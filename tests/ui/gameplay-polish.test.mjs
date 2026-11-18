// Gameplay polish GP-1 (docs/gameplay-polish-scope.md, section 8): the XP cue plays once (A), the
// numbers sit on the bars (B), only the current round shows (C), the outcome is shown once (D),
// a mastery gain stays with its round (E), and the monster drop-down and the town rule (F).
// Run with: npm run test:ui. Deterministic fixtures only, on the fake backend.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, fixedQuest, townLairZone } from './harness.mjs';
import { maxHp, xpToNext } from '../../public/js/engine/character.js';
import { TOWN_NO_MONSTERS } from '../../public/js/engine/world.js';

let env;
before(async () => { env = await setup(); });
after(async () => { await env?.close(); });

// One step north of Bramblebrook's village (5, 5), where its monsters roam.
const OUT = { y: 4 };

async function game({ hero = {}, edit, players = [], zones = [], activeHunts = [], viewport = { width: 390, height: 844 }, mobile, reducedMotion, textScale, clock } = {}) {
  const h = makeHero({ ...OUT, ...hero });
  if (edit) edit(h);
  const backend = new FakeBackend({ hero: h, players, zones, activeHunts, quests: [fixedQuest()] });
  const ctx = await env.page({ backend, viewport, mobile: mobile ?? viewport.width < 900, reducedMotion });
  if (textScale) await ctx.page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s; }), textScale);
  if (clock) await ctx.page.clock.install();
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"], #log', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
async function done(ctx) {
  assert.deepEqual(ctx.page.nativeDialogs, [], 'no native confirm/prompt/alert');
  assert.deepEqual(ctx.backend.unexpected, [], 'no request may leave the fake backend');
  assert.deepEqual(ctx.page.errors, [], 'no page errors');
  await ctx.context.close();
}
const calls = (backend, action) => backend.calls.filter((c) => c.action === action);
const tap = async (page, sel) => { await page.waitForTimeout(270); await page.click(sel); await settle(page); };
const monsterId = (page, name) => page.evaluate((n) => Object.values(window.clickmonster.MONSTERS).find((m) => m.name === n)?.id, name);
// Choose a monster in the drop-down and press Fight.
async function fightNamed(page, name) {
  await page.selectOption('#mon-select', await monsterId(page, name));
  await page.click('#main [data-a="fight"]'); await settle(page);
  await page.waitForTimeout(270);
}
async function finish(page, max = 60) {
  for (let i = 0; i < max && await page.$('[data-a="melee"]'); i++) await tap(page, '[data-a="melee"]');
}
const battle = (page) => page.evaluate(() => window.clickmonster.char.battle);
// What the battle log shows: the current round, and the collapsed groups.
const logView = (page) => page.evaluate(() => {
  const cur = document.querySelector('#log .turn.current');
  const group = (g) => {
    const d = document.querySelector(`#log details[data-g="${g}"]`);
    return d && { open: d.open, summary: d.querySelector('summary').textContent.trim(), turns: [...d.querySelectorAll('.turn-label')].map((t) => t.textContent), lines: [...d.querySelectorAll('p:not(.turn-label):not(.turn-gain)')].map((p) => p.textContent) };
  };
  return {
    currentLabel: cur?.querySelector('.turn-label')?.textContent || null,
    current: cur ? [...cur.querySelectorAll('p:not(.turn-label):not(.turn-gain)')].map((p) => p.textContent) : [],
    currentGain: cur?.querySelector('.turn-gain')?.textContent || null,
    visibleTurns: [...document.querySelectorAll('#log .turn')].filter((t) => t.checkVisibility()).length,
    earlier: group('earlier'), before: group('before'),
    wait: document.querySelector('#log .turn-wait')?.textContent || null,
    card: [...document.querySelectorAll('.outcome .rewards li')].map((l) => l.textContent),
  };
});

// ---------------------------------------------------------------- A. the XP cue plays once

