/**
 * @file api/jobs.js
 * @description Express router for the /api/jobs, /api/scrape, and /api/sources endpoints.
 *
 * GET  /api/jobs            — list/filter jobs with pagination
 * GET  /api/jobs/:id        — single job or 404
 * PATCH /api/jobs/:id       — update job status only
 * POST /api/scrape          — trigger an immediate scrape run
 * GET  /api/sources         — list configured sources with last scrape_run stats
 */
import { Router } from 'express';
import { runAllScrapers } from '../scheduler.js';

/**
 * Creates and returns an Express Router with all /jobs, /scrape, and /sources routes
 * bound to the provided db instance. Accepts an injectable db for testability.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ env: object, sources: object, profile: object }} [config]
 * @returns {import('express').Router}
 */
export function createJobsRouter(db, config = {}) {
  const router = Router();

  /**
   * GET /jobs
   *
   * Query params:
   *   status    TEXT    — filter by status (new|applied|hidden)
   *   source    TEXT    — filter by source
   *   company   TEXT    — partial match on company name
   *   q         TEXT    — full-text search across title, company, description
   *   remote    '1'     — filter to remote jobs only
   *   since     ISO     — first_seen >= since
   *   minScore  INT     — match_score >= minScore
   *   sort      string  — newest (default) | posted | match
   *   limit     INT     — default 50, max 200
   *   offset    INT     — default 0
   *
   * Response: { jobs: [...], total: N }
   */
  router.get('/jobs', (req, res) => {
    const {
      status,
      source,
      company,
      q,
      remote,
      since,
      minScore,
      sort = 'newest',
      limit = '50',
      offset = '0',
    } = req.query;

    const limitN = Math.min(parseInt(limit, 10) || 50, 200);
    const offsetN = parseInt(offset, 10) || 0;

    const conditions = [];
    const params = [];

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }
    if (company) {
      conditions.push('company LIKE ?');
      params.push(`%${company}%`);
    }
    if (q) {
      conditions.push('(title LIKE ? OR company LIKE ? OR description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (remote === '1' || remote === 'true') {
      conditions.push('remote = 1');
    }
    if (since) {
      conditions.push('first_seen >= ?');
      params.push(since);
    }
    if (minScore) {
      conditions.push('match_score >= ?');
      params.push(parseInt(minScore, 10));
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let orderBy;
    switch (sort) {
      case 'posted':
        orderBy = 'ORDER BY posted_at DESC, first_seen DESC';
        break;
      case 'match':
        orderBy = 'ORDER BY match_score DESC, first_seen DESC';
        break;
      default: // 'newest'
        orderBy = 'ORDER BY first_seen DESC';
    }

    const countSql = `SELECT COUNT(*) AS total FROM jobs ${where}`;
    const dataSql = `SELECT * FROM jobs ${where} ${orderBy} LIMIT ? OFFSET ?`;

    const countRow = db.prepare(countSql).get(...params);
    const jobs = db.prepare(dataSql).all(...params, limitN, offsetN);

    res.json({ jobs, total: countRow.total });
  });

  /**
   * GET /jobs/:id — single job or 404
   */
  router.get('/jobs/:id', (req, res) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json(job);
  });

  /**
   * PATCH /jobs/:id — update job status only
   * Body: { status: 'applied' | 'hidden' | 'new' }
   */
  router.patch('/jobs/:id', (req, res) => {
    const ALLOWED_STATUSES = ['applied', 'hidden', 'new'];
    const { status } = req.body ?? {};

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const existing = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Job not found' });

    db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, req.params.id);

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
    return res.json(updated);
  });

  /**
   * POST /scrape — trigger an immediate full scrape run
   * Response: { triggered: true }
   */
  router.post('/scrape', (req, res) => {
    // Fire-and-forget — don't await
    runAllScrapers(db, config).catch(err => {
      console.error('[api] /scrape error:', err.message);
    });
    return res.json({ triggered: true });
  });

  /**
   * GET /sources — list configured sources with their last scrape_run stats
   *
   * Response: Array of { source, lastRun: { started_at, finished_at, found, added, error } | null }
   */
  router.get('/sources', (req, res) => {
    // Get the latest run per source from scrape_runs
    const latestRuns = db.prepare(`
      SELECT source, started_at, finished_at, found, added, error
      FROM scrape_runs
      WHERE rowid IN (
        SELECT MAX(rowid) FROM scrape_runs GROUP BY source
      )
    `).all();

    const runsBySource = {};
    for (const run of latestRuns) {
      runsBySource[run.source] = {
        started_at: run.started_at,
        finished_at: run.finished_at,
        found: run.found,
        added: run.added,
        error: run.error,
      };
    }

    // Build the source list from config
    const configSources = config.sources ?? {};
    const sourceNames = Object.keys(configSources);

    const response = sourceNames.map(source => ({
      source,
      lastRun: runsBySource[source] ?? null,
    }));

    return res.json(response);
  });

  return router;
}
