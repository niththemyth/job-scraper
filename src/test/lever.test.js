/**
 * @file lever.test.js
 * @description Tests for the Lever ATS scraper adapter.
 *
 * Run with: node --test src/test/lever.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/lever.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'lever-netflix.json');

// ---------------------------------------------------------------------------
// scrape() — fixture loading and field mapping
// ---------------------------------------------------------------------------

test('scrape returns one result object per slug', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  assert.equal(results.length, 1, 'should have one result (one slug)');
  assert.equal(results[0].source, 'lever');
});

test('scrape returns all 3 jobs from fixture (non-US not filtered out)', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 3, 'all 3 fixture jobs should be returned');
});

test('scrape maps company from slug (capitalized)', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.company, 'Netflix', 'company should be capitalized slug');
  }
});

test('scrape maps title, location, and url correctly', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'abc001');
  assert.ok(job, 'job abc001 should be present');
  assert.equal(job.title, 'Software Engineer, Platform');
  assert.equal(job.location, 'Los Angeles, CA');
  assert.equal(job.url, 'https://jobs.lever.co/netflix/abc001');
});

test('scrape maps external_id as posting id string', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'abc001');
  assert.ok(job, 'job abc001 should be found by external_id');
  assert.equal(typeof job.external_id, 'string');
});

test('scrape sets source to "lever"', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.source, 'lever');
  }
});

test('scrape maps description from descriptionPlain', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'abc001');
  assert.ok(job.description, 'job should have a description');
  assert.ok(
    job.description.includes('Platform Engineering'),
    'description should contain plain text content',
  );
});

test('scrape maps department from categories.team', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'abc001');
  assert.equal(job.department, 'Platform Engineering');
  const remote = results[0].jobs.find(j => j.external_id === 'abc002');
  assert.equal(remote.department, 'Streaming');
});

test('scrape maps posted_at from createdAt (epoch ms to ISO)', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'abc001');
  assert.equal(job.posted_at, new Date(1748000000000).toISOString());
});

test('scrape sets is_us=1 for US locations', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const jobs = results[0].jobs;

  const la = jobs.find(j => j.external_id === 'abc001');    // Los Angeles, CA
  const remote = jobs.find(j => j.external_id === 'abc002'); // Remote

  assert.equal(la.is_us, 1, 'Los Angeles, CA should be is_us=1');
  assert.equal(remote.is_us, 1, 'Remote should be is_us=1');
});

test('scrape sets is_us=0 for non-US location', async () => {
  const results = await scrape(['netflix'], { fixture: FIXTURE });
  const amsterdam = results[0].jobs.find(j => j.external_id === 'abc003');
  assert.ok(amsterdam, 'Amsterdam job should be present');
  assert.equal(amsterdam.is_us, 0, 'Amsterdam, Netherlands should be is_us=0');
});

test('scrape generates deterministic id via hashId', async () => {
  const results1 = await scrape(['netflix'], { fixture: FIXTURE });
  const results2 = await scrape(['netflix'], { fixture: FIXTURE });
  const jobs1 = results1[0].jobs;
  const jobs2 = results2[0].jobs;
  for (let i = 0; i < jobs1.length; i++) {
    assert.equal(jobs1[i].id, jobs2[i].id, 'id should be deterministic across runs');
  }
});

// ---------------------------------------------------------------------------
// runScraper() — DB upsert and scrape_runs recording
// ---------------------------------------------------------------------------

test('runScraper with lever inserts jobs and records scrape_runs row', async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper('lever', ['netflix'], db, {
      fixture: FIXTURE,
    });

    assert.equal(found, 3, 'found should equal 3 (all fixture jobs)');
    assert.equal(added, 3, 'added should equal 3 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'lever');
    assert.equal(run.found, 3);
    assert.equal(run.added, 3);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
});

test('runScraper lever: re-running does not double-insert', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('lever', ['netflix'], db, { fixture: FIXTURE });
    const second = await runScraper('lever', ['netflix'], db, { fixture: FIXTURE });

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 3, 'second run should still find 3 jobs');

    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 3, 'DB should still have exactly 3 jobs');
  } finally {
    db.close();
  }
});

test('runScraper lever: jobs in DB have correct source field', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('lever', ['netflix'], db, { fixture: FIXTURE });
    const jobs = db.prepare('SELECT * FROM jobs').all();
    for (const job of jobs) {
      assert.equal(job.source, 'lever');
      assert.ok(job.id, 'id should be set');
      assert.ok(job.company, 'company should be set');
      assert.ok(job.title, 'title should be set');
      assert.ok(job.canonical_key, 'canonical_key should be set');
    }
  } finally {
    db.close();
  }
});
