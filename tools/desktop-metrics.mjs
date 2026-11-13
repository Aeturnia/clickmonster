// Desktop layout measurements on the UI test harness (fake backend, never the live one).
//   node tools/desktop-metrics.mjs [out.json] [sizes]      sizes like "1440x900,1920x1080"
// Set UI_PUBLIC_DIR to measure another checkout's public/ folder (for "before" numbers).
//
// Definitions (Explore, standing in Bramblebrook Meadows Village; Battle, at the first turn):
//   appShare        #app width as a percentage of the window width
//   contentW        width of the widest visible block in #main
//   gapToSide       from the right edge of #main's content to the left edge of the side column
//   sideEmpty       empty height in the side column, between the hero bar and the chat line
//   mainEmptyBelow  empty height in #main below its content (Explore)
//   bodyFont        computed body font size
//   battle.eyeTravel distance from the centre of the bottom edge of the battle log to the centre
//                   of the top edge of the first battle action, at the start of a fight (the log
//                   grows during a fight, so this is the largest it is)
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/desktop-metrics.json';
const sizes = (process.argv[3] || '1024x768,1280x800,1366x768,1440x900,1536x864,1920x1080,2560x1440')
  .split(',').map((s) => s.split('x').map(Number));

const EXPLORE = () => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const app = r('app'); const top = r('top'); const chat = r('chatbar'); const main = r('main');
  const kids = [...document.getElementById('main').children].filter((e) => e.getClientRects().length);
  const box = (f) => f(...kids.map((e) => e.getBoundingClientRect()));
  const right = box((...b) => Math.max(...b.map((x) => x.right)));
  const left = box((...b) => Math.min(...b.map((x) => x.left)));
  const bottom = box((...b) => Math.max(...b.map((x) => x.bottom)));
  return {
    appW: Math.round(app.width), appShare: Math.round((app.width / innerWidth) * 100),
    contentW: Math.round(right - left), gapToSide: Math.round(top.left - right),
    sideW: Math.round(top.width), sideEmpty: Math.round(chat.top - top.bottom),
    mainEmptyBelow: Math.max(0, Math.round(main.bottom - bottom)),
    bodyFont: getComputedStyle(document.body).fontSize,
  };
};
const BATTLE = () => {
  const log = document.getElementById('log')?.getBoundingClientRect();
  const act = document.querySelector('.dock-battle button')?.getBoundingClientRect();
  if (!log || !act) return null;
  return {
    logBottom: Math.round(log.bottom), actionTop: Math.round(act.top),
    eyeTravel: Math.round(Math.hypot(act.left + act.width / 2 - (log.left + log.width / 2), act.top - log.bottom)),
  };
};

const env = await setup();
const rows = [];
for (const [w, h] of sizes) {
  const backend = new FakeBackend({ hero: makeHero() });
  const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: false });
  try {
    await signIn(page, env.url, 'player');
    await page.waitForSelector('#dock .dock-explore', { timeout: 15000 });
    await settle(page);
    const explore = await page.evaluate(EXPLORE);
    await page.click('#main [data-a="fight"]');
    await page.waitForSelector('.dock-battle', { timeout: 10000 });
    await settle(page);
    rows.push({ size: `${w}x${h}`, ...explore, battle: await page.evaluate(BATTLE) });
  } catch (err) {
    rows.push({ size: `${w}x${h}`, error: err.message.split('\n')[0] });
  }
  await context.close();
}
await env.close();
fs.mkdirSync(out.replace(/[/\\][^/\\]*$/, '') || '.', { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(JSON.stringify(r));
