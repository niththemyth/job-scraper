/**
 * @file api.test.js
 * @description HTTP acceptance tests for the /api/jobs endpoints.
 *
 * Run with: node --test src/test/api.test.js
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { createDb } from '../db.js';
import { runScraper } from '../scrapers/index.js';
import { createJobsRouter } from '../api/jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, 'fixtures', 'newgrad-simplify.json');
const TEST_SOURCES = { simplify: 'https://example.com/listings.json' };

// ---------------------------------------------------------------------------
// Setup: shared db, app, and http server on ephemeral port 0
// ---------------------------------------------------------------------------

let db;
let server;
let baseUrl;
let knownJobId;

before(async () => {
  // 1. In-memory db with migrations already applied by createDb
  db = createDb(':memory:');

  // 2. Populate with fixture data
  await runScraper('newgrad', TEST_SOURCES, db, { fixture: FIXTURE });

  // 3. Grab a known job id for single-item tests
  const row = db.prepare('SELECT id FROM jobs LIMIT 1').get();
  knownJobId = row.id;

  // 4. Build Express app with injected db
  const app = express();
  app.use(express.json());
  app.use('/api', createJobsRouter(db));

  // 5. Listen on port 0 (OS assigns ephemeral port)
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(() => {
  server.close();
  db.close();
});

// ---------------------------------------------------------------------------
// Helper: simple HTTP request returning { statusCode, body }
// ---------------------------------------------------------------------------

function request(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const bodyStr = bodyObj != null ? JSON.stringify(bodyObj) : null;

    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr != null ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ statusCode: res.statusCode, body });
      });
    });

    req.on('error', reject);
    if (bodyStr != null) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /api/jobs returns 200 with { jobs, total } and total > 0', async () => {
  const { statusCode, body } = await request('GET', '/api/jobs');
  assert.equal(statusCode, 200, 'expected HTTP 200');
  assert.ok(Array.isArray(body.jobs), 'body.jobs should be an array');
  assert.ok(typeof body.total === 'number', 'body.total should be a number');
  assert.ok(body.total > 0, 'total should be > 0');
  assert.equal(body.jobs.length, body.total, 'jobs array length should match total');
});

test('GET /api/jobs/:id returns 200 and job object for a known id', async () => {
  const { statusCode, body } = await request('GET', `/api/jobs/${knownJobId}`);
  assert.equal(statusCode, 200, 'expected HTTP 200');
  assert.equal(body.id, knownJobId, 'returned job id should match');
  assert.ok(body.company, 'job should have a company field');
  assert.ok(body.title, 'job should have a title field');
});

test('GET /api/jobs/:id returns 404 for an unknown id', async () => {
  const { statusCode, body } = await request('GET', '/api/jobs/nonexistent-id-xyz');
  assert.equal(statusCode, 404, 'expected HTTP 404');
  assert.ok(body.error, 'body should have an error field');
});

test('PATCH /api/jobs/:id with { status: "applied" } updates the row', async () => {
  const { statusCode, body } = await request('PATCH', `/api/jobs/${knownJobId}`, { status: 'applied' });
  assert.equal(statusCode, 200, 'expected HTTP 200');
  assert.equal(body.status, 'applied', 'returned job status should be "applied"');

  // Verify the DB was updated
  const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(knownJobId);
  assert.equal(row.status, 'applied', 'DB row status should be "applied"');
});

test('PATCH /api/jobs/:id with invalid status returns 400', async () => {
  const { statusCode, body } = await request('PATCH', `/api/jobs/${knownJobId}`, { status: 'invalid-status' });
  assert.equal(statusCode, 400, 'expected HTTP 400');
  assert.ok(body.error, 'body should have an error field');
});

test('PATCH /api/jobs/:id for unknown id returns 404', async () => {
  const { statusCode, body } = await request('PATCH', '/api/jobs/nonexistent-id-xyz', { status: 'applied' });
  assert.equal(statusCode, 404, 'expected HTTP 404');
  assert.ok(body.error, 'body should have an error field');
});
