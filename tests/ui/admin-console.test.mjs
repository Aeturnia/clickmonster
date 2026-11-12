// Phase 4 admin console: navigation, deep links, responsive tables, forms, the moderation
// workflow and the zone editor. Deterministic fake backend; no live access; no native dialogs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, focusInfo, ADMIN_CHAT, ADMIN_REPORTS } from './harness.mjs';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

async function admin({ width = 1440, height = 900, who = 'admin', path = '/admin.html', wait = '.a-nav' } = {}) {
  const backend = new FakeBackend({ hero: makeHero(), chat: structuredClone(ADMIN_CHAT), reports: ADMIN_REPORTS });
  const ctx = await env.page({ backend, viewport: { width, height }, mobile: width < 900 });
  await signIn(ctx.page, env.url, who, path);
  await ctx.page.waitForSelector(wait, { timeout: 15000 });
  await ctx.page.waitForTimeout(300);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native confirm/prompt/alert');
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  await ctx.context.close();
}
const calls = (backend, action) => backend.calls.filter((c) => c.fn === 'admin' && c.action === action);
// Opens a section the way a person would: on phones, through its group first.
async function go(page, tab) {
  const sel = `[data-a="tab"][data-v="${tab}"]`;
  if (!(await page.isVisible(sel))) await page.click(`[data-a="navgroup"][data-v="${await page.getAttribute(sel, 'data-group')}"]`);
  await page.click(sel);
  await page.waitForTimeout(400);
}
async function tabUntil(page, pred, max = 80) {
  for (let i = 0; i < max; i++) { await page.keyboard.press('Tab'); const f = await focusInfo(page); if (pred(f)) return f; }
  return null;
}
const noAxe = async (page, label) => assert.deepEqual((await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`), [], label);

// ---------------------------------------------------------------- navigation

test('navigation: four labelled groups, every section listed, current one marked (desktop)', async () => {
  const ctx = await admin();
  const { page } = ctx;
  const nav = await page.evaluate(() => [...document.querySelectorAll('.a-group')].map((g) => ({
    label: document.getElementById(g.getAttribute('aria-labelledby')).textContent,
    items: [...g.querySelectorAll('[data-a="tab"]')].filter((b) => b.getClientRects().length).map((b) => b.dataset.v),
  })));
  assert.deepEqual(nav, [
    { label: 'Players and moderation', items: ['players', 'chat', 'log'] },
    { label: 'World', items: ['dashboard', 'world', 'hunts', 'economy'] },
    { label: 'Content', items: ['zones', 'announce'] },
    { label: 'Staff', items: ['staff'] },
  ]);
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'dashboard');
  assert.match(await page.textContent('[data-a="tab"][data-v="chat"]'), /2 open reports/, 'open reports count in the navigation');
  await noAxe(page, 'dashboard with sidebar');
  await done(ctx);
});

test('navigation on a phone: group switcher, current group visible, keyboard only', async () => {
  const ctx = await admin({ width: 320, height: 640 });
  const { page } = ctx;
  const vis = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => e.dataset.v), sel);
  assert.deepEqual(await vis('[data-a="navgroup"]'), ['people', 'world', 'content', 'staff']);
  assert.deepEqual(await vis('[data-a="tab"]'), ['dashboard', 'world', 'hunts', 'economy'], 'the current group (World) is open');
  const offscreen = await page.evaluate(() => [...document.querySelectorAll('.a-nav button')].filter((e) => e.getClientRects().length).filter((e) => { const r = e.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }).length);
  assert.equal(offscreen, 0, 'nothing in the navigation is off screen');
  const top = await page.evaluate(() => Math.round(document.getElementById('section-title').getBoundingClientRect().top));
  assert.ok(top <= 250, `content starts at ${top}px (before: 285)`);
  // Keyboard: open the Players group, then its Reports section.
  await page.evaluate(() => document.activeElement.blur());
  await tabUntil(page, (f) => f.a === 'navgroup' && f.v === 'people');
  await page.keyboard.press('Enter');
  assert.equal(await page.getAttribute('[data-a="navgroup"][data-v="people"]', 'aria-expanded'), 'true');
  assert.deepEqual([(await focusInfo(page)).a, (await focusInfo(page)).v], ['navgroup', 'people'], 'focus stays on the group button');
  await tabUntil(page, (f) => f.a === 'tab' && f.v === 'chat');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.report');
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'chat');
  await noAxe(page, 'phone navigation');
  await done(ctx);
});

test('navigation: a moderator sees no Staff group', async () => {
  const ctx = await admin({ who: 'mod' });
  const groups = await ctx.page.evaluate(() => [...document.querySelectorAll('.a-group')].map((g) => g.id));
  assert.deepEqual(groups, ['g-people', 'g-world', 'g-content']);
  await done(ctx);
});

test('deep links: sections, a player record and a zone have addresses; Back works', async () => {
  const ctx = await admin({ path: '/admin.html#chat', wait: '.report' });
  const { page } = ctx;
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'chat');
  await go(page, 'players');
  assert.equal(await page.evaluate(() => location.hash), '#players');
  await page.click('[data-a="open"][data-v="char-other"]');
  await page.waitForSelector('#player-title');
  assert.equal(await page.evaluate(() => location.hash), '#player/char-other');
  await page.goBack(); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => location.hash), '#players');
  assert.ok(await page.$('#q'), 'back on the search');
  await page.goBack(); await page.waitForSelector('.report');
  assert.equal(await page.getAttribute('[aria-current="page"]', 'data-v'), 'chat');
  // A record and a zone opened directly.
  await page.goto(`${env.url}/admin.html#player/char-2`); await page.waitForSelector('#player-title');
  assert.match(await page.textContent('#player-title'), /Grubnak/);
  await page.goto(`${env.url}/admin.html#zone/ashford`); await page.waitForSelector('#zone-form');
  assert.match(await page.textContent('#zs-basics-h'), /Ashford Vale/);
  await done(ctx);
});

