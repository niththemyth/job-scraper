/**
 * @file db.test.js
 * @description Tests for db.js (migrations) and lib/hash.js using node:test built-in runner.
 *
 * Run with: node --test src/test/db.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDb, runMigrations as runProductionMigrations } from '../db.js';
import { hashId, canonicalKey } from '../lib/hash.js';

// ---------------------------------------------------------------------------
// Helper: create an isolated in-memory DB using the real production
// createDb factory, and return the db instance + a runMigrations wrapper
// that delegates to the real production function.
// ---------------------------------------------------------------------------
function createTempDb() {
  const db = createDb(':memory:');

  function runMigrations() {
    runProductionMigrations(db);
  }

  function cleanup() {
    db.close();
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