test('GP-A1 after an XP gain, regeneration ticks leave the XP meter in place, and its cue starts once', async () => {
  const ctx = await game({ edit: (h) => { h.hp = Math.floor(maxHp(h) * 0.5); } });
  const { page } = ctx;
  await page.evaluate(() => {
    window.__anims = [];
    document.addEventListener('animationstart', (e) => { if (e.target.closest('#top .meter.xp')) window.__anims.push(e.animationName); }, true);
  });
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  assert.equal((await battle(page)).over, 'victory');
  const xpMeter = await page.$('#top .meter.xp');
  const hp = await page.evaluate(() => window.clickmonster.char.hp);
  // Regeneration: 1% of max HP every 3 seconds, drawn by the one-second tick.
  await page.waitForFunction((h) => window.clickmonster.char.hp > h, hp, { timeout: 8000 });
  await page.waitForTimeout(300);
  assert.equal(await xpMeter.evaluate((el) => el.isConnected), true, 'the XP meter was not recreated by the HP change');
  const anims = await page.evaluate(() => window.__anims);
  assert.deepEqual(anims.filter((a) => a === 'xp-glow'), ['xp-glow'], `the glow started once: ${anims.join(', ')}`);
  assert.deepEqual(anims.filter((a) => a === 'delta'), ['delta'], `the +XP chip started once: ${anims.join(', ')}`);
  await done(ctx);
});

test('GP-A2 a regeneration tick updates the hero bar HP and the Heal price together; at full HP Heal is off', async () => {
  const ctx = await game({ hero: { y: 5 }, edit: (h) => { const m = maxHp(h); h.hp = m - 2 * Math.ceil(m * 0.01); } });
  const { page } = ctx;
  const read = () => page.evaluate(() => ({
    hp: window.clickmonster.char.hp,
    bar: document.querySelector('#top .meter:not(.xp) .meter-num .sr-only')?.textContent,
    heal: document.querySelector('#dock [data-a="heal"]')?.textContent.replace(/\s+/g, ' ').trim(),
    healOff: document.querySelector('#dock [data-a="heal"]')?.disabled,
  }));
  const max = await page.evaluate(() => document.querySelector('#top .meter:not(.xp) .meter-num .sr-only').textContent.split(' of ')[1]);
  const first = await read();
  await page.waitForFunction((h) => window.clickmonster.char.hp > h, first.hp, { timeout: 8000 });
  await page.waitForTimeout(200);
  const mid = await read();
  const fmt = (n) => n.toLocaleString('en-US');
  assert.equal(mid.bar, `${fmt(mid.hp)} of ${max}`, 'the bar shows the new HP');
  const maxN = Number(max.replace(/,/g, ''));
  if (mid.hp < maxN) {
    assert.match(mid.heal, new RegExp(`Heal ${Math.ceil((maxN - mid.hp) * 0.15)} gold`), 'the Heal price follows the same tick');
    await page.waitForFunction((m) => window.clickmonster.char.hp >= m, maxN, { timeout: 8000 });
    await page.waitForTimeout(200);
  }
  const full = await read();
  assert.equal(full.bar, `${max} of ${max}`);
  assert.equal(full.heal, 'Heal Full health');
  assert.equal(full.healOff, true);
  await done(ctx);
});

// ---------------------------------------------------------------- B. numbers on the bars

// A hero with seven-digit HP and XP.
const BIG = (h) => {
  h.level = 60;
  h.stats.vit = 250000;
  h.hp = maxHp(h) - 1234;
  h.xp = 1234567;
};
// No meter's content overflows it, nothing in it is cut off, and no label or number wraps onto a
// second line (screen-reader text aside). The old meters wrapped their numbers at 320px.
const meterFit = () => [...document.querySelectorAll('.meter')].filter((m) => m.getClientRects().length).map((m) => {
  const r = m.getBoundingClientRect();
  const walker = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  const wrapped = [];
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim() || t.parentElement.closest('.sr-only') || !t.parentElement.checkVisibility()) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    if (new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size > 1) wrapped.push(t.textContent.trim());
  }
  const cut = [...m.querySelectorAll('*')].filter((el) => !el.closest('.sr-only') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1).map((el) => el.className);
  const out = [...m.querySelectorAll('*')].filter((el) => !el.closest('.sr-only') && el.getClientRects().length).some((el) => { const b = el.getBoundingClientRect(); return b.left < r.left - 1 || b.right > r.right + 1; });
  return { meter: m.className, overflow: m.scrollWidth > m.clientWidth + 1, cut, out, wrapped };
}).filter((x) => x.overflow || x.cut.length || x.out || x.wrapped.length);