// ---------------------------------------------------------------- tables

const TABLE_CHECK = () => {
  // A word is broken to fit when its letters land on more than one line.
  const brokenWords = (root) => {
  let n = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const re = /\S+/g; let m;
    while ((m = re.exec(t.data))) {
      range.setStart(t, m.index); range.setEnd(t, m.index + m[0].length);
      const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) n++;
    }
  }
  return n;
};
  const crushed = [...document.querySelectorAll('#admin table td')].reduce((a, td) => a + brokenWords(td), 0);
  const tables = [...document.querySelectorAll('#admin table')];
  return {
    tables: tables.length, crushed,
    allHeaded: tables.every((t) => t.tHead && [...t.tHead.querySelectorAll('th')].every((th) => th.scope === 'col')),
    labelled: [...document.querySelectorAll('#admin table.data td')].every((td) => td.dataset.label),
    clickRows: document.querySelectorAll('#admin tr.click, #admin tr[data-a]').length,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

test('tables: headers, labelled cells, no squeezed words or sideways scrolling, at every width', async () => {
  for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
    const ctx = await admin({ width: w, height: h });
    const { page } = ctx;
    for (const tab of ['players', 'log', 'hunts', 'economy', 'zones', 'staff']) {
      await go(page, tab);
      const t = await page.evaluate(TABLE_CHECK);
      assert.ok(t.tables >= 1, `${w} ${tab}: has a table`);
      assert.ok(t.allHeaded, `${w} ${tab}: column headers with scope`);
      assert.ok(t.labelled, `${w} ${tab}: cells carry their column name`);
      assert.equal(t.clickRows, 0, `${w} ${tab}: no mouse-only clickable rows`);
      assert.equal(t.crushed, 0, `${w} ${tab}: no words broken to fit`);
      assert.equal(t.hOverflow, false, `${w} ${tab}: no sideways page scroll`);
    }
    await done(ctx);
  }
});

