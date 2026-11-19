// Sign-out and session recovery evidence (docs/sign-out-scope.md, section 7): the screen a player
// is left on when their saved session has ended on the server (the owner's lockout), and after a
// failing sign-out, measured the same way on the old and the new version.
//   node tools/sign-out-evidence.mjs <out-dir>
// Set UI_PUBLIC_DIR to another checkout's public/ folder to measure that version instead.
// Fake backend only.
import fs from 'node:fs';
import { setup, signIn, FakeBackend, ACCOUNTS, savedSession, axe } from '../tests/ui/harness.mjs';

const out = process.argv[2] || 'tests/ui/artifacts/sign-out';
fs.mkdirSync(out, { recursive: true });
const env = await setup();
const summary = {};
const state = (page) => page.evaluate(() => {
  const shown = (id) => { const el = document.getElementById(id); return !!el && el.checkVisibility(); };
  return {
    form: shown('authform'), tryAgain: shown('gate-retry'), signOut: shown('gate-signout'), game: shown('app'),
    message: (document.getElementById('auth-msg')?.checkVisibility() && document.getElementById('auth-msg').textContent) || (shown('problem') && document.getElementById('problem').textContent.trim()) || '',
    saved: !!localStorage.getItem('clickmonster.auth'),
  };
});

try {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    // The owner's case: a saved session the server has ended (another device signed out).
    {
      const backend = new FakeBackend();
      const saved = savedSession(ACCOUNTS.player);
      backend.endSessions(ACCOUNTS.player);
      const { page, context } = await env.page({ backend, viewport: { width: w, height: h }, mobile: w < 900 });
      await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, ['clickmonster.auth', JSON.stringify(saved)]);
      await page.goto(`${env.url}/`);
      await page.waitForTimeout(6000);
      summary[`ended session at start-up, ${w}`] = await state(page);
      await page.screenshot({ path: `${out}/${w}-ended-session.png` });
      // Then the player presses Sign out, if it is there.
      if (await page.isVisible('#gate-signout')) { await page.click('#gate-signout'); await page.waitForTimeout(7000); }
      summary[`after pressing Sign out, ${w}`] = await state(page);
      summary[`axe, ${w}`] = (await axe(page, { minImpact: 'minor' })).map((v) => `${v.id}:${v.impact}`);
      await page.screenshot({ path: `${out}/${w}-after-sign-out.png` });
      await context.close();
    }
  }
  // A sign-out the server refuses, in the game.
  {
    const backend = new FakeBackend();
    const { page, context } = await env.page({ backend, viewport: { width: 390, height: 844 }, mobile: true });
    await signIn(page, env.url, 'player');
    await page.waitForSelector('#top .hud-row', { timeout: 15000 });
    backend.logoutFail = 500;
    await page.click('[data-a="tab"][data-v="hero"]');
    await page.click('#main [data-a="signout"]');
    await page.waitForTimeout(7000);
    summary['in-game Sign out refused by the server (500), 390'] = { ...(await state(page)), logouts: backend.logouts };
    await page.screenshot({ path: `${out}/390-sign-out-refused.png` });
    await context.close();
  }
} finally {
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  await env.close();
}
console.log(JSON.stringify(summary, null, 2));
