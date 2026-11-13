// The shared public-news rules (public/js/data/news.js, landing L-3): validation, addresses and the
// plain-text body format. The admin console, the admin function and the article pages use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNews, slugify, newsBlocks, newsBodyHtml, canDeleteNews, slugLocked } from '../public/js/data/news.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const good = { kind: 'patch', title: 'Patch notes 1.2', summary: 'What changed in this release of the game.', body: 'Fixes.' };

test('slugify makes a lower-case address from a title', () => {
  assert.equal(slugify('Patch notes 1.2'), 'patch-notes-1-2');
  assert.equal(slugify('  Élan & Ægis: the "Return"!  '), 'elan-gis-the-return');
  assert.equal(slugify('---'), '');
  assert.equal(slugify('x'.repeat(100)).length, 80);
});

test('checkNews accepts a good entry and cleans it', () => {
  const { value, errors } = checkNews({ ...good, title: '  Patch   notes 1.2 ', body: 'Line one  \r\n\r\nLine two\n\n' });
  assert.deepEqual(errors, {});
  assert.equal(value.title, 'Patch notes 1.2');
  assert.equal(value.slug, 'patch-notes-1-2', 'derived from the title when empty');
  assert.equal(value.body, 'Line one\n\nLine two');
  assert.equal(value.startsAt, null);
});

test('checkNews refuses what the database would refuse, field by field', () => {
  const { errors } = checkNews({ kind: 'gossip', title: 'Hi', summary: 'short', body: '  ', slug: 'Bad Slug' });
  assert.deepEqual(Object.keys(errors).sort(), ['body', 'kind', 'slug', 'summary', 'title']);
  assert.match(checkNews({ ...good, body: 'x'.repeat(20001) }).errors.body, /too long/);
  assert.match(checkNews({ ...good, slug: 'ab' }).errors.slug, /3 to 80/);
  assert.match(checkNews({ ...good, slug: 'double--hyphen' }).errors.slug, /single hyphens/);
});

test('only maintenance keeps a window, and it must end after it starts', () => {
  const start = '2030-01-02T10:00:00.000Z';
  const end = '2030-01-02T12:00:00.000Z';
  assert.deepEqual(checkNews({ ...good, kind: 'maintenance', startsAt: start, endsAt: end }).value.endsAt, end);
  assert.equal(checkNews({ ...good, kind: 'update', startsAt: start, endsAt: end }).value.startsAt, null);
  assert.match(checkNews({ ...good, kind: 'maintenance', startsAt: end, endsAt: start }).errors.endsAt, /after the start/);
  assert.match(checkNews({ ...good, kind: 'maintenance', startsAt: 'soon' }).errors.startsAt, /valid start time/);
});

test('the body is paragraphs and bullet lists, plain text only', () => {
  assert.deepEqual(newsBlocks('One\ncontinues\n\n- a\n- b\nAfter the list\n\n\n- c'), [
    { type: 'p', text: 'One continues' },
    { type: 'ul', items: ['a', 'b'] },
    { type: 'p', text: 'After the list' },
    { type: 'ul', items: ['c'] },
  ]);
  assert.equal(newsBodyHtml('<b>x</b>\n\n- <script>y</script>', esc), '<p>&lt;b&gt;x&lt;/b&gt;</p>\n<ul><li>&lt;script&gt;y&lt;/script&gt;</li></ul>');
  assert.deepEqual(newsBlocks(''), []);
});

test('what each state allows', () => {
  assert.equal(canDeleteNews('draft'), true);
  assert.equal(canDeleteNews('unpublished'), true);
  assert.equal(canDeleteNews('published'), false);
  assert.equal(slugLocked({ published_at: null }), false);
  assert.equal(slugLocked({ published_at: '2026-11-13T00:00:00Z' }), true);
});

test('the edge functions import shared code only from folders the deploy script uploads', async () => {
  const fs = await import('node:fs');
  for (const fn of ['admin', 'game']) {
    const src = fs.readFileSync(new URL(`../supabase/functions/${fn}/index.ts`, import.meta.url), 'utf8');
    const shared = [...src.matchAll(/from '(\.\/js\/[^']+)'/g)].map((m) => m[1]);
    assert.ok(shared.length > 0, fn);
    for (const path of shared) assert.match(path, /^\.\/js\/(engine|data)\/[\w-]+\.js$/, `${fn}: ${path} is uploaded by tools/deploy-functions.mjs`);
  }
});
