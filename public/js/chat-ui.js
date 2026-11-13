// Chat: Global, Zone and Whisper tabs. Messages arrive live through Supabase Realtime; sending
// goes through the game server, which enforces mutes, level, speed limits and link blocking.
// Two places to show it, one state (messages, tab, unread counts, draft):
//   drawer  a slim bar above the controls, opening a modal drawer (phones, tablets, and
//           desktop windows under 1280px)
//   panel   a persistent, non-modal panel in the desktop side column (1280px+, D-2); the game
//           stays usable, and live messages never move focus
// main.js switches between them with setMode() as the layout changes.
import { CHAT_LEVEL, CHAT_MAX_LEN, cleanChatText } from './engine/chat.js';
import { ask } from './confirm.js';

const TABS = [['global', 'Global'], ['zone', 'Zone'], ['whisper', 'Whispers']];
const KEEP = 120;

export function setupChat({ sb, api, getChar, toast, esc, zoneName }) {
  const st = {
    started: false, visible: false, open: false, tab: 'global',
    msgs: { global: [], zone: [], whisper: [] }, unread: { global: 0, zone: 0, whisper: 0 },
    myId: null, zone: null, role: null, ignores: new Map(), whisperTo: '', menuFor: null, channel: null, error: null,
    mode: 'drawer', draft: '', draftTo: null, // what is typed survives a switch between drawer and panel
  };
  const bar = document.getElementById('chatbar');
  const drawer = document.getElementById('chat');
  const body = document.getElementById('chat-body'); // redrawn content; the dialog itself stays
  const panel = document.getElementById('chatpanel'); // the desktop side column's chat panel
  const docked = () => st.mode === 'panel';
  const showing = () => st.visible && (docked() || st.open);
  const host = () => (docked() ? panel : drawer); // the element holding the chat controls

  const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const ignored = (m) => m.sender_id && st.ignores.has(m.sender_id);

  function add(channel, m, countUnread = true) {
    const list = st.msgs[channel];
    const i = list.findIndex((x) => x.id === m.id && !!x.system === !!m.system);
    if (i >= 0) { list[i] = m; return; }
    list.push(m);
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (list.length > KEEP) list.splice(0, list.length - KEEP);
    const mine = m.sender_id && m.sender_id === st.myId;
    if (countUnread && !mine && !ignored(m) && !(showing() && st.tab === channel)) st.unread[channel] += 1;
  }

  // ------------------------------------------------------------ loading
  async function loadChannel(channel) {
    let q = sb.from('chat_messages').select('id, channel, zone, sender_id, sender_name, sender_role, recipient_id, recipient_name, text, deleted_at, created_at')
      .eq('channel', channel).order('created_at', { ascending: false }).limit(60);
    if (channel === 'zone') q = q.eq('zone', st.zone);
    const { data } = await q;
    st.msgs[channel] = (data || []).reverse();
  }

  async function loadNews() {
    const { data } = await sb.from('events').select('id, kind, text, created_at').order('created_at', { ascending: false }).limit(15);
    for (const e of (data || []).reverse()) add('global', { ...e, system: true }, false);
  }

  async function loadMeta() {
    const char = getChar();
    const [{ data: me }, { data: ign }, { data: staff }] = await Promise.all([
      sb.rpc('my_character'),
      sb.from('chat_ignores').select('ignored_id, ignored_name'),
      sb.from('staff').select('role').maybeSingle(),
    ]);
    st.myId = me?.[0]?.id || null;
    st.zone = char?.loc.zone || me?.[0]?.zone || null;
    st.ignores = new Map((ign || []).map((r) => [r.ignored_id, r.ignored_name]));
    st.role = staff?.role || null;
  }

  function subscribe() {
    st.channel = sb.channel('chat-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, ({ new: m }) => {
        if (m.channel === 'zone' && m.zone !== st.zone) return;
        add(m.channel, m);
        paint();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, ({ new: m }) => {
        const list = st.msgs[m.channel] || [];
        const i = list.findIndex((x) => x.id === m.id && !x.system);
        if (i >= 0) { list[i] = m; paint(); }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, ({ new: e }) => {
        add('global', { ...e, system: true });
        paint();
      })
      .subscribe();
  }

  async function start() {
    if (st.started) return;
    st.started = true;
    try {
      await loadMeta();
      await Promise.all([loadChannel('global'), loadChannel('zone'), loadChannel('whisper')]);
      await loadNews();
    } catch { /* chat is optional; keep the game running */ }
    subscribe();
    paint();
  }

  async function stop() {
    if (st.channel) await sb.removeChannel(st.channel);
    Object.assign(st, { started: false, open: false, channel: null, msgs: { global: [], zone: [], whisper: [] }, unread: { global: 0, zone: 0, whisper: 0 } });
    paint();
  }

  async function setZone(zone) {
    if (!st.started || zone === st.zone) return;
    st.zone = zone;
    st.unread.zone = 0;
    try { await loadChannel('zone'); } catch { /* ignore */ }
    paint();
  }

  // ------------------------------------------------------------ focus-safe updates
  // Live messages refresh the bar, tabs, list and error area. Replace their markup only when it
  // changed, and keep keyboard focus (and the caret) on the equivalent control afterwards.
  const lastHtml = new WeakMap();
  const keyOf = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const { c, v } = el.dataset;
    if (!c) return null;
    return `[data-c="${CSS.escape(c)}"]${v != null ? `[data-v="${CSS.escape(v)}"]` : ':not([data-v])'}`;
  };
  function setHtml(el, html, fallback) {
    if (!el || lastHtml.get(el) === html) return false;
    const active = document.activeElement;
    const inside = active && active !== el && el.contains(active);
    const key = inside ? keyOf(active) : null;
    const caret = inside && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    el.innerHTML = html;
    lastHtml.set(el, html);
    if (inside) {
      const next = (key && el.querySelector(key)) || (fallback && fallback());
      if (next) {
        next.focus({ preventScroll: true });
        if (caret && 'setSelectionRange' in next) { try { next.setSelectionRange(...caret); } catch { /* not a text field */ } }
      }
    }
    return true;
  }

  // ------------------------------------------------------------ rendering
  // Messages are buttons in a single-tab-stop list (arrow keys move between them).
  // Activating one opens a small action menu right below it.
  function lineHtml(m) {
    if (m.system) return `<p class="chat-line system"><span class="t">${time(m.created_at)}</span> ${esc(m.text)}</p>`;
    if (ignored(m)) return '';
    const tag = m.sender_role ? ` <span class="staff-tag">${m.sender_role === 'admin' ? 'Admin' : 'Mod'}</span>` : '';
    const mine = m.sender_id === st.myId;
    let who;
    if (m.channel === 'whisper') {
      who = mine ? `To <b>${esc(m.recipient_name)}</b>` : `From <b>${esc(m.sender_name)}</b>${tag}`;
    } else {
      who = `<b>${esc(m.sender_name)}</b>${tag}`;
    }
    const body = m.deleted_at ? '<span class="removed">[message removed]</span>' : esc(m.text);
    const open = st.menuFor === m.id;
    const actions = [
      !mine ? `<button data-c="whisper" data-v="${esc(m.sender_name)}">Whisper</button>` : '',
      !mine ? `<button data-c="ignore" data-v="${esc(m.sender_name)}">Ignore</button>` : '',
      !mine && !m.deleted_at ? `<button data-c="report" data-v="${m.id}">Report</button>` : '',
      st.role && !m.deleted_at ? `<button data-c="delete" data-v="${m.id}" class="bad">Remove</button>` : '',
    ].join('');
    const menu = open ? (actions
      ? `<div class="chat-menu" id="chat-menu-${m.id}" role="group" aria-label="Message actions">${actions}</div>`
      : `<div class="chat-menu" id="chat-menu-${m.id}" role="group" aria-label="Message actions"><span class="small muted">No actions for your own message.</span></div>`) : '';
    return `<div class="chat-item"><button type="button" class="chat-line ${m.channel === 'whisper' ? 'whisper' : ''}" data-c="menu" data-v="${m.id}"
        tabindex="-1" aria-expanded="${open}" ${open ? `aria-controls="chat-menu-${m.id}"` : ''}><span class="t">${time(m.created_at)}</span> ${who}: ${body}</button>${menu}</div>`;
  }

  function latestLine() {
    const all = [...st.msgs.global, ...st.msgs.zone, ...st.msgs.whisper].filter((m) => !ignored(m) && !m.deleted_at);
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const m = all[0];
    if (!m) return 'Chat';
    if (m.system) return esc(m.text);
    const ch = m.channel === 'whisper' ? 'Whisper' : m.channel === 'zone' ? 'Zone' : 'Global';
    return `<span class="faint">${ch}</span> <b>${esc(m.sender_name)}</b>: ${esc(m.text)}`;
  }

  function paintBar() {
    if (!st.visible || !st.started || docked()) { setHtml(bar, ''); return; }
    const unreadTotal = TABS.reduce((n, [k]) => n + st.unread[k], 0);
    const unread = TABS.filter(([k]) => st.unread[k]).map(([k, l]) => `${l} ${st.unread[k]}`).join(', ');
    setHtml(bar, `<button class="chatbar" data-c="toggle" aria-haspopup="dialog" aria-label="Open chat${unreadTotal ? `, ${unreadTotal} unread` : ''}">
      <span class="chatbar-text">${latestLine()}</span>${unread ? `<span class="chatbar-unread">${unread}</span>` : ''}</button>`);
  }

  function tabsHtml() {
    return TABS.map(([k, l]) => `<button type="button" data-c="tab" data-v="${k}" class="${st.tab === k ? 'on' : ''}" aria-pressed="${st.tab === k}">${l}${st.unread[k] ? ` <span class="count" aria-label="${st.unread[k]} unread">${st.unread[k]}</span>` : ''}</button>`).join('');
  }

  function listHtml() {
    const isWhisper = st.tab === 'whisper';
    const ignoreList = isWhisper && st.ignores.size ? `<p class="small muted chat-ign">Ignored: ${[...st.ignores.values()].map((n) =>
      `${esc(n)} <button class="textbtn" data-c="unignore" data-v="${esc(n)}">unignore</button>`).join(', ')}</p>` : '';
    const empty = st.tab === 'zone' ? `No messages in ${esc(zoneName(st.zone))} yet.` : isWhisper ? 'No whispers yet. Tap a name to whisper.' : 'No messages yet.';
    return ignoreList + (st.msgs[st.tab].map(lineHtml).join('') || `<div class="empty"><p class="empty-title">${empty}</p></div>`);
  }

  // Roving tab stop: exactly one message is reachable with Tab; arrows move between them.
  function syncRoving(preferId) {
    const lines = [...host().querySelectorAll('.chat-line[data-c="menu"]')];
    if (!lines.length) return;
    let current = preferId != null && lines.find((l) => l.dataset.v === String(preferId));
    if (!current) current = lines.find((l) => l.tabIndex === 0) || lines[lines.length - 1];
    for (const l of lines) l.tabIndex = l === current ? 0 : -1;
  }

  function errorHtml() {
    return st.error ? `<div class="chat-error" role="alert" id="chat-error"><span>${esc(st.error)}</span>
      <button type="button" class="textbtn" data-c="clearError">Dismiss</button></div>` : '';
  }

  let opener = null;
  function closeDrawer() {
    st.open = false;
    st.menuFor = null;
    paint();
  }

  function paintChat() {
    // The drawer closes when chat isn't showing in it (closed, hidden, or moved to the panel).
    if (!(showing() && !docked()) && drawer.open) {
      drawer.close();
      body.innerHTML = '';
      const back = opener && opener.isConnected && opener.getClientRects().length ? opener : bar.querySelector('.chatbar');
      back?.focus({ preventScroll: true });
      opener = null;
    }
    if (!(showing() && docked()) && panel.firstChild) panel.innerHTML = '';
    if (!showing()) return;
    const root = host();
    // Same tab already showing: refresh the list, tabs and error only, keeping focus and typing intact.
    const shown = root.querySelector('.chat-panel');
    if (shown && shown.dataset.tab === st.tab) {
      const el = root.querySelector('#chat-list');
      const active = document.activeElement;
      // The message that owns the focus: the focused line itself, or the line whose menu is focused.
      const ownLine = active && el.contains(active)
        ? (active.dataset.c === 'menu' ? active.dataset.v : active.closest('.chat-item')?.querySelector('.chat-line')?.dataset.v)
        : null;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      const tabsEl = root.querySelector('.chat-tabs');
      setHtml(el, listHtml(), () => el.querySelector('.chat-line[tabindex="0"]') || el.querySelector('.chat-line'));
      syncRoving(ownLine);
      setHtml(tabsEl, tabsHtml(), () => tabsEl.querySelector('button.on'));
      setHtml(root.querySelector('#chat-error-slot'), errorHtml(), () => root.querySelector('#chat-input'));
      if (atBottom) el.scrollTop = el.scrollHeight;
      return;
    }
    const char = getChar();
    const canChat = char && char.level >= CHAT_LEVEL;
    const isWhisper = st.tab === 'whisper';
    const existing = root.querySelector('#chat-input');
    const keep = existing ? existing.value : st.draft;
    // Default the whisper target to whoever whispered you last.
    const lastFrom = [...st.msgs.whisper].reverse().find((m) => m.sender_id && m.sender_id !== st.myId);
    const keepTo = root.querySelector('#chat-to')?.value || st.draftTo || st.whisperTo || lastFrom?.sender_name || '';
    const placeholder = canChat ? (st.tab === 'zone' ? `Say to ${zoneName(st.zone)}` : isWhisper ? 'Whisper' : 'Say to everyone') : `Reach level ${CHAT_LEVEL} to chat`;
    // The panel has a visible heading (it names the landmark) and no Close; the drawer has Close.
    const head = docked()
      ? `<div class="chat-head docked" id="chat-head"><h2 class="side-h" id="chatpanel-h">Chat</h2>
          <div class="chat-tabs" role="group" aria-label="Channel">${tabsHtml()}</div></div>`
      : `<div class="chat-head" id="chat-head">
          <div class="chat-tabs" role="group" aria-label="Channel">${tabsHtml()}</div>
          <button type="button" class="textbtn" data-c="toggle">Close</button>
        </div>`;
    (docked() ? panel : body).innerHTML = `<div class="chat-panel" data-tab="${st.tab}">
      ${head}
      <div class="chat-list" id="chat-list" role="log" aria-label="${TABS.find(([k]) => k === st.tab)[1]} messages" aria-live="off">${listHtml()}</div>
      <div id="chat-error-slot">${errorHtml()}</div>
      <form class="chat-form" id="chat-form" novalidate>
        ${isWhisper ? `<label class="sr-only" for="chat-to">Whisper to</label><input id="chat-to" class="chat-to" placeholder="To" maxlength="18" autocomplete="off" value="${esc(keepTo)}">` : ''}
        <label class="sr-only" for="chat-input">Message</label>
        <input id="chat-input" maxlength="${CHAT_MAX_LEN}" autocomplete="off" enterkeyhint="send" ${canChat ? '' : 'disabled'}
          ${st.error ? 'aria-invalid="true" aria-describedby="chat-error"' : ''}
          placeholder="${esc(placeholder)}" value="${esc(keep)}">
        <button class="btn primary sm" type="submit" ${canChat ? '' : 'disabled'}>Send</button>
      </form>
    </div>`;
    syncRoving();
    const el = root.querySelector('#chat-list');
    el.scrollTop = el.scrollHeight;
    if (!docked() && !drawer.open) {
      opener = opener || document.activeElement;
      drawer.showModal();
      const input = drawer.querySelector('#chat-input');
      (input && !input.disabled ? input : drawer.querySelector('.chat-tabs button.on'))?.focus();
    }
  }

  function paint() {
    paintBar();
    if (showing()) st.unread[st.tab] = 0;
    paintChat();
    paintBar();
  }

  // Drawer or panel, as the layout changes. What is typed, the channel and the unread counts
  // carry over. If you were using chat when it moved, focus and the caret follow it (the drawer
  // opens for that); otherwise the drawer stays closed and focus stays where it is.
  function setMode(mode) {
    if (st.mode === mode) return;
    const from = host();
    const active = document.activeElement;
    const inside = active && active !== from && from.contains(active) ? active : null;
    const key = inside ? keyOf(inside) : null;
    const caret = inside && 'selectionStart' in inside ? [inside.selectionStart, inside.selectionEnd] : null;
    const input = from.querySelector('#chat-input');
    if (input) st.draft = input.value;
    const to = from.querySelector('#chat-to');
    if (to) st.draftTo = to.value;
    if (drawer.open) drawer.close();
    body.innerHTML = '';
    panel.innerHTML = '';
    opener = null;
    st.mode = mode;
    st.open = mode === 'drawer' && !!inside && st.visible;
    paint();
    if (inside && showing()) {
      const next = (key && host().querySelector(key)) || host().querySelector('#chat-input:not([disabled])');
      if (next) {
        next.focus({ preventScroll: true });
        if (caret && 'setSelectionRange' in next) { try { next.setSelectionRange(...caret); } catch { /* not a text field */ } }
      }
    }
  }

  function setVisible(v) {
    if (st.visible === v) return;
    st.visible = v;
    if (!v) st.open = false;
    paint();
  }

  function openWhisper(name) {
    if (!docked()) { opener = document.activeElement; st.open = true; }
    st.tab = 'whisper';
    st.whisperTo = name;
    st.draftTo = name;
    host().querySelector('.chat-panel')?.removeAttribute('data-tab');
    const to = host().querySelector('#chat-to');
    if (to) to.value = name;
    paint();
    const toEl = host().querySelector('#chat-to');
    if (toEl) toEl.value = name;
    host().querySelector('#chat-input:not([disabled])')?.focus();
  }

  // ------------------------------------------------------------ events
  function setError(msg) {
    st.error = msg;
    const slot = host().querySelector('#chat-error-slot');
    if (slot) setHtml(slot, errorHtml(), () => host().querySelector('#chat-input'));
    const input = host().querySelector('#chat-input');
    if (input) {
      if (msg) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'chat-error'); }
      else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    }
  }

  async function send() {
    const input = host().querySelector('#chat-input');
    const text = input?.value || '';
    const clean = cleanChatText(text);
    if (!clean.ok) { setError(clean.reason); return; }
    const args = { channel: st.tab, text: clean.text };
    if (st.tab === 'whisper') {
      args.to = (host().querySelector('#chat-to')?.value || '').trim();
      if (!args.to) { setError('Who should get this whisper? Type a name in the To box.'); host().querySelector('#chat-to')?.focus(); return; }
      st.whisperTo = args.to;
    }
    input.value = '';
    st.draft = '';
    try {
      await api('chat', args);
      setError(null); // the condition is resolved once a message goes through
    } catch (err) {
      input.value = text;
      st.draft = text;
      setError(err.message);
      input.focus();
    }
  }

  // The message a menu acts on, from whichever channel holds it.
  const findMsg = (id) => Object.values(st.msgs).flat().find((m) => String(m.id) === String(id));
  // Where focus goes if the menu button that asked was re-rendered away (a Realtime update):
  // the message's line, else the message box.
  const backTo = (id) => (id != null && host().querySelector(`.chat-line[data-v="${CSS.escape(String(id))}"]`)) || host().querySelector('#chat-input:not([disabled])') || host().querySelector('.chat-tabs button.on');
  const quote = (m) => (m ? `${m.sender_name}: "${m.text.length > 120 ? `${m.text.slice(0, 117)}...` : m.text}"` : '');

  async function onAction(c, v) {
    switch (c) {
      case 'toggle':
        if (docked()) return; // the panel is always open
        if (st.open) { closeDrawer(); return; }
        opener = document.activeElement;
        st.open = true; st.menuFor = null; paint(); return;
      case 'tab':
        st.tab = v; st.menuFor = null;
        host().querySelector('.chat-panel')?.removeAttribute('data-tab');
        paint();
        host().querySelector(`.chat-tabs [data-v="${v}"]`)?.focus();
        return;
      case 'menu':
        st.menuFor = st.menuFor === Number(v) ? null : Number(v);
        paintChat();
        host().querySelector(`.chat-line[data-v="${v}"]`)?.focus();
        return;
      case 'clearError': setError(null); host().querySelector('#chat-input')?.focus(); return;
      case 'whisper': st.menuFor = null; openWhisper(v); return;
      case 'ignore':
        if (!await ask({
          title: `Ignore ${v}?`,
          points: ["You won't see their messages or whispers.", 'You can stop ignoring them from the list at the top of the chat.'],
          confirm: 'Ignore', cancel: 'Cancel', tone: 'normal', fallback: () => backTo(),
        })) return;
        try { await api('ignore', { name: v }); await loadMeta(); toast(`Ignoring ${v}.`); } catch (err) { setError(err.message); }
        st.menuFor = null; paint(); return;
      case 'unignore':
        try { await api('unignore', { name: v }); await loadMeta(); toast(`No longer ignoring ${v}.`); } catch (err) { setError(err.message); }
        paint(); return;
      case 'report': {
        const res = await ask({
          title: 'Report this message?',
          lead: quote(findMsg(v)),
          points: ['A moderator will review it. The sender is not told who reported it.'],
          input: { label: 'Why are you reporting it? (optional)', maxlength: 200 },
          confirm: 'Send report', cancel: 'Cancel', tone: 'normal', fallback: () => backTo(v),
        });
        if (!res) return;
        const reason = res.value || '';
        try { await api('report', { messageId: v, reason }); toast('Thanks. A moderator will take a look.'); } catch (err) { setError(err.message); }
        st.menuFor = null; paint(); host().querySelector(`.chat-line[data-v="${v}"]`)?.focus(); return;
      }
      case 'delete':
        if (!await ask({
          title: 'Remove this message for everyone?',
          lead: quote(findMsg(v)),
          points: ['It is replaced by "message removed" for all players. The original stays in the moderation log.'],
          confirm: 'Remove message', cancel: 'Keep it', fallback: () => backTo(v),
        })) return;
        try { await api('modDelete', { messageId: v }); toast('Removed.'); } catch (err) { setError(err.message); }
        st.menuFor = null; paint(); host().querySelector(`.chat-line[data-v="${v}"]`)?.focus(); return;
      default:
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target === drawer) { closeDrawer(); return; } // backdrop tap
    const el = e.target.closest('[data-c]');
    if (!el || !(bar.contains(el) || drawer.contains(el) || panel.contains(el))) return;
    e.preventDefault();
    onAction(el.dataset.c, el.dataset.v);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'chat-form') return;
    e.preventDefault();
    send();
  });
  // Keep what is typed, so it survives a move between drawer and panel.
  document.addEventListener('input', (e) => {
    if (e.target.id === 'chat-input' && host().contains(e.target)) st.draft = e.target.value;
    if (e.target.id === 'chat-to' && host().contains(e.target)) st.draftTo = e.target.value;
  });
  // Escape closes an open message menu first, then the drawer.
  drawer.addEventListener('cancel', (e) => {
    e.preventDefault();
    if (closeMenu()) return;
    closeDrawer();
  });
  // An open message menu closes with Escape (in the panel, Escape does nothing else).
  function closeMenu() {
    if (st.menuFor == null) return false;
    const id = st.menuFor;
    st.menuFor = null;
    paintChat();
    host().querySelector(`.chat-line[data-v="${id}"]`)?.focus();
    return true;
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && closeMenu()) e.preventDefault(); });
  // Arrow keys move between messages.
  const arrows = (e) => {
    const line = e.target.closest?.('.chat-line[data-c="menu"]');
    if (!line || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const lines = [...host().querySelectorAll('.chat-line[data-c="menu"]')];
    const i = lines.indexOf(line);
    const next = e.key === 'Home' ? lines[0] : e.key === 'End' ? lines[lines.length - 1]
      : lines[Math.max(0, Math.min(lines.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    e.preventDefault();
    for (const l of lines) l.tabIndex = l === next ? 0 : -1;
    next.focus();
  };
  drawer.addEventListener('keydown', arrows);
  panel.addEventListener('keydown', arrows);
  // Swipe the header down to close.
  let touchY = null;
  drawer.addEventListener('touchstart', (e) => { if (e.target.closest('#chat-head')) touchY = e.touches[0].clientY; }, { passive: true });
  drawer.addEventListener('touchend', (e) => {
    if (touchY != null && e.changedTouches[0].clientY - touchY > 60) closeDrawer();
    touchY = null;
  });

  return { start, stop, setZone, setVisible, setMode, openWhisper, isOpen: showing };
}