for (const [w, h] of [[320, 640], [390, 844], [1024, 768], [1440, 900]]) {
  test(`GP-B1 at ${w}px, seven-digit HP and XP fit on the bars, in the hero bar and in a battle`, async () => {
    const ctx = await game({ edit: BIG, viewport: { width: w, height: h } });
    const { page } = ctx;
    assert.deepEqual(await page.evaluate(meterFit), [], 'explore');
    await fightNamed(page, 'Wisp Swarm');
    assert.deepEqual(await page.evaluate(meterFit), [], 'battle');
    await done(ctx);
  });
}

for (const w of [320, 390]) {
  test(`GP-B2 at ${w}px with 200% text, the bars still fit`, async () => {
    const ctx = await game({ edit: BIG, viewport: { width: w, height: 844 }, textScale: '200%' });
    const { page } = ctx;
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
    assert.deepEqual(await page.evaluate(meterFit), [], 'explore');
    await fightNamed(page, 'Wisp Swarm');
    assert.deepEqual(await page.evaluate(meterFit), [], 'battle');
    await done(ctx);
  });
}

test('GP-B3 the numbers are at least 4.5:1 against the fill and against the empty track, for HP, XP and the foe', async () => {
  const ctx = await game({ edit: (h) => { h.hp = Math.floor(maxHp(h) / 2); } });
  const { page } = ctx;
  await fightNamed(page, 'Bog Hag');
  const pairs = await page.evaluate(() => {
    const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const out = [];
    for (const [name, sel] of [['hp', '#top .meter:not(.xp)'], ['xp', '#top .meter.xp'], ['foe', '.side.foe .meter']]) {
      const m = document.querySelector(sel);
      const text = rgb(getComputedStyle(m.querySelector('.meter-text')).color);
      const fill = rgb(getComputedStyle(m.querySelector('.meter-track i')).backgroundColor);
      const track = rgb(getComputedStyle(m.querySelector('.meter-track')).backgroundColor);
      out.push({ name, fill: +ratio(text, fill).toFixed(2), track: +ratio(text, track).toFixed(2) });
    }
    return out;
  });
  for (const p of pairs) {
    assert.ok(p.fill >= 4.5, `${p.name} on its fill: ${p.fill}`);
    assert.ok(p.track >= 4.5, `${p.name} on the track: ${p.track}`);
  }
  await done(ctx);
});

test('GP-B4 when a bar shows the short numbers, screen readers still get the full ones', async () => {
  const ctx = await game({ edit: BIG, viewport: { width: 320, height: 640 } });
  const { page } = ctx;
  const xp = await page.evaluate(() => {
    const m = document.querySelector('#top .meter.xp');
    const shown = (sel) => getComputedStyle(m.querySelector(sel)).display !== 'none';
    return { compact: m.classList.contains('compact'), short: shown('.n-short'), full: shown('.n-full'), sr: m.querySelector('.sr-only').textContent, hidden: [...m.querySelectorAll('.n-full, .n-short')].every((el) => el.getAttribute('aria-hidden') === 'true') };
  });
  assert.equal(xp.compact, true, 'the full numbers do not fit at 320px');
  assert.equal(xp.short, true);
  assert.equal(xp.full, false);
  assert.match(xp.sr, /^1,234,567 of /);
  assert.equal(xp.hidden, true, 'the visible forms are not read out twice');
  await done(ctx);
});

test('GP-B5 reduced motion: no animation on the XP bar or the gain chips', async () => {
  const ctx = await game({ reducedMotion: 'reduce' });
  const { page } = ctx;
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  const s = await page.evaluate(() => ({
    chip: [...document.querySelectorAll('#top .delta')].map((d) => getComputedStyle(d).animationName),
    glow: document.querySelector('#top .meter.xp.gain .meter-track') && getComputedStyle(document.querySelector('#top .meter.xp.gain .meter-track')).animationName,
    width: getComputedStyle(document.querySelector('#top .meter-track i')).transitionDuration,
  }));
  assert.ok(s.chip.length, 'the gain chips are shown');
  assert.ok(s.chip.every((a) => a === 'none'), s.chip.join(', '));
  assert.equal(s.glow, 'none');
  await done(ctx);
});

