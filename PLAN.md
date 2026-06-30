# Job Scraper — Build Plan

> Spec for a build session (e.g. via the **superpowers** plugin). Greenfield repo.
> Decisions locked: **all big-tech coverage**, **US-only**, **alerts enabled**, **containerized/cloud-ready**.

## 1. Scope

A containerized web app that:
- Polls **Greenhouse, Lever, Ashby** ATS feeds (per-company) + **dedicated big-tech adapters**
  (Amazon, Google, Microsoft, Apple, Meta, …) + **Adzuna** and **USAJobs** search APIs on a schedule.
- Filters to **US-based, entry-level software-engineering** roles aligned to a resume profile
  (`config/profile.json`), scores each by skill overlap, normalizes into one schema, dedupes.
- Stores them in SQLite with a `first_seen` timestamp so "newly posted" is meaningful.
- **Sends alerts** (email + Discord/Slack webhook) the moment new matching jobs appear.
- Serves a **dashboard** to browse/filter/search, newest-first, with one-click **Apply** links and
  per-job triage state (`new` / `applied` / `hidden`).

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Single Node.js container                             │
│                                                       │
│  ┌────────────┐  schedule   ┌────────────────────┐    │
│  │ Scheduler  │─(node-cron)▶│ Scrapers           │    │
│  └────────────┘             │  greenhouse/lever/ │    │
│        │                    │  ashby (by slug)   │    │
│        │                    │  bigtech adapters  │    │
│        │                    │  adzuna / usajobs  │    │
│        ▼                    └─────────┬──────────┘    │
│  ┌────────────┐  upsert               │               │
│  │  SQLite    │◀──────────────────────┘               │
│  │ (volume)   │            │ new jobs                  │
│  └─────┬──────┘            ▼                           │
│        │ read       ┌────────────┐                     │
│  ┌─────▼──────┐     │ Alerter    │── email / webhook ─▶│ you
│  │ Express API│     └────────────┘                     │
│  └─────┬──────┘                                        │
│        ▼ ┌──────────────────┐                          │
│   static │ dashboard (JS)   │  :3000                   │
│         └──────────────────┘                           │
└──────────────────────────────────────────────────────┘
```

One process, one image. SQLite file on a mounted volume.

## 3. Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Runtime | Node.js 22 (ESM, plain JS + JSDoc) | No TS build step; fewer moving parts in Docker |
| DB | **`node:sqlite`** (built-in, verified working) | Zero native deps, tiny image |
| HTTP server | Express | Stable |
| Scheduler | `node-cron` | Cron-style polling |
| HTTP client | native `fetch` + `p-retry` | Built-in + backoff for flaky feeds |
| Validation | `zod` | Validate env + sources config at boot |
| Email | `nodemailer` | SMTP (Gmail app password or any provider) |
| Webhook alerts | native `fetch` | Discord/Slack incoming webhooks (no extra dep) |
| Frontend | **Static vanilla JS + CSS** (no build) | Single-stage Docker; a filter dashboard needs no framework |
| Container | `node:22-slim` + `docker-compose.yml` | Cloud-ready, volume for DB |

## 4. Big-tech coverage strategy (important)

"All big tech" cannot come from ATS feeds alone — the giants don't use Greenhouse/Lever/Ashby.
Three tiers, in priority order:

**Tier 1 — ATS slug feeds** (clean JSON, most reliable). Tech companies that use these:
- Greenhouse: `stripe`, `databricks`, `airbnb`, `coinbase`, `reddit`, `pinterest`, `dropbox`,
  `doordash`, `instacart`, `snowflake`, `datadog`, `gitlab`, `cloudflare`, `robinhood`, `figma`,
  `lyft`, `twitch`, `asana`, `samsara`, `affirm`, `gusto`, `nerdwallet`, `discord`
- Lever: `netflix`, `plaid`, `palantir`, `brex`
- Ashby: `openai`, `ramp`, `linear`, `notion`, `mistral`, `perplexity-ai`
- ⚠️ Slugs must be **verified live** — the build session should hit each endpoint once and drop any
  that 404. `scrape_runs` + `GET /api/sources` will surface bad slugs at runtime too.

**Tier 2 — Dedicated big-tech adapters** (proprietary career APIs; one module each, best-effort,
may need occasional maintenance when a site changes):
- **Amazon** — `https://www.amazon.jobs/en/search.json?normalized_job_title=Software%20Development%20Engineer&...`
- **Google** — `https://careers.google.com/api/v3/search/?q=software%20engineer&...`
- **Microsoft** — `https://gcsservices.careers.microsoft.com/search/api/v1/search?q=software%20engineer&...`
- **Apple** — `https://jobs.apple.com/api/role/search` (POST, JSON body)
- **Meta** — `https://www.metacareers.com/graphql` (GraphQL; hardest — fall back to Adzuna if brittle)
- Optional extras with public-ish feeds: **Nvidia, Salesforce, Adobe, Uber, Spotify, IBM, Oracle**
  (several of these are Eightfold/Workday-backed; add as time allows).
