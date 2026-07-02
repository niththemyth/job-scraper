/**
 * @file index.js
 * @description Express application entry point. Runs migrations, mounts routes, serves static files.
 */
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, db } from './db.js';
import { env, sources, profile } from './config.js';
import { createJobsRouter } from './api/jobs.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Run migrations on boot
runMigrations();

// 2. Start the scheduler (runs scrapers immediately + on cron schedule)
startScheduler(db, { env, sources, profile });

const app = express();

app.use(express.json());

// 3. Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// 4. Jobs API (includes /api/scrape and /api/sources)
app.use('/api', createJobsRouter(db, { env, sources, profile }));

// 5. Serve static files from public/
app.use(express.static(join(__dirname, '..', 'public')));

// 6. Start listening
app.listen(env.PORT, () => {
  console.log(`job-scraper listening on port ${env.PORT}`);
});

export default app;
