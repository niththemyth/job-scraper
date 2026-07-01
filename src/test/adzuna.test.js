/**
 * @file adzuna.test.js
 * @description Tests for the Adzuna job search API adapter.
 *
 * Run with: node --test src/test/adzuna.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/adzuna.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'adzuna-results.json');

// ---------------------------------------------------------------------------
// Helper: ensure env keys are set for tests that need them
// ---------------------------------------------------------------------------
function withEnvKeys(fn) {
  return async () => {
    const savedId = process.env.ADZUNA_APP_ID;
    const savedKey = process.env.ADZUNA_APP_KEY;
    process.env.ADZUNA_APP_ID = 'test-app-id';
    process.env.ADZUNA_APP_KEY = 'test-app-key';
    try {
      await fn();
    } finally {
      if (savedId === undefined) {
        delete process.env.ADZUNA_APP_ID;
      } else {
        process.env.ADZUNA_APP_ID = savedId;
      }
      if (savedKey === undefined) {
        delete process.env.ADZUNA_APP_KEY;
      } else {
        process.env.ADZUNA_APP_KEY = savedKey;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Missing-key guard
// ---------------------------------------------------------------------------

test('scrape returns [] with console.warn when ADZUNA_APP_ID is missing', async () => {
  const savedId = process.env.ADZUNA_APP_ID;
  const savedKey = process.env.ADZUNA_APP_KEY;
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
    assert.deepEqual(results, [], 'should return [] when keys are missing');
    assert.ok(warnings.length > 0, 'should emit at least one console.warn');
    assert.ok(
      warnings[0].includes('ADZUNA_APP_ID') || warnings[0].includes('adzuna'),
      'warn message should mention adzuna or ADZUNA_APP_ID',
    );
  } finally {
    console.warn = originalWarn;
    if (savedId !== undefined) process.env.ADZUNA_APP_ID = savedId;
    if (savedKey !== undefined) process.env.ADZUNA_APP_KEY = savedKey;
  }
});

test('scrape returns [] with console.warn when ADZUNA_APP_KEY is missing', async () => {
  const savedId = process.env.ADZUNA_APP_ID;
  const savedKey = process.env.ADZUNA_APP_KEY;
  process.env.ADZUNA_APP_ID = 'some-id';
  delete process.env.ADZUNA_APP_KEY;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
    assert.deepEqual(results, [], 'should return [] when key is missing');
    assert.ok(warnings.length > 0, 'should emit console.warn');
  } finally {
    console.warn = originalWarn;
    if (savedId !== undefined) process.env.ADZUNA_APP_ID = savedId;
    else delete process.env.ADZUNA_APP_ID;
    if (savedKey !== undefined) process.env.ADZUNA_APP_KEY = savedKey;
  }
});

// ---------------------------------------------------------------------------
// Fixture loading and field mapping
// ---------------------------------------------------------------------------

test('scrape returns one result object per query', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  assert.equal(results.length, 1, 'one result per query');
  assert.equal(results[0].source, 'adzuna');
}));

test('scrape loads all 3 jobs from fixture when no allowList', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  assert.equal(results[0].jobs.length, 3, 'all 3 fixture jobs returned when no filter');
}));

test('scrape maps title, company, location, url correctly', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  const job = results[0].jobs.find(j => j.external_id === 'az-1001');
  assert.ok(job, 'job az-1001 should be present');
  assert.equal(job.title, 'Software Engineer');
  assert.equal(job.company, 'Google');
  assert.equal(job.location, 'Mountain View, CA');
  assert.equal(job.url, 'https://www.adzuna.com/jobs/az-1001');
}));

test('scrape maps external_id as string', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  const job = results[0].jobs[0];
  assert.equal(typeof job.external_id, 'string');
}));

test('scrape sets source to "adzuna"', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  for (const job of results[0].jobs) {
    assert.equal(job.source, 'adzuna');
  }
}));

test('scrape maps salary_min and salary_max', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  const google = results[0].jobs.find(j => j.external_id === 'az-1001');
  assert.equal(google.salary_min, 130000);
  assert.equal(google.salary_max, 180000);

  const amazon = results[0].jobs.find(j => j.external_id === 'az-1002');
  assert.equal(amazon.salary_min, 140000);
  assert.equal(amazon.salary_max, 200000);
}));

test('scrape maps posted_at from created field', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  const job = results[0].jobs.find(j => j.external_id === 'az-1001');
  assert.equal(job.posted_at, '2026-06-01T00:00:00.000Z');
}));

test('scrape sets is_us=1 for US locations', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  const google = results[0].jobs.find(j => j.external_id === 'az-1001'); // Mountain View, CA
  assert.equal(google.is_us, 1, 'Mountain View, CA should be is_us=1');
}));

test('scrape generates deterministic id via hashId', withEnvKeys(async () => {
  const config = { queries: ['software engineer'], companyAllowList: [] };
  const opts = { fixture: FIXTURE };
  const results1 = await scrape(config, opts);
  const results2 = await scrape(config, opts);
  for (let i = 0; i < results1[0].jobs.length; i++) {
    assert.equal(results1[0].jobs[i].id, results2[0].jobs[i].id, 'id must be deterministic');
  }
}));

// ---------------------------------------------------------------------------
// companyAllowList filtering
// ---------------------------------------------------------------------------

test('companyAllowList filters jobs to only matching companies', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: ['Google', 'Amazon'] },
    { fixture: FIXTURE },
  );
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 2, 'only Google and Amazon jobs should remain');
  const companies = jobs.map(j => j.company);
  assert.ok(companies.includes('Google'), 'Google should be present');
  assert.ok(companies.includes('Amazon'), 'Amazon should be present');
  assert.ok(!companies.includes('TechCorp'), 'TechCorp should be filtered out');
}));

test('companyAllowList matching is case-insensitive', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: ['google'] },
    { fixture: FIXTURE },
  );
  const jobs = results[0].jobs;
  assert.equal(jobs.length, 1, 'lowercase "google" should match "Google"');
  assert.equal(jobs[0].company, 'Google');
}));

test('empty companyAllowList returns all jobs', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'], companyAllowList: [] },
    { fixture: FIXTURE },
  );
  assert.equal(results[0].jobs.length, 3, 'empty allowList should return all 3 jobs');
}));

test('undefined companyAllowList returns all jobs', withEnvKeys(async () => {
  const results = await scrape(
    { queries: ['software engineer'] },
    { fixture: FIXTURE },
  );
  assert.equal(results[0].jobs.length, 3, 'no allowList should return all 3 jobs');
}));

// ---------------------------------------------------------------------------
// runScraper() — DB integration
// ---------------------------------------------------------------------------

test('runScraper with adzuna inserts jobs and records scrape_runs row', withEnvKeys(async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper(
      'adzuna',
      { queries: ['software engineer'], companyAllowList: [] },
      db,
      { fixture: FIXTURE },
    );

    assert.equal(found, 3, 'found should be 3 (all fixture jobs)');
    assert.equal(added, 3, 'added should be 3 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'adzuna');
    assert.equal(run.found, 3);
    assert.equal(run.added, 3);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
}));

test('runScraper adzuna with missing keys records 0 found', async () => {
  const savedId = process.env.ADZUNA_APP_ID;
  const savedKey = process.env.ADZUNA_APP_KEY;
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;

  const db = createDb(':memory:');
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const { found, added } = await runScraper(
      'adzuna',
      { queries: ['software engineer'], companyAllowList: [] },
      db,
      { fixture: FIXTURE },
    );
    assert.equal(found, 0, 'found should be 0 when keys missing');
    assert.equal(added, 0, 'added should be 0 when keys missing');
  } finally {
    console.warn = originalWarn;
    db.close();
    if (savedId !== undefined) process.env.ADZUNA_APP_ID = savedId;
    if (savedKey !== undefined) process.env.ADZUNA_APP_KEY = savedKey;
  }
});
