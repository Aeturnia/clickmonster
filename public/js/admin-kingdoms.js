// Kingdoms in the admin console (K-1, stage K1-4, #83; docs/kingdoms-scope.md 5.10 and 5.11;
// docs/kingdoms-k1-plan.md 2.4). Find a plot or an owner, see a Kingdom, and revoke, reserve or
// unreserve a plot. The `admin` function decides everything: who may change a plot, whether
// Kingdoms are open, and whether the plot is still the one that was inspected. This module only
// shows what it allows, and never relies on hiding a control.
//
// The capability (the K1-1 review's Q3): the console sends a Kingdom request only when the
// function's `meta` reports `kingdoms`. The deployed function (admin v8) has no such key, so with
// it the section doesn't exist and nothing is asked. With the key: while closed, reads only; while
// open, reads for every staff member and the changes for admins.
//
// A change names the exact plot instance (and, for a revoke, the owner) shown when it was asked
// for, taken from the record on screen before the confirmation (K1-DB01). It is never retried, and
// never sent with a replacement: a refusal (a 409 when the plot has changed) reads the plot again
// and leaves the next step to the staff member.
import { ask } from './confirm.js';

const SIZE = 100; // the Kingdom Lands are 100 x 100 (data/kingdoms.js KINGDOM_SIZE)
const FORMS = new Set(['kp-find', 'kp-search', 'kp-revoke', 'kp-reserve', 'kp-unreserve']);

