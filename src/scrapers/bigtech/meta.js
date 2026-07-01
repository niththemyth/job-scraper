/**
 * @file scrapers/bigtech/meta.js
 * @description Scraper for Meta job listings via the Meta Careers GraphQL API.
 *
 * Fetches SWE roles from the Meta Careers GraphQL endpoint.
 * In test mode, loads from a local fixture file instead.
 *
 * NOTE: Meta's GraphQL schema changes frequently. If the fetch or parsing fails,
 * a warning is logged and [] is returned — this adapter must never throw.
 *
 * Failure isolation: all errors are caught and [] is returned — never throws.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../../lib/hash.js';
import { isUSLocation } from '../../lib/us-location.js';

const COMPANY = 'Meta';
const SOURCE = 'meta';
const BASE_URL = 'https://www.metacareers.com/jobs';
const FETCH_URL = 'https://www.metacareers.com/graphql';
const GRAPHQL_BODY = JSON.stringify({
  operationName: 'SearchJobsQuery',
  variables: {
    search_input: {
      q: 'software engineer',
      divisions: [],
      offices: [],
      roles: [],
      leadership_levels: [],
      saved_jobs: [],
      saved_searches: [],
      sub_teams: [],
      teams: [],
      is_leadership: false,
      normalized_location: 'United States',
      results_per_page: 20,
      page: 1,
      sort_by_new: true,
    },
  },
});

/**
 * Maps a raw Meta job object to the normalized DB schema shape.
 *
 * @param {object} job - Raw job from the Meta Careers GraphQL API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeJob(job) {
  const externalId = job.id?.toString() ?? '';
  const title = job.title ?? '';
  const location = job.location ?? '';
  const url = `${BASE_URL}/${externalId}`;
  const postedAt = job.post_date ?? null;
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
 * Runs the Meta scraper.
 *
 * Meta's GraphQL schema changes frequently — if the fetch fails or the response
 * shape is unexpected, a warning is logged and [] is returned (never throws).
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
        body: GRAPHQL_BODY,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching Meta jobs`);
      data = await res.json();
    }
    // Meta's GraphQL schema changes frequently — defensive access
    const jobs = data?.data?.job_search?.jobs ?? [];
    return jobs.map(normalizeJob);
  } catch (err) {
    console.warn(`[meta] scrape failed (GraphQL schema may have changed): ${err.message}`);
    return [];
  }
}
