/**
 * @file ashby.test.js
 * @description Tests for the Ashby ATS scraper adapter.
 *
 * Run with: node --test src/test/ashby.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/ashby.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'ashby-openai.json');

// ---------------------------------------------------------------------------
// scrape() — fixture loading and field mapping
// ---------------------------------------------------------------------------

test('scrape returns one result object per slug', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  assert.equal(results.length, 1, 'should have one result (one slug)');
  assert.equal(results[0].source, 'ashby');
});

test('scrape returns all 3 jobs from fixture (non-US not filtered out)', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 3, 'all 3 fixture jobs should be returned');
});

test('scrape maps company from slug (capitalized)', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.company, 'Openai', 'company should be capitalized slug');
  }
});

test('scrape maps title, location, and url correctly', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.ok(job, 'job oa-001 should be present');
  assert.equal(job.title, 'Software Engineer, Research');
  assert.equal(job.location, 'San Francisco, CA');
  assert.equal(job.url, 'https://jobs.ashbyhq.com/openai/oa-001');
});

test('scrape maps external_id as job id string', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.ok(job, 'job oa-001 should be found by external_id');
  assert.equal(typeof job.external_id, 'string');
});

test('scrape sets source to "ashby"', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.source, 'ashby');
  }
});

test('scrape strips HTML tags from descriptionHtml', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
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
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.ok(job.description.length > 0, 'stripped description should not be empty');
  assert.ok(
    job.description.includes('software engineer'),
    'should contain text from HTML',
  );
});

test('scrape maps department from departmentName', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const research = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.equal(research.department, 'Research');
  const applied = results[0].jobs.find(j => j.external_id === 'oa-002');
  assert.equal(applied.department, 'Applied AI');
});

test('scrape maps posted_at from publishedAt', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.equal(job.posted_at, '2026-05-15T00:00:00.000Z');
});

test('scrape sets is_us=1 for US locations', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const jobs = results[0].jobs;

  const sf = jobs.find(j => j.external_id === 'oa-001');  // San Francisco, CA
  const ny = jobs.find(j => j.external_id === 'oa-002');  // New York, NY

  assert.equal(sf.is_us, 1, 'San Francisco, CA should be is_us=1');
  assert.equal(ny.is_us, 1, 'New York, NY should be is_us=1');
});

test('scrape sets is_us=0 for non-US location', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const toronto = results[0].jobs.find(j => j.external_id === 'oa-003');
  assert.ok(toronto, 'Toronto job should be present');
  assert.equal(toronto.is_us, 0, 'Toronto, Canada should be is_us=0');
});

test('scrape maps salary_raw from compensation.summaryShort when present', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-002');
  assert.equal(job.salary_raw, '$200k-$370k', 'salary_raw should be set from compensation.summaryShort');
});

test('scrape sets salary_raw to null when compensation is absent', async () => {
  const results = await scrape(['openai'], { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'oa-001');
  assert.equal(job.salary_raw, null, 'salary_raw should be null when no compensation');
});

test('scrape generates deterministic id via hashId', async () => {
  const results1 = await scrape(['openai'], { fixture: FIXTURE });
  const results2 = await scrape(['openai'], { fixture: FIXTURE });
  const jobs1 = results1[0].jobs;
  const jobs2 = results2[0].jobs;
  for (let i = 0; i < jobs1.length; i++) {
    assert.equal(jobs1[i].id, jobs2[i].id, 'id should be deterministic across runs');
  }
});

// ---------------------------------------------------------------------------
// runScraper() — DB upsert and scrape_runs recording
// ---------------------------------------------------------------------------

test('runScraper with ashby inserts jobs and records scrape_runs row', async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper('ashby', ['openai'], db, {
      fixture: FIXTURE,
    });

    assert.equal(found, 3, 'found should equal 3 (all fixture jobs)');
    assert.equal(added, 3, 'added should equal 3 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'ashby');
    assert.equal(run.found, 3);
    assert.equal(run.added, 3);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
});

test('runScraper ashby: re-running does not double-insert', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('ashby', ['openai'], db, { fixture: FIXTURE });
    const second = await runScraper('ashby', ['openai'], db, { fixture: FIXTURE });

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 3, 'second run should still find 3 jobs');

    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 3, 'DB should still have exactly 3 jobs');
  } finally {
    db.close();
  }
});

test('runScraper ashby: jobs in DB have correct source field', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('ashby', ['openai'], db, { fixture: FIXTURE });
    const jobs = db.prepare('SELECT * FROM jobs').all();
    for (const job of jobs) {
      assert.equal(job.source, 'ashby');
      assert.ok(job.id, 'id should be set');
      assert.ok(job.company, 'company should be set');
      assert.ok(job.title, 'title should be set');
      assert.ok(job.canonical_key, 'canonical_key should be set');
    }
  } finally {
    db.close();
  }
});
