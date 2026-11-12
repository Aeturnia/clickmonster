// Measures the Phase 2 responsive acceptance metrics with the UI test harness (fake backend).
//   node tools/ui-metrics.mjs <out.json>
// Set UI_PUBLIC_DIR to measure another checkout's public/ folder (for "before" numbers).
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero, bigZone, fakeKeyboard, setKeyboard, PAGE_METRICS } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/metrics.json';
const SIZES = [[320, 640], [375, 812], [390, 844], [430, 932], [844, 390], [1024, 768], [1440, 900]];
const env = await setup();
const rows = [];

for (const [w, h] of SIZES) {
  const label = `${w}x${h}`;
  const mobile = w < 900;
  const r = { size: label };
  try {
    // Explore and battle.
    let ctx = await env.page({ backend: new FakeBackend({ hero: makeHero() }), viewport: { width: w, height: h }, mobile });
    let { page } = ctx;
    await fakeKeyboard(page);
    await signIn(page, env.url, 'player');
    await page.waitForSelector('[data-a="move"]', { timeout: 15000 }); await settle(page);
    r.town = await page.evaluate(PAGE_METRICS);
    await page.click('[data-a="move"][data-v="n"]'); await settle(page);
    r.open = await page.evaluate(PAGE_METRICS);
    await page.click('#main [data-a="fight"]'); await settle(page);
    await page.waitForTimeout(300); await page.click('[data-a="melee"]'); await settle(page);
    r.battle = await page.evaluate(() => {
      // Room for the log: from its top to the bottom of the screen area (the log grows into it).
      const log = document.getElementById('log').getBoundingClientRect();
      const main = document.getElementById('main').getBoundingClientRect();
      const inView = (sel) => { const el = document.querySelector(sel); if (!el) return false; const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; };
      return { logH: Math.round(Math.max(0, Math.min(main.bottom, innerHeight) - log.top)), meleeInView: inView('[data-a="melee"]'), castInView: inView('[data-a="cast"]'), hOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    // Chat drawer, then a simulated on-screen keyboard (the visual viewport shrinks).
    await page.waitForTimeout(300);
    for (let i = 0; i < 30 && await page.$('[data-a="melee"]'); i++) { await page.click('[data-a="melee"]'); await settle(page); await page.waitForTimeout(260); }
    if (await page.$('[data-a="done"]')) { await page.click('[data-a="done"]'); await settle(page); }
    await page.click('.chatbar'); await page.waitForSelector('#chat[open]'); await page.waitForTimeout(300);
    const chatM = () => page.evaluate(() => {
      const i = document.getElementById('chat-input').getBoundingClientRect();
      const l = document.getElementById('chat-list').getBoundingClientRect();
      const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
      return { inputVisible: i.top >= 0 && i.bottom <= vh + 1, listH: Math.round(l.height) };
    });
    r.chat = await chatM();
    // An overlay keyboard (iOS style) covering 45% of the screen; the page itself keeps its size.
    await setKeyboard(page, Math.round(h * 0.45));
    await page.waitForTimeout(300);
    r.chatKeyboard = await chatM();
    await ctx.context.close();

    // Map: a 40x40 zone.
    const hero = makeHero({ zone: 'test-expanse', x: 33, y: 30 });
    ctx = await env.page({ backend: new FakeBackend({ hero, zones: [bigZone(40)] }), viewport: { width: w, height: h }, mobile });
    page = ctx.page;
    await signIn(page, env.url, 'player');
    await page.waitForSelector('[data-a="move"]', { timeout: 15000 }); await settle(page);
    await page.click('[data-a="tab"][data-v="map"]'); await settle(page);
    r.map = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.map [data-a="walk"]')];
      const c = cells[0].getBoundingClientRect();
      const me = document.querySelector('.map .me, .map [aria-current="location"]').getBoundingClientRect();
      const box = (document.querySelector('.map-scroll') || document.querySelector('.map')).getBoundingClientRect();
      const meVisible = me.top >= Math.max(0, box.top) - 1 && me.bottom <= Math.min(innerHeight, box.bottom) + 1 && me.left >= Math.max(0, box.left) - 1 && me.right <= Math.min(innerWidth, box.right) + 1;
      return { cell: Math.round(Math.min(c.width, c.height)), meVisible, tabStops: cells.filter((x) => x.tabIndex >= 0).length, hOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    await ctx.context.close();

    // 200% text.
    if (w === 390) {
      ctx = await env.page({ backend: new FakeBackend({ hero: makeHero() }), viewport: { width: w, height: h }, mobile });
      page = ctx.page;
      await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%'; }));
      await signIn(page, env.url, 'player');
      await page.waitForSelector('[data-a="move"]', { timeout: 15000 }); await settle(page);
      r.text200 = await page.evaluate(PAGE_METRICS);
      await ctx.context.close();
    }
  } catch (err) {
    r.error = err.message.split('\n')[0];
  }
  rows.push(r);
  console.log(JSON.stringify(r));
}
await env.close();
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 1));
