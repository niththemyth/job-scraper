/**
 * @file scrapers/bigtech/apple.js
 * @description Scraper for Apple job listings via the Apple Jobs role search API.
 *
 * Fetches SWE roles from the Apple Jobs POST search endpoint.
 * In test mode, loads from a local fixture file instead.
 *
 * Failure isolation: all errors are caught and [] is returned — never throws.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../../lib/hash.js';
import { isUSLocation } from '../../lib/us-location.js';

const COMPANY = 'Apple';
const SOURCE = 'apple';
const BASE_URL = 'https://jobs.apple.com/en-us/details';
const FETCH_URL = 'https://jobs.apple.com/api/role/search';
const FETCH_BODY = JSON.stringify({
  query: 'software engineer',
  filters: {
    range: { standardWeeklyHours: { start: 40, end: 40 } },
    location: 'USA',
  },
  page: 0,
  locale: 'en-us',
  sort: 'relevance',
});

/**
 * Maps a raw Apple search result object to the normalized DB schema shape.
 *
 * @param {object} result - Raw job from the Apple Jobs search API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeJob(result) {
  const externalId = result.positionId?.toString() ?? '';
  const title = result.postingTitle ?? '';
  const location = result.locations?.[0]?.name ?? '';
  const url = `${BASE_URL}/${externalId}`;
  const postedAt = result.postingDate ?? null;
  const now = new Date().toISOString();

  return {
    id: hashId(SOURCE, externalId),
    source: SOURCE,
    external_id: externalId,
    company: COMPANY,
    title,
    location,
    url,
    description: result.jobSummary ?? null,
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
 * Runs the Apple scraper.
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
      const res = await fetch(FETCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: FETCH_BODY,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching Apple jobs`);
      data = await res.json();
    }
    const results = data.searchResults ?? [];
    return results.map(normalizeJob);
  } catch (err) {
    console.warn(`[apple] scrape failed: ${err.message}`);
    return [];
  }
}
