// Captures interaction states (pending, refused taps, battle turns and rewards, empty states,
// confirmations) with the UI test harness (fake backend, never the live one), plus an axe
// summary and any native confirm()/prompt() dialogs that appeared.
//   node tools/ui-states.mjs <out-dir> [widths]
// Set UI_PUBLIC_DIR to capture another checkout's public/ folder.
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero, axe, fixedQuest, adminTab } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/states';
const widths = (process.argv[3] || '390').split(',').map(Number);
fs.mkdirSync(out, { recursive: true });
const summary = [];
const env = await setup();
const wait = (page, ms = 280) => page.waitForTimeout(ms);
const CHAT = [{ id: 1, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: new Date(Date.now() - 60000).toISOString() }];

async function scene(w, name, opts, run) {
  const { hero = {}, players = [], admin = false } = opts;
  const h = w >= 1000 ? 900 : w <= 320 ? 640 : 844;
  const backend = new FakeBackend({ hero: makeHero(hero), players, chat: structuredClone(CHAT), quests: [fixedQuest()] });
  const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  const shot = async (label) => {
    await wait(page, 200);
    await page.screenshot({ path: `${out}/${w}-${label}.png` });
    const v = await axe(page, { minImpact: 'minor' }).catch(() => []);
    summary.push({ width: w, screen: label, violations: v.map((x) => `${x.id}:${x.impact}`), native: page.nativeDialogs.splice(0) });
  };
  try {
    await signIn(page, env.url, admin ? 'admin' : 'player', admin ? '/admin.html' : '/');
    await page.waitForSelector(admin ? '.tiles' : '[data-a="move"], #log', { timeout: 15000 });
    await settle(page);
    await run(page, shot, backend);
  } catch (err) {
    summary.push({ width: w, screen: `${name}-ERROR`, error: err.message.split('\n')[0] });
  }
  if (page.errors.length) summary.push({ width: w, screen: `${name}-pageerrors`, errors: page.errors });
  if (backend.unexpected.length) summary.push({ width: w, screen: `${name}-unexpected`, urls: backend.unexpected });
  await context.close();
}

for (const w of widths) {
  await scene(w, 'battle', {}, async (page, shot, backend) => {
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
    // The toughest foe here: the last in the drop-down (gameplay polish F1).
    await page.selectOption('#mon-select', await page.$eval('#mon-select', (s) => s.options[s.options.length - 1].value));
    await page.click('#main [data-a="fight"]'); await settle(page);
    for (let i = 0; i < 3; i++) { await wait(page); await page.click('[data-a="melee"]'); await settle(page); }
    await shot('battle-turns');
    // Slow server: the pressed action shows it is working; a second tap is refused.
    const release = backend.hold('melee');
    await wait(page); await page.click('[data-a="melee"]'); await wait(page, 150);
    await shot('pending');
    await page.click('[data-a="cast"]'); await wait(page, 120);
    await shot('refused-while-busy');
    release(); await settle(page); await wait(page, 400);
    // An accidental double tap.
    if (await page.$('[data-a="melee"]')) {
      await page.click('[data-a="melee"]'); await page.click('[data-a="melee"]'); await wait(page, 120);
      await shot('double-tap');
    }
    for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await wait(page); await page.click('[data-a="melee"]'); await settle(page); }
    await wait(page, 300);
    await shot('battle-defeat');
  });
  await scene(w, 'victory', {}, async (page, shot) => {
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
    await page.selectOption('#mon-select', { label: 'Lv 9 Bog Hag, Trivial, Shadow' });
    await page.click('#main [data-a="fight"]'); await settle(page);
    for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await wait(page); await page.click('[data-a="melee"]'); await settle(page); }
    await wait(page, 300);
    await shot('battle-victory');
  });
  await scene(w, 'empty', {}, async (page, shot) => {
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
    await page.click('[data-a="list"][data-v="players"]'); await settle(page); await wait(page, 400);
    await shot('empty-players');
  });
  await scene(w, 'delete', {}, async (page, shot) => {
    await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
    await page.click('[data-a="delete"]'); await wait(page, 300);
    await shot('confirm-delete-hero');
  });
  await scene(w, 'attack', { hero: { level: 35, zone: 'duskhollow', x: 2, y: 2 }, players: [{ id: 'char-other', name: 'Musa', race: 'human', level: 33, zone: 'duskhollow', x: 2, y: 2, updated_at: new Date().toISOString() }] }, async (page, shot) => {
    await page.click('[data-a="list"][data-v="players"]'); await settle(page);
    await page.waitForSelector('[data-a="attack"]', { timeout: 5000 });
    await page.click('[data-a="attack"]'); await wait(page, 300);
    await shot('confirm-attack');
  });
  await scene(w, 'abandon', {}, async (page, shot) => {
    await page.click('[data-a="quests"]'); await page.waitForSelector('[data-a="accept"]', { timeout: 5000 });
    await page.click('[data-a="accept"]'); await settle(page); await wait(page, 300);
    if (!(await page.$('#sheet[open]'))) { await page.click('[data-a="quests"]'); await wait(page, 300); }
    await page.click('[data-a="abandon"]'); await wait(page, 300);
    await shot('confirm-abandon-quest');
  });
  await scene(w, 'sell', {}, async (page, shot) => {
    await page.click('[data-a="tab"][data-v="gear"]'); await settle(page);
    await page.locator('[data-a="item"]', { hasText: /\/\d sockets/ }).first().click(); await page.waitForSelector('#sheet[open]');
    await page.click('[data-a="socket"]'); await settle(page); await wait(page, 300);
    await page.click('[data-a="sell"]'); await wait(page, 300);
    await shot('confirm-sell-gems');
  });
  await scene(w, 'chat', { level: 12 }, async (page, shot) => {
    await page.click('.chatbar'); await page.waitForSelector('#chat[open]'); await wait(page, 300);
    await page.click('.chat-line[data-c="menu"]'); await wait(page, 200);
    await page.click('[data-c="report"]'); await wait(page, 300);
    await shot('confirm-chat-report');
  });
  await scene(w, 'admin', { admin: true }, async (page, shot) => {
    await adminTab(page, 'players'); await wait(page, 500);
    await page.click('[data-a="open"]'); await page.waitForSelector('#sanction'); await wait(page, 300);
    await page.selectOption('#s-kind', 'ban'); await page.fill('#s-days', ''); await page.fill('#s-reason', 'Botting');
    await page.click('#sanction [type="submit"]'); await wait(page, 300);
    await shot('admin-confirm-ban');
  });
}
await env.close();
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 1));
for (const s of summary) console.log(JSON.stringify(s));
