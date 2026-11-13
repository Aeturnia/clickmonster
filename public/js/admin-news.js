// Public news in the admin console (landing L-3, docs/landing-scope.md). Admins only.
// Write a draft, preview it, publish, unpublish and delete; every change goes through the `admin`
// edge function, which records it in the audit log. The rules come from news.js, which the
// function and the database enforce too.
import { NEWS_KINDS, NEWS_KIND_LABEL, NEWS_STATUS_LABEL, NEWS_LIMITS, checkNews, slugify, newsBodyHtml, canDeleteNews, slugLocked } from './data/news.js';
import { ask } from './confirm.js';

// Form fields and the error keys checkNews() uses.
const FIELD = { kind: 'nw-kind', title: 'nw-title', slug: 'nw-slug', summary: 'nw-summary', body: 'nw-body', startsAt: 'nw-start', endsAt: 'nw-end' };

export function setupNews({ st, call, toast, render, esc, field, input, dataTable, pushRoute }) {
  // Pending flags in st.pendingForms (shared with admin.js): `news:<id|+new>:<op>`. One change to
  // an entry at a time; a second press sends nothing and asks nothing.
  const entryKey = (ed) => `news:${ed.id ?? '+new'}:`;
  const opKey = (ed, op) => `${entryKey(ed)}${op}`;
  const busy = (ed) => [...st.pendingForms].some((k) => k.startsWith(entryKey(ed)));
  const pendingOp = (ed) => ['save', 'publish', 'unpublish', 'delete'].find((op) => st.pendingForms.has(opKey(ed, op))) || null;
  function waiting(ed) {
    if (!busy(ed)) return false;
    toast('Still working on the last change to this article.');
    return true;
  }
  async function op(ed, name, fn) {
    st.pendingForms.add(opKey(ed, name));
    render();
    try { await fn(); return true; } catch (e) { toast(e.message, true); return false; } finally { st.pendingForms.delete(opKey(ed, name)); render(); }
  }

  const fmtDate = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  // <input type="datetime-local"> works in local time; the server stores UTC.
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const draftOf = (e) => ({
    kind: e?.kind || 'update', title: e?.title || '', slug: e?.slug || '', summary: e?.summary || '', body: e?.body || '',
    startsAt: toLocalInput(e?.maintenance_starts_at), endsAt: toLocalInput(e?.maintenance_ends_at),
  });
  const saved = (ed) => (ed.id == null ? null : st.news?.find((n) => n.id === ed.id) || ed.entry);
  const dirty = (ed) => JSON.stringify(ed.draft) !== JSON.stringify(draftOf(saved(ed)));
  // The draft as the server will see it: local times as ISO, slug derived from the title if empty.
  const outgoing = (ed) => ({ ...ed.draft, slug: ed.slugTouched || saved(ed) ? ed.draft.slug : '' , startsAt: ed.draft.startsAt ? new Date(ed.draft.startsAt).toISOString() : null, endsAt: ed.draft.endsAt ? new Date(ed.draft.endsAt).toISOString() : null });

  function open(entry) {
    st.newsEdit = { id: entry?.id ?? null, entry: entry || null, draft: draftOf(entry), slugTouched: !!entry, preview: false };
    st.fieldErrors = {};
    delete st.formErrors['news-form'];
    st.focusNext = '#news-edit-title';
    render();
    pushRoute();
  }
  function close() {
    const id = st.newsEdit?.id;
    st.newsEdit = null;
    st.fieldErrors = {};
    st.focusNext = id != null ? `[data-a="newsOpen"][data-v="${id}"]` : '#news-new';
    render();
    pushRoute();
  }

  async function load() {
    try { st.news = (await call('news')).news; } catch (e) { toast(e.message, true); }
    if (st.newsEdit?.id != null) {
      const fresh = st.news?.find((n) => n.id === st.newsEdit.id);
      if (fresh) st.newsEdit.entry = fresh;
    }
    render();
  }
  // Open an entry by id (from the address bar).
  async function edit(id) {
    if (!st.news) await load();
    const entry = st.news?.find((n) => String(n.id) === String(id));
    if (entry) open(entry); else { toast('That news entry no longer exists.', true); st.newsEdit = null; render(); }
  }

  // ------------------------------------------------------------ views
  function statusLine(e) {
    if (!e) return '<p class="note">A new draft. Nothing is public until you publish it.</p>';
    const where = `/news/${esc(e.slug)}`;
    if (e.status === 'draft') return '<p class="note">Draft. Not public.</p>';
    if (e.status === 'published') {
      return `<p class="note"><span class="pill ok">Published</span> since ${esc(fmtDate(e.published_at))}${e.revised_at ? `, updated ${esc(fmtDate(e.revised_at))}` : ''}. Its address is <b>${where}</b> and can't change.</p>`;
    }
    return `<p class="note"><span class="pill">Unpublished</span> Not public. First published ${esc(fmtDate(e.published_at))}; its address stays <b>${where}</b>.</p>`;
  }

  function preview(ed) {
    const d = ed.draft;
    const blocks = newsBodyHtml(d.body, esc);
    const when = saved(ed)?.published_at ? fmtDate(saved(ed).published_at) : 'Not yet published';
    return `<section class="box news-preview" aria-labelledby="news-preview-title">
      <h3 id="news-preview-title" tabindex="-1">Preview</h3>
      <p class="hint">How the article reads to players. The public pages arrive with the next phase; the layout there may differ.</p>
      <article class="news-article">
        <p class="news-kind">${esc(NEWS_KIND_LABEL[d.kind] || d.kind)} · ${esc(when)}</p>
        <h4>${esc(d.title || 'Untitled')}</h4>
        ${d.summary ? `<p class="news-summary">${esc(d.summary)}</p>` : ''}
        ${d.kind === 'maintenance' && (d.startsAt || d.endsAt) ? `<p class="news-window">Maintenance: ${esc(d.startsAt ? fmtDate(new Date(d.startsAt)) : 'start not set')} to ${esc(d.endsAt ? fmtDate(new Date(d.endsAt)) : 'end not set')}</p>` : ''}
        <div class="news-body">${blocks || '<p class="note">The article is empty.</p>'}</div>
      </article>
    </section>`;
  }

  function editor() {
    const ed = st.newsEdit;
    const e = saved(ed);
    const d = ed.draft;
    const pend = pendingOp(ed);
    const locked = slugLocked(e);
    const kinds = NEWS_KINDS.map((k) => `<option value="${k}"${d.kind === k ? ' selected' : ''}>${esc(NEWS_KIND_LABEL[k])}</option>`).join('');
    const pendBtn = (name) => (pend === name ? ' pending" aria-busy="true' : '');
    const actions = [];
    if (e && e.status !== 'published') actions.push(`<button type="button" class="btn primary${pendBtn('publish')}" data-a="newsPublish" data-v="${e.id}">${e.status === 'unpublished' ? 'Publish again' : 'Publish'}</button>`);
    if (e && e.status === 'published') actions.push(`<button type="button" class="btn danger${pendBtn('unpublish')}" data-a="newsUnpublish" data-v="${e.id}">Unpublish</button>`);
    if (e && canDeleteNews(e.status)) actions.push(`<button type="button" class="btn danger${pendBtn('delete')}" data-a="newsDelete" data-v="${e.id}">Delete${e.status === 'draft' ? ' draft' : ''}</button>`);
    const err = st.formErrors['news-form'];
    return `<p><button type="button" class="textbtn" data-a="newsBack">Back to all news</button></p>
      <form id="news-form" class="box" novalidate>
        <h3 id="news-edit-title" tabindex="-1">${e ? esc(e.title) : 'New article'}</h3>
        ${statusLine(e)}
        <fieldset class="news-fields"${pend ? ' disabled' : ''}>
          <legend class="sr-only">Article</legend>
          <div class="form-grid">
            ${field({ id: FIELD.kind, label: 'Kind', control: (attrs) => `<select ${attrs} name="kind">${kinds}</select>` })}
            ${field({ id: FIELD.title, label: 'Title', wide: true, hint: `${NEWS_LIMITS.title[0]} to ${NEWS_LIMITS.title[1]} characters.`, control: input(`name="title" maxlength="${NEWS_LIMITS.title[1]}" value="${esc(d.title)}" autocomplete="off"`) })}
            ${field({ id: FIELD.slug, label: 'Address', wide: true,
    hint: locked ? `Fixed since it was first published: /news/${esc(e.slug)}` : `The article's link: /news/<b>${esc(d.slug || slugify(d.title) || 'your-title')}</b>. Lower-case letters, numbers and hyphens. Made from the title if left empty. It can't change after publishing.`,
    control: input(`name="slug" maxlength="${NEWS_LIMITS.slug[1]}" value="${esc(d.slug)}" autocomplete="off" spellcheck="false"${locked ? ' readonly aria-readonly="true"' : ''}`) })}
            ${field({ id: FIELD.summary, label: 'Summary', wide: true, hint: `One line for lists and link previews. ${NEWS_LIMITS.summary[0]} to ${NEWS_LIMITS.summary[1]} characters.`, control: (attrs) => `<textarea ${attrs} name="summary" rows="2" maxlength="${NEWS_LIMITS.summary[1]}">${esc(d.summary)}</textarea>` })}
            ${field({ id: FIELD.body, label: 'Article', wide: true, hint: 'Plain text. Leave a blank line between paragraphs. Start a line with "- " for a bullet point. No links, images or formatting.', control: (attrs) => `<textarea ${attrs} name="body" rows="12" maxlength="${NEWS_LIMITS.body[1]}">${esc(d.body)}</textarea>` })}
            ${d.kind === 'maintenance' ? `
            ${field({ id: FIELD.startsAt, label: 'Maintenance starts', hint: 'Optional. Your local time.', control: input(`name="startsAt" type="datetime-local" value="${esc(d.startsAt)}"`) })}
            ${field({ id: FIELD.endsAt, label: 'Maintenance ends', hint: 'Optional. The notice disappears from the entrance after this.', control: input(`name="endsAt" type="datetime-local" value="${esc(d.endsAt)}"`) })}` : ''}
          </div>
        </fieldset>
        <div class="form-foot">
          <button class="btn primary${pendBtn('save')}" type="submit">${e ? 'Save changes' : 'Save draft'}</button>
          <button type="button" class="btn" data-a="newsPreview" aria-expanded="${ed.preview}" aria-controls="news-preview">${ed.preview ? 'Hide preview' : 'Preview'}</button>
          ${actions.join('')}
        </div>
        ${e?.status === 'published' && dirty(ed) ? '<p class="note">This article is public: saved changes show at once, marked as updated.</p>' : ''}
        ${err ? `<p class="form-error" id="news-form-error" role="alert">${esc(err)}</p>` : ''}
      </form>
      <div id="news-preview">${ed.preview ? preview(ed) : ''}</div>`;
  }

  function list() {
    const rows = (st.news || []).map((n) => [
      `<button type="button" class="row-link" data-a="newsOpen" data-v="${n.id}">${esc(n.title)}</button>`,
      esc(NEWS_KIND_LABEL[n.kind] || n.kind),
      `<span class="pill${n.status === 'published' ? ' ok' : ''}">${esc(NEWS_STATUS_LABEL[n.status])}</span>`,
      n.published_at ? esc(fmtDate(n.published_at)) : '',
      esc(fmtDate(n.updated_at)),
    ]);
    return `<p><button type="button" class="btn primary" id="news-new" data-a="newsNew">New article</button></p>
      <section class="box" aria-labelledby="news-list-title"><h3 id="news-list-title">All news</h3>
      <p class="hint">Development updates, patch notes, releases, maintenance and announcements for the public news pages. Only published articles are public.</p>
      ${!st.news ? '<p class="note">Loading.</p>' : dataTable({
    label: 'All news', empty: 'No news yet. Write the first article.',
    cols: [{ label: 'Title', lead: true }, { label: 'Kind' }, { label: 'Status' }, { label: 'First published' }, { label: 'Last changed' }],
    rows,
  })}</section>`;
  }

  const view = () => (st.newsEdit ? editor() : list());

  // ------------------------------------------------------------ events
  function onInput(e) {
    const ed = st.newsEdit;
    const el = e.target;
    if (!ed || el.form?.id !== 'news-form' || !el.name) return false;
    ed.draft[el.name] = el.value;
    if (el.name === 'slug') ed.slugTouched = true;
    // Typing fixes an inline error once the field is valid again.
    const id = FIELD[el.name];
    if (st.fieldErrors?.[id]) {
      const { errors } = checkNews(outgoing(ed));
      if (!errors[el.name]) { delete st.fieldErrors[id]; render(); }
    }
    if (el.name === 'kind') render(); // maintenance shows its window fields
    else if (el.name === 'title' && !ed.slugTouched) { const hint = document.getElementById(`${FIELD.slug}-hint`); if (hint && !slugLocked(saved(ed))) hint.querySelector('b').textContent = slugify(ed.draft.title) || 'your-title'; }
    return true;
  }

  async function onSubmit(form) {
    if (form.id !== 'news-form') return false;
    const ed = st.newsEdit;
    if (!ed || waiting(ed)) return true;
    const { errors } = checkNews(outgoing(ed));
    st.fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, m]) => [FIELD[k], m]));
    delete st.formErrors['news-form'];
    if (Object.keys(errors).length) { render(); document.getElementById(FIELD[Object.keys(errors)[0]])?.focus(); return true; }
    const isNew = ed.id == null;
    const ok = await op(ed, 'save', async () => {
      try {
        const res = await call('newsSave', { id: ed.id, entry: outgoing(ed) });
        st.news = res.news;
        if (st.newsEdit !== ed) return; // the editor was left meanwhile
        ed.id = res.entry.id;
        ed.entry = res.entry;
        ed.draft = draftOf(res.entry);
        ed.slugTouched = true;
      } catch (err) { st.formErrors['news-form'] = err.message; throw err; }
    });
    if (ok) { toast(isNew ? 'Draft saved.' : 'Saved.'); if (isNew) pushRoute(); }
    return true;
  }

  async function onClick(a, v) {
    if (!a.startsWith('news')) return false;
    const ed = st.newsEdit;
    if (a === 'newsNew') { open(null); return true; }
    if (a === 'newsOpen') { open(st.news?.find((n) => String(n.id) === v)); return true; }
    if (a === 'newsBack') { close(); return true; }
    if (a === 'newsPreview') { ed.preview = !ed.preview; if (ed.preview) st.focusNext = '#news-preview-title'; render(); return true; }
    const e = ed && saved(ed);
    if (!e || String(e.id) !== v) return true;
    if (waiting(ed)) return true;
    if (dirty(ed) && a !== 'newsDelete') { st.formErrors['news-form'] = 'Save your changes first, or undo them.'; render(); return true; }
    if (a === 'newsPublish') {
      if (!await ask({
        title: `Publish "${e.title}"?`,
        points: [`Anyone can read it at /news/${e.slug}, without signing in.`, ...(e.published_at ? ['It keeps its first publication date.'] : ['Its address can\'t change after this.']), 'The change is recorded in the audit log.'],
        confirm: e.published_at ? 'Publish again' : 'Publish', cancel: 'Not yet', tone: 'normal',
      })) return true;
      if (await op(ed, 'publish', async () => { const r = await call('newsPublish', { id: e.id }); st.news = r.news; if (st.newsEdit === ed) ed.entry = r.entry; })) toast('Published.');
    }
    if (a === 'newsUnpublish') {
      if (!await ask({
        title: `Unpublish "${e.title}"?`,
        points: ['It stops being public straight away. Its address shows "not available".', 'You can publish it again later, with the same address and first publication date.', 'The change is recorded in the audit log.'],
        confirm: 'Unpublish', cancel: 'Keep it published',
      })) return true;
      if (await op(ed, 'unpublish', async () => { const r = await call('newsUnpublish', { id: e.id }); st.news = r.news; if (st.newsEdit === ed) ed.entry = r.entry; })) toast('Unpublished.');
    }
    if (a === 'newsDelete') {
      const draft = e.status === 'draft';
      if (!await ask({
        title: draft ? `Delete the draft "${e.title}"?` : `Delete "${e.title}" for good?`,
        points: [draft ? 'It was never published.' : `It was published until it was taken down; its address /news/${e.slug} will be free again.`, 'This can\'t be undone.', 'The change is recorded in the audit log.'],
        typeToConfirm: draft ? null : e.title,
        confirm: draft ? 'Delete draft' : 'Delete for good', cancel: 'Keep it',
      })) return true;
      if (await op(ed, 'delete', async () => { const r = await call('newsDelete', { id: e.id }); st.news = r.news; })) {
        toast('Deleted.');
        if (st.newsEdit === ed) { st.newsEdit = null; st.focusNext = '#news-new'; render(); pushRoute(); }
      }
    }
    return true;
  }

  return { view, load, edit, onInput, onSubmit, onClick };
}
