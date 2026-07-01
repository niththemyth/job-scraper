/**
 * @file lib/match.js
 * @description Job match scoring and inference helpers.
 */

/**
 * Counts how many of profile.skills appear in the job's title + description.
 *
 * @param {{ title: string, description?: string }} job
 * @param {{ skills: string[] }} profile
 * @returns {number} match_score — count of matching skills
 */
export function scoreJob(job, profile) {
  const text = `${job.title} ${job.description || ''}`.toLowerCase();
  return profile.skills.filter(skill => text.includes(skill.toLowerCase())).length;
}

/**
 * Infers minimum years of experience from a job description.
 * Looks for patterns like "5+ years", "minimum 3 years", "2+ years of experience".
 * Returns the highest number found, or null if none.
 *
 * @param {string|null|undefined} description
 * @returns {number|null}
 */
export function inferMinYears(description) {
  if (!description) return null;

  const patterns = [
    /(\d+)\+?\s*years?\s+of\s+(?:relevant\s+)?(?:professional\s+)?experience/gi,
    /minimum\s+(?:of\s+)?(\d+)\+?\s*years?/gi,
    /at\s+least\s+(\d+)\+?\s*years?/gi,
    /(\d+)\+\s*years?/gi,
    /(\d+)\s+years?\s+(?:of\s+)?(?:experience|professional)/gi,
  ];

  let max = null;

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const n = parseInt(match[1], 10);
      if (max === null || n > max) max = n;
    }
  }

  return max;
}

/**
 * Infers seniority level from a job title.
 *
 * @param {string|null|undefined} title
 * @returns {'entry'|'mid'|'senior'|'unknown'}
 */
export function inferSeniority(title) {
  if (!title) return 'unknown';
  const lower = title.toLowerCase();

  const entryKeywords = ['new grad', 'entry', 'junior', 'associate'];
  for (const kw of entryKeywords) {
    if (lower.includes(kw)) return 'entry';
  }

  const seniorKeywords = ['senior', 'sr.', 'staff', 'principal', 'lead'];
  for (const kw of seniorKeywords) {
    if (lower.includes(kw)) return 'senior';
  }

  return 'unknown';
}
