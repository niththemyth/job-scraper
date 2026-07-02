/**
 * @file scrapers/newgrad.js
 * @description Scraper for SimplifyJobs-style new-grad JSON feeds.
 *
 * Processes one or more feed URLs from the `newgrad` sources config.
 * In test mode, reads from a local fixture file instead of fetching.
 */
import { readFileSync } from 'node:fs';
import { normalizeJob } from '../lib/normalize.js';
import { isUSLocation } from '../lib/us-location.js';

/**
 * Fetches and parses a JSON feed from a URL.
 *
 * @param {string} url
 * @returns {Promise<Array>}
 */
async function fetchFeed(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.json();
}

/**
 * Reads and parses a local JSON fixture file synchronously.
 *
 * @param {string} fixturePath
 * @returns {Array}
 */
function loadFixture(fixturePath) {
  return JSON.parse(readFileSync(fixturePath, 'utf-8'));
}

/**
 * Processes a single feed (fetch or fixture) and returns normalized US-only jobs.
 *
 * @param {string} sourceKey
 * @param {string} url
 * @param {{ fixture?: string }} options
 * @returns {Promise<{ source: string, jobs: object[] }>}
 */
async function processFeed(sourceKey, url, options) {
  const rawEntries = options?.fixture
    ? loadFixture(options.fixture)
    : await fetchFeed(url);

  // 1. Filter active AND visible entries
  const activeEntries = rawEntries.filter(e => e.active && e.is_visible);

  // 2. Normalize
  const normalized = activeEntries.map(e => normalizeJob(e, sourceKey));

  // 3. Annotate is_us and filter to US-only
  const usJobs = normalized
    .map(job => ({ ...job, is_us: isUSLocation(job.location) ? 1 : 0 }))
    .filter(job => job.is_us === 1);

  return { source: sourceKey, jobs: usJobs };
}

/**
 * Runs the newgrad scraper for each configured feed.
 *
 * @param {object} sources - The `newgrad` section from config/sources.json
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(sources, options = {}) {
  const results = [];

  for (const [key, value] of Object.entries(sources)) {
    // Skip non-URL entries (e.g. jobrightMarkdown: false)
    if (typeof value !== 'string') continue;

    try {
      results.push(await processFeed(key, value, options));
    } catch (err) {
      console.warn(`[newgrad] feed "${key}" failed: ${err.message}`);
    }
  }

  return results;
}
