// Slide-up chat drawer: a slim bar above the controls on every screen, and a drawer with
// Global, Zone and Whisper tabs. Messages arrive live through Supabase Realtime; sending goes
// through the game server, which enforces mutes, level, speed limits and link blocking.
import { CHAT_LEVEL, CHAT_MAX_LEN, cleanChatText } from './engine/chat.js';

const TABS = [['global', 'Global'], ['zone', 'Zone'], ['whisper', 'Whispers']];
const KEEP = 120;

export function setupChat({ sb, api, getChar, toast, esc, zoneName }) {
  const st = {
    started: false, visible: false, open: false, tab: 'global',
    msgs: { global: [], zone: [], whisper: [] }, unread: { global: 0, zone: 0, whisper: 0 },
    myId: null, zone: null, role: null, ignores: new Map(), whisperTo: '', menuFor: null, channel: null,
  };
  const bar = document.getElementById('chatbar');
  const drawer = document.getElementById('chat');

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
    if (countUnread && !mine && !ignored(m) && !(st.open && st.tab === channel)) st.unread[channel] += 1;
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

  // ------------------------------------------------------------ rendering
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
    const body = m.deleted_at ? '<span class="faint">[message removed]</span>' : esc(m.text);
    const menu = st.menuFor === m.id ? `<span class="chat-menu">
        ${!mine ? `<button data-c="whisper" data-v="${esc(m.channel === 'whisper' && mine ? m.recipient_name : m.sender_name)}">Whisper</button>` : ''}
        ${!mine ? `<button data-c="ignore" data-v="${esc(m.sender_name)}">Ignore</button>` : ''}
        ${!mine && !m.deleted_at ? `<button data-c="report" data-v="${m.id}">Report</button>` : ''}
        ${st.role && !m.deleted_at ? `<button data-c="delete" data-v="${m.id}" class="bad">Remove</button>` : ''}
      </span>` : '';
    return `<p class="chat-line ${m.channel === 'whisper' ? 'whisper' : ''}" data-c="menu" data-v="${m.id}"><span class="t">${time(m.created_at)}</span> ${who}: ${body}${menu}</p>`;
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
    if (!st.visible || !st.started) { bar.innerHTML = ''; return; }
    const unread = TABS.filter(([k]) => st.unread[k]).map(([k, l]) => `${l} ${st.unread[k]}`).join(', ');
    bar.innerHTML = `<button class="chatbar" data-c="toggle" aria-label="Open chat">
      <span class="chatbar-text">${latestLine()}</span>${unread ? `<span class="chatbar-unread">${unread}</span>` : ''}</button>`;
  }

  function tabsHtml() {
    return TABS.map(([k, l]) => `<button data-c="tab" data-v="${k}" class="${st.tab === k ? 'on' : ''}">${l}${st.unread[k] ? ` <span class="count">${st.unread[k]}</span>` : ''}</button>`).join('');
  }

  function listHtml() {
    const isWhisper = st.tab === 'whisper';
    const ignoreList = isWhisper && st.ignores.size ? `<p class="small muted chat-ign">Ignored: ${[...st.ignores.values()].map((n) =>
      `${esc(n)} <button class="textbtn" data-c="unignore" data-v="${esc(n)}">unignore</button>`).join(', ')}</p>` : '';
    const empty = st.tab === 'zone' ? `No messages in ${esc(zoneName(st.zone))} yet.` : isWhisper ? 'No whispers yet. Tap a name to whisper.' : 'No messages yet.';
    return ignoreList + (st.msgs[st.tab].map(lineHtml).join('') || `<p class="empty">${empty}</p>`);
  }

  function paintDrawer() {
    if (!st.open || !st.visible) { drawer.innerHTML = ''; drawer.className = ''; return; }
    // Same tab already showing: refresh the list and tabs only, so typing isn't interrupted.
    const panel = drawer.querySelector('.chat-panel');
    if (panel && panel.dataset.tab === st.tab) {
      const el = drawer.querySelector('#chat-list');
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      el.innerHTML = listHtml();
      drawer.querySelector('.chat-tabs').innerHTML = tabsHtml();
      if (atBottom) el.scrollTop = el.scrollHeight;
      return;
    }
    const char = getChar();
    const canChat = char && char.level >= CHAT_LEVEL;
    const isWhisper = st.tab === 'whisper';
    const existing = drawer.querySelector('#chat-input');
    const keep = existing ? existing.value : '';
    // Default the whisper target to whoever whispered you last.
    const lastFrom = [...st.msgs.whisper].reverse().find((m) => m.sender_id && m.sender_id !== st.myId);
    const keepTo = drawer.querySelector('#chat-to')?.value || st.whisperTo || lastFrom?.sender_name || '';
    drawer.className = 'open';
    drawer.innerHTML = `<div class="chat-panel" data-tab="${st.tab}">
      <div class="chat-head" id="chat-head">
        <div class="chat-tabs">${tabsHtml()}</div>
        <button class="textbtn" data-c="toggle">Close</button>
      </div>
      <div class="chat-list" id="chat-list">${listHtml()}</div>
      <form class="chat-form" id="chat-form">
        ${isWhisper ? `<input id="chat-to" class="chat-to" placeholder="To" maxlength="18" autocomplete="off" value="${esc(keepTo)}">` : ''}
        <input id="chat-input" maxlength="${CHAT_MAX_LEN}" autocomplete="off" enterkeyhint="send" ${canChat ? '' : 'disabled'}
          placeholder="${canChat ? (st.tab === 'zone' ? `Say to ${esc(zoneName(st.zone))}` : isWhisper ? 'Whisper' : 'Say to everyone') : `Reach level ${CHAT_LEVEL} to chat`}" value="${esc(keep)}">
        <button class="btn primary sm" type="submit" ${canChat ? '' : 'disabled'}>Send</button>
      </form>
    </div>`;
    const el = drawer.querySelector('#chat-list');
    el.scrollTop = el.scrollHeight;
  }

  function paint() {
    paintBar();
    if (st.open) {
      st.unread[st.tab] = 0;
      paintDrawer();
      paintBar();
    }
  }

  function setVisible(v) {
    if (st.visible === v) return;
    st.visible = v;
    if (!v) st.open = false;
    paint();
  }

  function openWhisper(name) {
    st.open = true;
    st.tab = 'whisper';
    st.whisperTo = name;
    drawer.innerHTML = '';
    paint();
    drawer.querySelector('#chat-input')?.focus();
  }

  // ------------------------------------------------------------ events
  async function send() {
    const input = drawer.querySelector('#chat-input');
    const text = input?.value || '';
    const clean = cleanChatText(text);
    if (!clean.ok) { toast(clean.reason, 'bad'); return; }
    const args = { channel: st.tab, text: clean.text };
    if (st.tab === 'whisper') {
      args.to = (drawer.querySelector('#chat-to')?.value || '').trim();
      if (!args.to) { toast('Who should get this whisper?', 'bad'); return; }
      st.whisperTo = args.to;
    }
    input.value = '';
    try {
      await api('chat', args);
    } catch (err) {
      input.value = text;
      toast(err.message, 'bad');
    }
  }

  async function onAction(c, v) {
    switch (c) {
      case 'toggle': st.open = !st.open; st.menuFor = null; drawer.innerHTML = ''; paint(); return;
      case 'tab': st.tab = v; st.menuFor = null; drawer.innerHTML = ''; paint(); return;
      case 'menu': st.menuFor = st.menuFor === Number(v) ? null : Number(v); paintDrawer(); return;
      case 'whisper': openWhisper(v); return;
      case 'ignore':
        if (!confirm(`Ignore ${v}? You won't see their messages or whispers.`)) return;
        try { await api('ignore', { name: v }); await loadMeta(); toast(`Ignoring ${v}.`); } catch (err) { toast(err.message, 'bad'); }
        st.menuFor = null; paint(); return;
      case 'unignore':
        try { await api('unignore', { name: v }); await loadMeta(); toast(`No longer ignoring ${v}.`); } catch (err) { toast(err.message, 'bad'); }
        paint(); return;
      case 'report': {
        const reason = prompt('Why are you reporting this message? (optional)');
        if (reason === null) return;
        try { await api('report', { messageId: v, reason }); toast('Thanks. A moderator will take a look.'); } catch (err) { toast(err.message, 'bad'); }
        st.menuFor = null; paint(); return;
      }
      case 'delete':
        if (!confirm('Remove this message for everyone?')) return;
        try { await api('modDelete', { messageId: v }); toast('Removed.'); } catch (err) { toast(err.message, 'bad'); }
        st.menuFor = null; paint(); return;
      default:
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-c]');
    if (!el || !(bar.contains(el) || drawer.contains(el))) return;
    e.preventDefault();
    onAction(el.dataset.c, el.dataset.v);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'chat-form') return;
    e.preventDefault();
    send();
  });
  // Swipe the header down to close.
  let touchY = null;
  drawer.addEventListener('touchstart', (e) => { if (e.target.closest('#chat-head')) touchY = e.touches[0].clientY; }, { passive: true });
  drawer.addEventListener('touchend', (e) => {
    if (touchY != null && e.changedTouches[0].clientY - touchY > 60) { st.open = false; drawer.innerHTML = ''; paint(); }
    touchY = null;
  });

  return { start, stop, setZone, setVisible, openWhisper, isOpen: () => st.open };
}
