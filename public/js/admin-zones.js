// Zone editor for the admin console. Edits a working copy of a zone definition, shows a
// live map preview and validation, and saves through the `admin` edge function.
import { ZONES, ZONE_DEFS, DEFAULT_ZONES, OVERWORLD_ID, compileZone, loadZones } from './data/zones.js';
import { validateZone, blankZone, deleteBlockers, ARCHETYPES, MAX_MONSTERS } from './engine/zone-validate.js';
import { ELEMENTS, ELEMENT_LABEL } from './data/elements.js';
import { WEAPON_TYPES, MAX_TIER } from './data/items.js';
import { ask } from './confirm.js';

// The editor's sections, in order. Problems found by validation are counted against the section
// they concern, so the index shows where to look.
const SECTIONS = [
  ['basics', 'Basics'], ['entry', 'Entry'], ['town', 'Town and shop'], ['monsters', 'Monsters'],
  ['boss', 'Boss'], ['paths', 'Extra paths'], ['preview', 'Preview'],
];
const sectionOf = (msg) => (/town|shop/i.test(msg) ? 'town' : /boss|lair/i.test(msg) ? 'boss' : /monster/i.test(msg) ? 'monsters'
  : /path|portal|arriv/i.test(msg) ? 'paths' : /entry|overworld/i.test(msg) ? 'entry' : 'basics');