- Each adapter is **isolated**: failure logs to `scrape_runs` and never kills the run.

**Tier 3 — Adzuna (US) safety net**: aggregates postings from FAANG + everyone else. Query
`software engineer` etc. with `country=us`, then keep results whose company matches a **big-tech
allow-list** (so Tier 2 brittleness is covered). USAJobs adds US federal SWE roles.

> Net effect: Tier 1 gives reliable unicorn/scaleup coverage, Tier 2 targets the giants directly,
> Tier 3 backfills anything Tier 2 misses. Honest tradeoff: Tier 2 adapters are the maintenance risk.

## 5. US-only filtering
- Adzuna `country=us`; USAJobs is US-federal by nature.
- ATS + big-tech results: keep rows whose location resolves to a US state / "United States" / "Remote (US)".
  Maintain a small US-location matcher (state names + abbreviations + "remote us"); drop clearly non-US.
- `remote` flag is best-effort; `REMOTE_ONLY` env can further narrow.

## 5.1 Job matching profile (entry-level + resume-aligned)

A single editable file **`config/profile.json`** drives *which* jobs count — no code changes needed.
Three stages applied to every normalized job:

1. **Title filter** — keep if title matches `includeTitles`, drop if it matches `excludeTitles`
   (`senior`, `staff`, `principal`, `lead`, `manager`, `intern`, `II/III/IV`, `sr`). This removes
   non-entry roles before anything else.
2. **Entry-level gate** — regex the description for experience requirements
   (`/(\d+)\+?\s*years/`, "minimum N years", etc.); set `min_years`. If `entryLevelOnly` and
   `min_years > maxYearsExperience` (default 2), drop it. Roles with no stated requirement pass.
   Also infer `seniority` from title/keywords (`new grad`/`entry`/`junior` → entry).
3. **Resume match score** — count overlap between the job's title+description and `skills`; store as
   `match_score`. Used to **sort newest-and-best first** and to **gate alerts**
   (`match_score >= minMatchScoreForAlert`). Nothing is deleted for a low score — it just ranks lower
   and won't trigger an alert.

Starter profile derived from the attached resume (Nithin Boopalan — UIUC CompE, Dec 2026, full-stack +
ML/AI):
```json
{
  "includeTitles": ["software engineer","software developer","swe","full stack","backend","frontend",
                    "new grad","new graduate","early career","associate software engineer",
                    "member of technical staff","application developer","ml engineer","ai engineer"],
  "excludeTitles": ["senior","sr.","staff","principal","lead","manager","director","architect",
                    "intern","ii","iii","iv"],
  "entryLevelOnly": true,
  "maxYearsExperience": 2,
  "skills": ["python","go","golang","c++","java","javascript","typescript","react","node","express",
             "fastapi","flask","django","nestjs","postgresql","mysql","mongodb","aws","docker",
             "kubernetes","ci/cd","machine learning","pytorch","langchain","scikit-learn","cuda",
             "sql","rest"],
  "minMatchScoreForAlert": 2
}
```
Implemented in `src/lib/filter.js` (title + entry-level) and `src/lib/match.js` (scoring). The dashboard
exposes a "min match score" slider and an "entry-level only" toggle so you can loosen/tighten live
without editing the file.

## 6. Data model (SQLite)

