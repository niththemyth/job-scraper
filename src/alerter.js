/**
 * @file alerter.js
 * @description Sends digest alerts (email, Discord, Slack) for new matching jobs.
 * Exports runAlerts(db, config, options).
 */
import nodemailer from 'nodemailer';

/**
 * Formats a list of jobs into a plain-text digest string.
 * @param {Array} jobs
 * @returns {string}
 */
function formatDigest(jobs) {
  const lines = [`${jobs.length} new job${jobs.length === 1 ? '' : 's'} found:\n`];
  jobs.forEach((job, i) => {
    lines.push(`${i + 1}. ${job.title} @ ${job.company} — ${job.location ?? 'Unknown'}`);
    lines.push(`   Match score: ${job.match_score} | Source: ${job.source}`);
    lines.push(`   Apply: ${job.url}`);
    lines.push('');
  });
  return lines.join('\n');
}

/**
 * Escapes HTML special characters.
 * @param {string|null|undefined} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formats an HTML digest of jobs.
 * @param {Array} jobs
 * @returns {string}
 */
function formatHtmlDigest(jobs) {
  const items = jobs
    .map(
      (job, i) => `<li>
  <strong>${i + 1}. ${escapeHtml(job.title)} @ ${escapeHtml(job.company)} — ${escapeHtml(job.location ?? 'Unknown')}</strong><br>
  Match score: ${job.match_score} | Source: ${escapeHtml(job.source)}<br>
  <a href="${escapeHtml(job.url)}">Apply</a>
</li>`,
    )
    .join('\n');
  return `<h2>${jobs.length} new job${jobs.length === 1 ? '' : 's'} found:</h2>\n<ol>\n${items}\n</ol>`;
}

/**
 * Sends an email digest via nodemailer (or an injected mock transport).
 * Skips with a console.warn if any required SMTP env var is missing.
 *
 * @param {object} env
 * @param {string} subject
 * @param {string} text
 * @param {string} html
 * @param {object|null} transportOverride  — injected mock; bypasses nodemailer creation
 * @returns {Promise<boolean>} true if email was sent
 */
async function sendEmail(env, subject, text, html, transportOverride) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO } = env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !ALERT_EMAIL_TO) {
    console.warn(
      '[alerter] Email skipped: one or more required vars missing ' +
        '(SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_TO).',
    );
    return false;
  }

  try {
    const transporter =
      transportOverride ??
      nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });

    await transporter.sendMail({
      from: SMTP_USER,
      to: ALERT_EMAIL_TO,
      subject,
      text,
      html,
    });
    console.log('[alerter] Email sent successfully.');
    return true;
  } catch (err) {
    console.error('[alerter] Email send failed:', err.message);
    return false;
  }
}

/**
 * Posts a digest to a Discord webhook.
 * Skips with console.warn if DISCORD_WEBHOOK_URL is not set.
 *
 * @param {object} env
 * @param {string} content
 * @returns {Promise<boolean>} true if webhook was sent
 */
async function sendDiscord(env, content) {
  const { DISCORD_WEBHOOK_URL } = env;

  if (!DISCORD_WEBHOOK_URL) {
    console.warn('[alerter] Discord skipped: DISCORD_WEBHOOK_URL not set.');
    return false;
  }

  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[alerter] Discord webhook sent.');
    return true;
  } catch (err) {
    console.error('[alerter] Discord webhook failed:', err.message);
    return false;
  }
}

/**
 * Posts a digest to a Slack webhook.
 * Skips with console.warn if SLACK_WEBHOOK_URL is not set.
 *
 * @param {object} env
 * @param {string} text
 * @returns {Promise<boolean>} true if webhook was sent
 */
async function sendSlack(env, text) {
  const { SLACK_WEBHOOK_URL } = env;

  if (!SLACK_WEBHOOK_URL) {
    console.warn('[alerter] Slack skipped: SLACK_WEBHOOK_URL not set.');
    return false;
  }

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[alerter] Slack webhook sent.');
    return true;
  } catch (err) {
    console.error('[alerter] Slack webhook failed:', err.message);
    return false;
  }
}

