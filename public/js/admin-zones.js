// Zone editor for the admin console. Edits a working copy of a zone definition, shows a
// live map preview and validation, and saves through the `admin` edge function.
import { ZONES, ZONE_DEFS, DEFAULT_ZONES, OVERWORLD_ID, compileZone, loadZones } from './data/zones.js';
import { validateZone, blankZone, ARCHETYPES, MAX_MONSTERS } from './engine/zone-validate.js';
import { ELEMENTS, ELEMENT_LABEL } from './data/elements.js';
import { WEAPON_TYPES, MAX_TIER } from './data/items.js';

export function setupZones({ st, call, toast, render, esc, isAdmin }) {
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

  // ------------------------------------------------------------ inputs
  const num = (path, label, attrs = '') => `<label>${label}<input data-f="${path}" data-t="int" type="number" ${attrs} value="${esc(getPath(st.zoneEdit.def, path) ?? '')}"></label>`;
  const text = (path, label, attrs = '') => `<label>${label}<input data-f="${path}" ${attrs} value="${esc(getPath(st.zoneEdit.def, path) ?? '')}"></label>`;
  const check = (path, label) => `<label class="chk"><input data-f="${path}" data-t="bool" type="checkbox" ${getPath(st.zoneEdit.def, path) ? 'checked' : ''}> ${label}</label>`;
  const select = (path, label, options, allowNone = false) => {
    const cur = getPath(st.zoneEdit.def, path) ?? '';
    return `<label>${label}<select data-f="${path}">${allowNone ? `<option value="" ${cur === '' ? 'selected' : ''}>None</option>` : ''}${options.map(([v, l]) =>
      `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  };
  const toggle = (key, label, on) => `<label class="chk"><input data-toggle="${key}" type="checkbox" ${on ? 'checked' : ''}> ${label}</label>`;

  // ------------------------------------------------------------ preview
  function previewHtml() {
    const d = st.zoneEdit.def;
    const all = defsWithDraft();
    const errors = validateZone(d, all);
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
          cells.push(`<button type="button" class="${cls}" tabindex="-1" title="${x}, ${y}">${label}</button>`);
        }
      }
      mapHtml = `<div class="map ${d.pvp ? 'pvp' : ''}" style="grid-template-columns:repeat(${size},1fr);max-width:420px">${cells.join('')}</div>
        <div class="legend"><span><b>T</b> Town</span><span><b>P</b> Path</span><span><b>B</b> Boss lair</span><span><b>E</b> Entry</span>
        <span>Levels ${z.levelRange[0]} to ${z.levelRange[1]}</span></div>`;
    } catch { mapHtml = '<p class="small bad">Can’t draw this zone yet.</p>'; }

    // Overworld placement preview.
    let owHtml = '';
    const ow = all.find((z) => z.id === OVERWORLD_ID);
    if (ow && d.id !== OVERWORLD_ID) {
      const cells = [];
      for (let y = 1; y <= ow.size; y++) {
        for (let x = 1; x <= ow.size; x++) {
          const here = all.find((z) => z.overworld && z.overworld[0] === x && z.overworld[1] === y);
          const mine = d.overworld && d.overworld[0] === x && d.overworld[1] === y;
          const town = ow.town && ow.town.x === x && ow.town.y === y;
          cells.push(`<button type="button" class="${mine ? 'me' : town ? 'town' : here ? 'portal' : ''}" data-owpick="${x},${y}" title="${here ? esc(here.name) : `${x}, ${y}`}">${mine ? 'Here' : town ? 'T' : here ? esc(here.name.slice(0, 2)) : ''}</button>`);
        }
      }
      owHtml = `<h3>Overworld placement</h3><p class="small muted">Tap an empty square to place this zone on the Overworld map. A path in and out is created automatically.</p>
        <div class="map" style="grid-template-columns:repeat(${ow.size},1fr);max-width:320px">${cells.join('')}</div>`;
    }
    return `${errors.length ? `<div class="notice bad"><p class="small" style="margin:0"><b>Fix before saving:</b></p><ul class="small" style="margin:6px 0 0;padding-left:18px">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`
      : '<p class="small good">No problems found.</p>'}
      <h3>Map preview</h3>${mapHtml}${owHtml}`;
  }

  function refreshPreview() {
    const el = document.getElementById('zone-preview');
    if (el) el.innerHTML = previewHtml();
  }

  // ------------------------------------------------------------ views
  function listView() {
    const zones = st.zones;
    if (!zones) return '<p class="muted">Loading.</p>';
    return `${isAdmin() ? '<div class="acts" style="margin:0 0 12px"><button class="btn primary" data-a="zoneNew">New zone</button></div>' : ''}
      <div class="box"><h2>Zones</h2><table>
      <tr><th>Zone</th><th class="num">Size</th><th class="num">Levels</th><th class="num">Heroes</th><th><span class="sr-only">Actions</span></th></tr>
      ${zones.map((r) => {
        const z = ZONES[r.id];
        const tags = [r.data.starter ? 'starter' : '', r.data.pvp ? 'PvP' : '', r.data.overworld ? `Overworld ${r.data.overworld.join(',')}` : r.id === OVERWORLD_ID ? '' : 'not on Overworld', r.builtin ? '' : 'custom'].filter(Boolean).join(', ');
        return `<tr class="click" data-a="zoneEdit" data-v="${esc(r.id)}"><td><b>${esc(r.data.name)}</b><br><span class="small faint">${esc(r.id)}${tags ? `, ${tags}` : ''}</span></td>
          <td class="num">${r.data.size}</td><td class="num">${z ? `${z.levelRange[0]}-${z.levelRange[1]}` : ''}</td><td class="num">${r.players}</td>
          <td class="num"><button type="button" class="textbtn" data-a="zoneEdit" data-v="${esc(r.id)}">${isAdmin() ? 'Edit' : 'View'}<span class="sr-only"> ${esc(r.data.name)}</span></button></td></tr>`;
      }).join('')}</table>
      <p class="small faint" style="margin-top:8px">Changes reach players within about two minutes. Heroes in a removed area are moved somewhere safe; fights against removed monsters end.</p></div>`;
  }

  function editorView() {
    const ed = st.zoneEdit;
    const d = ed.def;
    const zoneOpts = defsWithDraft().map((z) => [z.id, z.name]);
    const archOpts = ARCHETYPES.map((a) => [a, a]);
    const elemOpts = ELEMENTS.map((e) => [e, ELEMENT_LABEL[e]]);
    const monsterRow = (path, i) => `<div class="form-grid mon-row">
        ${text(`${path}.name`, 'Name')}${num(`${path}.level`, 'Level', 'min="1"')}
        ${select(`${path}.arch`, 'Type', archOpts)}${text(`${path}.verb`, 'Attack verb', 'placeholder="bites"')}
        ${select(`${path}.element`, 'Element', elemOpts, true)}
        ${i != null ? `<button type="button" class="btn sm danger" data-a="zoneDelMon" data-v="${i}" style="align-self:end">Remove</button>` : check(`${path}.proper`, 'Proper name (no "the")')}
      </div>`;
    const ro = !isAdmin();
    return `<div class="acts" style="margin-top:0"><button class="btn sm" data-a="zoneBack">Back to zones</button></div>
    <form id="zone-form" ${ro ? 'inert' : ''}>
    <div class="zone-cols">
      <div>
        <div class="box"><h2>${ed.isNew ? 'New zone' : esc(d.name)}</h2>
          <div class="form-grid">
            ${ed.isNew ? text('id', 'Id (permanent)', 'placeholder="misty-hills"') : `<label>Id<input value="${esc(d.id)}" disabled></label>`}
            ${text('name', 'Name')}
            ${num('size', 'Size (squares per side)', 'min="3" max="40"')}
            ${num('minLevel', 'Level to enter', 'min="0"')}
            ${num('exitLevel', 'Level to leave', 'min="0"')}
            <label style="grid-column:1/-1">Description<textarea data-f="desc" class="a-input" maxlength="300">${esc(d.desc || '')}</textarea></label>
            ${check('starter', 'Starter zone')}${check('pvp', 'PvP allowed')}
          </div></div>

        ${d.id !== OVERWORLD_ID ? `<div class="box"><h2>Entry</h2>
          <p class="small muted">Where travelers arrive. The path back to the Overworld sits here.</p>
          <div class="form-grid">${num('entry.x', 'Entry X', 'min="1"')}${num('entry.y', 'Entry Y', 'min="1"')}
            ${toggle('overworld', 'On the Overworld', !!d.overworld)}
            ${d.overworld ? `${num('overworld.0', 'Overworld X', 'min="1"')}${num('overworld.1', 'Overworld Y', 'min="1"')}` : ''}</div></div>` : ''}

        <div class="box"><h2>Town</h2>
          <div class="form-grid">${toggle('town', 'Has a town', !!d.town)}
          ${d.town ? `${text('town.name', 'Town name')}${num('town.x', 'X', 'min="1"')}${num('town.y', 'Y', 'min="1"')}` : ''}</div>
          ${d.town ? `<h3>Shop</h3><div class="form-grid">${toggle('shop', 'Town has a shop', !!d.shop)}</div>
            ${d.shop ? `<p class="lbl" style="margin-top:8px">Item classes</p><div class="chips-wrap">${Array.from({ length: MAX_TIER }, (_, i) => i + 1).map((t) =>
              `<label class="chk"><input type="checkbox" data-list="shop.tiers" value="${t}" ${d.shop.tiers.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
              <p class="lbl" style="margin-top:8px">Weapons</p><div class="chips-wrap">${Object.keys(WEAPON_TYPES).map((w) =>
              `<label class="chk"><input type="checkbox" data-list="shop.weapons" value="${w}" ${d.shop.weapons.includes(w) ? 'checked' : ''}> ${WEAPON_TYPES[w].label}</label>`).join('')}</div>
              <p class="lbl" style="margin-top:8px">Magic focuses</p><div class="chips-wrap">${ELEMENTS.map((e) =>
              `<label class="chk"><input type="checkbox" data-list="shop.elements" value="${e}" ${d.shop.elements.includes(e) ? 'checked' : ''}> ${ELEMENT_LABEL[e]}</label>`).join('')}</div>
              <div class="chips-wrap" style="margin-top:8px">${check('shop.armor', 'Sells armor')}</div>` : ''}` : ''}
        </div>

        <div class="box"><h2>Monsters (${d.monsters.length})</h2>
          <p class="small muted">Every square in the zone shares this list.</p>
          ${d.monsters.map((m, i) => monsterRow(`monsters.${i}`, i)).join('')}
          ${d.monsters.length < MAX_MONSTERS ? '<button type="button" class="btn sm" data-a="zoneAddMon">Add monster</button>' : ''}
        </div>

        <div class="box"><h2>Boss</h2>
          <div class="form-grid">${toggle('boss', 'Has a boss', !!d.boss)}</div>
          ${d.boss ? `${monsterRow('boss', null)}
            <h3>Lairs</h3><p class="small muted">Squares where the boss can be fought.</p>
            ${d.lairs.map((l, i) => `<div class="form-grid">${num(`lairs.${i}.x`, 'X', 'min="1"')}${num(`lairs.${i}.y`, 'Y', 'min="1"')}
              <button type="button" class="btn sm danger" data-a="zoneDelLair" data-v="${i}" style="align-self:end">Remove</button></div>`).join('')}
            <button type="button" class="btn sm" data-a="zoneAddLair">Add lair</button>` : ''}
        </div>

        <div class="box"><h2>Extra paths</h2>
          <p class="small muted">Paths straight to another zone, besides the Overworld.</p>
          ${d.portals.map((p, i) => `<div class="form-grid mon-row">
            ${text(`portals.${i}.label`, 'Label')}${select(`portals.${i}.to`, 'Leads to', zoneOpts)}
            ${num(`portals.${i}.x`, 'Here X', 'min="1"')}${num(`portals.${i}.y`, 'Here Y', 'min="1"')}
            ${num(`portals.${i}.tx`, 'Arrive X', 'min="1"')}${num(`portals.${i}.ty`, 'Arrive Y', 'min="1"')}
            ${num(`portals.${i}.minLevel`, 'Level needed', 'min="0"')}
            <button type="button" class="btn sm danger" data-a="zoneDelPortal" data-v="${i}" style="align-self:end">Remove</button></div>`).join('')}
          <button type="button" class="btn sm" data-a="zoneAddPortal">Add path</button>
        </div>
      </div>
      <div><div class="box zone-side" id="zone-preview">${previewHtml()}</div></div>
    </div>
    </form>
    ${isAdmin() ? `<div class="box acts">
      <button class="btn primary" data-a="zoneSave">${ed.isNew ? 'Create zone' : 'Save changes'}</button>
      <button class="btn" data-a="zoneBack">Cancel</button>
      ${!ed.isNew && DEFAULT_ZONES.some((z) => z.id === d.id) ? '<button class="btn" data-a="zoneReset">Restore built-in version</button>' : ''}
      ${!ed.isNew ? '<button class="btn danger" data-a="zoneDelete">Delete zone</button>' : ''}
    </div>` : '<p class="small faint">Only admins can edit zones.</p>'}`;
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

  function startEdit(id) {
    const row = st.zones.find((r) => r.id === id);
    if (!row) return;
    const def = clone(row.data);
    def.lairs = def.lairs || [];
    def.portals = def.portals || [];
    st.zoneEdit = { def, isNew: false, originalId: id };
    render();
    window.scrollTo(0, 0);
  }

  function startNew() {
    let n = 1;
    while (st.zones.some((r) => r.id === `new-zone-${n}`)) n++;
    st.zoneEdit = { def: blankZone(`new-zone-${n}`), isNew: true, originalId: null };
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
      case 'zoneBack': st.zoneEdit = null; render(); load(); return true;
      case 'zoneAddMon': d.monsters.push({ name: '', level: d.monsters.at(-1)?.level || 1, arch: 'brute', verb: 'attacks' }); render(); return true;
      case 'zoneDelMon': d.monsters.splice(Number(v), 1); render(); return true;
      case 'zoneAddLair': d.lairs.push({ x: 1, y: 1 }); render(); return true;
      case 'zoneDelLair': d.lairs.splice(Number(v), 1); render(); return true;
      case 'zoneAddPortal': d.portals.push({ x: 1, y: 1, to: OVERWORLD_ID, tx: 1, ty: 1, minLevel: 0, label: 'A path' }); render(); return true;
      case 'zoneDelPortal': d.portals.splice(Number(v), 1); render(); return true;
      case 'zoneSave': {
        const errors = validateZone(d, defsWithDraft());
        if (errors.length) { toast('Fix the problems listed first.', true); return true; }
        try {
          const res = await call('saveZone', { zone: d, isNew: ed.isNew });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          st.zoneEdit = null;
          toast(ed.isNew ? 'Zone created.' : 'Zone saved.');
          render();
        } catch (e) { toast(e.message, true); }
        return true;
      }
      case 'zoneDelete': {
        if (!confirm(`Delete ${d.name}? Heroes there will be moved somewhere safe. This can’t be undone (the definition is kept in the audit log).`)) return true;
        try {
          const res = await call('deleteZone', { id: ed.originalId });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          st.zoneEdit = null;
          toast('Zone deleted.');
          render();
        } catch (e) { toast(e.message, true); }
        return true;
      }
      case 'zoneReset': {
        if (!confirm(`Restore the built-in version of ${d.name}? Your edits to it will be replaced (the old version is kept in the audit log).`)) return true;
        try {
          const res = await call('resetZone', { id: ed.originalId });
          st.zones = res.zones;
          loadZones(res.zones.map((r) => r.data));
          startEdit(ed.originalId);
          toast('Restored.');
        } catch (e) { toast(e.message, true); }
        return true;
      }
      default: return false;
    }
  }

  // Field edits update the working copy and the preview without redrawing the form.
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

  return { view, load, onClick, onInput, onPick };
}
