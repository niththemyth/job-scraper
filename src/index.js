/**
 * @file index.js
 * @description Express application entry point. Runs migrations, mounts routes, serves static files.
 */
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './db.js';
import { env } from './config.js';
import jobsRouter from './api/jobs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1. Run migrations on boot
runMigrations();

const app = express();

app.use(express.json());

// 2. Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// 3. Jobs API
app.use('/api', jobsRouter);

// 4. Serve static files from public/
app.use(express.static(join(__dirname, '..', 'public')));

// 4. Start listening
app.listen(env.PORT, () => {
  console.log(`job-scraper listening on port ${env.PORT}`);
});

export default app;
