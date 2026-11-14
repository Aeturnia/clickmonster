// Public news (landing L-3, docs/landing-scope.md): the rules every part shares.
//   - the admin console (inline validation, preview),
//   - the `admin` edge function (it enforces them; it reaches this file through its js/ link, and tools/deploy-functions.mjs uploads js/data/),
//   - the public article pages (L-4).
// The database enforces the same limits and the publication rules with constraints and a trigger
// (supabase/migrations/*_news.sql), so nothing relies on this file alone.

export const NEWS_KINDS = ['update', 'patch', 'release', 'maintenance', 'announcement'];
export const NEWS_KIND_LABEL = {
  update: 'Development update', patch: 'Patch notes', release: 'Release', maintenance: 'Scheduled maintenance', announcement: 'Announcement',
};
export const NEWS_STATUS_LABEL = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished' };

export const NEWS_LIMITS = {
  title: [3, 120],
  summary: [10, 240],
  body: [1, 20000],
  slug: [3, 80],
};
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// A URL slug from a title: lower case letters, numbers and single hyphens.
export function slugify(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, NEWS_LIMITS.slug[1]).replace(/-+$/, '');
}

const len = (s) => [...String(s)].length;
const trimLines = (s) => String(s ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

// Checks a draft. Returns { value, errors }: value is the cleaned entry, errors maps a field
// (kind, title, slug, summary, body, startsAt, endsAt) to a message. Times are ISO strings or null.
export function checkNews(input = {}) {
  const errors = {};
  const kind = String(input.kind || 'update');
  const title = String(input.title ?? '').replace(/\s+/g, ' ').trim();
  const summary = String(input.summary ?? '').replace(/\s+/g, ' ').trim();
  const body = trimLines(input.body);
  const slug = String(input.slug ?? '').trim() || slugify(title);
  const when = (v) => {
    if (v == null || v === '') return null;
    const t = new Date(v);
    return Number.isNaN(t.getTime()) ? 'bad' : t.toISOString();
  };
  let startsAt = when(input.startsAt);
  let endsAt = when(input.endsAt);

  if (!NEWS_KINDS.includes(kind)) errors.kind = 'Choose a kind of news.';
  const [tMin, tMax] = NEWS_LIMITS.title;
  if (len(title) < tMin || len(title) > tMax) errors.title = `Give it a title of ${tMin} to ${tMax} characters.`;
  const [sMin, sMax] = NEWS_LIMITS.summary;
  if (len(summary) < sMin || len(summary) > sMax) errors.summary = `Write a one-line summary of ${sMin} to ${sMax} characters. It shows in lists and link previews.`;
  const [bMin, bMax] = NEWS_LIMITS.body;
  if (len(body) < bMin) errors.body = 'Write the article.';
  else if (len(body) > bMax) errors.body = `The article is too long: at most ${bMax.toLocaleString('en')} characters.`;
  const [gMin, gMax] = NEWS_LIMITS.slug;
  if (!SLUG_RE.test(slug) || slug.length < gMin || slug.length > gMax) errors.slug = `The address uses ${gMin} to ${gMax} lower-case letters, numbers and single hyphens, like "patch-notes-1-2".`;
  if (kind === 'maintenance') {
    if (startsAt === 'bad') errors.startsAt = 'Enter a valid start time, or leave it empty.';
    if (endsAt === 'bad') errors.endsAt = 'Enter a valid end time, or leave it empty.';
    if (!errors.startsAt && !errors.endsAt && startsAt && endsAt && endsAt <= startsAt) errors.endsAt = 'The end must be after the start.';
  } else {
    startsAt = null; // only maintenance has a window
    endsAt = null;
  }
  return { value: { kind, title, slug, summary, body, startsAt: startsAt === 'bad' ? null : startsAt, endsAt: endsAt === 'bad' ? null : endsAt }, errors };
}

// The article body as blocks: paragraphs (separated by blank lines) and bullet lists (lines that
// start with "- "). Plain text only: no HTML, links or images (Q4). The caller escapes the text.
export function newsBlocks(body) {
  const blocks = [];
  for (const chunk of trimLines(body).split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim());
    if (!lines.length) continue;
    let para = [];
    let list = null;
    const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; } };
    const flushList = () => { if (list) { blocks.push({ type: 'ul', items: list }); list = null; } };
    for (const raw of lines) {
      const m = raw.match(/^\s*-\s+(.*)$/);
      if (m) { flushPara(); (list ||= []).push(m[1].trim()); } else { flushList(); para.push(raw.trim()); }
    }
    flushPara();
    flushList();
  }
  return blocks;
}

// The body as escaped HTML (paragraphs and lists), for the admin preview and the article pages.
export function newsBodyHtml(body, esc) {
  return newsBlocks(body).map((b) => (b.type === 'p'
    ? `<p>${esc(b.text)}</p>`
    : `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`)).join('\n');
}

// What may happen to an entry in each state (Q8). The database enforces the same.
export const canDeleteNews = (status) => status === 'draft' || status === 'unpublished';
export const slugLocked = (entry) => !!entry?.published_at;