test('tables on a phone: each row is a card showing every column with its name', async () => {
  const ctx = await admin({ width: 390, height: 844 });
  const { page } = ctx;
  await go(page, 'players');
  const card = await page.evaluate(() => {
    const row = document.querySelector('#admin table.cards tbody tr');
    const tds = [...row.children];
    return {
      cols: document.querySelectorAll('#admin table.cards thead th').length, cells: tds.length,
      display: getComputedStyle(row).display,
      labels: tds.filter((td) => !td.classList.contains('lead') && td.textContent.trim()).map((td) => getComputedStyle(td, '::before').content.replace(/"/g, '')),
    };
  });
  assert.equal(card.display, 'block', 'rows stack as cards');
  assert.equal(card.cells, card.cols, 'no column dropped');
  assert.deepEqual(card.labels, ['Race', 'Level', 'Where', 'Status', 'Last seen']);
  // The row action is a real button, reachable and usable with the keyboard.
  await page.evaluate(() => document.activeElement.blur());
  const f = await tabUntil(page, (x) => x.a === 'open');
  assert.ok(f, 'the hero name is a button in the tab order');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'player-title');
  await done(ctx);
});

// ---------------------------------------------------------------- forms

test('forms: inline validation with the message tied to the field; no request until valid', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  await go(page, 'players');
  await page.click('[data-a="open"][data-v="char-other"]'); await page.waitForSelector('#sanction');
  await page.fill('#s-reason', '');
  await page.click('#sanction [type="submit"]');
  await page.waitForSelector('#s-reason-err');
  const st = await page.evaluate(() => {
    const el = document.getElementById('s-reason');
    return { focus: document.activeElement.id, invalid: el.getAttribute('aria-invalid'), describedby: el.getAttribute('aria-describedby'), msg: document.getElementById('s-reason-err').textContent };
  });
  assert.deepEqual(st, { focus: 's-reason', invalid: 'true', describedby: 's-reason-hint s-reason-err', msg: 'Give a reason. It goes on their record.' });
  assert.equal(calls(backend, 'sanction').length, 0);
  await noAxe(page, 'form with an inline error');
  await page.keyboard.type('Spam');
  assert.equal(await page.$('#s-reason-err'), null, 'typing a valid value clears the message');
  assert.equal(await page.getAttribute('#s-reason', 'aria-invalid'), null);
  // Other forms validate too: an announcement can't be empty, a staff email must look like one.
  await go(page, 'announce');
  await page.click('#announce [type="submit"]');
  assert.equal((await focusInfo(page)).id, 'ann-text');
  assert.match(await page.textContent('#ann-text-err'), /Write the message/);
  await go(page, 'staff');
  await page.fill('#st-email', 'not-an-email');
  await page.click('#addstaff [type="submit"]');
  assert.match(await page.textContent('#st-email-err'), /email address/);
  assert.equal(calls(backend, 'announce').length + calls(backend, 'setStaff').length, 0);
  await done(ctx);
});

test('forms: pending while sending, one request at a time, server errors stay in the form with values kept', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  await go(page, 'world');
  await page.fill('#ev-name', 'Harvest Festival');
  await page.fill('#m-xp', '2');
  const release = backend.hold('startEvent');
  backend.failNext('startEvent', 400, 'An event with that name is already running.');
  await page.click('#event [type="submit"]');
  await page.waitForSelector('#event [type="submit"][aria-busy="true"]');
  await page.click('#event [type="submit"]'); // a second press while the first is pending
  await page.waitForFunction(() => /Still working/.test(document.getElementById('toast').textContent));
  assert.equal(calls(backend, 'startEvent').length, 1, 'only one request');
  release();
  await page.waitForSelector('#event-error');
  const after = await page.evaluate(() => ({
    error: document.getElementById('event-error').textContent, role: document.getElementById('event-error').getAttribute('role'),
    name: document.getElementById('ev-name').value, xp: document.getElementById('m-xp').value,
    busy: document.querySelector('#event [type="submit"]').getAttribute('aria-busy'),
  }));
  assert.deepEqual(after, { error: 'An event with that name is already running.', role: 'alert', name: 'Harvest Festival', xp: '2', busy: null });
  await done(ctx);
});

test('forms: typed values and focus survive data arriving and re-rendering the screen', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  const release = backend.hold('events');
  await page.click('[data-a="tab"][data-v="announce"]');
  await page.waitForSelector('#ann-text');
  await page.focus('#ann-text');
  await page.keyboard.type('Servers restart at noon');
  release(); // the news list arrives and the section re-renders
  await page.waitForFunction(() => !/Loading/.test(document.getElementById('news-title').parentElement.textContent));
  const st = await page.evaluate(() => ({ value: document.getElementById('ann-text').value, focus: document.activeElement.id, caret: document.activeElement.selectionStart }));
  assert.deepEqual(st, { value: 'Servers restart at noon', focus: 'ann-text', caret: 23 });
  await done(ctx);
});

// ---------------------------------------------------------------- moderation workflow

