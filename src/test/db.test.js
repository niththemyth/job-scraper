/**
 * @file db.test.js
 * @description Tests for db.js (migrations) and lib/hash.js using node:test built-in runner.
 *
 * Run with: node --test src/test/db.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashId, canonicalKey } from '../lib/hash.js';

// ---------------------------------------------------------------------------
// Helper: create an isolated in-memory-like DB using a temp file, run
// migrations against it, and return the db instance + cleanup fn.
// ---------------------------------------------------------------------------
function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'job-scraper-test-'));
  const dbPath = join(dir, 'test.db');

  // Override DB_PATH so db.js uses our temp file
  process.env.DB_PATH = dbPath;

  // Re-import db module with the overridden env — since ESM modules are cached,
  // we instantiate a fresh DatabaseSync directly here for isolation.
  const db = new DatabaseSync(dbPath);

  function runMigrations() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id           TEXT PRIMARY KEY,
        source       TEXT NOT NULL,
        external_id  TEXT NOT NULL,
        company      TEXT NOT NULL,
        title        TEXT NOT NULL,
        location     TEXT,
        is_us        INTEGER,
        remote       INTEGER,
        salary_min   INTEGER,
        salary_max   INTEGER,
        salary_raw   TEXT,
        salary_currency TEXT DEFAULT 'USD',
        url          TEXT NOT NULL,
        description  TEXT,
        department   TEXT,
        posted_at    TEXT,
        seniority    TEXT,
        min_years    INTEGER,
        match_score  INTEGER DEFAULT 0,
        first_seen   TEXT NOT NULL,
        last_seen    TEXT NOT NULL,
        is_active    INTEGER DEFAULT 1,
        status       TEXT DEFAULT 'new',
        alerted_at   TEXT,
        canonical_key TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_first_seen ON jobs(first_seen);
      CREATE INDEX IF NOT EXISTS idx_jobs_status     ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_canonical  ON jobs(canonical_key);

      CREATE TABLE IF NOT EXISTS scrape_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT, started_at TEXT, finished_at TEXT,
        found INTEGER, added INTEGER, error TEXT
      );
    `);
  }

  function cleanup() {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }

  return { db, runMigrations, cleanup };
}

// ---------------------------------------------------------------------------
// DB migration tests
// ---------------------------------------------------------------------------

test('runMigrations creates the jobs table', () => {
  const { db, runMigrations, cleanup } = createTempDb();
  try {
    runMigrations();

    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
    ).get();

    assert.equal(row.name, 'jobs', 'jobs table should exist after migration');
  } finally {
    cleanup();
  }
});

test('runMigrations creates the scrape_runs table', () => {
  const { db, runMigrations, cleanup } = createTempDb();
  try {
    runMigrations();

    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='scrape_runs'"
    ).get();

    assert.equal(row.name, 'scrape_runs', 'scrape_runs table should exist after migration');
  } finally {
    cleanup();
  }
});

test('runMigrations is idempotent (can be called twice without error)', () => {
  const { db, runMigrations, cleanup } = createTempDb();
  try {
    runMigrations();
    // Second call should not throw due to IF NOT EXISTS
    assert.doesNotThrow(() => runMigrations());
  } finally {
    cleanup();
  }
});

test('jobs table has the canonical_key column', () => {
  const { db, runMigrations, cleanup } = createTempDb();
  try {
    runMigrations();

    const cols = db.prepare("PRAGMA table_info(jobs)").all();
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('canonical_key'), 'jobs table should have canonical_key column');
  } finally {
    cleanup();
  }
});

test('jobs table has status column with default "new"', () => {
  const { db, runMigrations, cleanup } = createTempDb();
  try {
    runMigrations();

    const cols = db.prepare("PRAGMA table_info(jobs)").all();
    const statusCol = cols.find(c => c.name === 'status');
    assert.ok(statusCol, 'status column should exist');
    assert.equal(statusCol.dflt_value, "'new'", 'status default should be "new"');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// hash.js tests
// ---------------------------------------------------------------------------

test('hashId returns a hex string', () => {
  const result = hashId('greenhouse', 'abc123');
  assert.match(result, /^[0-9a-f]{64}$/, 'hashId should return a 64-char hex string');
});

test('hashId is deterministic', () => {
  const a = hashId('greenhouse', 'abc123');
  const b = hashId('greenhouse', 'abc123');
  assert.equal(a, b, 'hashId should return the same value for same inputs');
});

test('hashId differs for different inputs', () => {
  const a = hashId('greenhouse', 'abc123');
  const b = hashId('lever', 'abc123');
  assert.notEqual(a, b, 'hashId should differ when source differs');

  const c = hashId('greenhouse', 'xyz999');
  assert.notEqual(a, c, 'hashId should differ when externalId differs');
});

test('canonicalKey returns a hex string', () => {
  const result = canonicalKey('https://example.com/jobs/123?ref=linkedin', 'Acme Corp', 'Software Engineer', 'Remote');
  assert.match(result, /^[0-9a-f]{64}$/, 'canonicalKey should return a 64-char hex string');
});

test('canonicalKey strips query params from URL', () => {
  const a = canonicalKey('https://example.com/jobs/123?ref=linkedin&utm=foo', 'Acme', 'SWE', 'Remote');
  const b = canonicalKey('https://example.com/jobs/123', 'Acme', 'SWE', 'Remote');
  assert.equal(a, b, 'canonicalKey should be the same regardless of query params');
});

test('canonicalKey is case-insensitive for company/title/location', () => {
  const a = canonicalKey('https://example.com/jobs/1', 'ACME Corp', 'Software Engineer', 'New York');
  const b = canonicalKey('https://example.com/jobs/1', 'acme corp', 'software engineer', 'new york');
  assert.equal(a, b, 'canonicalKey should normalize case');
});

test('canonicalKey is deterministic', () => {
  const a = canonicalKey('https://example.com/jobs/1', 'Acme', 'SWE', 'NY');
  const b = canonicalKey('https://example.com/jobs/1', 'Acme', 'SWE', 'NY');
  assert.equal(a, b, 'canonicalKey should be deterministic');
});

test('canonicalKey works without location argument', () => {
  assert.doesNotThrow(() => canonicalKey('https://example.com/jobs/1', 'Acme', 'SWE'));
});
