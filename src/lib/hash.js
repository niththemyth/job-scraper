/**
 * @file hash.js
 * @description Deterministic hashing utilities for job identity and cross-source deduplication.
 */
import { createHash } from 'node:crypto';

/**
 * Creates a deterministic hex string from source + externalId.
 * Used as the primary key for a job row.
 *
 * @param {string} source - The scraper source name (e.g. 'greenhouse', 'simplify')
 * @param {string} externalId - The source-specific job identifier
 * @returns {string} SHA-256 hex digest
 */
export function hashId(source, externalId) {
  return createHash('sha256')
    .update(`${source}:${externalId}`)
    .digest('hex');
}

/**
 * Strips query params and fragments from a URL string.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`;
  } catch {
    // Not a valid URL — fall through and return as-is lowercased
    return rawUrl.toLowerCase().trim();
  }
}

/**
 * Creates a canonical key for cross-source deduplication.
 * Normalizes URL (strips query params), lowercases+trims company/title/location.
 *
 * @param {string} url - Apply link URL
 * @param {string} company
 * @param {string} title
 * @param {string} [location]
 * @returns {string} SHA-256 hex digest
 */
export function canonicalKey(url, company, title, location = '') {
  const normUrl = normalizeUrl(url);
  const normCompany = company.toLowerCase().trim();
  const normTitle = title.toLowerCase().trim();
  const normLocation = location.toLowerCase().trim();

  const key = `${normUrl}|${normCompany}|${normTitle}|${normLocation}`;
  return createHash('sha256').update(key).digest('hex');
}