// ---------------------------------------------------------------- C. only the current round

test('GP-C1 during a fight only the current round shows; earlier rounds are collapsed and counted', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Wisp Swarm');
  for (let i = 0; i < 3; i++) await tap(page, '[data-a="melee"]');
  const v = await logView(page);
  assert.equal(v.currentLabel, 'Turn 3');
  assert.equal(v.visibleTurns, 1, 'one round visible');
  assert.equal(v.earlier.open, false, 'collapsed by default');
  assert.equal(v.earlier.summary, 'Earlier rounds (2)');
  assert.deepEqual(v.earlier.turns, ['Turn 1', 'Turn 2']);
  assert.match(v.earlier.lines[0], /^You face /, 'the opening line is part of the first round');
  assert.equal(v.before, null);
  assert.deepEqual(await axe(page, { minImpact: 'minor' }), []);
  await done(ctx);
});

test('GP-C2 opening Earlier rounds survives redraws and the next action; a new fight starts it closed', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Wisp Swarm');
  for (let i = 0; i < 2; i++) await tap(page, '[data-a="melee"]');
  await page.click('#log-earlier');
  assert.equal((await logView(page)).earlier.open, true);
  await page.waitForTimeout(1100); // a tick of the one-second timer
  await tap(page, '[data-a="melee"]');
  let v = await logView(page);
  assert.equal(v.earlier.open, true, 'still open after the next action');
  assert.equal(v.earlier.summary, 'Earlier rounds (2)');
  await tap(page, '[data-a="flee"]');
  for (let i = 0; i < 20 && await page.$('[data-a="flee"]'); i++) await tap(page, '[data-a="flee"]');
  await tap(page, '[data-a="done"]');
  await fightNamed(page, 'Wisp Swarm');
  for (let i = 0; i < 2; i++) await tap(page, '[data-a="melee"]');
  v = await logView(page);
  assert.equal(v.earlier.open, false, 'a new fight starts closed');
  await done(ctx);
});

test('GP-C3 the stored log is unchanged: every line is still there after the fight', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  const b = await battle(page);
  assert.equal(b.over, 'victory');
  assert.ok(b.log.some((l) => /^You gain \d+ experience\.$/.test(l.text)), 'the reward lines are kept in the data');
  assert.ok(b.log.some((l) => / dropped \d+ gold\.$/.test(l.text)));
  const server = ctx.backend.heroes[Object.keys(ctx.backend.heroes)[0]].battle.log.map((l) => l.text);
  assert.deepEqual(b.log.map((l) => l.text), server, 'the page holds the server log as sent');
  await done(ctx);
});

test('GP-C4 after a reload mid-fight: the lines already there are ungrouped, counted as lines, and new rounds follow', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Wisp Swarm');
  for (let i = 0; i < 2; i++) await tap(page, '[data-a="melee"]');
  const n = (await battle(page)).log.length;
  await page.reload();
  await page.waitForSelector('#log'); await settle(page);
  let v = await logView(page);
  assert.equal(v.before.summary, `Before this page loaded (${n} lines)`);
  assert.deepEqual(v.before.turns, [], 'no round labels for lines whose rounds are not known');
  assert.equal(v.before.lines.length, n);
  assert.equal(v.earlier, null);
  assert.equal(v.currentLabel, null);
  assert.equal(v.wait, 'Fight in progress, turn 2.');
  await tap(page, '[data-a="melee"]');
  v = await logView(page);
  assert.equal(v.before.summary, `Before this page loaded (${n} lines)`, 'unchanged');
  assert.equal(v.currentLabel, 'Turn 3');
  assert.equal(v.wait, null);
  assert.equal(v.earlier, null, 'no earlier rounds are invented');
  await done(ctx);
});