export function setupZones({ st, call, toast, render, esc, isAdmin, pushRoute }) {
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const defsWithDraft = () => {
    const d = st.zoneEdit.def;
    return [...st.zones.map((z) => z.data).filter((z) => z.id !== (st.zoneEdit.originalId || d.id)), d];
  };

  // ------------------------------------------------------------ path helpers
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }

  // ------------------------------------------------------------ inputs (visible labels, ids from the path)
  const fid = (path) => `zf-${path.replace(/\./g, '-')}`;
  const wrap = (path, label, control, { wide = false, hint = '' } = {}) => `<div class="f${wide ? ' wide' : ''}"><label for="${fid(path)}">${esc(label)}</label>${control}${hint ? `<p class="hint" id="${fid(path)}-hint">${hint}</p>` : ''}</div>`;
  const described = (path, hint) => (hint ? ` aria-describedby="${fid(path)}-hint"` : '');
  const num = (path, label, attrs = '', hint = '') => wrap(path, label, `<input id="${fid(path)}" data-f="${path}" data-t="int" type="number" inputmode="numeric" ${attrs}${described(path, hint)} value="${esc(getPath(st.zoneEdit.def, path) ?? '')}">`, { hint });
  const text = (path, label, attrs = '', opts = {}) => wrap(path, label, `<input id="${fid(path)}" data-f="${path}" ${attrs}${described(path, opts.hint)} value="${esc(getPath(st.zoneEdit.def, path) ?? '')}">`, opts);
  const check = (path, label) => `<label class="chk"><input data-f="${path}" data-t="bool" type="checkbox" ${getPath(st.zoneEdit.def, path) ? 'checked' : ''}> ${esc(label)}</label>`;
  const select = (path, label, options, allowNone = false) => {
    const cur = getPath(st.zoneEdit.def, path) ?? '';
    return wrap(path, label, `<select id="${fid(path)}" data-f="${path}">${allowNone ? `<option value="" ${cur === '' ? 'selected' : ''}>None</option>` : ''}${options.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
  };
  const toggle = (key, label, on) => `<label class="chk"><input data-toggle="${key}" type="checkbox" ${on ? 'checked' : ''}> ${esc(label)}</label>`;

  // ------------------------------------------------------------ preview and problems
  function problemsHtml(errors) {
    if (!errors.length) return '<p class="small good" id="zone-ok">No problems found.</p>';
    return `<div class="notice bad zone-problems"><p class="small flush"><b>${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before saving:</b></p>
      <ul>${errors.map((e) => `<li><button type="button" class="textbtn" data-a="zoneJump" data-v="${sectionOf(e)}">${esc(e)}</button></li>`).join('')}</ul></div>`;
  }

  function previewHtml(errors) {
    const d = st.zoneEdit.def;
    const all = defsWithDraft();
    let mapHtml = '';
    try {
      const z = compileZone(d, all);
      const size = Math.max(1, Math.min(40, d.size || 1));
      const cells = [];
      for (let y = 1; y <= size; y++) {
        for (let x = 1; x <= size; x++) {
          let cls = '';
          let label = '';
          if (z.town && z.town.x === x && z.town.y === y) { cls = 'town'; label = 'T'; }
          for (const f of z.features) {
            if (f.x !== x || f.y !== y) continue;
            if (f.type === 'portal') { cls = 'portal'; label = 'P'; }
            if (f.type === 'lair') { cls = 'lair'; label = 'B'; }
          }
          if (d.entry && d.entry.x === x && d.entry.y === y && !label) { cls = 'portal'; label = 'E'; }
          cells.push(`<span class="${cls}" title="${x}, ${y}">${label}</span>`);
        }
      }
      const places = [z.town ? `Town at ${z.town.x}, ${z.town.y}` : 'No town', ...z.features.filter((f) => f.type === 'lair').map((f) => `boss lair at ${f.x}, ${f.y}`),
        ...z.features.filter((f) => f.type === 'portal').map((f) => `path at ${f.x}, ${f.y}`), d.entry ? `entry at ${d.entry.x}, ${d.entry.y}` : ''].filter(Boolean).join('; ');
      mapHtml = `<div class="preview-map" role="img" aria-label="${esc(`${size} by ${size} map preview. ${places}.`)}"><div class="map ${d.pvp ? 'pvp' : ''}" style="--n:${size}">${cells.join('')}</div></div>
        <div class="legend"><span><b>T</b> Town</span><span><b>P</b> Path</span><span><b>B</b> Boss lair</span><span><b>E</b> Entry</span>
        <span>Levels ${z.levelRange[0]} to ${z.levelRange[1]}</span></div>`;
    } catch { mapHtml = '<p class="small bad">Can’t draw this zone yet.</p>'; }

    // Overworld placement.
    let owHtml = '';
    const ow = all.find((z) => z.id === OVERWORLD_ID);
    if (ow && d.id !== OVERWORLD_ID) {
      const cells = [];
      for (let y = 1; y <= ow.size; y++) {
        for (let x = 1; x <= ow.size; x++) {
          const here = all.find((z) => z.id !== d.id && z.overworld && z.overworld[0] === x && z.overworld[1] === y);
          const mine = d.overworld && d.overworld[0] === x && d.overworld[1] === y;
          const town = ow.town && ow.town.x === x && ow.town.y === y;
          const name = mine ? `${d.name} is here` : town ? `${ow.town.name}` : here ? here.name : 'Empty';
          cells.push(`<button type="button" class="${mine ? 'me' : town ? 'town' : here ? 'portal' : ''}" data-owpick="${x},${y}" aria-label="${esc(`${name}, square ${x}, ${y}`)}"${mine ? ' aria-current="location"' : ''}>${mine ? 'Here' : town ? 'T' : here ? esc(here.name.slice(0, 2)) : ''}</button>`);
        }
      }
      owHtml = `<h3>Overworld placement</h3><p class="note">Choose an empty square to place this zone on the Overworld map. A path in and out is created automatically.</p>
        <div class="preview-map ow-map"><div class="map" role="group" aria-label="Overworld squares" style="--n:${ow.size}">${cells.join('')}</div></div>`;
    }
    return `${problemsHtml(errors)}<h3>Map preview</h3>${mapHtml}${owHtml}`;
  }

  function savebarNote(errors) {
    return errors.length
      ? `<span class="bad">${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} to fix before saving.</span> <button type="button" class="textbtn" data-a="zoneJump" data-v="preview">Show</button>`
      : '<span class="good">Ready to save.</span>';
  }

  // Field edits update the working copy, the preview, the index badges and the save bar without
  // redrawing the form (so typing is never interrupted).
  function refreshPreview() {
    const errors = validateZone(st.zoneEdit.def, defsWithDraft());
    const el = document.getElementById('zone-preview-body');
    if (el) el.innerHTML = previewHtml(errors);
    const note = document.getElementById('zone-save-note');
    if (note) note.innerHTML = savebarNote(errors);
    const idx = document.getElementById('zone-index');
    if (idx) idx.innerHTML = indexHtml(errors);
  }

  function indexHtml(errors) {
    const count = Object.fromEntries(SECTIONS.map(([id]) => [id, 0]));
    for (const e of errors) count[sectionOf(e)] += 1;
    count.preview = errors.length;
    const d = st.zoneEdit.def;
    return SECTIONS.filter(([id]) => id !== 'entry' || d.id !== OVERWORLD_ID).map(([id, label]) =>
      `<li><button type="button" data-a="zoneJump" data-v="${id}" class="${count[id] ? 'bad' : ''}">${esc(label)}${count[id] ? ` <span aria-hidden="true">(${count[id]})</span><span class="sr-only">, ${count[id]} ${count[id] === 1 ? 'problem' : 'problems'}</span>` : ''}</button></li>`).join('');
  }

  // ------------------------------------------------------------ views
  function listView() {
    const zones = st.zones;
    if (!zones) return '<p class="note">Loading.</p>';
    const rows = zones.map((r) => {
      const z = ZONES[r.id];
      const tags = [r.data.starter ? 'starter' : '', r.data.pvp ? 'PvP' : '', r.data.overworld ? `Overworld ${r.data.overworld.join(',')}` : r.id === OVERWORLD_ID ? '' : 'not on Overworld', r.builtin ? '' : 'custom'].filter(Boolean).join(', ');
      return `<tr><td class="lead" data-label="Zone"><div class="cv"><b>${esc(r.data.name)}</b><span class="sub">${esc(r.id)}${tags ? `, ${tags}` : ''}</span></div></td>
        <td class="num" data-label="Size"><div class="cv">${r.data.size} by ${r.data.size}</div></td><td class="num" data-label="Levels"><div class="cv">${z ? `${z.levelRange[0]} to ${z.levelRange[1]}` : ''}</div></td><td class="num" data-label="Heroes"><div class="cv">${r.players}</div></td>
        <td class="act" data-label="Actions"><div class="cv"><button type="button" class="btn sm" data-a="zoneEdit" data-v="${esc(r.id)}">${isAdmin() ? 'Edit' : 'View'}<span class="sr-only"> ${esc(r.data.name)}</span></button></div></td></tr>`;
    }).join('');
    return `${isAdmin() ? '<div class="acts flush gap-bottom"><button class="btn primary" data-a="zoneNew">New zone</button></div>' : ''}
      <section class="box" aria-labelledby="zones-title"><h2 id="zones-title">Zones</h2>
      <div class="table-scroll"><table class="data cards"><caption class="sr-only">Zones</caption>
      <thead><tr><th scope="col">Zone</th><th scope="col" class="num">Size</th><th scope="col" class="num">Levels</th><th scope="col" class="num">Heroes</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="note">Changes reach players within about two minutes. Heroes in a removed area are moved somewhere safe; fights against removed monsters end.</p></section>`;
  }

  function section(id, title, body, intro = '') {
    return `<section class="box" id="zs-${id}" aria-labelledby="zs-${id}-h"><h2 id="zs-${id}-h" tabindex="-1">${title}</h2>${intro ? `<p class="note">${intro}</p>` : ''}${body}</section>`;
  }

  function editorView() {
    const ed = st.zoneEdit;
    const d = ed.def;
    const errors = validateZone(d, defsWithDraft());
    const zoneOpts = defsWithDraft().map((z) => [z.id, z.name]);
    const archOpts = ARCHETYPES.map((a) => [a, a]);
    const elemOpts = ELEMENTS.map((e) => [e, ELEMENT_LABEL[e]]);
    const monsterRow = (path, i) => `<fieldset class="f-set mon-row"><legend>${i != null ? `Monster ${i + 1}` : 'Boss'}</legend><div class="form-grid">
        ${text(`${path}.name`, 'Name')}${num(`${path}.level`, 'Level', 'min="1"')}
        ${select(`${path}.arch`, 'Type', archOpts)}${text(`${path}.verb`, 'Attack verb', 'placeholder="bites"')}
        ${select(`${path}.element`, 'Element', elemOpts, true)}
        ${i != null ? `<div class="f"><span class="lbl" aria-hidden="true">&nbsp;</span><button type="button" class="btn sm danger" data-a="zoneDelMon" data-v="${i}">Remove<span class="sr-only"> monster ${i + 1}</span></button></div>` : `<div class="f">${check(`${path}.proper`, 'Proper name (no "the")')}</div>`}
      </div></fieldset>`;
    const ro = !isAdmin();
    const body = `
      ${section('basics', ed.isNew ? 'New zone' : esc(d.name), `<div class="form-grid">
        ${ed.isNew ? text('id', 'Id (permanent)', 'placeholder="misty-hills" autocapitalize="off"', { hint: 'Lower case letters, numbers and hyphens. It can’t be changed later.' }) : `<div class="f"><label for="zf-id">Id</label><input id="zf-id" value="${esc(d.id)}" disabled></div>`}
        ${text('name', 'Name')}
        ${num('size', 'Size', 'min="3" max="40"', 'Squares per side, 3 to 40.')}
        ${num('minLevel', 'Level to enter', 'min="0"')}
        ${num('exitLevel', 'Level to leave', 'min="0"')}
        <div class="f wide"><label for="zf-desc">Description</label><textarea id="zf-desc" data-f="desc" maxlength="300">${esc(d.desc || '')}</textarea></div>
        <div class="f wide"><div class="chips-wrap">${check('starter', 'Starter zone')}${check('pvp', 'PvP allowed')}</div></div>
      </div>`)}
      ${d.id !== OVERWORLD_ID ? section('entry', 'Entry', `<div class="form-grid">${num('entry.x', 'Entry X', 'min="1"')}${num('entry.y', 'Entry Y', 'min="1"')}
          <div class="f wide">${toggle('overworld', 'On the Overworld', !!d.overworld)}</div>
          ${d.overworld ? `${num('overworld.0', 'Overworld X', 'min="1"')}${num('overworld.1', 'Overworld Y', 'min="1"')}` : ''}</div>`,
        'Where travelers arrive. The path back to the Overworld sits here.') : ''}
      ${section('town', 'Town and shop', `<div class="form-grid"><div class="f wide">${toggle('town', 'Has a town', !!d.town)}</div>
          ${d.town ? `${text('town.name', 'Town name')}${num('town.x', 'X', 'min="1"')}${num('town.y', 'Y', 'min="1"')}` : ''}</div>
          ${d.town ? `<h3>Shop</h3><div class="chips-wrap">${toggle('shop', 'Town has a shop', !!d.shop)}</div>
            ${d.shop ? `<fieldset class="f-set gap-top"><legend>Item classes</legend><div class="chips-wrap">${Array.from({ length: MAX_TIER }, (_, i) => i + 1).map((t) =>
              `<label class="chk"><input type="checkbox" data-list="shop.tiers" value="${t}" ${d.shop.tiers.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div></fieldset>
              <fieldset class="f-set gap-top"><legend>Weapons</legend><div class="chips-wrap">${Object.keys(WEAPON_TYPES).map((w) =>
              `<label class="chk"><input type="checkbox" data-list="shop.weapons" value="${w}" ${d.shop.weapons.includes(w) ? 'checked' : ''}> ${WEAPON_TYPES[w].label}</label>`).join('')}</div></fieldset>
              <fieldset class="f-set gap-top"><legend>Magic focuses</legend><div class="chips-wrap">${ELEMENTS.map((e) =>
              `<label class="chk"><input type="checkbox" data-list="shop.elements" value="${e}" ${d.shop.elements.includes(e) ? 'checked' : ''}> ${ELEMENT_LABEL[e]}</label>`).join('')}</div></fieldset>
              <div class="chips-wrap gap-top">${check('shop.armor', 'Sells armor')}</div>` : ''}` : ''}`)}
      ${section(`monsters`, `Monsters (${d.monsters.length})`, `${d.monsters.map((m, i) => monsterRow(`monsters.${i}`, i)).join('')}
          ${d.monsters.length < MAX_MONSTERS ? '<button type="button" class="btn sm" data-a="zoneAddMon">Add monster</button>' : `<p class="note">${MAX_MONSTERS} monsters is the most a zone can have.</p>`}`,
        'Every square in the zone shares this list.')}
      ${section('boss', 'Boss', `<div class="chips-wrap">${toggle('boss', 'Has a boss', !!d.boss)}</div>
          ${d.boss ? `${monsterRow('boss', null)}
            <h3>Lairs</h3><p class="note">Squares where the boss can be fought.</p>
            ${d.lairs.map((l, i) => `<fieldset class="f-set mon-row"><legend>Lair ${i + 1}</legend><div class="form-grid">${num(`lairs.${i}.x`, 'X', 'min="1"')}${num(`lairs.${i}.y`, 'Y', 'min="1"')}
              <div class="f"><span class="lbl" aria-hidden="true">&nbsp;</span><button type="button" class="btn sm danger" data-a="zoneDelLair" data-v="${i}">Remove<span class="sr-only"> lair ${i + 1}</span></button></div></div></fieldset>`).join('')}
            <button type="button" class="btn sm" data-a="zoneAddLair">Add lair</button>` : ''}`)}
      ${section('paths', 'Extra paths', `${d.portals.map((p, i) => `<fieldset class="f-set mon-row"><legend>Path ${i + 1}</legend><div class="form-grid">
            ${text(`portals.${i}.label`, 'Label')}${select(`portals.${i}.to`, 'Leads to', zoneOpts)}
            ${num(`portals.${i}.x`, 'Here X', 'min="1"')}${num(`portals.${i}.y`, 'Here Y', 'min="1"')}
            ${num(`portals.${i}.tx`, 'Arrive X', 'min="1"')}${num(`portals.${i}.ty`, 'Arrive Y', 'min="1"')}
            ${num(`portals.${i}.minLevel`, 'Level needed', 'min="0"')}
            <div class="f"><span class="lbl" aria-hidden="true">&nbsp;</span><button type="button" class="btn sm danger" data-a="zoneDelPortal" data-v="${i}">Remove<span class="sr-only"> path ${i + 1}</span></button></div></div></fieldset>`).join('')}
          <button type="button" class="btn sm" data-a="zoneAddPortal">Add path</button>`, 'Paths straight to another zone, besides the Overworld.')}`;

    return `<div class="acts flush"><button class="btn sm" data-a="zoneBack">Back to zones</button></div>
    <nav aria-label="Zone editor sections" class="gap-top"><ul class="zone-index" id="zone-index">${indexHtml(errors)}</ul></nav>
    <form id="zone-form" novalidate ${ro ? 'inert' : ''}>
    <div class="zone-cols">
      <div>${body}</div>
      <aside class="box zone-side" id="zs-preview" aria-labelledby="zs-preview-h"><h2 id="zs-preview-h" tabindex="-1">Preview and problems</h2><div id="zone-preview-body">${previewHtml(errors)}</div></aside>
    </div>
    </form>
    ${isAdmin() ? `<div class="zone-savebar">
      <p class="note" id="zone-save-note" aria-live="polite">${savebarNote(errors)}</p>
      <button class="btn primary" data-a="zoneSave">${ed.isNew ? 'Create zone' : 'Save changes'}</button>
      <button class="btn" data-a="zoneBack">Cancel</button>
      ${!ed.isNew && DEFAULT_ZONES.some((z) => z.id === d.id) ? '<button class="btn" data-a="zoneReset">Restore built-in version</button>' : ''}
      ${!ed.isNew ? '<button class="btn danger" data-a="zoneDelete">Delete zone</button>' : ''}
    </div>` : '<p class="note">Only admins can edit zones.</p>'}`;
  }

  function view() {
    return st.zoneEdit ? editorView() : listView();
  }

  // ------------------------------------------------------------ data
  async function load() {
    try {
      const res = await call('zones');
      st.zones = res.zones;
      loadZones(res.zones.map((r) => r.data));
    } catch (e) { toast(e.message, true); }
    render();
  }

  function startEdit(id, { push = true } = {}) {
    const row = st.zones?.find((r) => r.id === id);
    if (!row) return;
    const def = clone(row.data);
    def.lairs = def.lairs || [];
    def.portals = def.portals || [];
    st.zoneEdit = { def, isNew: false, originalId: id };
    st.focusNext = '#zs-basics-h';
    render();
    if (push) pushRoute();
    window.scrollTo(0, 0);
  }

  function startNew() {
    let n = 1;
    while (st.zones.some((r) => r.id === `new-zone-${n}`)) n++;
    st.zoneEdit = { def: blankZone(`new-zone-${n}`), isNew: true, originalId: null };
    st.focusNext = '#zf-id';
    render();
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ events
  async function onClick(a, v) {
    const ed = st.zoneEdit;
    const d = ed?.def;
    switch (a) {
      case 'zoneNew': startNew(); return true;
      case 'zoneEdit': startEdit(v); return true;
      case 'zoneBack': st.zoneEdit = null; render(); pushRoute(); load(); return true;
      case 'zoneJump': {
        const target = document.getElementById(`zs-${v}-h`);
        target?.scrollIntoView({ block: 'start' });
        target?.focus({ preventScroll: true });
        return true;
      }
      case 'zoneAddMon': d.monsters.push({ name: '', level: d.monsters.at(-1)?.level || 1, arch: 'brute', verb: 'attacks' }); st.focusNext = `#zf-monsters-${d.monsters.length - 1}-name`; render(); return true;
      case 'zoneDelMon': d.monsters.splice(Number(v), 1); st.focusNext = '#zs-monsters-h'; render(); return true;
      case 'zoneAddLair': d.lairs.push({ x: 1, y: 1 }); st.focusNext = `#zf-lairs-${d.lairs.length - 1}-x`; render(); return true;
      case 'zoneDelLair': d.lairs.splice(Number(v), 1); st.focusNext = '#zs-boss-h'; render(); return true;
      case 'zoneAddPortal': d.portals.push({ x: 1, y: 1, to: OVERWORLD_ID, tx: 1, ty: 1, minLevel: 0, label: 'A path' }); st.focusNext = `#zf-portals-${d.portals.length - 1}-label`; render(); return true;
      case 'zoneDelPortal': d.portals.splice(Number(v), 1); st.focusNext = '#zs-paths-h'; render(); return true;
      case 'zoneSave': {
        const errors = validateZone(d, defsWithDraft());
        if (errors.length) {
          // Point at the problems instead of a vague message.
          const t = document.getElementById('zs-preview-h');
          t?.scrollIntoView({ block: 'start' });
          t?.focus({ preventScroll: true });
          toast(`Fix the ${errors.length === 1 ? 'problem' : `${errors.length} problems`} listed under Preview and problems first.`, true);
          return true;
        }
        const btn = document.querySelector('[data-a="zoneSave"]');
        btn?.classList.add('pending'); btn?.setAttribute('aria-busy', 'true');
        try {
          const res = await call('saveZone', { zone: d, isNew: ed.isNew });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          st.zoneEdit = null;
          toast(ed.isNew ? 'Zone created.' : 'Zone saved.');
          render();
          pushRoute();
        } catch (e) {
          btn?.classList.remove('pending'); btn?.removeAttribute('aria-busy');
          toast(e.message, true);
        }
        return true;
      }
      case 'zoneDelete': {
        // Don't ask about a delete the server would refuse (it checks again anyway).
        const blockers = deleteBlockers(ed.originalId, ZONE_DEFS);
        if (blockers.length) { toast(`${d.name} can’t be deleted. ${blockers.join(' ')}`, true); return true; }
        if (!await ask({
          title: `Delete ${d.name}?`,
          points: ['Heroes in it are moved to a safe place the next time they act.', 'Any active world-boss hunt in it is cancelled.', 'This can’t be undone here; the definition is kept in the audit log.'],
          typeToConfirm: d.name, confirm: 'Delete zone', cancel: 'Keep zone',
        })) return true;
        try {
          const res = await call('deleteZone', { id: ed.originalId });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          st.zoneEdit = null;
          toast('Zone deleted.');
          render();
          pushRoute();
        } catch (e) { toast(e.message, true); }
        return true;
      }
      case 'zoneReset': {
        if (!await ask({
          title: `Restore the built-in ${d.name}?`,
          points: ['Your edits to it are replaced by the original version.', 'The edited version is kept in the audit log.'],
          confirm: 'Restore built-in version', cancel: 'Keep my edits',
        })) return true;
        try {
          const res = await call('resetZone', { id: ed.originalId });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          startEdit(ed.originalId, { push: false });
          toast('Restored.');
        } catch (e) { toast(e.message, true); }
        return true;
      }
      default: return false;
    }
  }

  function onInput(e) {
    if (!st.zoneEdit) return false;
    const el = e.target;
    const d = st.zoneEdit.def;
    if (el.dataset.f) {
      let v = el.value;
      if (el.dataset.t === 'int') v = v === '' ? 0 : Math.floor(Number(v));
      if (el.dataset.t === 'bool') v = el.checked;
      if (el.tagName === 'SELECT' && v === '' && /\.element$/.test(el.dataset.f)) {
        const parent = getPath(d, el.dataset.f.replace(/\.element$/, ''));
        delete parent.element;
      } else setPath(d, el.dataset.f, v);
      if (el.dataset.f === 'id') { st.zoneEdit.def.id = String(v).trim().toLowerCase(); }
      refreshPreview();
      return true;
    }
    if (el.dataset.list) {
      const list = getPath(d, el.dataset.list);
      const val = el.dataset.list === 'shop.tiers' ? Number(el.value) : el.value;
      const i = list.indexOf(val);
      if (el.checked && i < 0) list.push(val);
      if (!el.checked && i >= 0) list.splice(i, 1);
      if (el.dataset.list === 'shop.tiers') list.sort((x, y) => x - y);
      refreshPreview();
      return true;
    }
    if (el.dataset.toggle) {
      const k = el.dataset.toggle;
      if (k === 'overworld') d.overworld = el.checked ? [1, 1] : null;
      if (k === 'town') { d.town = el.checked ? { x: Math.ceil(d.size / 2), y: Math.ceil(d.size / 2), name: `${d.name} Town` } : null; if (!el.checked) d.shop = null; }
      if (k === 'shop') d.shop = el.checked ? { tiers: [1], weapons: Object.keys(WEAPON_TYPES), elements: [...ELEMENTS], armor: true } : null;
      if (k === 'boss') { d.boss = el.checked ? { name: 'Great Beast', level: (d.monsters.at(-1)?.level || 1) + 2, arch: 'brute', verb: 'crushes', proper: false } : null; if (!el.checked) d.lairs = []; else if (!d.lairs.length) d.lairs = [{ x: 1, y: 1 }]; }
      render();
      return true;
    }
    return false;
  }

  function onPick(el) {
    if (!st.zoneEdit || !isAdmin()) return false;
    const [x, y] = el.dataset.owpick.split(',').map(Number);
    st.zoneEdit.def.overworld = [x, y];
    render();
    return true;
  }

  // Open a zone by id (for a direct link); zones must be loaded.
  function edit(id) { if (st.zones?.some((r) => r.id === id)) startEdit(id, { push: false }); }

  return { view, load, onClick, onInput, onPick, edit };
}