/**
 * Main entry point: selects new matching jobs, sends a digest via all configured
 * channels, then stamps alerted_at on each job to prevent double-alerting.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ env: object, profile: object }} config
 * @param {{ forceSkipRateLimit?: boolean, transport?: object }} [options]
 *   - forceSkipRateLimit: bypass the ALERT_MIN_INTERVAL_MINUTES check (used by POST /api/alerts/test)
 *   - transport: mock nodemailer transporter injected by tests
 */
export async function runAlerts(db, config, options = {}) {
  const env = config?.env ?? {};
  const profile = config?.profile ?? {};
  const { forceSkipRateLimit = false, transport: transportOverride = null } = options;

  // Check global kill-switch
  if (env.ALERTS_ENABLED === false) {
    console.log('[alerter] ALERTS_ENABLED is false — skipping.');
    return 0;
  }

  // -------------------------------------------------------------------------
  // Rate control
  // -------------------------------------------------------------------------
  if (!forceSkipRateLimit) {
    const intervalMinutes = env.ALERT_MIN_INTERVAL_MINUTES ?? 10;
    const row = db
      .prepare('SELECT MAX(alerted_at) AS last_alerted FROM jobs WHERE alerted_at IS NOT NULL')
      .get();

    if (row && row.last_alerted) {
      const diffMs = Date.now() - new Date(row.last_alerted).getTime();
      const diffMinutes = diffMs / 1000 / 60;
      if (diffMinutes < intervalMinutes) {
        console.log(
          `[alerter] Rate limit: last alert was ${diffMinutes.toFixed(1)} min ago ` +
            `(min interval: ${intervalMinutes} min). Skipping.`,
        );
        return 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Job selection
  // -------------------------------------------------------------------------
  const minScore = profile.minMatchScoreForAlert ?? 0;

  let jobs = db
    .prepare(
      `SELECT * FROM jobs
       WHERE alerted_at IS NULL
         AND match_score >= ?
         AND is_us = 1
         AND (seniority != 'senior' OR seniority IS NULL)
         AND is_active = 1`,
    )
    .all(minScore);

  // Filter by ALERT_KEYWORDS (comma-separated; case-insensitive title match)
  const keywordsRaw = env.ALERT_KEYWORDS;
  if (keywordsRaw && typeof keywordsRaw === 'string') {
    const keywords = keywordsRaw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (keywords.length > 0) {
      jobs = jobs.filter((job) => {
        const title = (job.title ?? '').toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      });
    }
  }

  // Filter by REMOTE_ONLY
  if (env.REMOTE_ONLY === true) {
    jobs = jobs.filter((job) => job.remote === 1);
  }

  if (jobs.length === 0) {
    console.log('[alerter] No new matching jobs to alert on.');
    return 0;
  }

  console.log(`[alerter] Sending digest for ${jobs.length} job(s).`);

  // -------------------------------------------------------------------------
  // Build digest content
  // -------------------------------------------------------------------------
  const digestText = formatDigest(jobs);
  const digestHtml = formatHtmlDigest(jobs);
  const subject = `[Job Scraper] ${jobs.length} new matching job${jobs.length === 1 ? '' : 's'}`;

  // -------------------------------------------------------------------------
  // Dispatch to all channels (each skips gracefully if not configured)
  // -------------------------------------------------------------------------
  await sendEmail(env, subject, digestText, digestHtml, transportOverride);
  await sendDiscord(env, digestText);
  await sendSlack(env, digestText);

  // -------------------------------------------------------------------------
  // Stamp alerted_at on all dispatched jobs (single UPDATE with IN clause)
  // -------------------------------------------------------------------------
  const now = new Date().toISOString();
  const ids = jobs.map((j) => j.id);
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE jobs SET alerted_at = ? WHERE id IN (${placeholders})`).run(now, ...ids);

  console.log(`[alerter] Stamped alerted_at on ${ids.length} job(s).`);
  return ids.length;
}
