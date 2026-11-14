-- Database tests for public news (landing L-3, LAC-14). Run on the local stack:
--   npx supabase test db
-- Each run is one transaction, rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(42);

-- ------------------------------------------------------------ fixtures (as the table owner)
insert into public.news (slug, kind, title, summary, body, status, published_at) values
  ('visible-update', 'update', 'Visible update', 'Published and live, so anyone can read it.', 'Body', 'published', now() - interval '1 day'),
  ('future-update', 'update', 'Future update', 'Published, but its publication time has not come.', 'Body', 'published', now() + interval '1 day'),
  ('draft-update', 'update', 'Draft update', 'A draft that has never been published at all.', 'Body', 'draft', null),
  ('pulled-update', 'update', 'Pulled update', 'Published once, then unpublished by an admin.', 'Body', 'unpublished', now() - interval '2 days');

-- ------------------------------------------------------------ the public (anon)
set local role anon;
select results_eq($$ select slug from public.news order by slug $$, $$ values ('visible-update') $$,
  'anon reads only the published row whose time has passed');
select is((select count(*)::int from public.news where slug = 'draft-update'), 0, 'anon: a draft is hidden');
select is((select count(*)::int from public.news where slug = 'pulled-update'), 0, 'anon: an unpublished entry is hidden');
select is((select count(*)::int from public.news where slug = 'future-update'), 0, 'anon: a future publication is hidden');
select lives_ok($$ select id, slug, kind, title, summary, body, published_at, revised_at, maintenance_starts_at, maintenance_ends_at from public.news $$,
  'anon can select every article column');
select throws_ok($$ select status from public.news $$, '42501', null, 'anon: status is not readable');
select throws_ok($$ select created_by from public.news $$, '42501', null, 'anon: created_by is not readable');
select throws_ok($$ select updated_by from public.news $$, '42501', null, 'anon: updated_by is not readable');
select throws_ok($$ select created_at from public.news $$, '42501', null, 'anon: created_at is not readable');
select throws_ok($$ select updated_at from public.news $$, '42501', null, 'anon: updated_at is not readable');
select throws_ok($$ select * from public.news $$, '42501', null, 'anon: select * is refused');
select throws_ok($$ select slug from public.news where status = 'draft' $$, '42501', null, 'anon: filtering on status is refused');
select throws_ok($$ insert into public.news (slug, title, summary, body) values ('rls-check-anon', 'Anon write', 'An anonymous write attempt.', 'x') $$,
  '42501', null, 'anon: insert is refused');
select throws_ok($$ update public.news set title = 'Changed by anon' $$, '42501', null, 'anon: update is refused');
select throws_ok($$ delete from public.news $$, '42501', null, 'anon: delete is refused');
reset role;

-- ------------------------------------------------------------ signed-in players (authenticated)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq($$ select slug from public.news order by slug $$, $$ values ('visible-update') $$,
  'authenticated reads only the published row whose time has passed');
select throws_ok($$ select status from public.news $$, '42501', null, 'authenticated: status is not readable');
select throws_ok($$ select created_by from public.news $$, '42501', null, 'authenticated: created_by is not readable');
select throws_ok($$ select * from public.news $$, '42501', null, 'authenticated: select * is refused');
select throws_ok($$ insert into public.news (slug, title, summary, body) values ('rls-check-auth', 'Player write', 'A signed-in write attempt.', 'x') $$,
  '42501', null, 'authenticated: insert is refused');
select throws_ok($$ update public.news set title = 'Changed by a player' $$, '42501', null, 'authenticated: update is refused');
select throws_ok($$ delete from public.news $$, '42501', null, 'authenticated: delete is refused');
reset role;

-- ------------------------------------------------------------ the service role (the admin function)
set local role service_role;
select is((select count(*)::int from public.news), 4, 'service role sees every row, drafts included');
select lives_ok($$ insert into public.news (slug, title, summary, body) values ('service-draft', 'Service draft', 'Written through the admin function.', 'Body') $$,
  'service role can create a draft');
select lives_ok($$ update public.news set title = 'Service draft, edited' where slug = 'service-draft' $$, 'service role can edit a draft');
select lives_ok($$ update public.news set slug = 'service-draft-renamed' where slug = 'service-draft' $$, 'a draft''s address can change');
reset role;

-- ------------------------------------------------------------ publication rules (Q8), for any writer
select throws_ok($$ update public.news set slug = 'visible-renamed' where slug = 'visible-update' $$, '23514', null,
  'a published entry''s address can''t change');
select throws_ok($$ update public.news set slug = 'pulled-renamed' where slug = 'pulled-update' $$, '23514', null,
  'an unpublished entry''s address can''t change either');
select throws_ok($$ update public.news set published_at = now() where slug = 'visible-update' $$, '23514', null,
  'the first publication time can''t change');
select throws_ok($$ delete from public.news where slug = 'visible-update' $$, '23514', null, 'a published entry can''t be deleted');
select lives_ok($$ update public.news set status = 'unpublished' where slug = 'visible-update' $$, 'a published entry can be unpublished');
select lives_ok($$ update public.news set status = 'published' where slug = 'visible-update' $$, 'and published again');
select is((select published_at < now() - interval '23 hours' from public.news where slug = 'visible-update'), true,
  'republishing keeps the original publication time');
select lives_ok($$ update public.news set title = 'Visible update, corrected', revised_at = now() where slug = 'visible-update' $$,
  'a published entry''s text can be corrected, marked as revised');
select lives_ok($$ delete from public.news where slug = 'pulled-update' $$, 'an unpublished entry can be deleted');
select lives_ok($$ delete from public.news where slug = 'draft-update' $$, 'a draft can be deleted');

-- ------------------------------------------------------------ constraints
select throws_ok($$ insert into public.news (slug, title, summary, body, status, published_at) values ('bad-draft', 'Bad draft', 'A draft with a publication time.', 'x', 'draft', now()) $$,
  '23514', null, 'a draft has no publication time');
select throws_ok($$ insert into public.news (slug, title, summary, body, status) values ('bad-published', 'Bad published', 'Published without a publication time.', 'x', 'published') $$,
  '23514', null, 'a published entry has a publication time');
select throws_ok($$ insert into public.news (slug, title, summary, body) values ('Bad Slug!', 'Bad slug', 'An address with capitals and spaces.', 'x') $$,
  '23514', null, 'the address format is enforced');
select throws_ok($$ insert into public.news (slug, kind, title, summary, body, maintenance_starts_at) values ('window-on-update', 'update', 'Window', 'A maintenance window on an update.', 'x', now()) $$,
  '23514', null, 'only maintenance has a window');
select throws_ok($$ insert into public.news (slug, kind, title, summary, body, maintenance_starts_at, maintenance_ends_at) values ('backwards', 'maintenance', 'Backwards', 'A window that ends before it starts.', 'x', now(), now() - interval '1 hour') $$,
  '23514', null, 'a maintenance window ends after it starts');
select throws_ok($$ insert into public.news (slug, title, summary, body) values ('visible-update', 'Duplicate', 'An address that is already taken.', 'x') $$,
  '23505', null, 'addresses are unique');

select * from finish();
rollback;