test('moderation: from a report to a sanction without leaving the report; explicit steps', async () => {
  const ctx = await admin({ who: 'mod', path: '/admin.html#chat', wait: '.report' });
  const { page, backend } = ctx;
  // Report -> message (shown in the report) -> sender (inline) -> sanction.
  const first = await page.evaluate(() => document.querySelector('.report .report-msg').textContent);
  assert.match(first, /Grubnak: Get lost, newbies/);
  await page.click('[data-a="review"][data-v="900"]');
  await page.waitForSelector('#review-900 form');
  assert.equal((await focusInfo(page)).id, 'review-900-title', 'focus moves to the review');
  assert.match(await page.textContent('#review-900'), /Review Grubnak/);
  assert.match(await page.textContent('#review-900'), /Banned/, 'current sanctions shown');
  assert.match(await page.inputValue('#sanction-r900-reason'), /Get lost, newbies.*reported: Rude to new players/, 'reason starts from the report');
  await noAxe(page, 'review panel');
  // Moderator limits are explained before anything is sent.
  await page.selectOption('#sanction-r900-kind', 'ban');
  await page.fill('#sanction-r900-days', '');
  await page.click('#sanction-r900 [type="submit"]');
  assert.match(await page.textContent('#sanction-r900-days-err'), /Only admins can sanction permanently/);
  await page.fill('#sanction-r900-days', '30');
  await page.click('#sanction-r900 [type="submit"]');
  assert.match(await page.textContent('#sanction-r900-days-err'), /up to 7 days/);
  assert.equal(calls(backend, 'sanction').length, 0);
  // A 3-day mute: confirm (Phase 3), cancel first, then apply.
  await page.selectOption('#sanction-r900-kind', 'mute');
  await page.fill('#sanction-r900-days', '3');
  await page.click('#sanction-r900 [type="submit"]');
  await page.waitForSelector('#confirm[open]');
  assert.equal(await page.textContent('#confirm-title'), 'Mute Grubnak for 3 days?');
  await page.keyboard.press('Escape');
  assert.equal(calls(backend, 'sanction').length, 0, 'cancelled: nothing sent');
  await page.click('#sanction-r900 [type="submit"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('#review-900 .status-line');
  const sent = calls(backend, 'sanction');
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].args.id, sent[0].args.kind, sent[0].args.days], ['char-2', 'mute', 3]);
  assert.match(await page.textContent('#review-900 .status-line'), /Mute applied for 3 days\. The report is still open/);
  assert.match(await page.textContent('#review-900'), /Muted/, 'the summary shows the new sanction');
  assert.equal(await page.evaluate(() => location.hash), '#chat', 'still on the reports');
  assert.equal(calls(backend, 'resolveReport').length, 0, 'the report is only dismissed when asked');
  // Dismiss it explicitly.
  await page.click('[data-a="resolveReport"][data-v="900"]');
  await page.waitForFunction(() => !document.querySelector('[data-a="review"][data-v="900"]'));
  assert.equal(calls(backend, 'resolveReport').length, 1);
  assert.match(await page.textContent('#reports-title'), /Open reports \(1\)/);
  assert.equal((await focusInfo(page)).id, 'reports-title');
  await done(ctx);
});

