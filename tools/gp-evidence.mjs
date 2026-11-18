// Gameplay polish GP-1 evidence (docs/gameplay-polish-scope.md, section 9): screenshots, an axe
// summary and a few measurements, taken the same way on the old and the new version.
//   node tools/gp-evidence.mjs <out-dir>
// Set UI_PUBLIC_DIR to another checkout's public/ folder to measure that version instead.
// Fake backend only. Works with both the old monster rows and the new drop-down.
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero, axe } from '../tests/ui/harness.mjs';
import { maxHp, xpToNext } from '../public/js/engine/character.js';

const out = process.argv[2] || 'tests/ui/artifacts/gp';
fs.mkdirSync(out, { recursive: true });
const env = await setup();
const summary = { axe: [], metrics: {} };

async function open({ w = 390, h = 844, hero = {}, edit, textScale, players = [] } = {}) {
  const c = makeHero({ y: 4, ...hero });
  if (edit) edit(c);
  const backend = new FakeBackend({ hero: c, players });
  const ctx = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  if (textScale) await ctx.page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = s; }), textScale);
  await signIn(ctx.page, env.url, 'player');
  await ctx.page.waitForSelector('[data-a="move"], #log', { timeout: 15000 });
  await settle(ctx.page);
  return ctx;
}
const wait = (page, ms = 280) => page.waitForTimeout(ms);
async function fight(page, name) {
  const id = await page.evaluate((n) => Object.values(window.clickmonster.MONSTERS).find((m) => m.name === n).id, name);
  if (await page.$('#mon-select')) { await page.selectOption('#mon-select', id); await page.click('#main [data-a="fight"]'); }
  else await page.click(`#main [data-a="fight"][data-v="${id}"]`);
  await settle(page); await wait(page);
}
async function finish(page, max = 80) {
  for (let i = 0; i < max && await page.$('[data-a="melee"]'); i++) { await wait(page); await page.click('[data-a="melee"]'); await settle(page); }
}
async function shot(page, name) {
  await wait(page, 300);
  await page.screenshot({ path: `${out}/${name}.png` });
  const v = await axe(page, { minImpact: 'minor' });
  summary.axe.push({ screen: name, violations: v.map((x) => `${x.id}:${x.impact}`) });
}
// Meters whose text overflows them, is cut off, or wraps onto a second line (a label or number
// broken across lines); screen-reader text aside.
const METER_FIT = () => [...document.querySelectorAll('.meter')].filter((m) => m.getClientRects().length).filter((m) => {
  const r = m.getBoundingClientRect();
  const walker = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
  let wrapped = false;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim() || t.parentElement.closest('.sr-only') || !t.parentElement.checkVisibility()) continue;
    const range = document.createRange(); range.selectNodeContents(t);
    if (new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size > 1) wrapped = true;
  }
  return wrapped || m.scrollWidth > m.clientWidth + 1
    || [...m.querySelectorAll('*')].some((el) => !el.closest('.sr-only') && ((el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) || (el.getClientRects().length && (el.getBoundingClientRect().left < r.left - 1 || el.getBoundingClientRect().right > r.right + 1))));
}).length;
// Log lines visible on screen that repeat what the outcome card lists.
const CARD_REPEATS = () => [...document.querySelectorAll('#log p')].filter((p) => p.checkVisibility() && /dropped \d+ gold|mastery is now|^You gain \d+ experience|^You reached level|^You found a |^A rare find|^You wake up in town|^You take \d+ gold|takes \d+ of your gold/.test(p.textContent)).length;
const VISIBLE_TURNS = () => {
  const turns = [...document.querySelectorAll('#log .turn')].filter((t) => t.checkVisibility());
  return turns.length;
};

const FIVE = (c) => { c.level = 33; c.xp = 10234; c.hp = maxHp(c) - 40; };
const SEVEN = (c) => { c.level = 60; c.stats.vit = 250000; c.hp = maxHp(c) - 1234; c.xp = 1234567; };

