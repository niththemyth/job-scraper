/**
 * app.js — Job Scraper Dashboard (vanilla ES module, no build step)
 *
 * Manual verification steps:
 *   1. Start server:     node src/index.js
 *   2. Open:             http://localhost:3000/
 *   3. Network tab:      GET /api/jobs and GET /api/sources return 200
 *   4. Cards render:     seed DB or wait for first scrape run
 *   5. Sort dropdown:    each option changes the ?sort= param in network requests
 *   6. Scrape Now:       button shows "Scraping…" for ~2 s, then cards refresh
 *   7. Mark Applied:     button turns green in-place; re-clicking restores to "new"
 *   8. Hide:             card disappears immediately when hide-applied/hidden is on
 *   9. Filters:          each control re-fetches on change (company/search debounced)
 *  10. Mobile (<600px):  grid collapses to single column
 *  11. Dark mode:        toggle OS preference — colours adapt via prefers-color-scheme
 *  12. JS syntax check:  node --input-type=module < public/app.js  (exit 0 = clean)
 */

// ── Constants ──────────────────────────────────────────────────────────────

const NEW_JOB_WINDOW_HOURS = parseInt(
  document.querySelector('meta[name="new-job-window-hours"]')?.content ?? '24',
  10,
);

/** Skills from the profile data-attribute on <body>; used for matched-skill chips. */
const PROFILE_SKILLS = (document.body.dataset.skills ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  sort: localStorage.getItem('job-scraper-sort') ?? 'newest',
  filters: {
    source: '',
    company: '',
    q: '',
    remote: false,
    hasSalary: false,
    minScore: 0,
    entryLevelOnly: false,
    hideHandled: true,
  },
  jobs: [],
  total: 0,
  loading: false,
  offset: 0,
  limit: 50,
};

// ── DOM refs ───────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const jobsGrid        = $('jobs-grid');
const newCountBadge   = $('new-count-badge');
const lastScrapedEl   = $('last-scraped');
const scrapeBtn       = $('scrape-btn');
const sortSelect      = $('sort-select');
const filterSource    = $('filter-source');
const filterCompany   = $('filter-company');
const filterQ         = $('filter-q');
const filterRemote    = $('filter-remote');
const filterHasSalary = $('filter-has-salary');
const filterMinScore  = $('filter-min-score');
const scoreValue      = $('score-value');
const filterEntryLvl  = $('filter-entry-level');
const filterHideHndld = $('filter-hide-handled');
const paginationEl    = $('pagination');

// ── API helpers ────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── Data fetchers ──────────────────────────────────────────────────────────

async function fetchJobs() {
  if (state.loading) return;
  state.loading = true;
  jobsGrid.classList.add('loading');

  const params = new URLSearchParams();
  if (state.filters.hideHandled) params.set('status', 'new');
  if (state.filters.source)      params.set('source', state.filters.source);
  if (state.filters.company)     params.set('company', state.filters.company);
  if (state.filters.q)           params.set('q', state.filters.q);
  if (state.filters.remote)      params.set('remote', '1');
  if (state.filters.minScore > 0) params.set('minScore', String(state.filters.minScore));

  // Salary sort is handled client-side; fetch all (up to 200) with newest ordering
  const apiSort   = state.sort === 'salary' ? 'newest' : state.sort;
  const apiLimit  = state.sort === 'salary' ? '200'    : String(state.limit);
  const apiOffset = state.sort === 'salary' ? '0'      : String(state.offset);

  params.set('sort',   apiSort);
  params.set('limit',  apiLimit);
  params.set('offset', apiOffset);

  try {
    const data = await apiFetch(`/api/jobs?${params}`);
    let { jobs } = data;

    // ── Client-side filters ────────────────────────────────────────────
    if (state.filters.hasSalary) {
      jobs = jobs.filter(j => j.salary_min != null || j.salary_max != null);
    }
    if (state.filters.entryLevelOnly) {
      jobs = jobs.filter(j => j.seniority !== 'senior' && j.seniority !== 'mid');
    }

    // ── Client-side salary sort ────────────────────────────────────────
    if (state.sort === 'salary') {
      jobs = [...jobs].sort((a, b) => {
        const av = a.salary_max ?? a.salary_min ?? -1;
        const bv = b.salary_max ?? b.salary_min ?? -1;
        return bv - av;
      });
    }

    state.jobs  = jobs;
    state.total = data.total;
    renderJobs();
    renderPagination();
  } catch (err) {
    jobsGrid.innerHTML = `<div class="status-msg status-error">Failed to load jobs: ${esc(err.message)}</div>`;
  } finally {
    state.loading = false;
    jobsGrid.classList.remove('loading');
  }
}

