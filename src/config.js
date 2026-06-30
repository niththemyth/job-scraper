/**
 * @file config.js
 * @description Loads and validates environment variables and source configs using zod.
 */
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Env schema
// ---------------------------------------------------------------------------
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/jobs.db'),
  SCRAPE_INTERVAL_CRON: z.string().default('*/15 * * * *'),
  NEW_JOB_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  COUNTRY: z.string().default('us'),
  REMOTE_ONLY: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),

  // Data source keys (optional — adapters skip when missing)
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  USAJOBS_API_KEY: z.string().optional(),
  USAJOBS_EMAIL: z.string().optional(),

  // Alerts
  ALERTS_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default('true'),
  ALERT_KEYWORDS: z.string().default('software engineer,backend,frontend,full stack,sre,platform'),
  ALERT_MIN_INTERVAL_MINUTES: z.coerce.number().int().positive().default(10),
  ALERT_EMAIL_TO: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
});

/**
 * @type {z.infer<typeof EnvSchema>}
 */
export const env = EnvSchema.parse(process.env);

// ---------------------------------------------------------------------------
// Sources config
// ---------------------------------------------------------------------------
const SourcesSchema = z.object({
  newgrad: z.object({
    simplify: z.string().url(),
    vanshb03: z.string().url(),
    jobrightMarkdown: z.boolean(),
  }),
  greenhouse: z.array(z.string()),
  lever: z.array(z.string()),
  ashby: z.array(z.string()),
  bigtech: z.array(z.string()),
  adzuna: z.object({
    country: z.string(),
    queries: z.array(z.string()),
    companyAllowList: z.array(z.string()),
  }),
  usajobs: z.object({
    queries: z.array(z.string()),
  }),
});

const rawSources = JSON.parse(readFileSync(join(ROOT, 'config/sources.json'), 'utf8'));

/**
 * @type {z.infer<typeof SourcesSchema>}
 */
export const sources = SourcesSchema.parse(rawSources);

// ---------------------------------------------------------------------------
// Profile config
// ---------------------------------------------------------------------------
const ProfileSchema = z.object({
  includeTitles: z.array(z.string()),
  excludeTitles: z.array(z.string()),
  entryLevelOnly: z.boolean(),
  maxYearsExperience: z.number().int().nonnegative(),
  skills: z.array(z.string()),
  minMatchScoreForAlert: z.number().int().nonnegative(),
  sponsorshipFilter: z.enum(['none', 'requires', 'exclude_citizenship']),
});

const rawProfile = JSON.parse(readFileSync(join(ROOT, 'config/profile.json'), 'utf8'));

/**
 * @type {z.infer<typeof ProfileSchema>}
 */
export const profile = ProfileSchema.parse(rawProfile);
