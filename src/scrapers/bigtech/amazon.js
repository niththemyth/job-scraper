/**
 * @file scrapers/bigtech/amazon.js
 * @description Scraper for Amazon job listings via the amazon.jobs search API.
 *
 * Fetches new-grad SWE roles from the Amazon jobs search endpoint.
 * In test mode, loads from a local fixture file instead.
 *
 * Failure isolation: all errors are caught and [] is returned — never throws.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../../lib/hash.js';
import { isUSLocation } from '../../lib/us-location.js';

const COMPANY = 'Amazon';
const SOURCE = 'amazon';
const BASE_URL = 'https://www.amazon.jobs';
const FETCH_URL =
  `${BASE_URL}/en/search.json?normalized_job_title=Software%20Development%20Engineer` +
  `&country_code%5B%5D=US&radius=24km&facets%5B%5D=normalized_country_code` +
  `&facets%5B%5D=normalized_state_name&facets%5B%5D=normalized_city_name` +
  `&facets%5B%5D=location&facets%5B%5D=business_category&facets%5B%5D=category` +
  `&facets%5B%5D=schedule_type_id&facets%5B%5D=employee_class` +
  `&facets%5B%5D=normalized_job_title&facets%5B%5D=job_function_id` +
  `&offset=0&result_limit=100&sort=relevant&latitude=&longitude=&loc_group_id=` +
  `&loc_query=&base_query=software+engineer+new+grad&city=&country=&region=` +
  `&county=&query_options=&`;

/**
 * Maps a raw Amazon hit object to the normalized DB schema shape.
 *
 * @param {object} hit - Raw job hit from the Amazon search API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeJob(hit) {
  const externalId = hit.id_icims?.toString() ?? '';
  const title = hit.title ?? '';
  const location = hit.location ?? '';
  const url = `${BASE_URL}${hit.job_path ?? ''}`;
  const postedAt = hit.posted_date ?? null;
  const now = new Date().toISOString();

  return {
    id: hashId(SOURCE, externalId),
    source: SOURCE,
    external_id: externalId,
    company: COMPANY,
    title,
    location,
    url,
    description: hit.description_short ?? null,
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
 * Runs the Amazon scraper.
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
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching Amazon jobs`);
      data = await res.json();
    }
    const hits = data.hits ?? [];
    return hits.map(normalizeJob);
  } catch (err) {
    console.warn(`[amazon] scrape failed: ${err.message}`);
    return [];
  }
}
