/**
 * @file db.js
 * @description Initializes the node:sqlite database and runs schema migrations.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/jobs.db';

// Ensure the data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

/** @type {DatabaseSync} */
export const db = new DatabaseSync(DB_PATH);

/**
 * Creates all tables and indexes if they don't already exist.
 */
export function runMigrations() {
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