// ---------------------------------------------------------------- D. the outcome once

test('GP-D1 after a victory the rewards are only in the card; the narrative line stays in the round', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  const b = await battle(page);
  const v = await logView(page);
  assert.ok(v.current.some((t) => /has been slain!$/.test(t)), v.current.join(' | '));
  assert.ok(!v.current.some((t) => /^You gain \d+ experience|dropped \d+ gold|mastery is now|^You reached level|^You found a /.test(t)), v.current.join(' | '));
  assert.ok(v.card.includes(`+${b.rewards.xp} XP`) && v.card.includes(`+${b.rewards.gold} gold`), v.card.join(' | '));
  await done(ctx);
});

// A hero on 5 HP loses the next fight.
const FRAIL = (h) => { h.hp = 5; h.lastTick = Date.now() + 3600000; };

test('GP-D2 after a defeat the losses are only in the card; "You have been defeated by" stays', async () => {
  const ctx = await game({ hero: { gold: 4321 }, edit: FRAIL });
  const { page } = ctx;
  await fightNamed(page, 'Wisp Swarm');
  await finish(page, 80);
  assert.equal((await battle(page)).over, 'defeat');
  const v = await logView(page);
  assert.ok(v.current.some((t) => /^You have been defeated by /.test(t)), v.current.join(' | '));
  assert.ok(!v.current.some((t) => /^You wake up in town/.test(t)), v.current.join(' | '));
  const card = await page.evaluate(() => [...document.querySelectorAll('.outcome .losses li')].map((l) => l.textContent));
  assert.ok(card.includes('Lost 4,321 gold') && card.includes('Back in town'), card.join(' | '));
  await done(ctx);
});

const MUSA = { id: 'char-other', name: 'Musa', race: 'human', level: 33, zone: 'duskhollow', x: 2, y: 2, updated_at: new Date().toISOString() };
for (const win of [true, false]) {
  test(`GP-D2 a duel ${win ? 'won' : 'lost'}: the gold line is only in the card; the narrative line stays`, async () => {
    const opponent = win ? { ...MUSA, level: 30, gold: 900 } : { ...MUSA, level: 40, stats: { str: 900, dex: 900, int: 900, wis: 900, vit: 900 } };
    const ctx = await game({ hero: { level: 35, zone: 'duskhollow', x: 2, y: 2, gold: 4321 }, edit: win ? (h) => { Object.assign(h.stats, { str: 900, dex: 900, int: 900, wis: 900, vit: 900 }); h.hp = maxHp(h); } : null, players: [opponent] });
    const { page } = ctx;
    await tap(page, '[data-a="list"][data-v="players"]');
    await page.waitForSelector('[data-a="attack"]');
    await page.click('[data-a="attack"]');
    await page.click('#confirm [data-r="ok"]'); await settle(page);
    await page.waitForSelector('.outcome');
    assert.equal((await battle(page)).over, win ? 'victory' : 'defeat');
    const v = await logView(page);
    if (win) {
      assert.ok(v.current.includes('Victory! Musa has been defeated!'), v.current.join(' | '));
      assert.ok(!v.current.some((t) => /^You take \d+ gold/.test(t)));
      assert.ok(v.card.includes('You take 900 gold from Musa.'), v.card.join(' | '));
    } else {
      assert.ok(v.current.some((t) => /^You have been defeated by Musa/.test(t)), v.current.join(' | '));
      assert.ok(!v.current.some((t) => /You wake up in town/.test(t)), v.current.join(' | '));
      assert.ok(v.card.includes('Lost 4,321 gold'), v.card.join(' | '));
    }
    await done(ctx);
  });
}

