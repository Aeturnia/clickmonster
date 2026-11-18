// The game's public name and address, in one place (landing scope, section 6; Monstra Regna
// scope, MR-B1). The name players see also appears in index.html, admin.html, admin.js, main.js
// and manifest.webmanifest; tests/identity.test.mjs checks that no old name is left.
// SITE_ORIGIN is the trusted address for canonical and link-preview URLs on the article pages:
// never taken from a request's Host header.
export const SITE_NAME = 'Monstra Regna';
export const SITE_ORIGIN = 'https://monstraregna.com';
