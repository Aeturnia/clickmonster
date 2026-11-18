// Desktop layout measurements on the UI test harness (fake backend, never the live one).
//   node tools/desktop-metrics.mjs [out.json] [sizes]      sizes like "1440x900,1920x1080"
// Set UI_PUBLIC_DIR to measure another checkout's public/ folder (for "before" numbers).
//
// Definitions (Explore, standing in Bramblebrook Meadows Village; Battle, at the first turn):
//   appShare        #app width as a percentage of the window width
//   contentW        from the leftmost to the rightmost visible block in #main (not .sr-only)
//   gapToSide       from the right edge of #main's content to the left edge of the side column
//   sideEmpty       empty height in the side column above the chat line: from the lowest block
//                   above it (the hero bar in the Phase 2 layout; the summary or minimap on
//                   desktop) to the chat line
//                   With the persistent chat panel (D-2) there is no chat line: the empty height
//                   is what is left below the side column's last block
//   The side column is #side when the desktop layout shows it, otherwise the column holding #top.
//   chatPanel       whether the persistent chat panel is mounted
//   chatInputInView whether the chat message box is entirely within the window (panel only)
//   chatLines       how many lines of text the panel's message list has room for (its inner
//                   height divided by the list's line height), panel only
//   mainEmptyBelow  empty height in #main below its content (Explore)
//   bodyFont        computed body font size
//   battle.eyeTravel distance from the centre of the bottom edge of the battle log to the centre
//                   of the top edge of the first battle action, at the start of a fight (the log
//                   grows during a fight, so this is the largest it is)
//   battle.gap      from the bottom of the battle log to the top of the actions, at the start
//   battle.inColumn whether every battle action lies within the log's left and right edges
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/desktop-metrics.json';
const sizes = (process.argv[3] || '1024x768,1280x800,1366x768,1440x900,1536x864,1920x1080,2560x1440')
  .split(',').map((s) => s.split('x').map(Number));

const EXPLORE = () => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const app = r('app'); const top = r('top'); const chat = r('chatbar'); const main = r('main');
  const sideEl = document.getElementById('side');
  const side = sideEl && sideEl.getClientRects().length ? sideEl.getBoundingClientRect() : top;
  const above = ['top', 'summary', 'minimap'].map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length)
    .map((e) => e.getBoundingClientRect()).filter((b) => b.left >= side.left - 1 && b.bottom <= chat.top + 1);
  const kids = [...document.getElementById('main').children].filter((e) => e.getClientRects().length && !e.classList.contains('sr-only'));
  const box = (f) => f(...kids.map((e) => e.getBoundingClientRect()));
  const right = box((...b) => Math.max(...b.map((x) => x.right)));
  const left = box((...b) => Math.min(...b.map((x) => x.left)));
  const bottom = box((...b) => Math.max(...b.map((x) => x.bottom)));
  const panelEl = document.getElementById('chatpanel');
  const panelOn = !!(panelEl && panelEl.getClientRects().length);
  let sideEmpty;
  if (panelOn) {
    const blocks = [...sideEl.children].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().bottom);
    sideEmpty = Math.round(Math.min(side.bottom, innerHeight) - Math.max(side.top, ...blocks));
  } else {
    sideEmpty = Math.round(chat.top - Math.max(side.top, ...above.map((b) => b.bottom)));
  }
  const input = panelOn && panelEl.querySelector('#chat-input')?.getBoundingClientRect();
  const list = panelOn && panelEl.querySelector('#chat-list');
  const lineH = list ? parseFloat(getComputedStyle(list).lineHeight) || 0 : 0;
  return {
    appW: Math.round(app.width), appShare: Math.round((app.width / innerWidth) * 100),
    contentW: Math.round(right - left), gapToSide: Math.round(side.left - right),
    sideW: Math.round(side.width), sideEmpty,
    ...(panelOn ? {
      chatPanel: true,
      chatInputInView: input.top >= 0 && input.bottom <= innerHeight && input.left >= 0 && input.right <= innerWidth,
      chatLines: lineH ? Math.floor(list.clientHeight / lineH) : null,
    } : {}),
    mainEmptyBelow: Math.max(0, Math.round(main.bottom - bottom)),
    bodyFont: getComputedStyle(document.body).fontSize,
  };
};
const BATTLE = () => {
  const log = document.getElementById('log')?.getBoundingClientRect();
  const act = document.querySelector('.dock-battle button')?.getBoundingClientRect();
  if (!log || !act) return null;
  const acts = [...document.querySelectorAll('.dock-battle button')].map((b) => b.getBoundingClientRect());
  return {
    logBottom: Math.round(log.bottom), actionTop: Math.round(act.top), gap: Math.round(act.top - log.bottom),
    inColumn: acts.every((a) => a.left >= log.left - 1 && a.right <= log.right + 1),
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
    // Gameplay polish F2: monsters roam outside the village, so the fight starts one step north.
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
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
