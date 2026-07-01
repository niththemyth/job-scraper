/**
 * @file bigtech.test.js
 * @description Tests for the big-tech scraper adapters: Amazon, Google, Microsoft, Apple, Meta.
 *
 * All adapters are tested via local fixtures — no network calls.
 * Run with: node --test src/test/bigtech.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape as scrapeAmazon } from '../scrapers/bigtech/amazon.js';
import { scrape as scrapeGoogle } from '../scrapers/bigtech/google.js';
import { scrape as scrapeMicrosoft } from '../scrapers/bigtech/microsoft.js';
import { scrape as scrapeApple } from '../scrapers/bigtech/apple.js';
import { scrape as scrapeMeta } from '../scrapers/bigtech/meta.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = {
  amazon: join(__dirname, 'fixtures', 'bigtech-amazon.json'),
  google: join(__dirname, 'fixtures', 'bigtech-google.json'),
  microsoft: join(__dirname, 'fixtures', 'bigtech-microsoft.json'),
  apple: join(__dirname, 'fixtures', 'bigtech-apple.json'),
  meta: join(__dirname, 'fixtures', 'bigtech-meta.json'),
};

// ---------------------------------------------------------------------------
// Amazon adapter
// ---------------------------------------------------------------------------

test('amazon: returns all 3 jobs from fixture', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  assert.equal(jobs.length, 3, 'should return all 3 fixture jobs');
});

test('amazon: company field is "Amazon"', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  for (const job of jobs) {
    assert.equal(job.company, 'Amazon', 'company should be "Amazon"');
  }
});

test('amazon: source field is "amazon"', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  for (const job of jobs) {
    assert.equal(job.source, 'amazon');
  }
});

test('amazon: url is constructed from BASE_URL + job_path', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  const job = jobs.find(j => j.external_id === '2001');
  assert.ok(job, 'job 2001 should be present');
  assert.equal(job.url, 'https://www.amazon.jobs/jobs/2001');
});

test('amazon: field mapping — title, location, external_id', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  const job = jobs.find(j => j.external_id === '2001');
  assert.ok(job, 'job 2001 should be present');
  assert.equal(job.title, 'Software Development Engineer');
  assert.equal(job.location, 'Seattle, Washington');
  assert.equal(typeof job.external_id, 'string');
});

test('amazon: is_us=1 for US locations, is_us=0 for non-US', async () => {
  const jobs = await scrapeAmazon({ fixture: FIXTURES.amazon });
  const seattle = jobs.find(j => j.external_id === '2001');
  const newYork = jobs.find(j => j.external_id === '2002');
  const london = jobs.find(j => j.external_id === '2003');
  assert.equal(seattle.is_us, 1, 'Seattle, Washington should be is_us=1');
  assert.equal(newYork.is_us, 1, 'New York, New York should be is_us=1');
  assert.equal(london.is_us, 0, 'London, United Kingdom should be is_us=0');
});

test('amazon: id is deterministic (hashId)', async () => {
  const jobs1 = await scrapeAmazon({ fixture: FIXTURES.amazon });
  const jobs2 = await scrapeAmazon({ fixture: FIXTURES.amazon });
  for (let i = 0; i < jobs1.length; i++) {
    assert.equal(jobs1[i].id, jobs2[i].id, 'ids should be deterministic');
  }
});

test('amazon: returns [] on error (failure isolation)', async () => {
  const jobs = await scrapeAmazon({ fixture: '/nonexistent/path/fake.json' });
  assert.deepEqual(jobs, [], 'should return [] on fixture load error');
});

// ---------------------------------------------------------------------------
// Google adapter
// ---------------------------------------------------------------------------

test('google: returns all 3 jobs from fixture', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  assert.equal(jobs.length, 3, 'should return all 3 fixture jobs');
});

test('google: company field is "Google"', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  for (const job of jobs) {
    assert.equal(job.company, 'Google', 'company should be "Google"');
  }
});

test('google: source field is "google"', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  for (const job of jobs) {
    assert.equal(job.source, 'google');
  }
});

test('google: url comes from applyUrl field', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  const job = jobs.find(j => j.external_id === '3001');
  assert.ok(job, 'job 3001 should be present');
  assert.equal(job.url, 'https://careers.google.com/jobs/results/3001');
});

test('google: location comes from locations[0].display', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  const job = jobs.find(j => j.external_id === '3001');
  assert.ok(job, 'job 3001 should be present');
  assert.equal(job.location, 'Mountain View, CA');
});

test('google: field mapping — title, external_id', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  const job = jobs.find(j => j.external_id === '3001');
  assert.ok(job, 'job 3001 should be present');
  assert.equal(job.title, 'Software Engineer, Early Career');
  assert.equal(typeof job.external_id, 'string');
});

test('google: is_us=1 for US locations, is_us=0 for non-US', async () => {
  const jobs = await scrapeGoogle({ fixture: FIXTURES.google });
  const mv = jobs.find(j => j.external_id === '3001');
  const ny = jobs.find(j => j.external_id === '3002');
  const london = jobs.find(j => j.external_id === '3003');
  assert.equal(mv.is_us, 1, 'Mountain View, CA should be is_us=1');
  assert.equal(ny.is_us, 1, 'New York, NY should be is_us=1');
  assert.equal(london.is_us, 0, 'London, United Kingdom should be is_us=0');
});

test('google: returns [] on error (failure isolation)', async () => {
  const jobs = await scrapeGoogle({ fixture: '/nonexistent/path/fake.json' });
  assert.deepEqual(jobs, [], 'should return [] on fixture load error');
});

// ---------------------------------------------------------------------------
// Microsoft adapter
// ---------------------------------------------------------------------------

test('microsoft: returns all 3 jobs from fixture', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  assert.equal(jobs.length, 3, 'should return all 3 fixture jobs');
});

test('microsoft: company field is "Microsoft"', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  for (const job of jobs) {
    assert.equal(job.company, 'Microsoft', 'company should be "Microsoft"');
  }
});

test('microsoft: source field is "microsoft"', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  for (const job of jobs) {
    assert.equal(job.source, 'microsoft');
  }
});

test('microsoft: url is constructed from jobId', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  const job = jobs.find(j => j.external_id === '4001');
  assert.ok(job, 'job 4001 should be present');
  assert.equal(job.url, 'https://careers.microsoft.com/us/en/job/4001');
});

test('microsoft: location comes from properties.primaryWorkLocation', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  const job = jobs.find(j => j.external_id === '4001');
  assert.ok(job, 'job 4001 should be present');
  assert.equal(job.location, 'Redmond, Washington');
});

test('microsoft: field mapping — title, external_id', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  const job = jobs.find(j => j.external_id === '4001');
  assert.ok(job, 'job 4001 should be present');
  assert.equal(job.title, 'Software Engineer');
  assert.equal(typeof job.external_id, 'string');
});

test('microsoft: is_us=1 for US locations, is_us=0 for non-US', async () => {
  const jobs = await scrapeMicrosoft({ fixture: FIXTURES.microsoft });
  const redmond = jobs.find(j => j.external_id === '4001');
  const newYork = jobs.find(j => j.external_id === '4002');
  const dublin = jobs.find(j => j.external_id === '4003');
  assert.equal(redmond.is_us, 1, 'Redmond, Washington should be is_us=1');
  assert.equal(newYork.is_us, 1, 'New York, New York should be is_us=1');
  assert.equal(dublin.is_us, 0, 'Dublin, Ireland should be is_us=0');
});

test('microsoft: returns [] on error (failure isolation)', async () => {
  const jobs = await scrapeMicrosoft({ fixture: '/nonexistent/path/fake.json' });
  assert.deepEqual(jobs, [], 'should return [] on fixture load error');
});

// ---------------------------------------------------------------------------
// Apple adapter
// ---------------------------------------------------------------------------

test('apple: returns all 3 jobs from fixture', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  assert.equal(jobs.length, 3, 'should return all 3 fixture jobs');
});

test('apple: company field is "Apple"', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  for (const job of jobs) {
    assert.equal(job.company, 'Apple', 'company should be "Apple"');
  }
});

test('apple: source field is "apple"', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  for (const job of jobs) {
    assert.equal(job.source, 'apple');
  }
});

test('apple: url is constructed from positionId', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  const job = jobs.find(j => j.external_id === '200480048');
  assert.ok(job, 'job 200480048 should be present');
  assert.equal(job.url, 'https://jobs.apple.com/en-us/details/200480048');
});

test('apple: location comes from locations[0].name', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  const job = jobs.find(j => j.external_id === '200480048');
  assert.ok(job, 'job 200480048 should be present');
  assert.equal(job.location, 'Cupertino, California, United States');
});

test('apple: field mapping — title (postingTitle), external_id', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  const job = jobs.find(j => j.external_id === '200480048');
  assert.ok(job, 'job 200480048 should be present');
  assert.equal(job.title, 'Software Engineer');
  assert.equal(typeof job.external_id, 'string');
});

test('apple: is_us=1 for US locations, is_us=0 for non-US', async () => {
  const jobs = await scrapeApple({ fixture: FIXTURES.apple });
  const cupertino = jobs.find(j => j.external_id === '200480048');
  const austin = jobs.find(j => j.external_id === '200480049');
  const london = jobs.find(j => j.external_id === '200480050');
  assert.equal(cupertino.is_us, 1, 'Cupertino, California, United States should be is_us=1');
  assert.equal(austin.is_us, 1, 'Austin, Texas, United States should be is_us=1');
  assert.equal(london.is_us, 0, 'London, United Kingdom should be is_us=0');
});

test('apple: returns [] on error (failure isolation)', async () => {
  const jobs = await scrapeApple({ fixture: '/nonexistent/path/fake.json' });
  assert.deepEqual(jobs, [], 'should return [] on fixture load error');
});

// ---------------------------------------------------------------------------
// Meta adapter
// ---------------------------------------------------------------------------

test('meta: returns all 3 jobs from fixture', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  assert.equal(jobs.length, 3, 'should return all 3 fixture jobs');
});

test('meta: company field is "Meta"', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  for (const job of jobs) {
    assert.equal(job.company, 'Meta', 'company should be "Meta"');
  }
});

test('meta: source field is "meta"', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  for (const job of jobs) {
    assert.equal(job.source, 'meta');
  }
});

test('meta: url is constructed from job id', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  const job = jobs.find(j => j.external_id === '5001');
  assert.ok(job, 'job 5001 should be present');
  assert.equal(job.url, 'https://www.metacareers.com/jobs/5001');
});

test('meta: location comes from job.location field', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  const job = jobs.find(j => j.external_id === '5001');
  assert.ok(job, 'job 5001 should be present');
  assert.equal(job.location, 'Menlo Park, CA');
});

test('meta: field mapping — title, external_id', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  const job = jobs.find(j => j.external_id === '5001');
  assert.ok(job, 'job 5001 should be present');
  assert.equal(job.title, 'Software Engineer, New Grad');
  assert.equal(typeof job.external_id, 'string');
});

test('meta: is_us=1 for US locations, is_us=0 for non-US', async () => {
  const jobs = await scrapeMeta({ fixture: FIXTURES.meta });
  const menlo = jobs.find(j => j.external_id === '5001');
  const seattle = jobs.find(j => j.external_id === '5002');
  const london = jobs.find(j => j.external_id === '5003');
  assert.equal(menlo.is_us, 1, 'Menlo Park, CA should be is_us=1');
  assert.equal(seattle.is_us, 1, 'Seattle, WA should be is_us=1');
  assert.equal(london.is_us, 0, 'London, United Kingdom should be is_us=0');
});

test('meta: returns [] on error (failure isolation)', async () => {
  const jobs = await scrapeMeta({ fixture: '/nonexistent/path/fake.json' });
  assert.deepEqual(jobs, [], 'should return [] on fixture load error');
});

// ---------------------------------------------------------------------------
// runScraper() — bigtech dispatch integration
// ---------------------------------------------------------------------------

test('runScraper bigtech: dispatches to all named adapters via fixture', async () => {
  const db = createDb(':memory:');
  try {
    // Pass a single adapter to test dispatch works; fixture used by amazon
    const { found, added } = await runScraper(
      'bigtech',
      ['amazon'],
      db,
      { fixture: FIXTURES.amazon },
    );
    assert.equal(found, 3, 'found should equal 3 (all fixture jobs)');
    assert.equal(added, 3, 'added should equal 3 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'bigtech');
    assert.equal(run.found, 3);
    assert.equal(run.added, 3);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
});

test('runScraper bigtech: re-running does not double-insert', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('bigtech', ['google'], db, { fixture: FIXTURES.google });
    const second = await runScraper('bigtech', ['google'], db, { fixture: FIXTURES.google });

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 3, 'second run should still find 3 jobs');

    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 3, 'DB should still have exactly 3 jobs');
  } finally {
    db.close();
  }
});

test('runScraper bigtech: jobs in DB have correct company and source fields', async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('bigtech', ['microsoft'], db, { fixture: FIXTURES.microsoft });
    const jobs = db.prepare('SELECT * FROM jobs').all();
    for (const job of jobs) {
      assert.equal(job.source, 'microsoft');
      assert.equal(job.company, 'Microsoft');
      assert.ok(job.id, 'id should be set');
      assert.ok(job.title, 'title should be set');
      assert.ok(job.canonical_key, 'canonical_key should be set');
    }
  } finally {
    db.close();
  }
});
