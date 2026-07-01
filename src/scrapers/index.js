/**
 * @file scrapers/index.js
 * @description Orchestrates scraper runs: delegates to the appropriate scraper,
 * upserts results into the DB, and records a scrape_runs row.
 */
import { scrape as scrapeNewgrad } from './newgrad.js';
import { scrape as scrapeGreenhouse } from './greenhouse.js';
import { scrape as scrapeLever } from './lever.js';
import { scrape as scrapeAshby } from './ashby.js';
import { scrape as scrapeAdzuna } from './adzuna.js';
import { scrape as scrapeUSAJobs } from './usajobs.js';
import { isUSLocation } from '../lib/us-location.js';
import { inferMinYears, inferSeniority, scoreJob } from '../lib/match.js';
import { parseSalaryFromDescription } from '../lib/salary.js';
import { passesFilter } from '../lib/filter.js';

/**
 * Runs a named scraper, upserts results into the DB, and records a scrape_runs entry.
 *
 * Processing pipeline (before upsert):
 *  1. inferMinYears(job.description) → job.min_years
 *  2. inferSeniority(job.title) → job.seniority
 *  3. scoreJob(job, profile) → job.match_score
 *  4. If salary_min/salary_max null: parseSalaryFromDescription → merge salary fields
 *  5. job.is_us from isUSLocation(job.location)
 *  6. passesFilter(job, profile) → skip if false
 *
 * Upsert logic:
 *  - If a row with matching `id` already exists → update `last_seen` + `is_active` only.
 *  - If no matching `id` but a row with the same `canonical_key` exists → skip (dedup).
 *  - Otherwise → insert new row.
 *
 * @param {string} sourceName
 * @param {object} sourceConfig - Source configuration object passed to the scraper
 * @param {import('node:sqlite').DatabaseSync} db - DatabaseSync instance
 * @param {{ fixture?: string }} [options]
 * @param {object} [profile] - User profile for filtering/scoring; if omitted, no filtering applied
 * @returns {Promise<{ found: number, added: number, updated: number }>}
 */
export async function runScraper(sourceName, sourceConfig, db, options = {}, profile = null) {
  const startedAt = new Date().toISOString();
  let found = 0;
  let added = 0;
  let updated = 0;
  let errorMsg = null;

  try {
    let results;

    if (sourceName === 'newgrad') {
      results = await scrapeNewgrad(sourceConfig, options);
    } else if (sourceName === 'greenhouse') {
      results = await scrapeGreenhouse(sourceConfig, options);
    } else if (sourceName === 'lever') {
      results = await scrapeLever(sourceConfig, options);
    } else if (sourceName === 'ashby') {
      results = await scrapeAshby(sourceConfig, options);
    } else if (sourceName === 'bigtech') {
      // sourceConfig is an array of company names; URLs are hardcoded in each adapter
      results = [];
      for (const name of sourceConfig) {
        const { scrape } = await import(`./bigtech/${name}.js`);
        const jobs = await scrape(options);
        results.push({ jobs });
      }
    } else if (sourceName === 'adzuna') {
      results = await scrapeAdzuna(sourceConfig, options);
    } else if (sourceName === 'usajobs') {
      results = await scrapeUSAJobs(sourceConfig, options);
    } else {
      throw new Error(`Unknown scraper: ${sourceName}`);
    }

    const stmtCheckId = db.prepare('SELECT id FROM jobs WHERE id = ?');
    const stmtCheckCanonical = db.prepare(
      'SELECT id FROM jobs WHERE canonical_key = ?',
    );
    const stmtInsert = db.prepare(`
      INSERT INTO jobs
        (id, source, external_id, company, title, location, is_us, remote, url,
         description, department, posted_at, seniority, min_years, match_score,
         salary_min, salary_max, salary_raw, salary_currency,
         first_seen, last_seen, is_active, canonical_key, sponsorship)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const stmtUpdate = db.prepare(`
      UPDATE jobs SET last_seen = ?, is_active = ? WHERE id = ?
    `);

    for (const { jobs } of results) {
      found += jobs.length;

      for (const job of jobs) {
        // --- Processing pipeline ---

        // 1. Infer min_years from description if not already set
        if (job.min_years == null) {
          job.min_years = inferMinYears(job.description);
        }

        // 2. Infer seniority from title if not already set
        if (!job.seniority) {
          job.seniority = inferSeniority(job.title);
        }

        // 3. Score against profile skills
        if (profile) {
          job.match_score = scoreJob(job, profile);
        } else {
          job.match_score = job.match_score ?? 0;
        }

        // 4. Parse salary from description if structured salary not present
        if (job.salary_min == null && job.salary_max == null) {
          const parsed = parseSalaryFromDescription(job.description);
          if (parsed) {
            job.salary_min = parsed.salary_min;
            job.salary_max = parsed.salary_max;
            job.salary_raw = parsed.salary_raw;
          }
        }

        // 5. Set is_us from location
        job.is_us = isUSLocation(job.location) ? 1 : 0;

        // 6. Filter — skip jobs that don't pass the profile filter
        if (profile && !passesFilter(job, profile)) {
          found--;
          continue;
        }

        // --- Upsert ---
        const existing = stmtCheckId.get(job.id);

        if (existing) {
          stmtUpdate.run(new Date().toISOString(), job.is_active, job.id);
          updated++;
        } else {
          const canonicalDup = stmtCheckCanonical.get(job.canonical_key);
          if (canonicalDup) {
            // Different id but same canonical key — skip to avoid duplicates
            continue;
          }

          stmtInsert.run(
            job.id,
            job.source,
            job.external_id,
            job.company,
            job.title,
            job.location,
            job.is_us ?? 1,
            job.remote ?? null,
            job.url,
            job.description ?? null,
            job.department ?? null,
            job.posted_at,
            job.seniority ?? null,
            job.min_years ?? null,
            job.match_score ?? 0,
            job.salary_min ?? null,
            job.salary_max ?? null,
            job.salary_raw ?? null,
            job.salary_currency ?? null,
            job.first_seen,
            job.last_seen,
            job.is_active,
            job.canonical_key,
            job.sponsorship ?? null,
          );
          added++;
        }
      }
    }
  } catch (err) {
    errorMsg = err.message;
  }

  const finishedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO scrape_runs (source, started_at, finished_at, found, added, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sourceName, startedAt, finishedAt, found, added, errorMsg);

  return { found, added, updated };
}
