# job-scraper

An automated job scraper for new-grad software engineering roles. It continuously pulls listings from GitHub new-grad feeds, major ATS platforms (Greenhouse, Lever, Ashby), big-tech career pages, and optional API sources, deduplicates them into a local SQLite database, and serves a filterable dashboard at `http://localhost:3000`. Email and webhook alerts notify you the moment matching roles appear.

## Quick Start (Docker)

```bash
git clone https://github.com/your-org/job-scraper.git
cd job-scraper
cp .env.example .env
# Edit .env and fill in any API keys / alert settings you want
docker compose up
```

Open `http://localhost:3000` in your browser.

## Local Development

```bash
npm install
cp .env.example .env
# Edit .env as needed
node src/index.js
```

Or with auto-reload (requires nodemon):

```bash
npm run dev
```

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and edit as needed.

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port the server listens on | `3000` |
| `SCRAPE_INTERVAL_CRON` | Cron expression for scrape frequency | `*/15 * * * *` |
| `NEW_JOB_WINDOW_HOURS` | Hours to consider a job "new" for alerts | `24` |
| `COUNTRY` | Country filter for Adzuna searches (`us`, `gb`, etc.) | `us` |
| `REMOTE_ONLY` | When `true`, filter to remote-friendly roles only | `false` |
| `ADZUNA_APP_ID` | Adzuna API app ID (optional) | — |
| `ADZUNA_APP_KEY` | Adzuna API key (optional) | — |
| `USAJOBS_API_KEY` | USAJobs API key (optional) | — |
| `USAJOBS_EMAIL` | Email registered with USAJobs API (optional) | — |
| `ALERTS_ENABLED` | Master switch for email/webhook alerts | `true` |
| `ALERT_KEYWORDS` | Comma-separated keywords to match job titles | `software engineer,...` |
| `ALERT_MIN_INTERVAL_MINUTES` | Minimum minutes between alert batches | `10` |
| `ALERT_EMAIL_TO` | Recipient address for email alerts | — |
| `SMTP_HOST` | SMTP server hostname | — |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username / sender address | — |
| `SMTP_PASS` | SMTP password or app password | — |
| `DISCORD_WEBHOOK_URL` | Discord incoming webhook URL (optional) | — |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL (optional) | — |

## Sources

### New-grad GitHub feeds
- [SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions) — community-maintained new-grad list
- [vanshb03/Summer2025-Internships](https://github.com/vanshb03/Summer2025-Internships) — internship + new-grad tracker

### ATS direct scraping
- **Greenhouse** — scrapes public job boards for companies listed in `src/config/greenhouse.js`
- **Lever** — scrapes public job boards for companies listed in `src/config/lever.js`
- **Ashby** — scrapes public job boards for companies listed in `src/config/ashby.js`

### Big-tech career pages
Amazon, Google, Microsoft, Apple, and Meta public job search APIs.

### Optional API sources
- **Adzuna** — requires `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free tier available)
- **USAJobs** — requires `USAJOBS_API_KEY` + `USAJOBS_EMAIL` (free government API)

## Dashboard

Open `http://localhost:3000` for the live dashboard. Features:

- Filter by keyword, location, company, and source
- Sort by date posted, company name, or title
- Mark jobs as applied, hidden, or saved
- Hide already-seen listings with one click
- Dark mode toggle (persisted in localStorage)
- Auto-refresh every 60 seconds

## Alerts Setup

### Email (SMTP)

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `ALERT_EMAIL_TO` in `.env`. Works with Gmail (use an App Password), SendGrid, Mailgun, or any SMTP relay.

Example for Gmail:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
ALERT_EMAIL_TO=you@gmail.com
```

### Discord

Create an Incoming Webhook in your Discord server (Server Settings > Integrations > Webhooks) and set:
```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

### Slack

Create an Incoming Webhook app in Slack and set:
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Database | `node:sqlite` (built-in, no separate process) |
| Web server | Express 4 |
| Scheduler | node-cron |
| Email | nodemailer |
| Validation | zod |
| Container | Docker / Docker Compose V2 |
