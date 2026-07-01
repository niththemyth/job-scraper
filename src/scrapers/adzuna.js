/**
 * @file scrapers/adzuna.js
 * @description Scraper for Adzuna job search API.
 *
 * Requires ADZUNA_APP_ID and ADZUNA_APP_KEY env vars. If either is missing,
 * returns [] immediately with a console.warn and never throws.
 *
 * API endpoint:
 *   https://api.adzuna.com/v1/api/jobs/us/search/{page}?app_id={id}&app_key={key}&results_per_page=50&what={query}
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../lib/hash.js';
import { isUSLocation } from '../lib/us-location.js';

/**
 * Maps a raw Adzuna result object to the normalized DB schema shape.
 *
 * @param {object} result - Raw result from the Adzuna API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeAdzunaJob(result) {
  const source = 'adzuna';
  const externalId = result.id.toString();
  const company = result.company?.display_name ?? '';
  const title = result.title ?? '';
  const location = result.location?.display_name ?? '';
  const url = result.redirect_url ?? '';
  const description = result.description ?? null;
  const postedAt = result.created ?? null;
  const now = new Date().toISOString();

  return {
    id: hashId(source, externalId),
    source,
    external_id: externalId,
    company,
    title,
    location,
    url,
    description,
    department: null,
    salary_min: result.salary_min ?? null,
    salary_max: result.salary_max ?? null,
    salary_raw: null,
    posted_at: postedAt,
    first_seen: now,
    last_seen: now,
    is_active: 1,
    canonical_key: canonicalKey(url, company, title, location),
    is_us: isUSLocation(location) ? 1 : 0,
    sponsorship: null,
  };
}

/**
 * Fetches jobs for a single query from the Adzuna API.
 *
 * @param {string} query - Search keyword (e.g. "software engineer")
 * @param {string} appId - ADZUNA_APP_ID
 * @param {string} appKey - ADZUNA_APP_KEY
 * @returns {Promise<Array>} Raw result objects from the API
 */
async function fetchQuery(query, appId, appKey) {
  const encodedQuery = encodeURIComponent(query);
  const url =
    `https://api.adzuna.com/v1/api/jobs/us/search/1` +
    `?app_id=${appId}&app_key=${appKey}` +
    `&results_per_page=50&what=${encodedQuery}&content-type=application/json`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching Adzuna query: "${query}"`);
  }
  const data = await res.json();
  return data.results ?? [];
}

/**
 * Reads and parses a local JSON fixture file synchronously.
 *
 * @param {string} fixturePath
 * @returns {Array} Raw result objects
 */
function loadFixture(fixturePath) {
  const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  return data.results ?? [];
}

/**
 * Runs the Adzuna scraper for each query in the source config.
 *
 * Returns [] (not throws) if keys are missing or on any per-query error.
 *
 * @param {object} sourceConfig - { queries: string[], companyAllowList?: string[] }
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(sourceConfig, options = {}) {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    console.warn(
      '[adzuna] Missing ADZUNA_APP_ID or ADZUNA_APP_KEY env vars — skipping Adzuna scraper',
    );
    return [];
  }

  const queries = sourceConfig.queries ?? [];
  const companyAllowList = sourceConfig.companyAllowList ?? [];
  const results = [];

  for (const query of queries) {
    try {
      const rawResults = options?.fixture
        ? loadFixture(options.fixture)
        : await fetchQuery(query, appId, appKey);

      let jobs = rawResults.map(r => normalizeAdzunaJob(r));

      if (companyAllowList.length > 0) {
        jobs = jobs.filter(job =>
          companyAllowList.some(allowed =>
            job.company.toLowerCase().includes(allowed.toLowerCase()),
          ),
        );
      }

      results.push({ source: 'adzuna', jobs });
    } catch (err) {
      console.warn(`[adzuna] Error fetching query "${query}": ${err.message}`);
      results.push({ source: 'adzuna', jobs: [] });
    }
  }

  return results;
}