export function setupKingdoms({ st, call, toast, render, esc, field, input, dataTable, isAdmin, pushRoute, when, fmt, showTab }) {
  // Per sign-in. Each read is numbered: an answer is used only while its read is still the latest of
  // its kind, and only for the state it was asked from (a sign-out replaces it).
  // The state object is also the sign-in's identity: a request or a confirmation started from one
  // state does nothing further once another has replaced it (the K1-4 review, K1-ADM01). The
  // changes in flight are its own (pending), so none can carry over to the next staff member.
  const fresh = () => ({ cap: null, q: '', list: null, listError: null, rec: null, recError: null, recLoading: null, plotSeq: 0, listSeq: 0, capSeq: 0, pending: new Set() });
  st.kingdoms = fresh();
  const K = () => st.kingdoms;
  const available = () => !!K().cap;
  const isOpen = () => K().cap?.open === true;
  const canChange = () => available() && isOpen() && isAdmin();
  const plotKey = (x, y) => `kingdom:${x},${y}:`;
  const busyPlot = (x, y) => [...K().pending].some((key) => key.startsWith(plotKey(x, y)));
  // The plot on screen (or being read): a change's recovery reads its plot again only if it still is.
  const inspecting = (x, y) => { const r = K().rec || K().recLoading; return !!r && r.x === x && r.y === y; };

  // A new sign-in, or a sign-out: the section's state, its forms' errors and the reasons typed go.
  function reset() {
    st.kingdoms = fresh();
    for (const id of FORMS) delete st.formErrors[id];
    if (st.fieldErrors) for (const id of Object.keys(st.fieldErrors)) if (id.startsWith('kp-')) delete st.fieldErrors[id];
    for (const id of FORMS) st.clearForms.add(id);
  }

  // The capability is gone (an older function, a rollback, or meta failing): every Kingdom read on
  // its way is dropped, nothing more is asked, and the section closes (K1-ADM03). Closed is not
  // gone: a function that reports Kingdoms closed keeps the section, read-only.
  function lose(s) {
    s.plotSeq++; s.listSeq++;
    s.rec = null; s.recLoading = null; s.recError = null; s.list = null; s.listError = null;
    if (st.tab === 'kingdoms') showTab('dashboard');
    else render();
  }
  // "Unknown action." is the answer of a function without Kingdoms (admin v8): read meta again.
  const unknownAction = (e) => e?.status === 400 && e.message === 'Unknown action.';

  // The capability, from `meta`. Anything else (an older function, a refusal, no connection) means
  // no capability: no Kingdom request, and nothing said about it.
  async function loadCap() {
    const s = K();
    const seq = ++s.capSeq;
    let cap = null;
    try {
      const c = (await call('meta'))?.kingdoms;
      if (c && Number(c.version) >= 1) cap = { version: Number(c.version), open: c.open === true };
    } catch { /* no capability */ }
    if (K() !== s || s.capSeq !== seq) return; // another sign-in, or a newer read of meta
    const had = !!s.cap;
    s.cap = cap;
    if (had && !cap) lose(s);
  }

  async function loadPlot(x, y, { focus = false } = {}) {
    if (!available()) return;
    const s = K();
    const seq = ++s.plotSeq;
    const current = () => K() === s && s.plotSeq === seq;
    s.recLoading = { x, y };
    s.recError = null;
    render();
    try {
      const r = await call('kingdomPlot', { x, y });
      if (!current()) return;
      s.rec = { x, y, plot: r.plot || null, owner: r.owner || null, kingdom: r.kingdom || null };
    } catch (e) {
      if (!current()) return;
      s.rec = null;
      s.recError = { x, y, message: e.message };
      if (unknownAction(e)) { s.recLoading = null; await loadCap(); if (!current()) return; } // lose() drops this read
    }
    s.recLoading = null;
    if (focus) st.focusNext = '#kp-title';
    render();
    pushRoute();
  }

  async function loadList(q = K().q) {
    if (!available()) return;
    const s = K();
    const seq = ++s.listSeq;
    s.q = q;
    s.listError = null;
    try {
      const r = await call('kingdomSearch', { q });
      if (K() !== s || s.listSeq !== seq) return;
      s.list = r.plots || [];
    } catch (e) {
      if (K() !== s || s.listSeq !== seq) return;
      s.listError = e.message;
      if (unknownAction(e)) { await loadCap(); if (K() !== s || s.listSeq !== seq) return; }
    }
    render();
  }

  // ------------------------------------------------------------ views
  // "Plot x, y": a short "x, y" would be under 24 px wide (WCAG 2.5.8).
  const plotButton = (x, y, label = `Plot ${x}, ${y}`) => `<button type="button" class="row-link" data-a="kpOpen" data-v="${x},${y}">${esc(label)}</button>`;
  const statusText = (p) => (p.status === 'reserved' ? 'Reserved' : 'Claimed');

  function stateNote() {
    if (!isOpen()) return '<p class="note" id="kp-state">Kingdoms are closed. You can look plots up; revoking, reserving and unreserving open with Kingdoms.</p>';
    if (!isAdmin()) return '<p class="note" id="kp-state">Only admins can revoke, reserve or unreserve plots.</p>';
    return '';
  }

  function record() {
    const s = K();
    if (s.recLoading) return `<section class="box" aria-labelledby="kp-title"><h3 id="kp-title" tabindex="-1">Plot ${s.recLoading.x}, ${s.recLoading.y}</h3><p class="note" aria-busy="true">Loading the plot.</p></section>`;
    if (s.recError) {
      const { x, y, message } = s.recError;
      return `<section class="box" aria-labelledby="kp-title"><h3 id="kp-title" tabindex="-1">Plot ${x}, ${y}</h3>
        <p class="field-msg bad" role="alert">${esc(message)}</p><button type="button" class="btn sm" data-a="kpReload" data-v="${x},${y}">Try again</button></section>`;
    }
    if (!s.rec) return '';
    const { x, y, plot, owner, kingdom } = s.rec;
    let what;
    let act = '';
    if (!plot) {
      what = '<p>Free. No hero holds it, and it isn’t reserved.</p>';
      if (canChange()) act = changeForm('kp-reserve', 'reserve', x, y, {}, 'Reserve plot', 'No player can claim it while it is reserved.');
    } else if (plot.status === 'reserved') {
      what = `<p>Reserved${plot.claimed_at ? ` since ${esc(when(plot.claimed_at))}` : ''}. No player can claim it.</p><p class="small">Reservation ${plot.id}.</p>`;
      if (canChange()) act = changeForm('kp-unreserve', 'unreserve', x, y, { plot: plot.id }, 'Unreserve plot', 'Any player can then claim it.');
    } else {
      const who = owner
        ? `<button type="button" class="row-link" data-a="open" data-v="${esc(owner.id)}">${esc(owner.name)}</button>, level ${owner.level}`
        : 'a hero who couldn’t be found';
      const recorded = kingdom?.plot;
      const matches = recorded && recorded.x === x && recorded.y === y;
      what = `<p>Claimed by ${who}${plot.claimed_at ? `, since ${esc(when(plot.claimed_at))}` : ''}. ${owner ? `${esc(owner.name)}’s Kingdom.` : ''}</p>
        <p class="small">Ownership ${plot.id}.</p>
        ${matches ? '' : `<p class="field-msg bad" role="alert">The hero’s record ${recorded ? `puts their Kingdom on plot ${recorded.x}, ${recorded.y}` : 'has no Kingdom'}, which doesn’t match this plot. The I-1 check (supabase/checks/kingdom_verify.sql) reports this.</p>`}`;
      if (canChange() && owner) act = changeForm('kp-revoke', 'revoke', x, y, { plot: plot.id, char: owner.id, name: owner.name }, 'Revoke Kingdom', 'The plot is freed and the hero loses their Kingdom. It is recorded in the audit log.', 'danger');
    }
    return `<section class="box" aria-labelledby="kp-title"><h3 id="kp-title" tabindex="-1">Plot ${x}, ${y}</h3>
      ${what}
      <div class="acts"><button type="button" class="btn sm" data-a="kpReload" data-v="${x},${y}">Reload plot</button></div>
      ${act}
    </section>`;
  }

  // A change's form. Its data attributes are the plot as shown: the change names exactly these.
  function changeForm(id, op, x, y, data, label, hint, tone = '') {
    const pending = K().pending.has(`${plotKey(x, y)}${op}`);
    const err = st.formErrors[id];
    const attrs = Object.entries({ x, y, ...data }).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    return `<form id="${id}" class="gap-top" novalidate${attrs}>
      <div class="form-grid">
        ${field({ id: `${id}-reason`, label: 'Reason', wide: true, hint: esc(hint), control: input('maxlength="300" autocomplete="off" required') })}
      </div>
      <div class="form-foot"><button class="btn ${tone || 'primary'}${pending ? ' pending' : ''}" type="submit"${pending ? ' aria-busy="true"' : ''}>${esc(label)}</button></div>
      ${err ? `<p class="form-error" id="${id}-error" role="alert">${esc(err)}</p>` : ''}
    </form>`;
  }

  function list() {
    const s = K();
    if (s.listError) return `<p class="field-msg bad" role="alert">${esc(s.listError)}</p><button type="button" class="btn sm" data-a="kpList">Try again</button>`;
    if (!s.list) return '<p class="note" aria-busy="true">Loading plots.</p>';
    return `${s.q ? `<p class="note">Plots held by heroes whose name contains “${esc(s.q)}”.</p>` : '<p class="note">The most recent plots, up to 50.</p>'}
      ${dataTable({
        label: 'Plots', empty: s.q ? 'No plots held by a hero with that name.' : 'No plots are claimed or reserved.',
        cols: [{ label: 'Plot', lead: true }, { label: 'Status' }, { label: 'Owner' }, { label: 'Since' }],
        rows: s.list.map((p) => [plotButton(p.x, p.y), statusText(p), p.owner ? esc(p.owner.name) : '', p.claimed_at ? esc(when(p.claimed_at)) : '']),
      })}`;
  }

  function view() {
    const s = K();
    return `${stateNote()}
      <div class="cols">
        <section class="box" aria-labelledby="kp-find-title"><h3 id="kp-find-title">Find a plot</h3>
          <form id="kp-find" novalidate><div class="form-grid">
            ${field({ id: 'kp-x', label: 'Across', hint: `1 to ${SIZE}`, control: input('type="number" min="1" max="100" step="1" inputmode="numeric" required') })}
            ${field({ id: 'kp-y', label: 'Down', hint: `1 to ${SIZE}`, control: input('type="number" min="1" max="100" step="1" inputmode="numeric" required') })}
          </div><div class="form-foot"><button class="btn primary" type="submit">Show plot</button></div></form>
        </section>
        <section class="box" aria-labelledby="kp-search-title"><h3 id="kp-search-title">Find by owner</h3>
          <form id="kp-search" novalidate><div class="form-grid">
            ${field({ id: 'kp-q', label: 'Hero name', wide: true, hint: 'Part of a name. Leave it empty for the most recent plots.', control: input(`type="search" autocomplete="off" value="${esc(s.q)}"`) })}
          </div><div class="form-foot"><button class="btn" type="submit">Search</button></div></form>
        </section>
      </div>
      ${record()}
      <section class="box" aria-labelledby="kp-list-title"><h3 id="kp-list-title">Plots</h3>${list()}</section>`;
  }

  // The hero's Kingdom on their record, with a way to the plot. It sends nothing: the record
  // already carries it.
  function playerLine(c) {
    const p = c?.kingdom?.plot;
    if (!available() || !p) return '';
    return `<p class="small">Kingdom on plot ${p.x}, ${p.y}. ${plotButton(p.x, p.y, 'See the plot')}</p>`;
  }

  // ------------------------------------------------------------ changes
  const QUESTIONS = {
    revoke: ({ x, y, name }, reason) => ({
      title: `Revoke ${name}’s Kingdom?`,
      points: [
        `Plot ${x}, ${y} is freed, and ${name} loses their Kingdom and everything on it.`,
        'Nothing is refunded, except the gold paid for a building still under construction.',
        `Reason, in the audit log: “${reason}”`,
        'This cannot be undone.',
      ],
      typeToConfirm: name, confirm: 'Revoke Kingdom', cancel: 'Keep it',
    }),
    reserve: ({ x, y }, reason) => ({
      title: `Reserve plot ${x}, ${y}?`,
      points: ['No player can claim it until it is unreserved.', `Reason, in the audit log: “${reason}”`],
      confirm: 'Reserve plot', cancel: 'Cancel', tone: 'normal',
    }),
    unreserve: ({ x, y }, reason) => ({
      title: `Unreserve plot ${x}, ${y}?`,
      points: ['Any player can then claim it.', `Reason, in the audit log: “${reason}”`],
      confirm: 'Unreserve plot', cancel: 'Cancel', tone: 'normal',
    }),
  };

  async function change(form, op) {
    // The sign-in this change belongs to (K1-ADM01). Once another state replaces it (signing out,
    // here or in another tab, or another staff member signing in), nothing more is done for it.
    const s = K();
    const mine = () => K() === s;
    // The plot as shown, taken now: the request names exactly this (K1-DB01).
    const d = form.dataset;
    const shown = { x: Number(d.x), y: Number(d.y), plotId: d.plot ? Number(d.plot) : null, characterId: d.char || null, name: d.name || '' };
    const reasonEl = form.querySelector(`#${form.id}-reason`);
    const reason = (reasonEl?.value || '').trim();
    if (busyPlot(shown.x, shown.y)) { toast('Still working on the last change to this plot.'); return; }
    if (!reason) {
      st.fieldErrors = { ...(st.fieldErrors || {}), [`${form.id}-reason`]: 'Give a reason. It goes in the audit log.' };
      render();
      document.getElementById(`${form.id}-reason`)?.focus();
      return;
    }
    if (st.fieldErrors) delete st.fieldErrors[`${form.id}-reason`];
    const ok = await ask(QUESTIONS[op](shown, reason)); // signing out cancels it (admin.js, cancelAsk())
    // Checked again after the question: the same sign-in, still allowed to change plots, and no
    // other change to this plot started meanwhile.
    if (!ok || !mine() || !canChange() || busyPlot(shown.x, shown.y)) return;
    const key = `${plotKey(shown.x, shown.y)}${op}`;
    const args = op === 'revoke'
      ? { x: shown.x, y: shown.y, plotId: shown.plotId, characterId: shown.characterId, reason }
      : op === 'unreserve' ? { x: shown.x, y: shown.y, plotId: shown.plotId, reason } : { x: shown.x, y: shown.y, reason };
    const action = { revoke: 'kingdomRevoke', reserve: 'kingdomReserve', unreserve: 'kingdomUnreserve' }[op];
    // Pending until its plot has been read again (or its recovery has ended), so the controls drawn
    // before the answer can't send another change meanwhile (K1-ADM02). Other plots stay free.
    s.pending.add(key);
    delete st.formErrors[form.id];
    render();
    let failed = null;
    let done = null;
    try {
      done = await call(action, args);
    } catch (e) {
      failed = e;
    }
    // Sent and perhaps committed, but for a sign-in that has ended: nothing is shown, cleared or
    // asked for the next one. The server's transaction stands; it isn't undone.
    if (!mine()) return;
    try {
      if (failed) toast(failed.message, true); // stays until dismissed: the form may be gone after the reload
      else {
        toast(op === 'revoke'
          ? `${shown.name}’s Kingdom is revoked. ${done?.refund > 0 ? `${fmt(done.refund)} gold refunded.` : 'Nothing was refunded.'}`
          : op === 'reserve' ? `Plot ${shown.x}, ${shown.y} is reserved.` : `Plot ${shown.x}, ${shown.y} is no longer reserved.`);
      }
      // Whatever happened, the plot is read again, if it's still the one being looked at; a newer
      // inspection, and anything typed in it, is left alone. A refusal is not retried, and nothing
      // is sent with a replacement id: the staff member looks, and asks again if they still mean it.
      if (failed?.status === 409 && /aren’t open/.test(failed.message)) await loadCap();
      else if (unknownAction(failed)) await loadCap();
      if (!mine() || !available()) return;
      if (inspecting(shown.x, shown.y)) {
        if (!failed) st.clearForms.add(form.id);
        await loadPlot(shown.x, shown.y);
      }
      if (mine()) loadList();
    } finally {
      s.pending.delete(key);
      if (mine()) render();
    }
  }

  // ------------------------------------------------------------ events (admin.js calls these)
  async function onSubmit(form) {
    if (!FORMS.has(form.id)) return false;
    if (!available()) return true;
    if (form.id === 'kp-find') {
      const raw = { x: form.querySelector('#kp-x').value.trim(), y: form.querySelector('#kp-y').value.trim() };
      const errs = {};
      for (const [k, id] of [['x', 'kp-x'], ['y', 'kp-y']]) {
        const n = Number(raw[k]);
        if (!/^\d+$/.test(raw[k]) || n < 1 || n > SIZE) errs[id] = `Enter a whole number from 1 to ${SIZE}.`;
      }
      st.fieldErrors = { ...(st.fieldErrors || {}) };
      delete st.fieldErrors['kp-x']; delete st.fieldErrors['kp-y'];
      Object.assign(st.fieldErrors, errs);
      if (Object.keys(errs).length) { render(); document.getElementById(Object.keys(errs)[0])?.focus(); return true; }
      await loadPlot(Number(raw.x), Number(raw.y), { focus: true });
      return true;
    }
    if (form.id === 'kp-search') { K().list = null; render(); await loadList(form.querySelector('#kp-q').value.trim()); return true; }
    if (!canChange()) return true;
    await change(form, form.id.slice(3));
    return true;
  }

  async function onClick(a, v) {
    if (a === 'kpOpen' || a === 'kpReload') {
      const [x, y] = String(v).split(',').map(Number);
      if (!available() || !x || !y) return true;
      if (st.tab !== 'kingdoms') showTab('kingdoms', { push: false });
      await loadPlot(x, y, { focus: a === 'kpOpen' });
      return true;
    }
    if (a === 'kpList') { await loadList(); return true; }
    return false;
  }

  // The section's address: the plot on screen, if any.
  const route = () => (K().rec ? `#kingdom/${K().rec.x},${K().rec.y}` : K().recLoading ? `#kingdom/${K().recLoading.x},${K().recLoading.y}` : '#kingdoms');

  return { view, load: () => loadList(), loadCap, loadPlot, reset, available, onSubmit, onClick, playerLine, route };
}
