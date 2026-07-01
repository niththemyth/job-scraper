/**
 * @file scrapers/ashby.js
 * @description Scraper for Ashby ATS public job boards.
 *
 * Fetches jobs from POST https://api.ashbyhq.com/posting-api/job-board/{slug}
 * with body { "includeCompensation": true } for each company slug.
 * In test mode, loads from a local fixture file instead.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../lib/hash.js';
import { isUSLocation } from '../lib/us-location.js';

/**
 * Strips HTML tags from a string using a simple regex.
 *
 * @param {string} str
 * @returns {string}
 */
function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Capitalizes the first letter of a slug to produce a display company name.
 *
 * @param {string} slug
 * @returns {string}
 */
function capitalizeSlug(slug) {
  if (!slug) return '';
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * Maps a raw Ashby job object to the normalized DB schema shape.
 *
 * @param {object} job - Raw job from the Ashby API
 * @param {string} slug - Company slug (used as company name)
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeAshbyJob(job, slug) {
  const source = 'ashby';
  const externalId = job.id;
  const company = capitalizeSlug(slug);
  const title = job.title ?? '';
  const location = job.locationName ?? '';
  const url = job.jobUrl ?? '';
  const description = job.descriptionHtml ? stripHtml(job.descriptionHtml) : null;
  const department = job.departmentName ?? null;
  const postedAt = job.publishedAt ?? null;
  const salaryRaw = job.compensation?.summaryShort ?? null;
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
    department,
    posted_at: postedAt,
    first_seen: now,
    last_seen: now,
    is_active: 1,
    canonical_key: canonicalKey(url, company, title, location),
    is_us: isUSLocation(location) ? 1 : 0,
    sponsorship: null,
    salary_raw: salaryRaw,
  };
}

/**
 * Fetches jobs for a single Ashby board slug from the public API.
 *
 * @param {string} slug
 * @returns {Promise<Array>}
 */
async function fetchSlug(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ includeCompensation: true }),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching Ashby board: ${slug}`);
  }
  const data = await res.json();
  return data.jobs ?? [];
}

/**
 * Reads and parses a local JSON fixture file synchronously.
 *
 * @param {string} fixturePath
 * @returns {Array}
 */
function loadFixture(fixturePath) {
  const data = JSON.parse(readFileSync(fixturePath, 'utf-8'));
  return data.jobs ?? [];
}

/**
 * Runs the Ashby scraper for each company slug.
 *
 * @param {string[]} slugs - Array of Ashby company slugs
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(slugs, options = {}) {
  const results = [];

  for (const slug of slugs) {
    const rawJobs = options?.fixture
      ? loadFixture(options.fixture)
      : await fetchSlug(slug);

    const jobs = rawJobs.map(job => normalizeAshbyJob(job, slug));

    results.push({ source: 'ashby', jobs });
  }

  return results;
}