```sql
CREATE TABLE jobs (
  id           TEXT PRIMARY KEY,   -- hash(source + external_id)
  source       TEXT NOT NULL,
  external_id  TEXT NOT NULL,
  company      TEXT NOT NULL,
  title        TEXT NOT NULL,
  location     TEXT,
  is_us        INTEGER,            -- 1 if location matched US
  remote       INTEGER,
  url          TEXT NOT NULL,      -- apply link
  description  TEXT,
  department   TEXT,
  posted_at    TEXT,               -- source date if available
  seniority    TEXT,               -- inferred: entry|mid|senior|unknown
  min_years    INTEGER,            -- years experience required, parsed from description (NULL if none)
  match_score  INTEGER DEFAULT 0,  -- overlap with resume skills (drives ranking + alert gate)
  first_seen   TEXT NOT NULL,      -- when WE first saw it (drives "new" + alerts)
  last_seen    TEXT NOT NULL,
  is_active    INTEGER DEFAULT 1,
  status       TEXT DEFAULT 'new', -- new|applied|hidden
  alerted_at   TEXT                -- set once an alert has been sent (dedupe)
);
CREATE INDEX idx_jobs_first_seen ON jobs(first_seen);
CREATE INDEX idx_jobs_status     ON jobs(status);

CREATE TABLE scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, started_at TEXT, finished_at TEXT,
  found INTEGER, added INTEGER, error TEXT
);
```

Dedupe key = stable hash of `source:external_id`. Re-scrapes **upsert**: bump `last_seen`, never
overwrite `first_seen`, `status`, or `alerted_at`.

## 7. Alerts

- **Channels:** SMTP email (`nodemailer`) + Discord and/or Slack incoming webhook. Any channel with
  missing config is skipped. Recommend a webhook as the simplest reliable default + email as primary.
- **Trigger:** after each scrape run, select jobs with `alerted_at IS NULL` that match alert filters,
  send a **single digest** (not one message per job), then stamp `alerted_at`. Guarantees no
  double-alerts and no spam storms.
- **Filters:** alerts only fire for jobs that already passed the matching profile (§5.1) — i.e.
  **entry-level, US, and `match_score >= minMatchScoreForAlert`**. `ALERT_KEYWORDS` / company
  allow-list / `REMOTE_ONLY` narrow further. So you're alerted on entry-level SWE roles that fit your
  resume, not every posting.
- **Rate control:** `ALERT_MIN_INTERVAL_MINUTES` to batch bursts.
- Manual test endpoint `POST /api/alerts/test`.
- ⚠️ The **Gmail MCP available in the build session is build-time only** — a deployed container can't
  use it. Runtime email must go through SMTP. (The build session may use the Gmail MCP to send a
  one-off "it works" test, but the shipped code uses nodemailer.)

## 8. Scheduler
- `node-cron`, default every 15 min (`SCRAPE_INTERVAL_CRON`).
- All adapters run concurrently with a concurrency cap.
- Run-once on boot. Manual trigger `POST /api/scrape`. Alerter runs at the end of each scrape.

## 9. API
```
GET   /api/jobs?status=&source=&company=&q=&remote=&since=&limit=&offset=  → { jobs, total }
GET   /api/jobs/:id
PATCH /api/jobs/:id            { status: 'applied'|'hidden'|'new' }
GET   /api/sources            → config + last run stats (shows dead slugs)
POST  /api/scrape             → trigger now
POST  /api/alerts/test        → send a test alert
GET   /api/health
```

## 10. Dashboard (vanilla SPA)
- Newest-first feed; **NEW** badge for `first_seen` within `NEW_JOB_WINDOW_HOURS`.
- Filters: source, company, search, remote-only, hide applied/hidden.
- Card: title, company, location, age ("2h ago"), **Apply** (original posting), **Mark applied**, **Hide**.
- Auto-refresh every 60s; live new-job count. Responsive, dark-mode-friendly CSS.

## 11. Config & secrets (`.env.example`)
```
PORT=3000
SCRAPE_INTERVAL_CRON=*/15 * * * *
NEW_JOB_WINDOW_HOURS=24
COUNTRY=us
REMOTE_ONLY=false
# data sources
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
USAJOBS_API_KEY=
USAJOBS_EMAIL=
# alerts
ALERTS_ENABLED=true
ALERT_KEYWORDS=software engineer,backend,frontend,full stack,sre,platform
ALERT_MIN_INTERVAL_MINUTES=10
ALERT_EMAIL_TO=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
DISCORD_WEBHOOK_URL=
SLACK_WEBHOOK_URL=
```
Adapters/channels with missing keys are **skipped with a warning** — the app runs with just ATS +
big-tech feeds and a webhook out of the box (no paid signups required).

