/**
 * @file scrapers/index.js
 * @description Orchestrates scraper runs: delegates to the appropriate scraper,
 * upserts results into the DB, and records a scrape_runs row.
 */
import { scrape as scrapeNewgrad } from './newgrad.js';
import { scrape as scrapeGreenhouse } from './greenhouse.js';
import { scrape as scrapeLever } from './lever.js';
import { scrape as scrapeAshby } from './ashby.js';

/**
 * Runs a named scraper, upserts results into the DB, and records a scrape_runs entry.
 *
 * Upsert logic:
 *  - If a row with matching `id` already exists → update `last_seen` + `is_active` only.
 *  - If no matching `id` but a row with the same `canonical_key` exists → skip (dedup).
 *  - Otherwise → insert new row.
 *
 * @param {string} sourceName - Scraper name, currently only 'newgrad'
 * @param {object} sourceConfig - Source configuration object passed to the scraper
 * @param {import('node:sqlite').DatabaseSync} db - DatabaseSync instance
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<{ found: number, added: number, updated: number }>}
 */
export async function runScraper(sourceName, sourceConfig, db, options = {}) {
  const startedAt = new Date().toISOString();
  let found = 0;
  let added = 0;
  let updated = 0;
  let errorMsg = null;

  try {
    let results;

    if (sourceName === 'newgrad') {
      results = await scrapeNewgrad(sourceConfig, options);
    } else if (sourceName === 'greenhouse') {
      results = await scrapeGreenhouse(sourceConfig, options);
    } else if (sourceName === 'lever') {
      results = await scrapeLever(sourceConfig, options);
    } else if (sourceName === 'ashby') {
      results = await scrapeAshby(sourceConfig, options);
    } else if (sourceName === 'bigtech') {
      // sourceConfig is an array of company names; URLs are hardcoded in each adapter
      results = [];
      for (const name of sourceConfig) {
        const { scrape } = await import(`./bigtech/${name}.js`);
        const jobs = await scrape(options);
        results.push({ jobs });
      }
    } else {
      throw new Error(`Unknown scraper: ${sourceName}`);
    }

    const stmtCheckId = db.prepare('SELECT id FROM jobs WHERE id = ?');
    const stmtCheckCanonical = db.prepare(
      'SELECT id FROM jobs WHERE canonical_key = ?',
    );
    const stmtInsert = db.prepare(`
      INSERT INTO jobs
        (id, source, external_id, company, title, location, is_us, url,
         posted_at, first_seen, last_seen, is_active, canonical_key, sponsorship)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const stmtUpdate = db.prepare(`
      UPDATE jobs SET last_seen = ?, is_active = ? WHERE id = ?
    `);

    for (const { jobs } of results) {
      found += jobs.length;

      for (const job of jobs) {
        const existing = stmtCheckId.get(job.id);

        if (existing) {
          stmtUpdate.run(new Date().toISOString(), job.is_active, job.id);
          updated++;
        } else {
          const canonicalDup = stmtCheckCanonical.get(job.canonical_key);
          if (canonicalDup) {
            // Different id but same canonical key — skip to avoid duplicates
            continue;
          }

          stmtInsert.run(
            job.id,
            job.source,
            job.external_id,
            job.company,
            job.title,
            job.location,
            job.is_us ?? 1,
            job.url,
            job.posted_at,
            job.first_seen,
            job.last_seen,
            job.is_active,
            job.canonical_key,
            job.sponsorship ?? null,
          );
          added++;
        }
      }
    }
  } catch (err) {
    errorMsg = err.message;
  }

  const finishedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO scrape_runs (source, started_at, finished_at, found, added, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceName, startedAt, finishedAt, found, added, errorMsg);

  return { found, added, updated };
}
