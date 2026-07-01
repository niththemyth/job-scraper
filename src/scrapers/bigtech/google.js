/**
 * @file scrapers/bigtech/google.js
 * @description Scraper for Google job listings via the Google Careers search API.
 *
 * Fetches new-grad SWE roles from the Google Careers v3 search endpoint.
 * In test mode, loads from a local fixture file instead.
 *
 * Failure isolation: all errors are caught and [] is returned — never throws.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../../lib/hash.js';
import { isUSLocation } from '../../lib/us-location.js';

const COMPANY = 'Google';
const SOURCE = 'google';
const FETCH_URL =
  'https://careers.google.com/api/v3/search/?q=software+engineer+new+grad' +
  '&location_type=2&distance=50mi&jex=ENTRY_LEVEL';

/**
 * Maps a raw Google job object to the normalized DB schema shape.
 *
 * @param {object} job - Raw job from the Google Careers API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeJob(job) {
  const externalId = job.id?.toString() ?? '';
  const title = job.title ?? '';
  const location = job.locations?.[0]?.display ?? '';
  const url = job.applyUrl ?? '';
  const postedAt = job.created ?? null;
  const now = new Date().toISOString();

  return {
    id: hashId(SOURCE, externalId),
    source: SOURCE,
    external_id: externalId,
    company: COMPANY,
    title,
    location,
    url,
    description: job.description ?? null,
    posted_at: postedAt,
    first_seen: now,
    last_seen: now,
    is_active: 1,
    canonical_key: canonicalKey(url, COMPANY, title, location),
    is_us: isUSLocation(location) ? 1 : 0,
    sponsorship: null,
  };
}

/**
 * Runs the Google scraper.
 *
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<object[]>} Array of normalized jobs (empty on error)
 */
export async function scrape(options = {}) {
  try {
    let data;
    if (options.fixture) {
      data = JSON.parse(readFileSync(options.fixture, 'utf-8'));
    } else {
      const res = await fetch(FETCH_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching Google jobs`);
      data = await res.json();
    }
    const jobs = data.jobs ?? [];
    return jobs.map(normalizeJob);
  } catch (err) {
    console.warn(`[google] scrape failed: ${err.message}`);
    return [];
  }
}