test('moderation: removing a reported message asks first and sends nothing when cancelled', async () => {
  const ctx = await admin({ path: '/admin.html#chat', wait: '.report' });
  const { page, backend } = ctx;
  await page.click('.report [data-a="chatDelete"][data-v="12"]');
  await page.waitForSelector('#confirm[open]');
  await page.click('#confirm [data-r="cancel"]');
  assert.equal(calls(backend, 'chatDelete').length, 0);
  await page.click('.report [data-a="chatDelete"][data-v="12"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForFunction(() => /removed by admin/.test(document.querySelector('.report').textContent));
  assert.equal(calls(backend, 'chatDelete').length, 1);
  await done(ctx);
});

// ---------------------------------------------------------------- zone editor

test('zone editor: section index, live problem summary, save points at the problems', async () => {
  const ctx = await admin({ path: '/admin.html#zone/ashford', wait: '#zone-form' });
  const { page, backend } = ctx;
  const index = await page.evaluate(() => [...document.querySelectorAll('#zone-index button')].map((b) => b.textContent.trim()));
  assert.deepEqual(index, ['Basics', 'Entry', 'Town and shop', 'Monsters', 'Boss', 'Extra paths', 'Preview']);
  await page.click('#zone-index [data-v="boss"]');
  assert.equal((await focusInfo(page)).id, 'zs-boss-h', 'the index moves focus to the section');
  assert.match(await page.textContent('#zone-save-note'), /Ready to save/);
  // Break it: monsters with an empty name.
  await page.fill('#zf-monsters-0-name', '');
  await page.waitForFunction(() => /problem/.test(document.getElementById('zone-save-note').textContent));
  const st = await page.evaluate(() => ({
    note: document.getElementById('zone-save-note').textContent, live: document.getElementById('zone-save-note').getAttribute('aria-live'),
    flagged: [...document.querySelectorAll('#zone-index button.bad')].map((b) => b.dataset.v),
    list: [...document.querySelectorAll('.zone-problems li')].map((li) => li.textContent.trim()),
  }));
  assert.match(st.note, /1 problem to fix before saving/);
  assert.equal(st.live, 'polite');
  assert.ok(st.flagged.includes('monsters') && st.flagged.includes('preview'), `index flags ${st.flagged}`);
  assert.ok(st.list.length === 1, st.list.join(' | '));
  assert.equal(await page.inputValue('#zf-monsters-0-name'), '', 'typing is never interrupted by the preview');
  await page.click('[data-a="zoneSave"]');
  assert.equal((await focusInfo(page)).id, 'zs-preview-h', 'Save takes you to the problems');
  assert.equal(calls(backend, 'saveZone').length, 0);
  await noAxe(page, 'zone editor with a problem');
  await done(ctx);
});

test('zone editor: preview is sticky beside the form on wide screens, not on phones; overworld squares are big enough', async () => {
  for (const [w, h, sticky] of [[1440, 900, true], [390, 844, false]]) {
    const ctx = await admin({ width: w, height: h, path: '/admin.html#zone/ashford', wait: '#zone-form' });
    const { page } = ctx;
    const pos = await page.evaluate(() => getComputedStyle(document.getElementById('zs-preview')).position);
    assert.equal(pos === 'sticky', sticky, `${w}: preview ${pos}`);
    if (sticky) {
      await page.evaluate(() => window.scrollTo(0, 1400)); await page.waitForTimeout(200);
      const r = await page.evaluate(() => { const b = document.getElementById('zs-preview').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; });
      assert.ok(r.top >= 0 && r.top < 40 && r.bottom <= 900, `the preview stays in view while editing (${r.top}-${r.bottom})`);
    }
    // The sticky save bar never takes more than a fifth of the screen.
    const bar = await page.evaluate(() => Math.round(document.querySelector('.zone-savebar').getBoundingClientRect().height));
    assert.ok(bar <= h / 5, `${w}: save bar ${bar}px of ${h}`);
    const ow = await page.evaluate(() => [...document.querySelectorAll('[data-owpick]')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.ok(ow.length && Math.min(...ow) >= 40, `overworld squares ${Math.min(...ow)}px (before: 43, unnamed)`);
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-owpick]')].every((b) => b.getAttribute('aria-label'))), 'each square is named');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await done(ctx);
  }
});

// ---------------------------------------------------------------- Phase 4 review corrections

const busy = (page, sel) => page.getAttribute(sel, 'aria-busy');
const toastSays = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('toast').textContent), re.source);

test('P4-01 two forms sending at once: each keeps its own pending state; a second press sends nothing', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  await go(page, 'world');
  await page.fill('#ev-name', 'Harvest Festival');
  await page.fill('#m-xp', '2');
  await page.fill('#b-xp', '1.5');
  const releaseEvent = backend.hold('startEvent');
  const releaseBase = backend.hold('setBase');
  await page.click('#event [type="submit"]');
  await page.waitForSelector('#event [type="submit"][aria-busy="true"]');
  await page.click('#base [type="submit"]');
  await page.waitForSelector('#base [type="submit"][aria-busy="true"]');
  // The event request finishes while Base settings is still sending.
  releaseEvent();
  await page.waitForSelector('#event [type="submit"]:not([aria-busy])');
  assert.equal(await busy(page, '#base [type="submit"]'), 'true', 'Base settings is still pending after the event finished');
  assert.equal(await page.inputValue('#b-xp'), '1.5', 'typed values kept');
  await page.click('#base [type="submit"]');
  await toastSays(page, /Still working/);
  assert.equal(calls(backend, 'setBase').length, 1, 'the second press sent nothing');
  releaseBase();
  await page.waitForSelector('#base [type="submit"]:not([aria-busy])');
  await settle(page);
  assert.deepEqual([calls(backend, 'startEvent').length, calls(backend, 'setBase').length], [1, 1]);
  await done(ctx);
});

