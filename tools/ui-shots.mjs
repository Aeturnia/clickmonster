// Captures the main screens with the UI test harness (fake backend, never the live one),
// plus an axe summary, for before/after comparisons in pull requests.
//   node tools/ui-shots.mjs <out-dir> [widths]
// Set UI_PUBLIC_DIR to capture another checkout's public/ folder.
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero, axe, bigZone, adminTab } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/shots';
// Sizes: "390" (height chosen automatically) or "844x390".
const widths = (process.argv[3] || '320,390,1440').split(',').map((v) => v.includes('x') ? v.split('x').map(Number) : [Number(v), null]);
fs.mkdirSync(out, { recursive: true });
const summary = [];

const env = await setup();
for (const [w, hh] of widths) {
  const h = hh || (w >= 1000 ? 900 : w <= 320 ? 640 : 844);
  const tag = hh ? `${w}x${hh}` : `${w}`;
  const others = [{ id: 'char-other', name: 'Musa', race: 'human', level: 9, zone: 'bramblebrook', x: 5, y: 4, updated_at: new Date().toISOString() }];
  const chat = [
    { id: 1, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: 'admin', recipient_id: null, recipient_name: null, text: 'Welcome to the test realm!', deleted_at: null, created_at: new Date(Date.now() - 600000).toISOString() },
    { id: 2, channel: 'global', zone: null, sender_id: 'char-other', sender_name: 'Musa', sender_role: null, recipient_id: null, recipient_name: null, text: 'Anyone hunting goblins?', deleted_at: null, created_at: new Date(Date.now() - 300000).toISOString() },
  ];
  const backend = new FakeBackend({ hero: makeHero({ pendingLevels: 1 }), players: others, chat });
  const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${tag}-${name}.png` });
    const v = await axe(page, { minImpact: 'minor' });
    summary.push({ width: tag, screen: name, violations: v.map((x) => `${x.id}:${x.impact}`) });
  };
  try {
    await page.goto(env.url + '/');
    await page.waitForSelector('#authform');
    await shot('auth');
    await signIn(page, env.url, 'player');
    await page.waitForSelector('.pad, [data-a="later"]', { timeout: 15000 });
    await settle(page);
    if (await page.$('[data-a="later"]')) { await shot('levelup-sheet'); await page.click('[data-a="later"]'); await settle(page); }
    await shot('explore-town');
    await page.click('[data-a="shop"]'); await settle(page); await shot('shop-sheet');
    await page.keyboard.press('Escape'); await settle(page);
    await page.click('[data-a="move"][data-v="n"]'); await settle(page); await shot('explore-open');
    await page.click('#main [data-a="fight"]'); await settle(page); await page.waitForTimeout(260);
    await page.click('[data-a="melee"]'); await settle(page); await page.click('[data-a="melee"]'); await settle(page);
    await shot('battle');
    for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await page.click('[data-a="melee"]'); await settle(page); }
    await shot('battle-result');
    if (await page.$('[data-a="done"]')) { await page.click('[data-a="done"]'); await settle(page); }
    await page.click('[data-a="tab"][data-v="hero"]'); await settle(page); await shot('hero');
    await page.click('[data-a="tab"][data-v="gear"]'); await settle(page); await shot('gear');
    await page.click('[data-a="item"]'); await settle(page); await shot('item-sheet');
    await page.keyboard.press('Escape'); await settle(page);
    await page.click('[data-a="tab"][data-v="map"]'); await settle(page); await shot('map');
    await page.click('[data-a="tab"][data-v="explore"]'); await settle(page);
    // The drawer, or on desktop from 1280px the persistent panel (focus in its message box).
    if (await page.evaluate(() => document.getElementById('app').dataset.chat === 'panel')) { await page.click('#chatpanel #chat-input'); await shot('chat-panel'); }
    else { await page.click('.chatbar'); await page.waitForSelector('.chat-panel'); await shot('chat-drawer'); }
    await page.keyboard.press('Escape'); await settle(page);
  } catch (err) {
    summary.push({ width: tag, screen: 'ERROR', error: err.message.split('\n')[0] });
  }
  if (page.errors.length) summary.push({ width: tag, screen: 'pageerrors', errors: page.errors });
  await context.close();

  // A 40x40 zone map.
  const mapBackend = new FakeBackend({ hero: makeHero({ zone: 'test-expanse', x: 33, y: 30 }), zones: [bigZone(40)] });
  const mp = await env.page({ backend: mapBackend, viewport: { width: w, height: h }, mobile: w < 900 });
  try {
    await signIn(mp.page, env.url, 'player');
    await mp.page.waitForSelector('[data-a="move"]', { timeout: 15000 }); await settle(mp.page);
    await mp.page.click('[data-a="tab"][data-v="map"]'); await settle(mp.page); await mp.page.waitForTimeout(300);
    await mp.page.screenshot({ path: `${out}/${tag}-map-40x40.png` });
    const v = await axe(mp.page, { minImpact: 'minor' });
    summary.push({ width: tag, screen: 'map-40x40', violations: v.map((x) => `${x.id}:${x.impact}`) });
  } catch (err) { summary.push({ width: tag, screen: 'map-ERROR', error: err.message.split('\n')[0] }); }
  await mp.context.close();
  if (backend.unexpected.length) summary.push({ width: tag, screen: 'unexpected-requests', urls: backend.unexpected });

  // Admin console.
  const adminBackend = new FakeBackend({ hero: makeHero(), players: others, chat });
  const a = await env.page({ backend: adminBackend, viewport: { width: w, height: h }, mobile: w < 900 });
  try {
    await signIn(a.page, env.url, 'admin', '/admin.html');
    await a.page.waitForSelector('.tiles', { timeout: 15000 });
    await a.page.waitForTimeout(300);
    const ashot = async (name) => { await a.page.screenshot({ path: `${out}/${tag}-admin-${name}.png` }); const v = await axe(a.page, { minImpact: 'minor' }); summary.push({ width: tag, screen: `admin-${name}`, violations: v.map((x) => `${x.id}:${x.impact}`) }); };
    await ashot('dashboard');
    await adminTab(a.page, 'players'); await a.page.waitForTimeout(500); await ashot('players');
    await a.page.click('[data-a="open"]'); await a.page.waitForSelector('#sanction'); await a.page.waitForTimeout(300); await ashot('player');
    await adminTab(a.page, 'zones'); await a.page.waitForTimeout(500); await ashot('zones');
  } catch (err) {
    summary.push({ width: tag, screen: 'admin-ERROR', error: err.message.split('\n')[0] });
  }
  if (adminBackend.unexpected.length) summary.push({ width: tag, screen: 'admin-unexpected-requests', urls: adminBackend.unexpected });
  await a.context.close();
}
await env.close();
fs.writeFileSync(`${out}/axe-summary.json`, JSON.stringify(summary, null, 1));
const errors = summary.filter((s) => /ERROR|unexpected|pageerrors/.test(s.screen));
console.log(`captured ${summary.length - errors.length} screens to ${out}`);
if (errors.length) console.log(JSON.stringify(errors, null, 1));
