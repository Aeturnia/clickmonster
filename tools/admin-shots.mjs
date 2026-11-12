// Captures every admin console section at the Phase 4 widths with the UI test harness (fake
// backend, never the live one): a screenshot, an axe summary (all impacts) and layout metrics.
//   node tools/admin-shots.mjs <out-dir> [widths]
// Set UI_PUBLIC_DIR to capture another checkout's public/ folder.
import fs from 'node:fs';
import { setup, signIn, FakeBackend, makeHero, axe, ADMIN_CHAT, ADMIN_REPORTS } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/admin';
const widths = (process.argv[3] || '320,390,768,1024,1440').split(',').map(Number);
const HEIGHT = { 320: 640, 390: 844, 768: 1024, 1024: 768, 1440: 900 };
fs.mkdirSync(out, { recursive: true });
const METRICS = () => {
  const vw = innerWidth;
  const admin = document.getElementById('admin');
  const els = [...admin.querySelectorAll('*')];
  const offRight = els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest('[data-scroll], .table-scroll, .map-scroll'); }).length;
  const scrollers = [...admin.querySelectorAll('.box, .table-scroll')].filter((b) => b.scrollWidth > b.clientWidth + 1).length;
  const ths = [...admin.querySelectorAll('th')];
  const targets = [...admin.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')].filter((e) => e.getClientRects().length);
  // A checkbox inside its label: the label is the target.
  const small = targets.filter((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 24 && !e.closest('.map') && !(e.matches('input[type=checkbox], input[type=radio]') && e.closest('label') && e.closest('label').getBoundingClientRect().height >= 24); }).length;
  const nav = document.querySelector('#admin nav');
  const navR = nav ? nav.getBoundingClientRect() : null;
  const firstContent = admin.querySelector('#section-title')?.getBoundingClientRect().top;
  return {
    hOverflow: document.documentElement.scrollWidth > vw + 1, offRight, sidewaysBoxes: scrollers,
    inlineStyles: [...admin.querySelectorAll('[style]')].filter((e) => e.getAttribute('style').trim() && !/^\s*(--[\w-]+\s*:[^;]+;?\s*)+$/.test(e.getAttribute('style'))).length,
    inlineStyleSamples: [...new Set([...admin.querySelectorAll('[style]')].map((e) => e.getAttribute('style')).filter((v) => v.trim() && !/^\s*(--[\w-]+\s*:[^;]+;?\s*)+$/.test(v)))].slice(0, 6), tables: admin.querySelectorAll('table').length,
    thScoped: ths.filter((h) => h.scope).length, thTotal: ths.length, clickRows: admin.querySelectorAll('tr.click').length,
    smallTargets: small, navH: navR ? Math.round(navR.height) : null, contentTop: firstContent != null ? Math.round(firstContent) : null,
  };
};

const env = await setup();
const summary = [];
for (const w of widths) {
  const h = HEIGHT[w] || 900;
  const backend = new FakeBackend({ hero: makeHero(), chat: structuredClone(ADMIN_CHAT), reports: ADMIN_REPORTS });
  const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
  const shot = async (name) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${w}-${name}.png`, fullPage: false });
    const v = await axe(page, { minImpact: 'minor' }).catch((e) => [{ id: `axe-error:${e.message}` }]);
    summary.push({ width: w, screen: name, violations: v.map((x) => `${x.id}:${x.impact}`), metrics: await page.evaluate(METRICS) });
  };
  // On phones a section can sit in a collapsed group: open its group first (older layouts had none).
  const go = async (tab) => {
    const sel = `[data-a="tab"][data-v="${tab}"]`;
    if (!(await page.isVisible(sel))) { const g = await page.getAttribute(sel, 'data-group'); if (g) await page.click(`[data-a="navgroup"][data-v="${g}"]`); }
    await page.click(sel); await page.waitForTimeout(500);
  };
  try {
    await signIn(page, env.url, 'admin', '/admin.html');
    await page.waitForSelector('.tiles', { timeout: 15000 });
    await shot('dashboard');
    await go('players'); await shot('players');
    await page.click('#admin [data-a="open"][data-v="char-player"]'); await page.waitForSelector('#sanction'); await shot('player');
    await go('chat'); await shot('chat');
    await go('world'); await shot('world');
    await go('hunts'); await shot('hunts');
    await go('economy'); await shot('economy');
    await go('zones'); await shot('zones');
    await page.click('button[data-a="zoneEdit"]'); await page.waitForTimeout(400); await shot('zone-editor');
    await go('announce'); await shot('announce');
    await go('log'); await shot('log');
    await go('staff'); await shot('staff');
  } catch (err) {
    summary.push({ width: w, screen: 'ERROR', error: err.message.split('\n')[0] });
  }
  if (page.errors.length) summary.push({ width: w, screen: 'pageerrors', errors: page.errors });
  if (backend.unexpected.length) summary.push({ width: w, screen: 'unexpected', urls: backend.unexpected });
  await context.close();
}
await env.close();
fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 1));
for (const s of summary) console.log(JSON.stringify({ w: s.width, s: s.screen, v: s.violations, ...s.metrics, e: s.error }));
