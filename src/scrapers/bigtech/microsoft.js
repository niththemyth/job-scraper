/**
 * @file scrapers/bigtech/microsoft.js
 * @description Scraper for Microsoft job listings via the Microsoft Careers search API.
 *
 * Fetches new-grad / student SWE roles from the Microsoft GCS services search endpoint.
 * In test mode, loads from a local fixture file instead.
 *
 * Failure isolation: all errors are caught and [] is returned — never throws.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../../lib/hash.js';
import { isUSLocation } from '../../lib/us-location.js';

const COMPANY = 'Microsoft';
const SOURCE = 'microsoft';
const BASE_URL = 'https://careers.microsoft.com/us/en/job';
const FETCH_URL =
  'https://gcsservices.careers.microsoft.com/search/api/v1/search' +
  '?q=software+engineer&lc=United+States&exp=Students+and+recent+graduates' +
  '&et=Full-Time&lang=en_us&pgSz=20&pg=1&flc=NewGrad';

/**
 * Maps a raw Microsoft job object to the normalized DB schema shape.
 *
 * @param {object} job - Raw job from the Microsoft Careers API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeJob(job) {
  const externalId = job.jobId?.toString() ?? '';
  const title = job.title ?? '';
  const props = job.properties ?? {};
  const location = props.primaryWorkLocation ?? '';
  const url = `${BASE_URL}/${externalId}`;
  const postedAt = props.postedDate ?? null;
  const now = new Date().toISOString();

  return {
    id: hashId(SOURCE, externalId),
    source: SOURCE,
    external_id: externalId,
    company: COMPANY,
    title,
    location,
    url,
    description: props.description ?? null,
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
 * Runs the Microsoft scraper.
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
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching Microsoft jobs`);
      data = await res.json();
    }
    const jobs = data.operationResult?.result?.jobs ?? [];
    return jobs.map(normalizeJob);
  } catch (err) {
    console.warn(`[microsoft] scrape failed: ${err.message}`);
    return [];
  }
}
