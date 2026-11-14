// The entrance's news (landing L-4, LAC-15, Q5, Q10). entry.js loads this only after the entrance
// has rendered, and nothing waits for it: sign-in, a returning session and the game all go ahead
// whether news arrives, arrives late, or never does. It reads published articles through the
// public API with the publishable key (no supabase-js) and shows:
//   - the latest three, with title, date and summary, and a link to all news (Q10);
//   - one line near the form for scheduled maintenance that is upcoming or under way (Q5). It is
//     checked again at the notice's start and end, from the data already loaded: it says "under
//     way" once it starts and disappears once it ends, without a reload or another request
//     (L-4 review, L4-01).
// If anything goes wrong, nothing is shown: no error, no empty box.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const COLS = 'slug,kind,title,summary,published_at,maintenance_starts_at,maintenance_ends_at';
const TIMEOUT_MS = 4000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function read(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/news?${query}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }, signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.filter((r) => r && SLUG.test(String(r.slug)) && r.title && r.published_at) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const dayText = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const timeText = (t) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const startOf = (m) => (m.maintenance_starts_at ? Date.parse(m.maintenance_starts_at) : null);
const endOf = (m) => (m.maintenance_ends_at ? Date.parse(m.maintenance_ends_at) : null);
// Upcoming or under way: no end, or the end still to come.
const relevant = (m, now) => endOf(m) == null || endOf(m) > now;
// Under way: started (with or without an end), or with no start and an end still to come. A notice
// with no window at all is neither under way nor upcoming.
const underWay = (m, now) => relevant(m, now) && (startOf(m) != null ? startOf(m) <= now : endOf(m) != null);

// The notice to show now: any one under way first, open-ended or not (L-4 review, L4-03), then the
// soonest to start, then one with no window. Null when none is left.
function pickMaintenance(list, now) {
  const live = list.filter((m) => relevant(m, now));
  return live.find((m) => underWay(m, now))
    || live.filter((m) => startOf(m) != null && startOf(m) > now).sort((a, b) => startOf(a) - startOf(b))[0]
    || live[0] || null;
}

function maintenanceLine(m, now) {
  const start = startOf(m);
  const end = endOf(m);
  let when = '';
  if (start != null && start > now) when = end != null ? `, ${timeText(start)} to ${timeText(end)}` : `, from ${timeText(start)}`;
  else if (end != null) when = `, under way until ${timeText(end)}`;
  return `<b>Scheduled maintenance:</b> ${esc(m.title)}${esc(when)}. <a href="/news/${esc(m.slug)}">Details</a>`;
}

// Shows the right notice for now, and checks again at the next start or end among the notices
// already loaded. Timers longer than setTimeout allows (about 24 days) are re-armed in steps.
const MAX_WAIT = 2 ** 31 - 1;
let maintTimer = null;
function showMaintenance(list) {
  clearTimeout(maintTimer);
  const now = Date.now();
  const el = $('maint');
  const m = pickMaintenance(list, now);
  if (!m) { el.hidden = true; el.textContent = ''; return; }
  const html = maintenanceLine(m, now);
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = false;
  const next = list.flatMap((x) => [startOf(x), endOf(x)]).filter((t) => t != null && t > now).sort((a, b) => a - b)[0];
  if (next != null) maintTimer = setTimeout(() => showMaintenance(list), Math.min(next - now + 50, MAX_WAIT));
}

// Its styles, loaded only when there is something to show; shown once they apply (or fail).
function useStyles() {
  if (document.getElementById('entry-news-css')) return Promise.resolve();
  const link = document.createElement('link');
  link.id = 'entry-news-css';
  link.rel = 'stylesheet';
  link.href = 'css/entry-news.css';
  const done = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
  document.head.append(link);
  return done;
}

export async function showNews() {
  // Maintenance: only notices that haven't ended, so ended ones can never use up the five places.
  const now = new Date().toISOString();
  const [latest, maintenance] = await Promise.all([
    read(`select=${COLS}&order=published_at.desc&limit=3`),
    read(`select=${COLS}&kind=eq.maintenance&or=(maintenance_ends_at.is.null,maintenance_ends_at.gt.${now})&order=published_at.desc&limit=5`),
  ]);
  const notices = maintenance || [];
  if (!latest?.length && !pickMaintenance(notices, Date.now())) return;
  await useStyles();
  showMaintenance(notices);
  if (latest?.length) {
    $('news-list').innerHTML = latest.map((a) => `<li class="e-news-item">
      <a class="e-news-link" href="/news/${esc(a.slug)}">${esc(a.title)}</a>
      <span class="e-news-date"><time datetime="${esc(a.published_at)}">${esc(dayText(a.published_at))}</time></span>
      <span class="e-news-summary">${esc(a.summary)}</span>
    </li>`).join('');
    $('news').hidden = false;
  }
}
