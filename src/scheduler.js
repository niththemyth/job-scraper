/**
 * @file scheduler.js
 * @description Cron-based scheduler for running all scrapers and triggering alerts.
 */
import cron from 'node-cron';
import { runScraper } from './scrapers/index.js';

// Lazy-load alerter so it's a no-op if src/alerter.js doesn't exist yet.
let runAlerts = async () => {};
try {
  const mod = await import('./alerter.js');
  if (typeof mod.runAlerts === 'function') {
    runAlerts = mod.runAlerts;
  }
} catch {
  // alerter not yet implemented — safe to ignore
}

/**
 * Runs all configured scrapers with a concurrency cap of 3.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ sources: object, env: object, profile: object }} config
 */
export async function runAllScrapers(db, config) {
  const { sources, profile } = config;

  // Build the list of [sourceName, sourceConfig] pairs
  const tasks = [];

  if (sources.newgrad) tasks.push(['newgrad', sources.newgrad]);
  if (sources.greenhouse) tasks.push(['greenhouse', sources.greenhouse]);
  if (sources.lever) tasks.push(['lever', sources.lever]);
  if (sources.ashby) tasks.push(['ashby', sources.ashby]);
  if (sources.bigtech) tasks.push(['bigtech', sources.bigtech]);
  if (sources.adzuna) tasks.push(['adzuna', sources.adzuna]);
  if (sources.usajobs) tasks.push(['usajobs', sources.usajobs]);

  const CONCURRENCY = 3;
  const results = [];

  // Simple Promise pool — runs at most CONCURRENCY scrapers at a time
  let index = 0;

  async function runNext() {
    if (index >= tasks.length) return;
    const [sourceName, sourceConfig] = tasks[index++];
    console.log(`[scheduler] Starting scraper: ${sourceName}`);
    try {
      const result = await runScraper(sourceName, sourceConfig, db, {}, profile);
      console.log(`[scheduler] Finished scraper: ${sourceName} — found=${result.found}, added=${result.added}`);
      results.push({ sourceName, ...result });
    } catch (err) {
      console.error(`[scheduler] Error in scraper: ${sourceName}:`, err.message);
      results.push({ sourceName, error: err.message });
    }
    await runNext();
  }

  // Spin up CONCURRENCY workers
  const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, () => runNext());
  await Promise.all(workers);

  console.log('[scheduler] All scrapers complete.');

  // Trigger alerts (no-op if alerter not implemented)
  try {
    await runAlerts(db, config);
  } catch (err) {
    console.error('[scheduler] Alert error:', err.message);
  }

  return results;
}

/**
 * Starts the cron scheduler and immediately runs all scrapers on boot.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ env: { SCRAPE_INTERVAL_CRON?: string }, sources: object, profile: object }} config
 */
export function startScheduler(db, config) {
  const cronExpr = config.env?.SCRAPE_INTERVAL_CRON ?? '*/15 * * * *';

  // Run immediately on boot — don't wait for first tick
  console.log('[scheduler] Running initial scrape on boot...');
  runAllScrapers(db, config).catch(err => {
    console.error('[scheduler] Initial scrape failed:', err.message);
  });

  // Schedule recurring runs
  cron.schedule(cronExpr, () => {
    console.log(`[scheduler] Cron tick — starting scheduled scrape (${cronExpr})`);
    runAllScrapers(db, config).catch(err => {
      console.error('[scheduler] Scheduled scrape failed:', err.message);
    });
  });

  console.log(`[scheduler] Scheduler started with cron: ${cronExpr}`);
}
