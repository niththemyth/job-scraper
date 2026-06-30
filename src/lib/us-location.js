/**
 * @file us-location.js
 * @description Determines whether a location string refers to a US location.
 * Uses string matching — no external dependencies.
 */

const US_STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana',
  'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota',
  'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
];

const US_STATE_ABBR = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS',
  'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK',
  'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
]);

// Non-US keywords checked before US detection to prevent false positives.
const NON_US_KEYWORDS = [
  'canada', 'ontario', 'british columbia', 'alberta', 'quebec', 'manitoba',
  'saskatchewan', 'nova scotia', 'new brunswick',
  'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa',
  'united kingdom', ' uk,', '(uk)', ', uk',
  'england', 'scotland', 'wales',
  'london', 'manchester', 'edinburgh',
  'germany', 'berlin', 'munich', 'frankfurt',
  'france', 'paris', 'lyon',
  'australia', 'sydney', 'melbourne', 'brisbane',
  'india', 'bangalore', 'hyderabad', 'mumbai', 'delhi', 'chennai', 'pune',
  'china', 'beijing', 'shanghai', 'shenzhen',
  'japan', 'tokyo', 'osaka',
  'south korea', 'seoul',
  'singapore',
  'ireland', 'dublin',
  'netherlands', 'amsterdam',
  'sweden', 'stockholm',
  'norway', 'oslo',
  'denmark', 'copenhagen',
  'switzerland', 'zurich', 'geneva',
  'spain', 'madrid', 'barcelona',
  'italy', 'rome', 'milan',
  'poland', 'warsaw',
  'czechia', 'prague',
  'austria', 'vienna',
  'belgium', 'brussels',
  'finland', 'helsinki',
  'portugal', 'lisbon',
  'brazil', 'são paulo', 'sao paulo',
  'mexico', 'mexico city',
  'israel', 'tel aviv',
  'new south wales', 'victoria',
];

/**
 * Returns true if the location string is a US location (or bare Remote).
 * Returns false for clearly non-US locations.
 *
 * @param {string} locationStr
 * @returns {boolean}
 */
export function isUSLocation(locationStr) {
  if (!locationStr || typeof locationStr !== 'string') return false;

  const str = locationStr.trim();
  if (str === '') return false;

  const lower = str.toLowerCase();

  // --- Non-US guard (check first to short-circuit false positives) ---
  for (const kw of NON_US_KEYWORDS) {
    if (lower.includes(kw)) return false;
  }

  // --- Explicit US markers ---
  if (lower === 'us' || lower === 'usa') return true;
  if (lower.includes('united states')) return true;

  // Ends with ", US" or ", USA" (e.g. "Remote, US")
  if (/,\s*usa?$/i.test(str)) return true;

  // Ends with "(US)" or "(USA)" (e.g. "Remote (US)")
  if (/\(usa?\)$/i.test(str)) return true;

  // Bare Remote — assume US-eligible
  if (lower === 'remote') return true;

  // "Remote, US" already caught above; also "Remote (US)" caught above.
  // Catch other leading-remote variants: "Remote - US", "Remote / US"
  if (/^remote\s*[-/]\s*us[^a-z]/i.test(str) || /^remote\s*[-/]\s*usa?$/i.test(str)) return true;

  // --- US state names (word-boundary aware) ---
  for (const state of US_STATE_NAMES) {
    const idx = lower.indexOf(state);
    if (idx === -1) continue;
    const before = idx === 0 ? '' : lower[idx - 1];
    const after = lower[idx + state.length];
    const okBefore = idx === 0 || /[\s,(]/.test(before);
    const okAfter = after === undefined || /[\s,)]/.test(after);
    if (okBefore && okAfter) return true;
  }

  // --- US state abbreviations in comma-separated parts (e.g. "City, ST") ---
  const parts = str.split(/,\s*/);
  for (const part of parts) {
    if (US_STATE_ABBR.has(part.trim().toUpperCase())) return true;
  }

  return false;
}