/** Fetch total new-job count (unfiltered) for the badge in the top bar. */
async function fetchNewCount() {
  try {
    const data = await apiFetch('/api/jobs?status=new&limit=1');
    const n = data.total;
    newCountBadge.textContent = `${n} new`;
    newCountBadge.style.display = n > 0 ? '' : 'none';
  } catch {
    // non-fatal
  }
}

/** Fetch sources to update the last-scraped timestamp and populate the source dropdown. */
async function fetchSources() {
  try {
    const sources = await apiFetch('/api/sources');

    // Last scraped = most recent finished_at across all sources
    const times = sources
      .map(s => s.lastRun?.finished_at ?? s.lastRun?.started_at)
      .filter(Boolean)
      .sort()
      .reverse();
    lastScrapedEl.textContent = times.length > 0
      ? `Last scraped: ${timeAgo(times[0])}`
      : 'Last scraped: never';

    // Populate source select (preserve current value)
    const current = filterSource.value;
    while (filterSource.options.length > 1) filterSource.remove(1);
    for (const s of sources) {
      const opt = document.createElement('option');
      opt.value = s.source;
      opt.textContent = s.source;
      filterSource.appendChild(opt);
    }
    filterSource.value = current;
  } catch {
    // non-fatal
  }
}

async function scrapeNow() {
  scrapeBtn.textContent = 'Scraping…';
  scrapeBtn.disabled = true;
  try {
    await apiFetch('/api/scrape', { method: 'POST' });
  } catch {
    // fire-and-forget; errors are logged server-side
  }
  setTimeout(async () => {
    await Promise.all([fetchJobs(), fetchSources(), fetchNewCount()]);
    scrapeBtn.textContent = 'Scrape Now';
    scrapeBtn.disabled = false;
  }, 2000);
}

