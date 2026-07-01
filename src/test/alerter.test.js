/**
 * @file alerter.test.js
 * @description Tests for src/alerter.js
 *
 * Run with: node --test src/test/alerter.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../db.js';
import { runAlerts } from '../alerter.js';

// ---------------------------------------------------------------------------
// Mock transport factory
// ---------------------------------------------------------------------------

function createMockTransport() {
  const sent = [];
  return {
    sendMail: async (msg) => {
      sent.push(msg);
      return { messageId: 'test-msg' };
    },
    getSent: () => sent,
    clear: () => {
      sent.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

let _jobCounter = 0;

/**
 * Inserts a test job and returns the inserted job object (with defaults applied).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} [overrides]
 * @returns {object}
 */
function insertJob(db, overrides = {}) {
  _jobCounter += 1;
  const defaults = {
    id: `job-${_jobCounter}`,
    source: 'test',
    external_id: `ext-${_jobCounter}`,
    company: 'Test Corp',
    title: 'Software Engineer',
    location: 'Remote, US',
    is_us: 1,
    remote: 1,
    match_score: 5,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    is_active: 1,
    status: 'new',
    url: `https://example.com/jobs/${_jobCounter}`,
    alerted_at: null,
    seniority: null,
  };

  const job = { ...defaults, ...overrides };

  db.prepare(`
    INSERT INTO jobs
      (id, source, external_id, company, title, location, is_us, remote,
       match_score, first_seen, last_seen, is_active, status, url, alerted_at, seniority)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.source,
    job.external_id,
    job.company,
    job.title,
    job.location,
    job.is_us,
    job.remote,
    job.match_score,
    job.first_seen,
    job.last_seen,
    job.is_active,
    job.status,
    job.url,
    job.alerted_at,
    job.seniority,
  );

  return job;
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

function makeConfig(envOverrides = {}) {
  return {
    env: {
      ALERTS_ENABLED: true,
      ALERT_MIN_INTERVAL_MINUTES: 10,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_USER: 'user@example.com',
      SMTP_PASS: 'secret',
      ALERT_EMAIL_TO: 'dest@example.com',
      ALERT_KEYWORDS: '',
      REMOTE_ONLY: false,
      ...envOverrides,
    },
    profile: {
      minMatchScoreForAlert: 2,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('stamps alerted_at on all 3 matching jobs', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig();

  const job1 = insertJob(db);
  const job2 = insertJob(db);
  const job3 = insertJob(db);

  await runAlerts(db, config, { forceSkipRateLimit: true, transport });

  for (const job of [job1, job2, job3]) {
    const row = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(job.id);
    assert.ok(row.alerted_at, `job ${job.id} should have alerted_at stamped`);
  }

  assert.equal(transport.getSent().length, 1, 'exactly one email should be sent');

  db.close();
});

test('does not send new alert when all jobs already have alerted_at', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig();

  const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
  insertJob(db, { alerted_at: past });
  insertJob(db, { alerted_at: past });
  insertJob(db, { alerted_at: past });

  await runAlerts(db, config, { forceSkipRateLimit: true, transport });

  assert.equal(transport.getSent().length, 0, 'no email should be sent when all jobs are already alerted');

  db.close();
});

test('rate limiting: skips when last alert was recent, sends when forced', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  // 60-minute window
  const config = makeConfig({ ALERT_MIN_INTERVAL_MINUTES: 60 });

  // One job already alerted 1 minute ago (within the 60-min window)
  const recentAlertedAt = new Date(Date.now() - 60 * 1000).toISOString();
  insertJob(db, { alerted_at: recentAlertedAt });

  // One unalerted job waiting
  insertJob(db);

  // Without force — should be rate-limited
  await runAlerts(db, config, { transport });
  assert.equal(transport.getSent().length, 0, 'should skip due to rate limit');

  // With forceSkipRateLimit — should send
  await runAlerts(db, config, { forceSkipRateLimit: true, transport });
  assert.equal(transport.getSent().length, 1, 'should send when rate limit is bypassed');

  db.close();
});

test('ALERT_KEYWORDS filter: only matching-title jobs get alerted', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig({ ALERT_KEYWORDS: 'backend,python' });

  const matching = insertJob(db, { title: 'Backend Engineer' });
  const nonMatch1 = insertJob(db, { title: 'Product Manager' });
  const nonMatch2 = insertJob(db, { title: 'Data Analyst' });

  await runAlerts(db, config, { forceSkipRateLimit: true, transport });

  const matchRow = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(matching.id);
  assert.ok(matchRow.alerted_at, 'keyword-matching job should have alerted_at stamped');

  const nm1Row = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(nonMatch1.id);
  assert.equal(nm1Row.alerted_at, null, 'non-matching job should NOT have alerted_at');

  const nm2Row = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(nonMatch2.id);
  assert.equal(nm2Row.alerted_at, null, 'non-matching job should NOT have alerted_at');

  assert.equal(transport.getSent().length, 1, 'one email sent for the one matching job');

  db.close();
});

test('mock transport captures digest subject and body content', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig();

  insertJob(db, { title: 'Software Engineer', company: 'Acme Corp', location: 'San Francisco, CA' });
  insertJob(db, { title: 'Full Stack Developer', company: 'Beta Inc', location: 'New York, NY' });

  await runAlerts(db, config, { forceSkipRateLimit: true, transport });

  assert.equal(transport.getSent().length, 1, 'exactly one email should be sent');
  const email = transport.getSent()[0];

  assert.ok(email.subject.includes('[Job Scraper]'), 'subject should include [Job Scraper]');
  assert.ok(email.subject.includes('2'), 'subject should reflect job count');
  assert.ok(email.text.includes('Acme Corp'), 'text body should include first company');
  assert.ok(email.text.includes('Beta Inc'), 'text body should include second company');
  assert.ok(email.html, 'email should have an html field');
  assert.ok(email.to, 'email should have a to field');

  db.close();
});

test('skips email gracefully when SMTP config is incomplete (no throw)', async () => {
  const db = createDb(':memory:');
  // No transport override, missing SMTP — should warn but not throw
  const config = makeConfig({ SMTP_HOST: undefined, SMTP_USER: undefined });

  insertJob(db);

  await assert.doesNotReject(
    () => runAlerts(db, config, { forceSkipRateLimit: true }),
    'runAlerts should not throw when SMTP config is missing',
  );

  // Job should still be stamped (channels skip gracefully; stamp always runs)
  const row = db.prepare('SELECT alerted_at FROM jobs').get();
  assert.ok(row.alerted_at, 'job should be stamped even if email channel was skipped');

  db.close();
});

test('REMOTE_ONLY filter: only remote jobs get alerted', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig({ REMOTE_ONLY: true });

  const remoteJob = insertJob(db, { remote: 1 });
  const officeJob = insertJob(db, { remote: 0 });

  await runAlerts(db, config, { forceSkipRateLimit: true, transport });

  const remoteRow = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(remoteJob.id);
  assert.ok(remoteRow.alerted_at, 'remote job should be alerted');

  const officeRow = db.prepare('SELECT alerted_at FROM jobs WHERE id = ?').get(officeJob.id);
  assert.equal(officeRow.alerted_at, null, 'non-remote job should NOT be alerted');

  assert.equal(transport.getSent().length, 1, 'one email sent for the remote job only');

  db.close();
});

test('second run after all alerted: no email sent', async () => {
  const db = createDb(':memory:');
  const transport = createMockTransport();
  const config = makeConfig();

  insertJob(db);
  insertJob(db);
  insertJob(db);

  // First run — should alert all 3
  await runAlerts(db, config, { forceSkipRateLimit: true, transport });
  assert.equal(transport.getSent().length, 1, 'first run should send one email');

  transport.clear();

  // Second run — all jobs already have alerted_at
  await runAlerts(db, config, { forceSkipRateLimit: true, transport });
  assert.equal(transport.getSent().length, 0, 'second run should send no email');

  db.close();
});