test('GP-D3 each reward and loss is announced exactly once', async () => {
  const ctx = await game({ hero: { gold: 4321 } });
  const { page } = ctx;
  await page.evaluate(() => {
    window.__said = [];
    new MutationObserver(() => { const t = document.getElementById('sr-status').textContent; if (t) window.__said.push(t); }).observe(document.getElementById('sr-status'), { childList: true, characterData: true, subtree: true });
  });
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  let said = (await page.evaluate(() => window.__said)).join(' ');
  const count = (re) => (said.match(re) || []).length;
  assert.equal(count(/You gain \d+ experience\./g), 1, said);
  assert.equal(count(/dropped \d+ gold\./g), 1, said);
  assert.equal(count(/has been slain!/g), 1, said);
  await done(ctx);
  // A defeat, on a hero who can't last.
  const ctx2 = await game({ hero: { gold: 4321 }, edit: FRAIL });
  const p2 = ctx2.page;
  await p2.evaluate(() => {
    window.__said = [];
    new MutationObserver(() => { const t = document.getElementById('sr-status').textContent; if (t) window.__said.push(t); }).observe(document.getElementById('sr-status'), { childList: true, characterData: true, subtree: true });
  });
  await fightNamed(p2, 'Wisp Swarm');
  await finish(p2, 80);
  assert.equal((await battle(p2)).over, 'defeat');
  await p2.waitForTimeout(200);
  said = (await p2.evaluate(() => window.__said)).join(' ');
  assert.equal(count(/You wake up in town/g), 1, said);
  assert.equal(count(/You have been defeated by/g), 1, said);
  await done(ctx2);
});

test('GP-D5 a finished fight restored after a reload: every stored line, unfiltered, with the card', async () => {
  const ctx = await game();
  const { page } = ctx;
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  const b = await battle(page);
  await page.reload();
  await page.waitForSelector('#log'); await settle(page);
  const v = await logView(page);
  assert.equal(v.before.summary, `Before this page loaded (${b.log.length} lines)`);
  assert.deepEqual(v.before.lines, b.log.map((l) => l.text), 'all of it, in order, nothing hidden');
  assert.equal(v.currentLabel, null);
  assert.equal(v.wait, null, 'the fight is over');
  assert.ok(v.card.includes(`+${b.rewards.xp} XP`), v.card.join(' | '));
  await done(ctx);
});

// ---------------------------------------------------------------- E. a mastery gain, once

test('GP-E1 a mastery gain shows under its own round only, however fast the next action comes', async () => {
  const ctx = await game({ edit: (h) => { h.hp = maxHp(h); } });
  const { page } = ctx;
  let found = null;
  for (let fight = 0; fight < 4 && !found; fight++) {
    await fightNamed(page, 'Wisp Swarm');
    for (let i = 0; i < 40 && await page.$('[data-a="melee"]'); i++) {
      await tap(page, '[data-a="melee"]');
      const v = await logView(page);
      if (v.currentGain && !(await battle(page)).over) { found = { label: v.currentLabel, gain: v.currentGain }; break; }
    }
    if (!found) {
      for (let i = 0; i < 30 && await page.$('[data-a="flee"]'); i++) await tap(page, '[data-a="flee"]');
      if (await page.$('[data-a="done"]')) await tap(page, '[data-a="done"]');
      await page.click('[data-a="move"][data-v="n"]').catch(() => {}); await settle(page);
      if (await page.$('[data-a="heal"]')) { await tap(page, '[data-a="heal"]'); await tap(page, '[data-a="move"][data-v="n"]'); }
    }
  }
  assert.ok(found, 'a mastery was raised in the middle of a fight');
  await tap(page, '[data-a="melee"]'); // within the old 2.6 s window
  const v = await logView(page);
  assert.notEqual(v.currentLabel, found.label);
  assert.notEqual(v.currentGain, found.gain, 'the next round does not repeat it');
  const under = await page.evaluate((label) => {
    const t = [...document.querySelectorAll('#log details[data-g="earlier"] .turn')].find((x) => x.querySelector('.turn-label').textContent === label);
    return t?.querySelector('.turn-gain')?.textContent || null;
  }, found.label);
  assert.equal(under, found.gain, 'it stays under the round that raised it');
  await done(ctx);
});

// ---------------------------------------------------------------- F. the drop-down and the town