async function updateStatus(id, status) {
  try {
    const updated = await apiFetch(`/api/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });

    const idx = state.jobs.findIndex(j => j.id === id);
    if (idx === -1) return;

    // If hide-handled is on and the new status removes the job from view, remove the card
    if (state.filters.hideHandled && (status === 'applied' || status === 'hidden')) {
      state.jobs.splice(idx, 1);
      const card = jobsGrid.querySelector(`[data-job-id="${CSS.escape(id)}"]`);
      if (card) {
        card.classList.add('card-removing');
        setTimeout(() => card.remove(), 200);
      }
      renderPagination();
    } else {
      state.jobs[idx] = updated;
      const card = jobsGrid.querySelector(`[data-job-id="${CSS.escape(id)}"]`);
      if (card) renderCard(updated, card);
    }

    if (status === 'applied' || status === 'hidden') fetchNewCount();
  } catch (err) {
    console.error('[updateStatus] failed:', err.message);
  }
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderJobs() {
  if (state.jobs.length === 0) {
    jobsGrid.innerHTML = '<div class="status-msg">No jobs found. Try adjusting your filters or click Scrape Now.</div>';
    return;
  }
  jobsGrid.innerHTML = '';
  for (const job of state.jobs) {
    const card = document.createElement('article');
    card.className = 'job-card';
    card.dataset.jobId = job.id;
    renderCard(job, card);
    jobsGrid.appendChild(card);
  }
}

function renderCard(job, card) {
  const isNew      = isNewJob(job.first_seen);
  const scoreClass = job.match_score >= 5 ? 'score-green'
                   : job.match_score >= 2 ? 'score-yellow'
                   : 'score-grey';
  const salary        = formatSalary(job.salary_min, job.salary_max);
  const salaryClass   = salary === '—' ? ' salary-empty' : '';
  const avatarBg      = companyColor(job.company ?? '');
  const avatarLetter  = (job.company ?? '?').trim()[0].toUpperCase();
  const matchedSkills = getMatchedSkills(job);
  const hasLongDesc   = (job.description ?? '').length > 400;

  card.dataset.jobId  = job.id;
  card.className      = `job-card${job.status === 'applied' ? ' status-applied' : ''}`;

  card.innerHTML = `
    <div class="card-header">
      <div class="avatar" style="background:${avatarBg}" aria-hidden="true">${esc(avatarLetter)}</div>
      <div class="card-title-block">
        <h2 class="job-title">${esc(job.title)}</h2>
        <div class="company-name">${esc(job.company)}</div>
      </div>
    </div>

    <div class="card-meta">
      <span class="location${job.remote ? ' remote' : ''}">
        ${esc(job.location || 'Location unknown')}${job.remote ? ' · Remote' : ''}
      </span>
      <span class="salary${salaryClass}">${esc(salary)}</span>
    </div>

    <div class="card-badges">
      <span class="badge score-badge ${scoreClass}" title="Match score">${job.match_score ?? 0}/10</span>
      ${isNew ? '<span class="badge badge-new">NEW</span>' : ''}
      <span class="badge badge-source">${esc(job.source)}</span>
      ${job.sponsorship ? `<span class="badge badge-sponsorship" title="Sponsorship">${esc(job.sponsorship)}</span>` : ''}
      <span class="age" title="${esc(job.first_seen ?? '')}">${timeAgo(job.first_seen)}</span>
    </div>

    ${matchedSkills.length > 0 ? `
    <div class="skills-chips" aria-label="Matched skills">
      ${matchedSkills.slice(0, 8).map(s => `<span class="skill-chip">${esc(s)}</span>`).join('')}
    </div>` : ''}

    ${job.description ? `
    <div class="description collapsed" data-expanded="false">
      <div class="description-text"></div>
      ${hasLongDesc ? '<button class="expand-btn" type="button">Show more</button>' : ''}
    </div>` : ''}

    <div class="card-actions">
      <a href="${esc(job.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-apply">Apply ↗</a>
      <button
        class="btn btn-applied${job.status === 'applied' ? ' active' : ''}"
        type="button"
        data-action="applied"
        data-job-id="${esc(job.id)}"
      >${job.status === 'applied' ? 'Applied ✓' : 'Mark Applied'}</button>
      <button
        class="btn btn-hide"
        type="button"
        data-action="hidden"
        data-job-id="${esc(job.id)}"
      >Hide</button>
    </div>
  `;

  // Set description text via textContent (XSS-safe)
  if (job.description) {
    const textEl = card.querySelector('.description-text');
    if (textEl) textEl.textContent = job.description;
  }

  // Expand / collapse description
  const expandBtn = card.querySelector('.expand-btn');
  if (expandBtn) {
    const descEl = card.querySelector('.description');
    expandBtn.addEventListener('click', () => {
      const expanded = descEl.dataset.expanded === 'true';
      descEl.dataset.expanded = expanded ? 'false' : 'true';
      descEl.classList.toggle('collapsed', expanded);
      expandBtn.textContent = expanded ? 'Show more' : 'Show less';
    });
  }
}

function renderPagination() {
  // Salary sort fetches all at once client-side — no pagination needed
  if (state.sort === 'salary') {
    paginationEl.innerHTML = '';
    return;
  }
  const totalPages  = Math.ceil(state.total / state.limit);
  const currentPage = Math.floor(state.offset / state.limit) + 1;
  if (totalPages <= 1) {
    paginationEl.innerHTML = '';
    return;
  }
  const prev = currentPage > 1
    ? `<button class="btn btn-page" type="button" data-offset="${state.offset - state.limit}">← Prev</button>`
    : '';
  const next = currentPage < totalPages
    ? `<button class="btn btn-page" type="button" data-offset="${state.offset + state.limit}">Next →</button>`
    : '';
  paginationEl.innerHTML = `
    ${prev}
    <span class="page-info">Page ${currentPage} of ${totalPages} (${state.total} total)</span>
    ${next}
  `;
}

// ── Utilities ──────────────────────────────────────────────────────────────

/** HTML-escape a string for safe use in innerHTML contexts. */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSalary(min, max) {
  if (!min && !max) return '—';
  const k = n => `$${Math.round(n / 1000)}k`;
  if (min && max) return `${k(min)}–${k(max)}`;
  if (max)        return `up to ${k(max)}`;
  return `${k(min)}+`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function isNewJob(isoStr) {
  if (!isoStr) return false;
  return Date.now() - new Date(isoStr).getTime() < NEW_JOB_WINDOW_HOURS * 3_600_000;
}

/** Return which profile skills are mentioned in the job title or description. */
function getMatchedSkills(job) {
  if (!PROFILE_SKILLS.length) return [];
  const text = `${job.title ?? ''} ${job.description ?? ''}`.toLowerCase();
  return PROFILE_SKILLS.filter(skill => text.includes(skill));
}

/**
 * Deterministic hue from company name — gives each company a consistent avatar colour.
 * @param {string} name
 * @returns {string} CSS hsl() colour
 */
function companyColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 42%)`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Event listeners ────────────────────────────────────────────────────────

// Initialise sort dropdown from persisted state
sortSelect.value = state.sort;

sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  state.offset = 0;
  localStorage.setItem('job-scraper-sort', state.sort);
  fetchJobs();
});

scrapeBtn.addEventListener('click', scrapeNow);

filterSource.addEventListener('change', () => {
  state.filters.source = filterSource.value;
  state.offset = 0;
  fetchJobs();
});

filterCompany.addEventListener('input', debounce(() => {
  state.filters.company = filterCompany.value.trim();
  state.offset = 0;
  fetchJobs();
}, 400));

filterQ.addEventListener('input', debounce(() => {
  state.filters.q = filterQ.value.trim();
  state.offset = 0;
  fetchJobs();
}, 400));

filterRemote.addEventListener('change', () => {
  state.filters.remote = filterRemote.checked;
  state.offset = 0;
  fetchJobs();
});

filterHasSalary.addEventListener('change', () => {
  state.filters.hasSalary = filterHasSalary.checked;
  state.offset = 0;
  fetchJobs();
});

filterMinScore.addEventListener('input', () => {
  const v = parseInt(filterMinScore.value, 10);
  scoreValue.textContent = String(v);
  state.filters.minScore = v;
  state.offset = 0;
  fetchJobs();
});

filterEntryLvl.addEventListener('change', () => {
  state.filters.entryLevelOnly = filterEntryLvl.checked;
  state.offset = 0;
  fetchJobs();
});

filterHideHndld.addEventListener('change', () => {
  state.filters.hideHandled = filterHideHndld.checked;
  state.offset = 0;
  fetchJobs();
});

// Delegated handler for action buttons and pagination (avoids re-binding per card)
document.addEventListener('click', e => {
  // Action buttons (Apply / Hide)
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const { action, jobId } = actionBtn.dataset;
    if (action === 'applied') {
      const job = state.jobs.find(j => j.id === jobId);
      const newStatus = job?.status === 'applied' ? 'new' : 'applied';
      updateStatus(jobId, newStatus);
    } else if (action === 'hidden') {
      updateStatus(jobId, 'hidden');
    }
    return;
  }

  // Pagination buttons
  const pageBtn = e.target.closest('[data-offset]');
  if (pageBtn) {
    state.offset = parseInt(pageBtn.dataset.offset, 10);
    fetchJobs();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// ── Initialise ─────────────────────────────────────────────────────────────

// Sync filter state with the default checked values in HTML
state.filters.hideHandled = filterHideHndld.checked;

// Initial load
fetchJobs();
fetchSources();
fetchNewCount();

// Auto-refresh every 60 s
setInterval(() => {
  fetchJobs();
  fetchSources();
  fetchNewCount();
}, 60_000);
