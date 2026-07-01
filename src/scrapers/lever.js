/**
 * @file scrapers/lever.js
 * @description Scraper for Lever ATS public job boards.
 *
 * Fetches jobs from https://api.lever.co/v0/postings/{slug}?mode=json
 * for each company slug. In test mode, loads from a local fixture file instead.
 */
import { readFileSync } from 'node:fs';
import { hashId, canonicalKey } from '../lib/hash.js';
import { isUSLocation } from '../lib/us-location.js';

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
 * Maps a raw Lever posting object to the normalized DB schema shape.
 *
 * @param {object} posting - Raw posting from the Lever API
 * @param {string} slug - Company slug (used as company name)
 * @returns {object} Normalized job matching the DB schema
 */
function normalizeLeverJob(posting, slug) {
  const source = 'lever';
  const externalId = posting.id;
  const company = capitalizeSlug(slug);
  const title = posting.text ?? '';
  const location = posting.categories?.location ?? '';
  const url = posting.hostedUrl ?? '';
  const description = posting.descriptionPlain ?? null;
  const department = posting.categories?.team ?? null;
  const postedAt = posting.createdAt
    ? new Date(posting.createdAt).toISOString()
    : null;
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
 * Fetches jobs for a single Lever board slug from the public API.
 *
 * @param {string} slug
 * @returns {Promise<Array>}
 */
async function fetchSlug(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching Lever board: ${slug}`);
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
 * Runs the Lever scraper for each company slug.
 *
 * @param {string[]} slugs - Array of Lever company slugs
 * @param {{ fixture?: string }} [options]
 * @returns {Promise<Array<{ source: string, jobs: object[] }>>}
 */
export async function scrape(slugs, options = {}) {
  const results = [];

  for (const slug of slugs) {
    const rawJobs = options?.fixture
      ? loadFixture(options.fixture)
      : await fetchSlug(slug);

    const jobs = rawJobs.map(posting => normalizeLeverJob(posting, slug));

    results.push({ source: 'lever', jobs });
  }

  return results;
}
