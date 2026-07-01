/**
 * @file lib/salary.js
 * @description Parses salary ranges from free-text job descriptions.
 */

/**
 * Converts a salary token like "120k" or "120,000" to an integer.
 *
 * @param {string} raw - e.g. "120k", "120,000"
 * @returns {number}
 */
function parseAmount(raw) {
  const cleaned = raw.replace(/,/g, '');
  if (/k$/i.test(cleaned)) {
    return Math.round(parseFloat(cleaned) * 1000);
  }
  return parseInt(cleaned, 10);
}

/**
 * Parses salary information from a job description.
 *
 * Recognizes patterns like:
 *   $120k–$160k   $120,000-$160,000   $80k+
 *
 * @param {string|null|undefined} description
 * @returns {{ salary_min: number, salary_max: number|null, salary_raw: string } | null}
 */
export function parseSalaryFromDescription(description) {
  if (!description) return null;

  // Match range: $120k-$160k, $120,000–$160,000, etc.
  const rangeRe = /\$(\d[\d,]*k?)\s*[-–—]\s*\$(\d[\d,]*k?)/gi;
  // Match open-ended: $80k+
  const openRe = /\$(\d[\d,]*k?)\+/gi;

  let match;

  // Try range first
  match = rangeRe.exec(description);
  if (match) {
    const salary_min = parseAmount(match[1]);
    const salary_max = parseAmount(match[2]);
    return { salary_min, salary_max, salary_raw: match[0] };
  }

  // Try open-ended
  match = openRe.exec(description);
  if (match) {
    const salary_min = parseAmount(match[1]);
    return { salary_min, salary_max: null, salary_raw: match[0] };
  }

  return null;
}
