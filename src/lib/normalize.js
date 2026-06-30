/**
 * @file normalize.js
 * @description Normalizes a raw job entry from a JSON feed into the DB schema shape.
 */
import { hashId, canonicalKey } from './hash.js';

/**
 * Normalizes a raw job entry from a SimplifyJobs-style JSON feed.
 *
 * @param {object} raw - Raw entry from the feed
 * @param {string} source - Source identifier (e.g. 'simplify', 'vanshb03')
 * @returns {object} Normalized job matching the DB schema
 */
export function normalizeJob(raw, source) {
  const location =
    Array.isArray(raw.locations) && raw.locations.length > 0
      ? raw.locations.join(', ')
      : (raw.location ?? '');

  const company = raw.company_name ?? '';
  const title = raw.title ?? '';
  const url = raw.url ?? '';
  const now = new Date().toISOString();

  return {
    id: hashId(source, String(raw.id)),
    source,
    external_id: String(raw.id),
    company,
    title,
    location,
    url,
    posted_at: raw.date_posted ? new Date(raw.date_posted * 1000).toISOString() : null,
    first_seen: now,
    last_seen: now,
    is_active: raw.active && raw.is_visible ? 1 : 0,
    canonical_key: canonicalKey(url, company, title, location),
    sponsorship: raw.sponsorship ?? null,
  };
}
