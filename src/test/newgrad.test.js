/**
 * @file newgrad.test.js
 * @description Tests for the newgrad scraper, normalizer, and US-location filter.
 *
 * Run with: node --test src/test/newgrad.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/newgrad.js';
import { runScraper } from '../scrapers/index.js';
import { isUSLocation } from '../lib/us-location.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'newgrad-simplify.json');

// Single-source config used across tests — fixture is substituted for the URL at runtime.
const TEST_SOURCES = { simplify: 'https://example.com/listings.json' };

// ---------------------------------------------------------------------------
// scrape() — fixture loading and filtering
// ---------------------------------------------------------------------------

test('scrape returns one result object per source', async () => {
  const results = await scrape(TEST_SOURCES, { fixture: FIXTURE });
  assert.equal(results.length, 1, 'should have one result (one source)');
  assert.equal(results[0].source, 'simplify');
});

test('scrape returns exactly 2 active US jobs from a 5-entry fixture', async () => {
  const results = await scrape(TEST_SOURCES, { fixture: FIXTURE });
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 2, 'fixture has 2 active+visible US jobs');
});

test('scrape sets is_us=1 on returned jobs', async () => {
  const results = await scrape(TEST_SOURCES, { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.is_us, 1, `job ${job.external_id} should have is_us=1`);
  }
});

test('scrape sets sponsorship field from raw fixture', async () => {
  const results = await scrape(TEST_SOURCES, { fixture: FIXTURE });
  const stripe = results[0].jobs.find(j => j.company === 'Stripe');
  assert.ok(stripe, 'Stripe job should be in results');
  assert.equal(stripe.sponsorship, 'Does not sponsor');

  const databricks = results[0].jobs.find(j => j.company === 'Databricks');
  assert.ok(databricks, 'Databricks job should be in results');
  assert.equal(databricks.sponsorship, 'Sponsorship Available');
});

// ---------------------------------------------------------------------------
// runScraper() — DB upsert and scrape_runs recording
// ---------------------------------------------------------------------------

test('runScraper inserts jobs and records scrape_runs row', async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper('newgrad', TEST_SOURCES, db, {
      fixture: FIXTURE,
    });

    assert.equal(found, 2, 'found should equal 2');
    assert.equal(added, 2, 'added should equal 2 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'newgrad');
    assert.equal(run.found, 2);
    assert.equal(run.added, 2);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
});

test('jobs in DB have correct fields after insert', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });

    const jobs = db.prepare('SELECT * FROM jobs').all();
    assert.equal(jobs.length, 2);

    for (const job of jobs) {
      assert.ok(job.id, 'id should be set');
      assert.equal(job.source, 'simplify');
      assert.ok(job.company, 'company should be set');
      assert.ok(job.title, 'title should be set');
      assert.equal(job.is_us, 1, 'is_us should be 1');
      assert.equal(job.is_active, 1, 'is_active should be 1');
      assert.ok(job.canonical_key, 'canonical_key should be set');
    }
  } finally {
    db.close();
  }
});

test('re-running scraper with same fixture does not double-count', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });
    const second = await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 2, 'second run still found 2 jobs from feed');

    const jobCount = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(jobCount.c, 2, 'DB should still have exactly 2 jobs');

    const runCount = db.prepare('SELECT COUNT(*) AS c FROM scrape_runs').get();
    assert.equal(runCount.c, 2, 'should have 2 scrape_run records');
  } finally {
    db.close();
  }
});

test('canonical_key deduplication: same URL/company/title/location maps to 1 row', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });

    // Manually insert a job with a different id but the same canonical_key as an existing job
    const existing = db.prepare('SELECT * FROM jobs LIMIT 1').get();
    const fakeId = 'fake-different-id';

    db.prepare(`
      INSERT OR IGNORE INTO jobs
        (id, source, external_id, company, title, location, is_us, url,
         posted_at, first_seen, last_seen, is_active, canonical_key, sponsorship)
      VALUES (?, 'simplify', 'fake-ext', ?, ?, ?, 1, ?, NULL, datetime('now'), datetime('now'), 1, ?, NULL)
    `).run(
      fakeId,
      existing.company,
      existing.title,
      existing.location,
      existing.url,
      existing.canonical_key, // same canonical_key
    );

    // A subsequent runScraper run should not add another row for the original job
    const third = await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });
    assert.equal(third.added, 0, 'no new rows when canonical match exists');

    // The fake row we inserted manually + 2 original = 3
    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 3, 'DB should have original 2 + 1 manually inserted');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// isUSLocation — known cases
// ---------------------------------------------------------------------------

test('isUSLocation — US locations return true', () => {
  const cases = [
    'San Francisco, CA',
    'New York, NY',
    'Remote',
    'Remote, US',
    'Remote (US)',
    'United States',
    'Seattle, WA',
    'Texas',
    'California',
    'Austin, TX',
    'Chicago, IL',
    'Boston, MA',
    'USA',
  ];
  for (const loc of cases) {
    assert.equal(isUSLocation(loc), true, `expected true for: "${loc}"`);
  }
});

test('isUSLocation — non-US locations return false', () => {
  const cases = [
    'Toronto, Ontario, Canada',
    'Ottawa, ON, Canada',
    'Vancouver, BC, Canada',
    'London, UK',
    'London, United Kingdom',
    'Berlin, Germany',
    'Paris, France',
    'Sydney, Australia',
    'Bangalore, India',
    'Singapore',
    'Tokyo, Japan',
    'Dublin, Ireland',
    'Amsterdam, Netherlands',
  ];
  for (const loc of cases) {
    assert.equal(isUSLocation(loc), false, `expected false for: "${loc}"`);
  }
});

test('isUSLocation — edge cases', () => {
  assert.equal(isUSLocation(''), false, 'empty string');
  assert.equal(isUSLocation(null), false, 'null');
  assert.equal(isUSLocation(undefined), false, 'undefined');
});
