/**
 * @file lib/filter.js
 * @description Job filtering based on user profile preferences.
 */

/**
 * Returns true if the job passes the profile's title and entry-level filters.
 *
 * Rules:
 * 1. Title must contain at least one substring from profile.includeTitles (case-insensitive).
 * 2. Title must NOT contain any substring from profile.excludeTitles (case-insensitive).
 * 3. If profile.entryLevelOnly is true: if job.min_years is not null and
 *    job.min_years > profile.maxYearsExperience, return false. null min_years passes.
 *
 * @param {{ title: string, min_years: number|null }} job
 * @param {{ includeTitles: string[], excludeTitles: string[], entryLevelOnly: boolean, maxYearsExperience: number }} profile
 * @returns {boolean}
 */
export function passesFilter(job, profile) {
  const titleLower = (job.title || '').toLowerCase();

  // Must match at least one includeTitles substring
  const hasInclude = profile.includeTitles.some(sub => titleLower.includes(sub.toLowerCase()));
  if (!hasInclude) return false;

  // Must not match any excludeTitles substring
  const hasExclude = profile.excludeTitles.some(sub => titleLower.includes(sub.toLowerCase()));
  if (hasExclude) return false;

  // Entry-level gate
  if (profile.entryLevelOnly) {
    if (job.min_years !== null && job.min_years !== undefined && job.min_years > profile.maxYearsExperience) {
      return false;
    }
  }

  return true;
}
