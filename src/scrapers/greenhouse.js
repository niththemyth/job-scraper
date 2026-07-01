/**
 * @file scrapers/greenhouse.js
 * @description Scraper for Greenhouse ATS public job boards.
 *
 * Fetches jobs from https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
 * for each company slug. In test mode, loads from a local fixture file instead.
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
 * Maps a raw Greenhouse job object to the normalized DB schema shape.
 *
 * @param {object} job - Raw job from the Greenhouse API
 * @param {string} slug - Company slug (used as company name)
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeGreenhouseJob(job, slug) {
  const source = 'greenhouse';
  const externalId = job.id.toString();
  const company = capitalizeSlug(slug);
  const title = job.title ?? '';
  const location = job.location?.name ?? '';
  const url = job.absolute_url ?? '';
  const description = job.content ? stripHtml(job.content) : null;
  const department = job.departments?.[0]?.name ?? null;
  const postedAt = job.updated_at ?? null;
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
  };
}

/**
 * Fetches jobs for a single Greenhouse board slug from the public API.
 *
 * @param {string} slug
 * @returns {Promise<Array>}
 */
async function fetchSlug(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching Greenhouse board: ${slug}`);
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
 * Runs the Greenhouse scraper for each company slug.
 *
 * @param {string[]} slugs - Array of Greenhouse company slugs
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(slugs, options = {}) {
  const results = [];

  for (const slug of slugs) {
    const rawJobs = options?.fixture
      ? loadFixture(options.fixture)
      : await fetchSlug(slug);

    const jobs = rawJobs.map(job => normalizeGreenhouseJob(job, slug));

    results.push({ source: 'greenhouse', jobs });
  }

  return results;
}
