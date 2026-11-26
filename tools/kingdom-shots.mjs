// Captures the Kingdom screens (K-1, K1-3) with the UI test harness (fake backend, never the live
// one), with Kingdoms opened in the browser and in the fake game function, plus an axe summary.
//   node tools/kingdom-shots.mjs <out-dir> [sizes]
// Sizes: "390" (height chosen automatically) or "740x360". The closed screens are ui-shots.mjs's.
import fs from 'node:fs';
import { setup, signIn, settle, FakeBackend, makeHero, axe, kingdomsOn } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/kingdom-shots';
const sizes = (process.argv[3] || '320,740x360,390,1440').split(',').map((v) => (v.includes('x') ? v.split('x').map(Number) : [Number(v), null]));
fs.mkdirSync(out, { recursive: true });
const summary = [];
const PLOTS = [
  { x: 3, y: 2, status: 'claimed', name: 'Alda' }, { x: 7, y: 4, status: 'claimed', name: 'Grubnak' },
  { x: 5, y: 5, status: 'reserved' }, { x: 6, y: 5, status: 'reserved' },
];

const env = await setup();
for (const [w, hh] of sizes) {
  const h = hh || (w >= 1000 ? 900 : w <= 320 ? 640 : 844);
  const tag = hh ? `${w}x${hh}` : `${w}`;
  const backend = new FakeBackend({ hero: makeHero({ zone: 'kingdoms', x: 1, y: 1 }), kingdoms: { plots: PLOTS } });
  const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${tag}-${name}.png` });
    const v = await axe(page, { minImpact: 'minor' });
    summary.push({ size: tag, screen: name, violations: v.map((x) => `${x.id}:${x.impact}`) });
  };
  try {
    await kingdomsOn(page);
    await signIn(page, env.url);
    await page.waitForSelector('#main .place', { timeout: 15000 });
    await settle(page);
    await shot('kingdoms-explore');
    await page.click('[data-a="tab"][data-v="map"]');
    await page.waitForSelector('.plots [data-a="kplot"]');
    await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
    await settle(page);
    await shot('plot-map');
    await page.click('.plots [data-v="4,6"]'); await settle(page);
    await shot('plot-selected');
    await page.click('[data-a="kclaim"]'); await page.waitForSelector('#confirm[open]');
    await shot('claim-dialog');
    await page.click('#confirm [data-r="ok"]'); await settle(page);
    await page.waitForFunction(() => !document.querySelector('.plots button.loading'));
    await shot('plot-map-claimed');
    await page.click('[data-a="tab"][data-v="hero"]'); await settle(page);
    await page.evaluate(() => [...document.querySelectorAll('#main h3')].find((e) => e.textContent === 'Kingdom')?.scrollIntoView());
    await shot('hero-kingdom');
    await page.click('#main [data-a="kmanage"]'); await page.waitForSelector('#sheet [data-a="krelease"]');
    await shot('manage-sheet');
  } catch (err) {
    summary.push({ size: tag, screen: 'ERROR', error: err.message.split('\n')[0] });
  }
  if (page.errors.length) summary.push({ size: tag, screen: 'pageerrors', errors: page.errors });
  if (backend.unexpected.length) summary.push({ size: tag, screen: 'unexpected-requests', urls: backend.unexpected });
  await context.close();
}
await env.close();
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 1));
const bad = summary.filter((s) => s.screen === 'ERROR' || (s.violations && s.violations.length) || s.errors || s.urls);
console.log(`captured ${summary.filter((s) => s.violations).length} screens to ${out}; ${bad.length ? `${bad.length} problems:\n${JSON.stringify(bad, null, 1)}` : 'axe: 0 violations of any impact'}`);