test('GP-F1 keyboard: choosing a monster starts nothing; Tab to Fight and Enter starts the chosen one', async () => {
  const ctx = await game();
  const { page, backend } = ctx;
  const label = await page.evaluate(() => document.querySelector('label[for="mon-select"]')?.textContent);
  assert.equal(label, 'Monster');
  await page.focus('#mon-select');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  assert.equal(calls(backend, 'fight').length, 0, 'choosing does not start a fight');
  const chosen = await page.$eval('#mon-select', (s) => s.value);
  assert.equal(chosen, await monsterId(page, 'Thieving Goblin'), 'three steps down from the first monster');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.a), 'fight');
  await page.keyboard.press('Enter'); await settle(page);
  assert.deepEqual(calls(backend, 'fight').map((c) => c.args.monsterId), [chosen]);
  assert.equal((await battle(page)).monsterId, chosen);
  await done(ctx);
});

test('GP-F2 the choice survives unrelated redraws, and the drop-down returns to the monster last fought', async () => {
  const ctx = await game({ edit: (h) => { h.hp = Math.floor(maxHp(h) * 0.5); } });
  const { page, backend } = ctx;
  const hag = await monsterId(page, 'Bog Hag');
  await page.selectOption('#mon-select', hag);
  const hp = await page.evaluate(() => window.clickmonster.char.hp);
  await page.waitForFunction((h) => window.clickmonster.char.hp > h, hp, { timeout: 8000 }); // a redraw
  await tap(page, '[data-a="list"][data-v="players"]');
  await tap(page, '[data-a="list"][data-v="monsters"]');
  assert.equal(await page.$eval('#mon-select', (s) => s.value), hag, 'kept across redraws and a list switch');
  const bear = await monsterId(page, 'Brown Bear');
  await fightNamed(page, 'Brown Bear');
  for (let i = 0; i < 30 && await page.$('[data-a="flee"]'); i++) await tap(page, '[data-a="flee"]');
  await tap(page, '[data-a="done"]');
  assert.equal(await page.$eval('#mon-select', (s) => s.value), bear, 'back to the last monster fought');
  assert.equal(backend.unexpected.length, 0);
  await done(ctx);
});