test('P4-01 a press while a confirmed form is sending opens no second confirmation', async () => {
  const ctx = await admin();
  const { page, backend } = ctx;
  await go(page, 'hunts');
  await page.fill('#h-name', 'The Ashen Colossus');
  const release = backend.hold('startHunt');
  await page.click('#hunt [type="submit"]');
  await page.click('#confirm [data-r="ok"]');
  await page.waitForSelector('#hunt [type="submit"][aria-busy="true"]');
  await page.click('#hunt [type="submit"]');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => !!document.getElementById('confirm')?.open), false, 'no second dialog');
  await toastSays(page, /Still working/);
  release();
  await page.waitForSelector('#hunt [type="submit"]:not([aria-busy])');
  assert.equal(calls(backend, 'startHunt').length, 1);
  await done(ctx);
});

test('P4-01 zone save: pending survives re-renders and repeated presses send one request', async () => {
  const ctx = await admin({ path: '/admin.html#zone/ashford', wait: '#zone-form' });
  const { page, backend } = ctx;
  const release = backend.hold('saveZone');
  await page.click('[data-a="zoneSave"]');
  await page.waitForSelector('[data-a="zoneSave"][aria-busy="true"]');
  // Anything that re-renders the editor meanwhile (here: adding a path) must keep Save pending.
  await page.click('[data-a="zoneAddPortal"]');
  await page.waitForSelector('[data-f="portals.0.label"]');
  assert.match(await page.textContent('#zone-save-note'), /Ready to save/, 'the draft is still valid');
  assert.equal(await busy(page, '[data-a="zoneSave"]'), 'true', 'Save is still pending after a re-render');
  await page.click('[data-a="zoneSave"]');
  await page.click('[data-a="zoneSave"]');
  await toastSays(page, /Still working/);
  assert.equal(calls(backend, 'saveZone').length, 1, 'repeated presses sent nothing');
  release();
  await page.waitForSelector('#zone-form', { state: 'detached' });
  await settle(page);
  assert.equal(calls(backend, 'saveZone').length, 1);
  await done(ctx);
});

test('P4-01 zone save failure: pending clears, the problem shows, focus and the draft stay', async () => {
  const ctx = await admin({ path: '/admin.html#zone/ashford', wait: '#zone-form' });
  const { page, backend } = ctx;
  await page.fill('#zf-name', 'Ashford Downs');
  const release = backend.hold('saveZone');
  backend.failNext('saveZone', 400, 'That zone was changed by someone else.');
  await page.focus('[data-a="zoneSave"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-a="zoneSave"][aria-busy="true"]');
  release();
  await page.waitForFunction(() => /changed by someone else/.test(document.getElementById('alerts').textContent));
  const st = await page.evaluate(() => ({
    busy: document.querySelector('[data-a="zoneSave"]').getAttribute('aria-busy'),
    pending: document.querySelector('[data-a="zoneSave"]').classList.contains('pending'),
    focus: document.activeElement.dataset.a, name: document.getElementById('zf-name').value,
  }));
  assert.deepEqual(st, { busy: null, pending: false, focus: 'zoneSave', name: 'Ashford Downs' });
  // And it can be saved again.
  await page.click('[data-a="zoneSave"]');
  await page.waitForSelector('#zone-form', { state: 'detached' });
  assert.equal(calls(backend, 'saveZone').length, 2);
  await done(ctx);
});

