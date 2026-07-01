/**
 * @file scrapers/usajobs.js
 * @description Scraper for the USAJobs federal jobs API.
 *
 * Requires USAJOBS_API_KEY and USAJOBS_EMAIL env vars. If either is missing,
 * returns [] immediately with a console.warn and never throws.
 *
 * API endpoint:
 *   https://data.usajobs.gov/api/search?Keyword={query}&LocationName=United+States&ResultsPerPage=25&JobCategoryCode=2210
 *
 * Headers required:
 *   Authorization-Key: {USAJOBS_API_KEY}
 *   User-Agent: {USAJOBS_EMAIL}
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../lib/hash.js';
import { isUSLocation } from '../lib/us-location.js';

/**
 * Maps a raw USAJobs MatchedObjectDescriptor to the normalized DB schema shape.
 *
 * @param {object} descriptor - Raw MatchedObjectDescriptor from the USAJobs API
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeUSAJobsJob(descriptor) {
  const source = 'usajobs';
  const externalId = descriptor.PositionID ?? '';
  const company = 'US Government';
  const title = descriptor.PositionTitle ?? '';
  const location = descriptor.PositionLocation?.[0]?.LocationName ?? '';
  const url = descriptor.ApplyURI?.[0] ?? '';
  const description = descriptor.UserArea?.Details?.JobSummary ?? null;
  const postedAt = descriptor.PublicationStartDate ?? null;
  const now = new Date().toISOString();

  // Parse annual salary if available (RateIntervalCode = 'PA' = per annum)
  let salaryMin = null;
  let salaryMax = null;
  const remunerations = descriptor.PositionRemuneration ?? [];
  const annualRemun = remunerations.find(r => r.RateIntervalCode === 'PA');
  if (annualRemun) {
    salaryMin = parseFloat(annualRemun.MinimumRange);
    salaryMax = parseFloat(annualRemun.MaximumRange);
  }

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
    salary_min: salaryMin,
    salary_max: salaryMax,
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
 * Fetches jobs for a single keyword query from the USAJobs API.
 *
 * @param {string} query - Keyword search term
 * @param {string} apiKey - USAJOBS_API_KEY
 * @param {string} email - USAJOBS_EMAIL (used as User-Agent)
 * @returns {Promise<Array>} Raw MatchedObjectDescriptor objects
 */
async function fetchQuery(query, apiKey, email) {
  const encodedQuery = encodeURIComponent(query);
  const url =
    `https://data.usajobs.gov/api/search` +
    `?Keyword=${encodedQuery}&LocationName=United+States&ResultsPerPage=25&JobCategoryCode=2210`;

  const res = await fetch(url, {
    headers: {
      'Authorization-Key': apiKey,
      'User-Agent': email,
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching USAJobs query: "${query}"`);
  }

  const data = await res.json();
  return (data.SearchResult?.SearchResultItems ?? []).map(
    item => item.MatchedObjectDescriptor,
  );
}

/**
 * Reads and parses a local JSON fixture file synchronously.
 *
 * @param {string} fixturePath
 * @returns {Array} Raw MatchedObjectDescriptor objects
 */
function loadFixture(fixturePath) {
  const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  return (data.SearchResult?.SearchResultItems ?? []).map(
    item => item.MatchedObjectDescriptor,
  );
}

/**
 * Runs the USAJobs scraper for each query in the source config.
 *
 * Returns [] (not throws) if keys are missing or on any per-query error.
 *
 * @param {object} sourceConfig - { queries: string[] }
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(sourceConfig, options = {}) {
  const apiKey = process.env.USAJOBS_API_KEY;
  const email = process.env.USAJOBS_EMAIL;

  if (!apiKey || !email) {
    console.warn(
      '[usajobs] Missing USAJOBS_API_KEY or USAJOBS_EMAIL env vars — skipping USAJobs scraper',
    );
    return [];
  }

  const queries = sourceConfig.queries ?? [];
  const results = [];

  for (const query of queries) {
    try {
      const descriptors = options?.fixture
        ? loadFixture(options.fixture)
        : await fetchQuery(query, apiKey, email);

      const jobs = descriptors.map(d => normalizeUSAJobsJob(d));
      results.push({ source: 'usajobs', jobs });
    } catch (err) {
      console.warn(`[usajobs] Error fetching query "${query}": ${err.message}`);
      results.push({ source: 'usajobs', jobs: [] });
    }
  }

  return results;
}