// A focused drop-down is left in place by every unrelated update. The clock is moved on so the
// hunts and the world events refresh (every 30 s), with regeneration ticks (every second) and a
// chat message alongside. The hunt's health and a new world event change the screen, which proves
// it was redrawn around the drop-down. (The players list refreshes only while it is the list on
// screen, so it never redraws the drop-down.)
for (const where of ['off town', 'a town tile that is also a lair']) {
  test(`GP-F2b unrelated updates leave the focused drop-down element in place (${where})`, async () => {
    const lair = where !== 'off town';
    const zone = lair ? 'test-hamlet' : 'bramblebrook';
    const hunt = { id: 'h1', zone, name: 'Old Mother Bramble', level: 12, hp: 15000, max_hp: 20000, ends_at: new Date(Date.now() + 3 * 3600000).toISOString() };
    const ctx = await game({
      hero: lair ? { zone, x: 3, y: 3 } : {},
      zones: lair ? [townLairZone()] : [],
      activeHunts: [hunt],
      edit: (h) => { h.hp = Math.floor(maxHp(h) * 0.5); },
      clock: true,
    });
    const { page, backend } = ctx;
    await page.waitForSelector('#main [data-a="hunt"]');
    await page.focus('#mon-select');
    const el = await page.$('#mon-select');
    const value = await el.evaluate((s) => s.value);
    await page.evaluate(() => {
      window.__mainChanges = 0;
      new MutationObserver((m) => { window.__mainChanges += m.length; }).observe(document.getElementById('main'), { childList: true, subtree: true, characterData: true });
    });
    const heal = lair ? await page.$eval('#dock [data-a="heal"]', (b) => b.textContent) : null;
    hunt.hp = 9000; // the hunt row will say 45% instead of 75%
    backend.worldEvents.push({ id: 'ev-9', name: 'Blood Moon', until: new Date(Date.now() + 86400000).toISOString(), xp: 2 });
    backend.broadcast('chat_messages', 'INSERT', { id: 77, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Hello there', deleted_at: null, created_at: new Date().toISOString() });
    await page.clock.runFor(31000);
    await page.waitForFunction(() => /45% health left/.test(document.querySelector('#main [data-a="hunt"]').textContent), null, { timeout: 5000 });
    await page.waitForFunction(() => /Blood Moon/.test(document.getElementById('main').textContent), null, { timeout: 5000 });
    assert.ok(await page.evaluate(() => window.__mainChanges) > 0, 'the screen was redrawn');
    assert.equal(await el.evaluate((s) => s.isConnected), true, 'the same element, never replaced');
    assert.equal(await el.evaluate((s) => document.activeElement === s), true, 'still focused');
    assert.equal(await el.evaluate((s) => s.value), value);
    if (lair) assert.notEqual(await page.$eval('#dock [data-a="heal"]', (b) => b.textContent), heal, 'the Heal price moved with the ticks');
    await done(ctx);
  });
}

test('GP-F3 world-boss hunts stay rows above the drop-down, and still start a hunt', async () => {
  const hunt = { id: 'h1', zone: 'bramblebrook', name: 'Old Mother Bramble', level: 12, hp: 15000, max_hp: 20000, ends_at: new Date(Date.now() + 3 * 3600000).toISOString() };
  const ctx = await game({ activeHunts: [hunt] });
  const { page, backend } = ctx;
  await page.waitForSelector('#main [data-a="hunt"]');
  const order = await page.evaluate(() => {
    const h = document.querySelector('#main [data-a="hunt"]');
    return { row: h.classList.contains('row'), before: !!(h.compareDocumentPosition(document.getElementById('mon-select')) & Node.DOCUMENT_POSITION_FOLLOWING) };
  });
  assert.deepEqual(order, { row: true, before: true });
  await tap(page, '#main [data-a="hunt"]');
  assert.deepEqual(calls(backend, 'hunt').map((c) => c.args.huntId), ['h1']);
  assert.equal((await battle(page)).hunt, 'h1');
  await done(ctx);
});

test('GP-F5 on a town tile: the town message, and no monster drop-down or Fight control', async () => {
  const ctx = await game({ hero: { y: 5 } });
  const { page } = ctx;
  const t = await page.evaluate(() => ({
    msg: document.querySelector('#main .town-calm')?.textContent,
    select: !!document.getElementById('mon-select'),
    fight: document.querySelectorAll('[data-a="fight"]').length,
  }));
  assert.deepEqual(t, { msg: TOWN_NO_MONSTERS, select: false, fight: 0 });
  assert.deepEqual(await axe(page, { minImpact: 'minor' }), []);
  await done(ctx);
});

test('GP-F5b on a tile that is both town and lair: the town message, the lair boss alone, and Fight starts it', async () => {
  const ctx = await game({ hero: { zone: 'test-hamlet', x: 3, y: 3 }, zones: [townLairZone()] });
  const { page, backend } = ctx;
  const t = await page.evaluate(() => ({
    msg: document.querySelector('#main .town-calm')?.textContent,
    options: [...document.querySelectorAll('#mon-select option')].map((o) => o.textContent),
  }));
  assert.equal(t.msg, TOWN_NO_MONSTERS);
  assert.deepEqual(t.options, ['Lv 5 The Undercroft King, Trivial, boss']);
  await tap(page, '#main [data-a="fight"]');
  assert.deepEqual(calls(backend, 'fight').map((c) => c.args.monsterId), ['test-hamlet:the-undercroft-king']);
  assert.equal((await battle(page)).monsterId, 'test-hamlet:the-undercroft-king');
  await done(ctx);
});

test('GP-X1 axe: no violations of any impact on the explore picker, a fight with history, and a victory', async () => {
  for (const [w, h] of [[320, 640], [1440, 900]]) {
    const ctx = await game({ viewport: { width: w, height: h } });
    const { page } = ctx;
    assert.deepEqual(await axe(page, { minImpact: 'minor' }), [], `explore ${w}`);
    await fightNamed(page, 'Wisp Swarm');
    for (let i = 0; i < 2; i++) await tap(page, '[data-a="melee"]');
    await page.click('#log-earlier');
    assert.deepEqual(await axe(page, { minImpact: 'minor' }), [], `fight ${w}`);
    await done(ctx);
  }
});
