/**
 * @file usajobs.test.js
 * @description Tests for the USAJobs federal job search API adapter.
 *
 * Run with: node --test src/test/usajobs.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb } from '../db.js';
import { scrape } from '../scrapers/usajobs.js';
import { runScraper } from '../scrapers/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'usajobs-results.json');

// ---------------------------------------------------------------------------
// Helper: ensure env keys are set for tests that need them
// ---------------------------------------------------------------------------
function withEnvKeys(fn) {
  return async () => {
    const savedKey = process.env.USAJOBS_API_KEY;
    const savedEmail = process.env.USAJOBS_EMAIL;
    process.env.USAJOBS_API_KEY = 'test-api-key';
    process.env.USAJOBS_EMAIL = 'test@example.com';
    try {
      await fn();
    } finally {
      if (savedKey === undefined) {
        delete process.env.USAJOBS_API_KEY;
      } else {
        process.env.USAJOBS_API_KEY = savedKey;
      }
      if (savedEmail === undefined) {
        delete process.env.USAJOBS_EMAIL;
      } else {
        process.env.USAJOBS_EMAIL = savedEmail;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Missing-key guard
// ---------------------------------------------------------------------------

test('scrape returns [] with console.warn when USAJOBS_API_KEY is missing', async () => {
  const savedKey = process.env.USAJOBS_API_KEY;
  const savedEmail = process.env.USAJOBS_EMAIL;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_EMAIL;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
    assert.deepEqual(results, [], 'should return [] when keys are missing');
    assert.ok(warnings.length > 0, 'should emit at least one console.warn');
    assert.ok(
      warnings[0].includes('USAJOBS_API_KEY') || warnings[0].includes('usajobs'),
      'warn message should mention usajobs or USAJOBS_API_KEY',
    );
  } finally {
    console.warn = originalWarn;
    if (savedKey !== undefined) process.env.USAJOBS_API_KEY = savedKey;
    if (savedEmail !== undefined) process.env.USAJOBS_EMAIL = savedEmail;
  }
});

test('scrape returns [] with console.warn when USAJOBS_EMAIL is missing', async () => {
  const savedKey = process.env.USAJOBS_API_KEY;
  const savedEmail = process.env.USAJOBS_EMAIL;
  process.env.USAJOBS_API_KEY = 'some-key';
  delete process.env.USAJOBS_EMAIL;

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
    assert.deepEqual(results, [], 'should return [] when email is missing');
    assert.ok(warnings.length > 0, 'should emit console.warn');
  } finally {
    console.warn = originalWarn;
    if (savedKey !== undefined) process.env.USAJOBS_API_KEY = savedKey;
    else delete process.env.USAJOBS_API_KEY;
    if (savedEmail !== undefined) process.env.USAJOBS_EMAIL = savedEmail;
  }
});

// ---------------------------------------------------------------------------
// Fixture loading and field mapping
// ---------------------------------------------------------------------------

test('scrape returns one result object per query', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  assert.equal(results.length, 1, 'one result per query');
  assert.equal(results[0].source, 'usajobs');
}));

test('scrape loads all 3 jobs from fixture', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  assert.equal(results[0].jobs.length, 3, 'all 3 fixture jobs returned');
}));

test('scrape maps title, company, location, url correctly', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'usajobs-2210-001');
  assert.ok(job, 'job usajobs-2210-001 should be present');
  assert.equal(job.title, 'IT Specialist (APPSW)');
  assert.equal(job.company, 'US Government');
  assert.equal(job.location, 'Washington, DC');
  assert.equal(job.url, 'https://www.usajobs.gov/job/usajobs-2210-001');
}));

test('scrape sets source to "usajobs"', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.source, 'usajobs');
  }
}));

test('scrape sets company to "US Government" for all jobs', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.company, 'US Government');
  }
}));

test('scrape maps external_id from PositionID', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'usajobs-2210-002');
  assert.ok(job, 'job usajobs-2210-002 should be findable by external_id');
  assert.equal(typeof job.external_id, 'string');
}));

test('scrape parses per-annum salary_min and salary_max correctly', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });

  const job1 = results[0].jobs.find(j => j.external_id === 'usajobs-2210-001');
  assert.equal(job1.salary_min, 80000);
  assert.equal(job1.salary_max, 120000);

  const job2 = results[0].jobs.find(j => j.external_id === 'usajobs-2210-002');
  assert.equal(job2.salary_min, 95000);
  assert.equal(job2.salary_max, 145000);

  const job3 = results[0].jobs.find(j => j.external_id === 'usajobs-2210-003');
  assert.equal(job3.salary_min, 100000);
  assert.equal(job3.salary_max, 155000);
}));

test('scrape salary values are numbers (parseFloat applied)', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(typeof job.salary_min, 'number', 'salary_min should be a number');
    assert.equal(typeof job.salary_max, 'number', 'salary_max should be a number');
  }
}));

test('scrape maps description from JobSummary', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'usajobs-2210-001');
  assert.ok(job.description, 'description should be set');
  assert.ok(
    job.description.includes('software applications'),
    'description should contain fixture text',
  );
}));

test('scrape maps posted_at from PublicationStartDate', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  const job = results[0].jobs.find(j => j.external_id === 'usajobs-2210-001');
  assert.equal(job.posted_at, '2026-06-01T00:00:00.000Z');
}));

test('scrape sets is_us=1 for US locations', withEnvKeys(async () => {
  const results = await scrape({ queries: ['software engineer'] }, { fixture: FIXTURE });
  for (const job of results[0].jobs) {
    assert.equal(job.is_us, 1, `${job.location} should be is_us=1`);
  }
}));

test('scrape generates deterministic id via hashId', withEnvKeys(async () => {
  const config = { queries: ['software engineer'] };
  const opts = { fixture: FIXTURE };
  const results1 = await scrape(config, opts);
  const results2 = await scrape(config, opts);
  for (let i = 0; i < results1[0].jobs.length; i++) {
    assert.equal(results1[0].jobs[i].id, results2[0].jobs[i].id, 'id must be deterministic');
  }
}));

// ---------------------------------------------------------------------------
// runScraper() — DB integration
// ---------------------------------------------------------------------------

test('runScraper with usajobs inserts jobs and records scrape_runs row', withEnvKeys(async () => {
  const db = createDb(':memory:');
  try {
    const { found, added } = await runScraper(
      'usajobs',
      { queries: ['software engineer'] },
      db,
      { fixture: FIXTURE },
    );

    assert.equal(found, 3, 'found should be 3 (all fixture jobs)');
    assert.equal(added, 3, 'added should be 3 on first run');

    const run = db.prepare('SELECT * FROM scrape_runs ORDER BY id DESC').get();
    assert.equal(run.source, 'usajobs');
    assert.equal(run.found, 3);
    assert.equal(run.added, 3);
    assert.equal(run.error, null);
  } finally {
    db.close();
  }
}));

test('runScraper usajobs: re-running does not double-insert', withEnvKeys(async () => {
  const db = createDb(':memory:');
  try {
    await runScraper('usajobs', { queries: ['software engineer'] }, db, { fixture: FIXTURE });
    const second = await runScraper(
      'usajobs',
      { queries: ['software engineer'] },
      db,
      { fixture: FIXTURE },
    );

    assert.equal(second.added, 0, 'second run should add 0 new jobs');
    assert.equal(second.found, 3, 'second run should still find 3 jobs');

    const count = db.prepare('SELECT COUNT(*) AS c FROM jobs').get();
    assert.equal(count.c, 3, 'DB should still have exactly 3 jobs');
  } finally {
    db.close();
  }
}));

test('runScraper usajobs with missing keys records 0 found', async () => {
  const savedKey = process.env.USAJOBS_API_KEY;
  const savedEmail = process.env.USAJOBS_EMAIL;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_EMAIL;

  const db = createDb(':memory:');
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const { found, added } = await runScraper(
      'usajobs',
      { queries: ['software engineer'] },
      db,
      { fixture: FIXTURE },
    );
    assert.equal(found, 0, 'found should be 0 when keys missing');
    assert.equal(added, 0, 'added should be 0 when keys missing');
  } finally {
    console.warn = originalWarn;
    db.close();
    if (savedKey !== undefined) process.env.USAJOBS_API_KEY = savedKey;
    if (savedEmail !== undefined) process.env.USAJOBS_EMAIL = savedEmail;
  }
});
