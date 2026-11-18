// Gameplay polish GP-1 (docs/gameplay-polish-scope.md, sections 8 and 14): the XP cue plays once
// (A), the numbers sit on the bars (B), only the current round shows (C), the outcome is shown once
// (D), a mastery gain stays with its round (E), the monster drop-down and the town rule (F), and,
// from amendment 1, the floating gold and XP cues (GP-B6 to B8), two-line meters (GP-B9) and the
// fight screen without HP bars (GP-H1 to H4).
// Run with: npm run test:ui. Deterministic fixtures only, on the fake backend.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, signIn, settle, FakeBackend, makeHero, axe, fixedQuest, townLairZone, watchCues } from './harness.mjs';
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
  // The +XP cue no longer lives in the meter (amendment G1); GP-B7 checks it plays once.
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

// A world boss with a seven-digit Shared HP: the only bar left in a fight (amendment G3).
const BIG_HUNT = () => ({ id: 'h-big', zone: 'bramblebrook', name: 'Old Mother Bramble', level: 12, hp: 1234567, max_hp: 2000000, ends_at: new Date(Date.now() + 3 * 3600000).toISOString() });
async function intoHunt(page) {
  await page.waitForSelector('#main [data-a="hunt"]');
  await tap(page, '#main [data-a="hunt"]');
  await page.waitForSelector('#fx-foe .meter');
}

for (const [w, h] of [[320, 640], [390, 844], [1024, 768], [1440, 900]]) {
  test(`GP-B1 at ${w}px, seven-digit HP and XP fit on the bars, in the hero bar and on a world boss's bar`, async () => {
    const ctx = await game({ edit: BIG, viewport: { width: w, height: h }, activeHunts: [BIG_HUNT()] });
    const { page } = ctx;
    assert.deepEqual(await page.evaluate(meterFit), [], 'explore');
    await intoHunt(page);
    assert.deepEqual(await page.evaluate(meterFit), [], 'world-boss hunt');
    await done(ctx);
  });
}

for (const w of [320, 390]) {
  test(`GP-B2 at ${w}px with 200% text, the bars still fit`, async () => {
    const ctx = await game({ edit: BIG, viewport: { width: w, height: 844 }, textScale: '200%', activeHunts: [BIG_HUNT()] });
    const { page } = ctx;
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '32px');
    assert.deepEqual(await page.evaluate(meterFit), [], 'explore');
    await intoHunt(page);
    assert.deepEqual(await page.evaluate(meterFit), [], 'world-boss hunt');
    await done(ctx);
  });
}