## 12. Sources config (`config/sources.json`, committed & editable)
```json
{
  "greenhouse": ["stripe","databricks","airbnb","coinbase","reddit","pinterest","dropbox",
                 "doordash","instacart","snowflake","datadog","gitlab","cloudflare","robinhood",
                 "figma","lyft","twitch","asana","affirm","discord"],
  "lever": ["netflix","plaid","palantir","brex"],
  "ashby": ["openai","ramp","linear","notion","perplexity-ai"],
  "bigtech": ["amazon","google","microsoft","apple","meta"],
  "adzuna":  { "country": "us", "queries": ["software engineer","backend engineer","frontend engineer"],
               "companyAllowList": ["Google","Amazon","Apple","Microsoft","Meta","Nvidia","Netflix"] },
  "usajobs": { "queries": ["software engineer","IT specialist"] }
}
```

## 13. Repo layout
```
job-scraper/
├─ Dockerfile  docker-compose.yml  .dockerignore  .env.example  .gitignore
├─ package.json  PLAN.md  CLAUDE.md
├─ config/sources.json  config/profile.json
├─ src/
│  ├─ index.js            # express + static + boot scrape + scheduler
│  ├─ db.js               # node:sqlite + migrations
│  ├─ config.js           # env + sources validation (zod)
│  ├─ scheduler.js
│  ├─ alerter.js          # digest + channels
│  ├─ api/jobs.js
│  ├─ scrapers/
│  │   ├─ index.js  greenhouse.js  lever.js  ashby.js  adzuna.js  usajobs.js
│  │   └─ bigtech/{amazon,google,microsoft,apple,meta}.js
│  ├─ lib/{http,normalize,filter,match,us-location,hash}.js
│  └─ test/fixtures/      # saved JSON per source for offline dev/tests
└─ public/{index.html,app.js,styles.css}
```

## 14. Build phases (for the CLI / superpowers session)
1. **Scaffold** — package.json, db, config, `/api/health`, Docker. Boots clean.
2. **One ATS adapter end-to-end** — Greenhouse → normalize → upsert → `/api/jobs`, using a **fixture**
   so it works offline (sandbox may block outbound to these hosts; deploy target won't).
3. **Remaining ATS adapters** — Lever, Ashby (each with a fixture).
4. **Big-tech adapters** — Amazon/Google/Microsoft/Apple/Meta (fixtures; verify endpoints where reachable).
5. **Adzuna + USAJobs** (key-gated, skip-if-missing).
6. **Filtering (SWE + US-only) + entry-level gate + resume match scoring (`config/profile.json`) + dedupe + scheduler.**
7. **Alerter** (email + webhook + digest dedupe).
8. **Dashboard.**
9. **Dockerize + compose + README + verify run.**
10. **Review pass** (see skills).

> Network caveat for the build session: outbound to greenhouse/lever/ashza/adzuna failed from this
> sandbox (`HTTP 000`). Develop against **saved fixtures** so the build never blocks; live verification
> happens on the deploy target. Check `$HTTPS_PROXY/__agentproxy/status` if you want to retry live.

## 15. Recommended Claude Code skills / plugins for the build
| Skill | When | Why |
|-------|------|-----|
| **superpowers** | Planning/refinement | Drive the spec & task breakdown (your chosen workflow) |
| **init** | After scaffold | Generate `CLAUDE.md` for future sessions |
| **session-start-hook** | Early | Auto-install deps + run tests/lint each web session (build is iterative) |
| **run** | After Docker | Launch the container, confirm it serves jobs |
| **verify** | After dashboard | Drive the app (Chromium + Playwright preinstalled) to confirm render + Apply/Mark-applied + a test alert |
| **security-review** | Before deploy | Outbound requests + API keys + scraped HTML rendering → SSRF / secret-leak / XSS pass |
| **code-review** | End | Correctness pass on the diff |
| **fewer-permission-prompts** | During | Allowlist common npm/docker calls so the session isn't interrupted |

No external marketplace plugins required. Freebies in this env: **Playwright + Chromium preinstalled**
(handy for a future browser-based scraper fallback for a board with no JSON feed).

## 16. Known risks / honest caveats
- **Tier-2 big-tech adapters are brittle** — proprietary career APIs change without notice; Adzuna
  (Tier 3) is the backstop. Expect occasional adapter maintenance.
- **ATS slugs drift** — verify on first run; `GET /api/sources` surfaces dead ones.
- **Scraping etiquette** — respect rate limits, set a real `User-Agent`, cache between polls; these are
  public JSON endpoints but don't hammer them. No LinkedIn/Indeed scraping (ToS + anti-bot).
- **Adzuna/USAJobs need free API keys** — app runs without them (ATS + big-tech only), just narrower.
