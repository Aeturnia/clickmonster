// The game's public name and address, in one place (landing scope, section 6; Monstra Regna
// scope, MR-B1). The name players see also appears in index.html, admin.html, admin.js, main.js
// and manifest.webmanifest; tests/identity.test.mjs checks that no old name is left.
// SITE_ORIGIN is the trusted address for canonical and link-preview URLs on the article pages:
// never taken from a request's Host header.
export const SITE_NAME = 'Monstra Regna';
export const SITE_ORIGIN = 'https://monstraregna.com';

// The public pages' menu and footer (Monstra Regna scope, MR-B2, 4.2 and 4.3). The news pages draw
// them from here. index.html and the static pages (guide/, leaderboard/, contact/) carry the same
// markup as plain HTML, with no script; tests/site-pages.test.mjs checks they match these.
// Contact is in because its address reaches a monitored inbox (D8, confirmed by the owner,
// 2026-11-19). Discord joins the menu only once a permanent invite exists (D9). Privacy and Terms
// join the footer only once the legal milestone delivers them (D7): no dead links.
// The year is fixed text: updating it is a yearly task (CLAUDE.md).
export const CONTACT_EMAIL = 'support@monstraregna.com';
export const COPYRIGHT_HTML = '&copy; 2026 Aeturnis Development Labs, LLC';
export const MENU = [['Home', '/'], ['Guide', '/guide'], ['Leaderboard', '/leaderboard'], ['Contact', '/contact']];
export const menuHtml = (current) => `<nav class="site-nav" aria-label="Site"><ul>${MENU.map(([label, href]) => `<li><a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}</ul></nav>`;
export const footerHtml = () => `<footer class="site-foot"><p>${COPYRIGHT_HTML}</p><ul><li><a href="/contact">Contact</a></li></ul></footer>`;
