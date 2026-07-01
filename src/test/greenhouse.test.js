/**
 * @file greenhouse.test.js
 * @description Tests for the Greenhouse ATS scraper adapter.
 *
 * Run with: node --test src/test/greenhouse.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/greenhouse.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'greenhouse-stripe.json');

// ---------------------------------------------------------------------------
// scrape() — fixture loading and field mapping
// ---------------------------------------------------------------------------

test('scrape returns one result object per slug', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  assert.equal(results.length, 1, 'should have one result (one slug)');
  assert.equal(results[0].source, 'greenhouse');
});

test('scrape returns all 5 jobs from fixture (non-US not filtered out)', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 5, 'all 5 fixture jobs should be returned');
});

test('scrape maps company from slug (capitalized)', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.company, 'Stripe', 'company should be capitalized slug');
  }
});

test('scrape maps title, location, and url correctly', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === '10001');
  assert.ok(job, 'job 10001 should be present');
  assert.equal(job.title, 'Software Engineer, Backend');
  assert.equal(job.location, 'San Francisco, CA');
  assert.equal(job.url, 'https://boards.greenhouse.io/stripe/jobs/10001');
});

test('scrape maps external_id as string of numeric id', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === '10001');
  assert.ok(job, 'job 10001 should be found by string external_id');
  assert.equal(typeof job.external_id, 'string');
});

test('scrape sets source to "greenhouse"', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.source, 'greenhouse');
  }
});

test('scrape strips HTML tags from description', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.ok(job.description, `job ${job.external_id} should have a description`);
    assert.doesNotMatch(
      job.description,
      /<[^>]+>/,
      `job ${job.external_id} description should not contain HTML tags`,
    );
  }
});

test('scrape description contains plain text content (not empty after strip)', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === '10001');
  assert.ok(job.description.length > 0, 'stripped description should not be empty');
  assert.ok(job.description.includes('backend engineer'), 'should contain text from HTML');
});

test('scrape sets is_us=1 for US locations', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const jobs = results[0].jobs;

  const sf = jobs.find(j => j.external_id === '10001');   // San Francisco, CA
  const remote = jobs.find(j => j.external_id === '10002'); // Remote
  const ny = jobs.find(j => j.external_id === '10003');   // New York, NY
  const seattle = jobs.find(j => j.external_id === '10005'); // Seattle, WA

  assert.equal(sf.is_us, 1, 'San Francisco, CA should be is_us=1');
  assert.equal(remote.is_us, 1, 'Remote should be is_us=1');
  assert.equal(ny.is_us, 1, 'New York, NY should be is_us=1');
  assert.equal(seattle.is_us, 1, 'Seattle, WA should be is_us=1');
});

test('scrape sets is_us=0 for non-US location', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const london = results[0].jobs.find(j => j.external_id === '10004');
  assert.ok(london, 'London job should be present');
  assert.equal(london.is_us, 0, 'London, United Kingdom should be is_us=0');
});

test('scrape maps department from first departments entry', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const engineering = results[0].jobs.find(j => j.external_id === '10001');
  assert.equal(engineering.department, 'Engineering');
  const intern = results[0].jobs.find(j => j.external_id === '10005');
  assert.equal(intern.department, 'University');
});

test('scrape maps posted_at from updated_at', async () => {
  const results = await scrape(['stripe'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === '10001');
  assert.equal(job.posted_at, '2026-06-01T00:00:00.000Z');
});

test('scrape generates deterministic id via hashId', async () => {
  const results1 = await scrape(['stripe'], { fixture: FIXTURE });
  const results2 = await scrape(['stripe'], { fixture: FIXTURE });
  const jobs1 = results1[0].jobs;
  const jobs2 = results2[0].jobs;
  for (let i = 0; i < jobs1.length; i++) {
    assert.equal(jobs1[i].id, jobs2[i].id, 'id should be deterministic across runs');
  }
});

// ---------------------------------------------------------------------------
// runScraper() — DB upsert and scrape_runs recording
// ---------------------------------------------------------------------------

test('runScraper with greenhouse inserts jobs and records scrape_runs row', async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper('greenhouse', ['stripe'], db, {
      fixture: FIXTURE,
    });

    assert.equal(found, 5, 'found should equal 5 (all fixture jobs)');
    assert.equal(added, 5, 'added should equal 5 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'greenhouse');
    assert.equal(run.found, 5);
    assert.equal(run.added, 5);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
});

test('runScraper greenhouse: re-running does not double-insert', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('greenhouse', ['stripe'], db, { fixture: FIXTURE });
    const second = await runScraper('greenhouse', ['stripe'], db, { fixture: FIXTURE });

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 5, 'second run should still find 5 jobs');

    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 5, 'DB should still have exactly 5 jobs');
  } finally {
    db.close();
  }
});

test('runScraper greenhouse: jobs in DB have correct source field', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('greenhouse', ['stripe'], db, { fixture: FIXTURE });
    const jobs = db.prepare('SELECT * FROM jobs').all();
    for (const job of jobs) {
      assert.equal(job.source, 'greenhouse');
      assert.ok(job.id, 'id should be set');
      assert.ok(job.company, 'company should be set');
      assert.ok(job.title, 'title should be set');
      assert.ok(job.canonical_key, 'canonical_key should be set');
    }
  } finally {
    db.close();
  }
});