try {
  // B: the hero bar with five- and seven-digit numbers, at each width; and 320 at 200% text.
  for (const [w, h] of [[320, 640], [390, 844], [1024, 768], [1440, 900]]) {
    for (const [tag, edit] of [['xp5', FIVE], ['xp7', SEVEN]]) {
      const { page, context } = await open({ w, h, edit });
      summary.metrics[`B meters cut or overflowing, explore ${tag} ${w}`] = await page.evaluate(METER_FIT);
      await shot(page, `${w}-explore-${tag}`);
      await fight(page, 'Wisp Swarm');
      summary.metrics[`B meters cut or overflowing, battle ${tag} ${w}`] = await page.evaluate(METER_FIT);
      await context.close();
    }
  }
  // The owner's case: five-digit XP on a phone, just after a victory, with the "+XP" chip showing.
  for (const w of [320, 390]) {
    const { page, context } = await open({ w, h: w === 320 ? 640 : 844, edit: FIVE });
    await fight(page, 'Garden Snake');
    await finish(page);
    summary.metrics[`B meters cut or overflowing, after a victory xp5 ${w}`] = await page.evaluate(METER_FIT);
    await shot(page, `${w}-victory-xp5-chip`);
    await context.close();
  }
  for (const w of [320, 390]) {
    const { page, context } = await open({ w, h: 844, edit: SEVEN, textScale: '200%' });
    summary.metrics[`B meters cut or overflowing, explore xp7 ${w} 200% text`] = await page.evaluate(METER_FIT);
    await shot(page, `${w}-explore-xp7-200pct`);
    await context.close();
  }

  // A: the XP cue after a victory, with regeneration running.
  {
    const { page, context } = await open({ edit: (c) => { c.hp = Math.floor(maxHp(c) * 0.5); } });
    await page.evaluate(() => { window.__a = []; document.addEventListener('animationstart', (e) => { if (e.target.closest('#top .meter.xp')) window.__a.push(e.animationName); }, true); });
    await fight(page, 'Garden Snake');
    await finish(page);
    const meter = await page.$('#top .meter.xp');
    const hp = await page.evaluate(() => window.clickmonster.char.hp);
    await page.waitForFunction((x) => window.clickmonster.char.hp > x, hp, { timeout: 8000 });
    await wait(page, 300);
    const a = await page.evaluate(() => window.__a);
    summary.metrics['A XP glow starts after one victory'] = a.filter((x) => x === 'xp-glow').length;
    summary.metrics['A +XP chip starts after one victory'] = a.filter((x) => x === 'delta').length;
    summary.metrics['A XP meter element replaced by a regeneration tick'] = !(await meter.evaluate((el) => el.isConnected));
    await context.close();
  }

  // C and D: a fight in round 3; a victory; a defeat.
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    {
      const { page, context } = await open({ w, h });
      await fight(page, 'Wisp Swarm');
      for (let i = 0; i < 3; i++) { await wait(page); await page.click('[data-a="melee"]'); await settle(page); }
      summary.metrics[`C rounds visible after 3 actions ${w}`] = await page.evaluate(VISIBLE_TURNS);
      await shot(page, `${w}-battle-round3`);
      if (await page.$('#log-earlier')) { await page.click('#log-earlier'); await shot(page, `${w}-battle-round3-earlier-open`); }
      await context.close();
    }
    {
      const { page, context } = await open({ w, h });
      await fight(page, 'Garden Snake');
      await finish(page);
      summary.metrics[`D visible lines repeating the Victory card ${w}`] = await page.evaluate(CARD_REPEATS);
      await shot(page, `${w}-victory`);
      await context.close();
    }
    {
      const { page, context } = await open({ w, h, hero: { gold: 4321 }, edit: (c) => { c.hp = 5; c.lastTick = Date.now() + 3600000; } });
      await fight(page, 'Wisp Swarm');
      await finish(page);
      summary.metrics[`D visible lines repeating the Defeated card ${w}`] = await page.evaluate(CARD_REPEATS);
      await shot(page, `${w}-defeat`);
      await context.close();
    }
  }
  // D: a duel, lost.
  {
    const musa = { id: 'char-other', name: 'Musa', race: 'human', level: 40, zone: 'duskhollow', x: 2, y: 2, stats: { str: 900, dex: 900, int: 900, wis: 900, vit: 900 }, updated_at: new Date().toISOString() };
    const { page, context } = await open({ hero: { level: 35, zone: 'duskhollow', x: 2, y: 2, gold: 4321 }, players: [musa] });
    await page.click('[data-a="list"][data-v="players"]'); await settle(page);
    await page.waitForSelector('[data-a="attack"]');
    await page.click('[data-a="attack"]');
    await page.click('#confirm [data-r="ok"]'); await settle(page);
    await page.waitForSelector('.outcome');
    summary.metrics['D visible lines repeating the duel card 390'] = await page.evaluate(CARD_REPEATS);
    await shot(page, '390-duel-lost');
    await context.close();
  }

  // F: explore off town and on the town tile.
  for (const [w, h] of [[320, 640], [390, 844], [1440, 900]]) {
    for (const [tag, y] of [['open', 4], ['town', 5]]) {
      const { page, context } = await open({ w, h, hero: { y } });
      summary.metrics[`F fight controls on the ${tag} tile ${w}`] = await page.evaluate(() => document.querySelectorAll('#main [data-a="fight"], #dock [data-a="fight"]').length);
      await shot(page, `${w}-explore-${tag}`);
      await context.close();
    }
  }
} finally {
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  await env.close();
}
console.log(JSON.stringify(summary.metrics, null, 2));
console.log('axe violations:', summary.axe.filter((a) => a.violations.length).map((a) => `${a.screen}: ${a.violations.join(', ')}`).join('; ') || 'none');