test('P4-02 granting admin: the email must be typed; Cancel sends nothing; confirming sends one request', async () => {
  const ctx = await admin({ path: '/admin.html#staff', wait: '#addstaff' });
  const { page, backend } = ctx;
  await page.fill('#st-email', 'new.admin@example.test');
  await page.selectOption('#st-role', 'admin');
  await page.click('#addstaff [type="submit"]');
  await page.waitForSelector('#confirm[open]');
  const dlg = await page.evaluate(() => ({
    title: document.getElementById('confirm-title').textContent, tone: document.getElementById('confirm').dataset.tone,
    body: document.getElementById('confirm-body').textContent, ok: document.querySelector('#confirm [data-r="ok"]').textContent,
    disabled: document.querySelector('#confirm [data-r="ok"]').disabled, focus: document.activeElement.id,
  }));
  assert.equal(dlg.title, 'Make new.admin@example.test an admin?');
  assert.equal(dlg.tone, 'danger');
  assert.match(dlg.body, /Admins can do everything a moderator can/);
  assert.match(dlg.body, /add or remove staff/);
  assert.match(dlg.body, /audit log/);
  assert.equal(dlg.ok, 'Make admin');
  assert.equal(dlg.disabled, true, 'confirm stays disabled until the email is typed');
  assert.equal(dlg.focus, 'confirm-input');
  await noAxe(page, 'grant admin confirmation');
  await page.click('#confirm [data-r="cancel"]');
  await page.waitForSelector('#confirm:not([open])', { state: 'attached' });
  assert.equal(calls(backend, 'setStaff').length, 0, 'Cancel sends nothing');
  assert.deepEqual([await page.inputValue('#st-email'), await page.inputValue('#st-role')], ['new.admin@example.test', 'admin'], 'values kept');
  assert.equal(await page.evaluate(() => document.activeElement.matches('#addstaff [type="submit"]')), true, 'focus back on Add');
  // Confirm: a wrong email keeps the button disabled; the right one (any case) enables it.
  await page.click('#addstaff [type="submit"]');
  await page.fill('#confirm-input', 'new.admin@example.tes');
  assert.equal(await page.isDisabled('#confirm [data-r="ok"]'), true);
  await page.fill('#confirm-input', 'New.Admin@example.test');
  await page.click('#confirm [data-r="ok"]');
  await toastSays(page, /Added/);
  await settle(page);
  assert.deepEqual(calls(backend, 'setStaff').map((c) => c.args), [{ email: 'new.admin@example.test', role: 'admin' }], 'exactly one request');
  await done(ctx);
});

test('P4-02 granting moderator: a normal confirmation stating the permissions; one request', async () => {
  const ctx = await admin({ path: '/admin.html#staff', wait: '#addstaff' });
  const { page, backend } = ctx;
  await page.fill('#st-email', 'new.mod@example.test');
  await page.click('#addstaff [type="submit"]');
  await page.waitForSelector('#confirm[open]');
  const dlg = await page.evaluate(() => ({
    title: document.getElementById('confirm-title').textContent, tone: document.getElementById('confirm').dataset.tone,
    body: document.getElementById('confirm-body').textContent, input: !!document.getElementById('confirm-input'),
    focus: document.activeElement.dataset.r,
  }));
  assert.equal(dlg.title, 'Make new.mod@example.test a moderator?');
  assert.deepEqual([dlg.tone, dlg.input, dlg.focus], ['normal', false, 'ok']);
  assert.match(dlg.body, /Moderators can look up players/);
  assert.match(dlg.body, /up to 7 days/);
  await noAxe(page, 'grant moderator confirmation');
  await page.click('#confirm [data-r="cancel"]');
  assert.equal(calls(backend, 'setStaff').length, 0, 'Cancel sends nothing');
  await page.click('#addstaff [type="submit"]');
  await page.click('#confirm [data-r="ok"]');
  await toastSays(page, /Added/);
  await settle(page);
  assert.deepEqual(calls(backend, 'setStaff').map((c) => c.args), [{ email: 'new.mod@example.test', role: 'moderator' }]);
  await done(ctx);
});

test('P4-02 changing the role of existing staff says which way it changes', async () => {
  const ctx = await admin({ path: '/admin.html#staff', wait: '#addstaff' });
  const { page, backend } = ctx;
  await page.waitForSelector('[data-a="removeStaff"]');
  await page.fill('#st-email', 'mod@example.test');
  await page.selectOption('#st-role', 'admin');
  await page.click('#addstaff [type="submit"]');
  assert.equal(await page.textContent('#confirm-title'), 'Change mod@example.test from moderator to admin?');
  await page.click('#confirm [data-r="cancel"]');
  await page.fill('#st-email', 'admin@example.test');
  await page.selectOption('#st-role', 'moderator');
  await page.click('#addstaff [type="submit"]');
  assert.equal(await page.textContent('#confirm-title'), 'Change admin@example.test from admin to moderator?');
  assert.match(await page.textContent('#confirm-body'), /They lose their admin powers/);
  await page.click('#confirm [data-r="cancel"]');
  assert.equal(calls(backend, 'setStaff').length, 0);
  await done(ctx);
});