test('GP-B3 the numbers are at least 4.5:1 against the fill and against the empty track, for HP, XP and the foe', async () => {
  const ctx = await game({ edit: (h) => { h.hp = Math.floor(maxHp(h) / 2); }, activeHunts: [BIG_HUNT()] });
  const { page } = ctx;
  await intoHunt(page); // the foe colour is on the world boss's Shared HP bar
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

test('GP-B5 reduced motion: no animation on the XP bar or the gain cues; the cues stay still for the same time', async () => {
  const ctx = await game({ reducedMotion: 'reduce' });
  const { page } = ctx;
  await watchCues(page);
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  const glow = await page.evaluate(() => document.querySelector('#top .meter.xp.gain .meter-track') && getComputedStyle(document.querySelector('#top .meter.xp.gain .meter-track')).animationName);
  assert.equal(glow, 'none');
  await page.waitForTimeout(1900);
  const cues = await page.evaluate(() => window.__cues);
  assert.ok(cues.length >= 2, `the gold and XP cues are shown: ${JSON.stringify(cues)}`);
  for (const c of cues) {
    assert.equal(c.anim, 'none', c.text);
    assert.equal(c.starts, 0, c.text);
    assert.ok(c.removed && c.removed - c.added >= 1500 && c.removed - c.added < 3000, `${c.text} shown for ${c.removed - c.added} ms`);
  }
  await done(ctx);
});

// ---------------------------------------------------------------- amendment 1: floating cues (G1)

// The contrast of a cue's text on its dark backing, composited over the hero bar's background.
const cueContrast = (c) => {
  const nums = (s) => s.match(/[\d.]+/g).map(Number);
  const [r, g, b] = nums(c.color);
  const [br, bg, bb, ba = 1] = nums(c.background);
  const BG = [21, 17, 14]; // --bg, behind the hero bar
  const back = [br, bg, bb].map((v, i) => v * ba + BG[i] * (1 - ba));
  const lum = ([x, y, z]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(x) + 0.7152 * f(y) + 0.0722 * f(z); };
  const [hi, lo] = [lum([r, g, b]), lum(back)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

test('GP-B6 the XP cue takes no space in the bar: the label stays "Lv N" and the fit is the same as without it', async () => {
  // The owner's case (scope 14.1): level 62 at 23,516 XP, a win in Cinderspire Caldera.
  const ctx = await game({ hero: { level: 62, zone: 'cinderspire', x: 3, y: 3 }, edit: (h) => { h.xp = 23516; } });
  const { page } = ctx;
  await watchCues(page);
  await page.selectOption('#mon-select', { index: 0 });
  await page.click('#main [data-a="fight"]'); await settle(page);
  await finish(page);
  assert.equal((await battle(page)).over, 'victory');
  // Just after the win, while the gain shows: the bar's label is only the level. (Before
  // amendment 1 it held the "+71 XP" chip here, the label the owner's iPhone cut off.)
  assert.equal(await page.evaluate(() => document.querySelector('#top .meter.xp .meter-name').textContent), 'Lv 62');
  await page.waitForTimeout(2900); // the cue and the glow are over
  const xp = (await page.evaluate(() => window.__cues)).find((c) => /XP$/.test(c.text));
  assert.ok(xp, 'an XP cue was shown');
  assert.equal(xp.inMeter, false, 'the cue is not inside the meter');
  assert.equal(xp.xpLabel, 'Lv 62', 'while the cue shows, the label is only the level');
  const after = await page.evaluate(() => { const m = document.querySelector('#top #hud-xp .meter'); return { label: m.querySelector('.meter-name').textContent, fit: ['compact', 'stack'].filter((c) => m.classList.contains(c)) }; });
  assert.deepEqual(xp.xpFit, after.fit, 'the same fit with the cue and without it');
  assert.equal(after.label, 'Lv 62');
  await done(ctx);
});

test('GP-B7 the XP cue starts once, holds through a regeneration tick without restarting, is removed at 1.6 s, and is not recreated', async () => {
  const ctx = await game({ edit: (h) => { h.hp = Math.floor(maxHp(h) * 0.5); } });
  const { page } = ctx;
  await watchCues(page);
  // As soon as the XP cue appears, make the next one-second tick regenerate HP, and note the cue's
  // state when that tick repaints the HP meter.
  await page.evaluate(() => {
    const top = document.getElementById('top');
    new MutationObserver((muts) => {
      for (const n of muts.flatMap((m) => [...m.addedNodes])) {
        if (n.nodeType !== 1 || !n.classList.contains('cue') || !/XP$/.test(n.textContent)) continue;
        window.clickmonster.char.lastTick -= 3000;
        new MutationObserver(() => {
          if (window.__atTick) return;
          window.__atTick = { connected: n.isConnected, starts: n.__cue.starts, opacity: getComputedStyle(n).opacity, at: performance.now() - n.__cue.added };
        }).observe(top.querySelector('#hud-hp'), { childList: true });
      }
    }).observe(top, { childList: true });
  });
  await fightNamed(page, 'Garden Snake');
  await finish(page);
  assert.equal((await battle(page)).over, 'victory');
  await page.waitForFunction(() => window.__atTick, null, { timeout: 3000 });
  const tick = await page.evaluate(() => window.__atTick);
  assert.ok(tick.at < 1600, `the tick came while the cue showed (${Math.round(tick.at)} ms)`);
  assert.equal(tick.connected, true, 'the tick did not replace the cue');
  assert.equal(tick.starts, 1, 'its animation started once');
  assert.equal(tick.opacity, '1', 'no fading');
  await page.waitForTimeout(1900);
  let cues = await page.evaluate(() => window.__cues.filter((c) => /XP$/.test(c.text)));
  assert.equal(cues.length, 1, 'one XP cue');
  const [c] = cues;
  assert.equal(c.ariaHidden, 'true');
  assert.equal(c.starts, 1);
  assert.ok(c.removed && c.removed - c.added >= 1500 && c.removed - c.added < 3000, `shown for ${c.removed - c.added} ms`);
  // Two more regeneration ticks: no cue comes back.
  await page.evaluate(() => { window.clickmonster.char.lastTick -= 6000; });
  await page.waitForTimeout(2200);
  cues = await page.evaluate(() => window.__cues.filter((x) => /XP$/.test(x.text)));
  assert.equal(cues.length, 1, 'later ticks did not recreate the cue');
  assert.equal(await page.$('#top .cue'), null);
  await done(ctx);
});

for (const way of ['gain', 'spend']) {
  test(`GP-B8 a gold ${way} floats over the gold, told apart by colour, at least 4.5:1, and the gold line keeps its width`, async () => {
    const ctx = way === 'gain' ? await game() : await game({ hero: { y: 5 }, edit: (h) => { h.hp = Math.floor(maxHp(h) / 2); } });
    const { page } = ctx;
    await watchCues(page);
    let amount;
    if (way === 'gain') {
      await fightNamed(page, 'Garden Snake');
      await finish(page);
      amount = (await battle(page)).rewards.gold;
      assert.ok(amount > 0, 'the fight drops gold');
    } else {
      const gold = await page.evaluate(() => window.clickmonster.char.gold);
      await tap(page, '#dock [data-a="heal"]');
      amount = gold - await page.evaluate(() => window.clickmonster.char.gold);
      assert.ok(amount > 0, 'healing costs gold');
    }
    // The gold line's width just after the change, while the gain or spend shows, and once it is
    // over. (Before amendment 1 the chip sat in the gold line and widened it.)
    const goldWidth = () => page.evaluate(() => document.querySelector('#top #hud-row .hud-res').getBoundingClientRect().width);
    const during = await goldWidth();
    await page.waitForTimeout(2900);
    assert.ok(Math.abs(during - await goldWidth()) < 0.5, `the gold line is ${during} wide just after the change, ${await goldWidth()} later`);
    const cue = (await page.evaluate(() => window.__cues)).find((c) => !/XP$/.test(c.text));
    assert.ok(cue, 'a gold cue was shown');
    assert.equal(cue.text, `${way === 'gain' ? '+' : '-'}${amount.toLocaleString('en-US')}`);
    assert.ok(cue.cls.split(' ').includes(way === 'gain' ? 'up' : 'down'), cue.cls);
    assert.equal(cue.ariaHidden, 'true');
    assert.ok(cueContrast(cue) >= 4.5, `contrast ${cueContrast(cue).toFixed(2)}`);
    const width = await page.evaluate(() => document.querySelector('#top #hud-row .hud-res').getBoundingClientRect().width);
    assert.ok(Math.abs(cue.goldWidth - width) < 0.5, `the gold line is ${cue.goldWidth} wide with the cue, ${width} without`);
    await done(ctx);
  });
}

test('GP-B9 on two lines, the label and the numbers each span the bar (fix A)', async () => {
  const ctx = await game();
  const { page } = ctx;
  // Narrow columns force the hero bar's meters onto two lines.
  await page.addStyleTag({ content: '#top .hud-bars { grid-template-columns: 5.5rem 5.5rem !important; }' });
  await page.evaluate(() => dispatchEvent(new Event('resize')));
  await page.waitForTimeout(100);
  const parts = await page.evaluate(() => [...document.querySelectorAll('#top .meter.stack')].map((m) => {
    const text = m.querySelector('.meter-text');
    const cs = getComputedStyle(text);
    const room = text.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { meter: m.className, room, name: m.querySelector('.meter-name').getBoundingClientRect().width, num: m.querySelector('.meter-num').getBoundingClientRect().width };
  }));
  assert.ok(parts.length >= 1, 'at least one meter is on two lines');
  for (const p of parts) {
    assert.ok(Math.abs(p.name - p.room) < 1, `${p.meter}: the label is ${p.name} wide on a ${p.room} bar`);
    assert.ok(Math.abs(p.num - p.room) < 1, `${p.meter}: the numbers are ${p.num} wide on a ${p.room} bar`);
  }
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

// ---------------------------------------------------------------- amendment 1: no HP bars in a fight (G2, G3)

// Floats added to the fight's sides: which side, and whether each sits in its side's strip.
const watchFloats = (page) => page.evaluate(() => {
  window.__floats = [];
  new MutationObserver((muts) => {
    for (const n of muts.flatMap((m) => [...m.addedNodes])) {
      if (n.nodeType === 1 && n.classList.contains('float')) window.__floats.push({ side: n.closest('.side')?.id, inStrip: n.parentElement.classList.contains('side-fx'), cls: n.className });
    }
  }).observe(document.getElementById('main'), { childList: true, subtree: true });
});

test('GP-H1 an ordinary fight shows no HP bar on either side; the damage numbers still float over both sides', async () => {
  const ctx = await game();
  const { page } = ctx;
  await watchFloats(page);
  await fightNamed(page, 'Bog Hag');
  for (let i = 0; i < 3 && await page.$('[data-a="melee"]'); i++) await tap(page, '[data-a="melee"]');
  const v = await page.evaluate(() => ({ meters: document.querySelectorAll('#versus .meter').length, strips: [...document.querySelectorAll('#versus .side')].map((s) => !!s.querySelector('.side-fx')) }));
  assert.equal(v.meters, 0, 'no HP bars');
  assert.deepEqual(v.strips, [true, true], 'each side keeps its strip');
  const floats = await page.evaluate(() => window.__floats);
  assert.ok(floats.some((f) => f.side === 'fx-foe') && floats.some((f) => f.side === 'fx-you'), JSON.stringify(floats));
  assert.ok(floats.every((f) => f.inStrip), "every float is in its side's strip");
  // Your HP during the fight is the hero bar's (scope 14.6, GP-A2): it follows the hits taken.
  const hp = await page.evaluate(() => ({ bar: document.querySelector('#top .meter:not(.xp) .meter-num .sr-only').textContent, hp: window.clickmonster.char.hp }));
  assert.equal(hp.bar.split(' of ')[0], hp.hp.toLocaleString('en-US'));
  await done(ctx);
});

test('GP-H2 a world-boss hunt shows the Shared HP bar and no bar for you', async () => {
  const ctx = await game({ activeHunts: [BIG_HUNT()] });
  const { page } = ctx;
  await intoHunt(page);
  const v = await page.evaluate(() => ({
    you: document.querySelectorAll('#fx-you .meter').length,
    foe: [...document.querySelectorAll('#fx-foe .meter')].map((m) => m.querySelector('.meter-name').textContent),
    inStrip: !!document.querySelector('#fx-foe .side-fx .meter'),
  }));
  assert.deepEqual(v, { you: 0, foe: ['Shared HP'], inStrip: true });
  await done(ctx);
});

test('GP-H3 a duel shows no bars', async () => {
  const opponent = { ...MUSA, level: 30, gold: 900 };
  const ctx = await game({ hero: { level: 35, zone: 'duskhollow', x: 2, y: 2 }, edit: (h) => { Object.assign(h.stats, { str: 900, dex: 900, int: 900, wis: 900, vit: 900 }); h.hp = maxHp(h); }, players: [opponent] });
  const { page } = ctx;
  await tap(page, '[data-a="list"][data-v="players"]');
  await page.waitForSelector('[data-a="attack"]');
  await page.click('[data-a="attack"]');
  await page.click('#confirm [data-r="ok"]'); await settle(page);
  await page.waitForSelector('.outcome');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#versus .meter').length), 0);
  await done(ctx);
});

// Each kind of float, placed in each side's strip, at the start and the end of its rise: its box
// must not touch the name or the sub-line, and must stay inside the strip and the fight's area.
const floatGeometry = () => {
  const out = [];
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const v = document.getElementById('versus').getBoundingClientRect();
  for (const side of document.querySelectorAll('#versus .side')) {
    const strip = side.querySelector('.side-fx');
    if (!strip) { out.push({ side: side.id, problems: ['no strip'] }); continue; }
    const name = side.querySelector('.side-name').getBoundingClientRect();
    const sub = side.querySelector('.side-sub').getBoundingClientRect();
    for (const [cls, text] of [['crit', '1,234!'], ['miss', 'Miss'], ['dmg-you', '-1,234']]) {
      const el = document.createElement('span');
      el.className = `float ${cls}`;
      el.textContent = text;
      strip.appendChild(el);
      void getComputedStyle(el).animationName;
      const anim = el.getAnimations()[0];
      anim.pause();
      const s = strip.getBoundingClientRect();
      for (const t of [0, anim.effect.getComputedTiming().duration - 1]) {
        anim.currentTime = t;
        const b = el.getBoundingClientRect();
        const problems = [hit(b, name) && 'covers the name', hit(b, sub) && 'covers the sub-line', b.top < s.top - 0.5 && 'above the strip',
          b.bottom > s.bottom + 0.5 && 'below the strip', (b.left < v.left - 0.5 || b.right > v.right + 0.5) && 'outside the fight'].filter(Boolean);
        if (problems.length) out.push({ side: side.id, cls, t, problems });
      }
      el.remove();
    }
  }
  return out;
};

for (const [w, scale] of [[390, null], [320, '200%']]) {
  test(`GP-H4 at ${w}px${scale ? ` with ${scale} text` : ''}, critical hits, misses and damage stay in their strip, clear of the names and sub-lines`, async () => {
    const ctx = await game({ viewport: { width: w, height: 844 }, textScale: scale });
    const { page } = ctx;
    await fightNamed(page, 'Bog Hag');
    assert.deepEqual(await page.evaluate(floatGeometry), []);
    await done(ctx);
  });
}
