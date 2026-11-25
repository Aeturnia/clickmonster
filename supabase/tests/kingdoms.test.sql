-- Database tests for Kingdoms K1-1 (#83; docs/kingdoms-k1-plan.md, 2.1; docs/kingdoms-scope.md, 5.3.1).
-- Run on the local stack: npx supabase test db. Each run is one transaction, rolled back at the end,
-- so now() is fixed for the whole run: that is what makes the revoke's finish boundary exact.
--
-- Every failure case is followed by checks of the state after it (the plot, the hero, the rewards,
-- the audit log). That is what proves the rollback, not the error alone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(140);

-- ------------------------------------------------------------ fixtures (as the table owner)
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000ab01', 'kingdom-one@example.test'),
  ('00000000-0000-4000-8000-00000000ab02', 'kingdom-two@example.test'),
  ('00000000-0000-4000-8000-00000000ab03', 'kingdom-three@example.test');
insert into public.characters (id, user_id, name, race, level, zone, x, y, data, version, updated_at) values
  ('00000000-0000-4000-8000-00000000cb01', '00000000-0000-4000-8000-00000000ab01', 'Kingtest One', 'human', 5, 'kingdoms', 1, 1, '{"gold": 1000}', 3, now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000cb02', '00000000-0000-4000-8000-00000000ab02', 'Kingtest Two', 'human', 5, 'kingdoms', 1, 1, '{"gold": 2000}', 7, now() - interval '1 day'),
  ('00000000-0000-4000-8000-00000000cb03', '00000000-0000-4000-8000-00000000ab03', 'Kingtest Three', 'human', 5, 'kingdoms', 1, 1, '{"gold": 3000}', 0, now() - interval '1 day');
insert into public.pending_rewards (character_id, source, gold, note, claimed_at) values
  ('00000000-0000-4000-8000-00000000cb01', 'hunt', 100, 'kr-one-a', null),
  ('00000000-0000-4000-8000-00000000cb01', 'hunt', 200, 'kr-one-b', null),
  ('00000000-0000-4000-8000-00000000cb02', 'hunt', 300, 'kr-two-a', null);

create temporary table ids on commit drop as
  select note, id from public.pending_rewards where note like 'kr-%';
create temporary table nowms on commit drop as
  select floor(extract(epoch from now()) * 1000)::bigint as ms;

-- A hero's data with a Kingdom on (x, y), optionally with a construction record.
create function pg_temp.with_kingdom(base jsonb, px int, py int, construction jsonb default null) returns jsonb
language sql as $$
  select base || jsonb_build_object('kingdom',
    jsonb_build_object('plot', jsonb_build_object('x', px, 'y', py), 'claimedAt', 1)
    || case when construction is null then '{}'::jsonb else jsonb_build_object('construction', construction) end)
$$;

-- An audit log that refuses every insert, to prove the admin functions are all or nothing.
-- A real function, not pg_temp, so a trigger on a permanent table can use it. The run rolls back.
create function public.kingdom_test_refuse_audit() returns trigger language plpgsql as $$
begin raise exception 'audit refused (test)'; end $$;

-- ------------------------------------------------------------ the table
select has_table('public', 'kingdom_plots', 'kingdom_plots exists');
select col_is_pk('public', 'kingdom_plots', array['x', 'y'], 'its primary key is (x, y)');
select ok((select relrowsecurity from pg_class where oid = 'public.kingdom_plots'::regclass), 'RLS is on');
-- has_column_privilege() is true for a column OR a table-level grant, so these cover both (K1-DB03).
select ok((select bool_and(has_column_privilege('authenticated', 'public.kingdom_plots', c, 'select'))
           from unnest(array['id', 'x', 'y', 'status', 'character_id', 'claimed_at']) as c),
  'authenticated can read all six plot columns');
select ok((select not bool_or(has_column_privilege('anon', 'public.kingdom_plots', c, 'select, insert, update, references'))
           from unnest(array['id', 'x', 'y', 'status', 'character_id', 'claimed_at']) as c)
          and not has_table_privilege('anon', 'public.kingdom_plots', 'delete, truncate, trigger'),
  'anon has no privilege on the table or any column');
select ok((select not bool_or(has_column_privilege('authenticated', 'public.kingdom_plots', c, 'insert, update, references'))
           from unnest(array['id', 'x', 'y', 'status', 'character_id', 'claimed_at']) as c)
          and not has_table_privilege('authenticated', 'public.kingdom_plots', 'delete, truncate, trigger'),
  'authenticated can''t write the table or any column');
select is((select count(*)::int from pg_policy where polrelid = 'public.kingdom_plots'::regclass), 1,
  'the table has exactly one policy');
select ok((select polcmd = 'r' and polpermissive and polroles = array[(select oid from pg_roles where rolname = 'authenticated')]
                  and pg_get_expr(polqual, polrelid) = 'true' and polwithcheck is null
           from pg_policy where polrelid = 'public.kingdom_plots'::regclass),
  'that policy lets authenticated read every row, and nothing else');
select throws_ok($$ insert into public.kingdom_plots (x, y, status) values (0, 1, 'reserved') $$,
  '23514', null, 'x below 1 is refused');
select throws_ok($$ insert into public.kingdom_plots (x, y, status) values (1, 101, 'reserved') $$,
  '23514', null, 'y above 100 is refused');
select throws_ok($$ insert into public.kingdom_plots (x, y, status, character_id) values (2, 2, 'claimed', null) $$,
  '23514', null, 'a claimed plot without an owner is refused');
select throws_ok($$ insert into public.kingdom_plots (x, y, status, character_id) values (2, 2, 'reserved', '00000000-0000-4000-8000-00000000cb03') $$,
  '23514', null, 'a reserved plot with an owner is refused');
select throws_ok($$ insert into public.kingdom_plots (x, y, status) values (2, 2, 'abandoned') $$,
  '23514', null, 'an unknown status is refused');

-- ------------------------------------------------------------ the functions and their privileges
select ok((select p.prosecdef and 'search_path=public' = any (p.proconfig)
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.kingdom_claim(uuid,integer,jsonb,text,integer,text,integer,integer,integer,integer,bigint[])')),
  'kingdom_claim(): security definer, search_path public, service_role only');
select ok((select p.prosecdef and 'search_path=public' = any (p.proconfig)
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.kingdom_release(uuid,integer,jsonb,text,integer,text,integer,integer,bigint,bigint[])')),
  'kingdom_release(): security definer, search_path public, service_role only');
select ok((select bool_and(p.prosecdef and 'search_path=public' = any (p.proconfig)
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
           from pg_proc p where p.oid in (
             to_regprocedure('public.kingdom_revoke(integer,integer,bigint,uuid,uuid,text,text)'),
             to_regprocedure('public.kingdom_reserve(integer,integer,uuid,text,text)'),
             to_regprocedure('public.kingdom_unreserve(integer,integer,bigint,uuid,text,text)'))
           having count(*) = 3),
  'kingdom_revoke(), kingdom_reserve() and kingdom_unreserve(): security definer, search_path public, service_role only');
select is((select format_type(prorettype, null) from pg_proc where oid = to_regprocedure('public.kingdom_revoke(integer,integer,bigint,uuid,uuid,text,text)')),
  'bigint', 'kingdom_revoke() returns the refund as bigint (K1-DB02)');
select ok((select p.prosecdef
             and not has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.kingdom_claim_staged_rewards(uuid,bigint[])')),
  'the private reward helper: nobody can call it directly, not even service_role');
select ok((select p.provolatile = 'v' and not p.prosecdef
             and has_function_privilege('authenticated', p.oid, 'execute')
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
           from pg_proc p where p.oid = to_regprocedure('public.kingdom_free_plot(integer,integer,boolean)')),
  'kingdom_free_plot(): volatile, security invoker, authenticated and service_role only (Q1)');
select function_returns('public', 'save_hero_with_rewards',
  array['uuid', 'integer', 'jsonb', 'text', 'integer', 'text', 'integer', 'integer', 'bigint[]'], 'integer',
  'save_hero_with_rewards() is still there, unchanged in signature');

set local role authenticated;
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3, '{}', 'x', 1, 'kingdoms', 1, 1, 1, 1, array[]::bigint[]) $$,
  '42501', null, 'authenticated: calling kingdom_claim() is refused');
select throws_ok($$ select public.kingdom_claim_staged_rewards('00000000-0000-4000-8000-00000000cb01', array[]::bigint[]) $$,
  '42501', null, 'authenticated: calling the private helper is refused');
reset role;
set local role anon;
select throws_ok($$ select * from public.kingdom_free_plot(1, 1, false) $$,
  '42501', null, 'anon: calling the finder is refused');
reset role;

-- ------------------------------------------------------------ claim: bad arguments (MRARG)
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    pg_temp.with_kingdom('{"gold": 900}', 0, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, 0, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: a plot outside 1 to 100 is refused');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    null, 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: null p_data is refused');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    '[1, 2]', 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: p_data that isn''t an object is refused');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    '{"gold": 900}', 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: p_data without a kingdom is refused (I-1)');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    '{"gold": 900, "kingdom": "yes"}', 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: a kingdom that isn''t an object is refused');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    pg_temp.with_kingdom('{"gold": 900}', 6, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'claim: a kingdom.plot that isn''t the plot claimed is refused (I-1)');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    pg_temp.with_kingdom('{"gold": 900}', 5, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5, null) $$,
  'MRARG', 'bad_arguments', 'claim: a null reward set is refused');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    pg_temp.with_kingdom('{"gold": 900}', 5, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5,
    array[(select id from ids where note = 'kr-one-a'), (select id from ids where note = 'kr-one-a')]) $$,
  'MRARG', 'bad_arguments', 'claim: a duplicate reward id is refused');
select ok(not exists (select 1 from public.kingdom_plots where x = 5 and y = 5)
          and (select version from public.characters where id = '00000000-0000-4000-8000-00000000cb01') = 3
          and (select count(*) from public.pending_rewards where note like 'kr-one-%' and claimed_at is null) = 2,
  'after the refused claims: no plot, the hero unchanged, the rewards unclaimed');

-- ------------------------------------------------------------ claim: success, with staged rewards
select is(public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 3,
    pg_temp.with_kingdom('{"gold": 1200}', 5, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, 5, 5,
    array[(select id from ids where note = 'kr-one-a'), (select id from ids where note = 'kr-one-b')]),
  4, 'claim: returns the new version, p_version + 1');
select is((select character_id from public.kingdom_plots where x = 5 and y = 5 and status = 'claimed'),
  '00000000-0000-4000-8000-00000000cb01'::uuid, 'claim: the plot is claimed by the hero');
select ok((select version = 4 and data = pg_temp.with_kingdom('{"gold": 1200}', 5, 5)
                  and zone = 'kingdoms' and x = 1 and y = 1 and updated_at = now()
           from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'claim: the hero is saved with its data, public columns, version and updated_at');
select is((select count(*)::int from public.pending_rewards where note like 'kr-one-%' and claimed_at = now()), 2,
  'claim: the staged rewards are claimed in the same transaction');

-- ------------------------------------------------------------ claim: conflicts
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 4,
    pg_temp.with_kingdom('{"gold": 1200}', 6, 6), 'Kingtest One', 5, 'kingdoms', 1, 1, 6, 6, array[]::bigint[]) $$,
  'MRHAS', 'has_kingdom', 'claim: a hero who already has a plot is refused (MRHAS)');
select ok(not exists (select 1 from public.kingdom_plots where x = 6 and y = 6)
          and (select version from public.characters where id = '00000000-0000-4000-8000-00000000cb01') = 4,
  'after MRHAS: no second plot, the hero unchanged');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 7,
    pg_temp.with_kingdom('{"gold": 1500}', 5, 5), 'Kingtest Two', 5, 'kingdoms', 1, 1, 5, 5,
    array[(select id from ids where note = 'kr-two-a')]) $$,
  'MRPLT', 'plot_taken', 'claim: a plot another hero has is refused (MRPLT)');
select ok((select version from public.characters where id = '00000000-0000-4000-8000-00000000cb02') = 7
          and (select claimed_at from public.pending_rewards where note = 'kr-two-a') is null
          and (select character_id from public.kingdom_plots where x = 5 and y = 5) = '00000000-0000-4000-8000-00000000cb01',
  'after MRPLT: the hero unchanged, the reward pending, the plot still the first hero''s');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 6,
    pg_temp.with_kingdom('{"gold": 1500}', 7, 7), 'Kingtest Two', 5, 'kingdoms', 1, 1, 7, 7,
    array[(select id from ids where note = 'kr-two-a')]) $$,
  'MRVER', 'version_conflict', 'claim: a stale version is refused (MRVER)');
select ok(not exists (select 1 from public.kingdom_plots where x = 7 and y = 7)
          and (select claimed_at from public.pending_rewards where note = 'kr-two-a') is null,
  'after MRVER: no plot, and the staged reward is still pending (amendment 1)');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 7,
    pg_temp.with_kingdom('{"gold": 1500}', 7, 7), 'Kingtest Two', 5, 'kingdoms', 1, 1, 7, 7,
    array[(select id from ids where note = 'kr-one-a')]) $$,
  'MRREW', 'rewards_conflict', 'claim: a reward that isn''t the hero''s, or is claimed already, is refused (MRREW)');
select ok(not exists (select 1 from public.kingdom_plots where x = 7 and y = 7)
          and (select version from public.characters where id = '00000000-0000-4000-8000-00000000cb02') = 7,
  'after MRREW: no plot, the hero unchanged');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-0000000000ff', 0,
    pg_temp.with_kingdom('{}', 8, 8), 'Nobody', 1, 'kingdoms', 1, 1, 8, 8, array[]::bigint[]) $$,
  'MRVER', 'version_conflict', 'claim: a hero that doesn''t exist is refused (MRVER)');
select ok(not exists (select 1 from public.kingdom_plots where x = 8 and y = 8), 'after it: no plot');

-- ------------------------------------------------------------ release
-- The ownership instances the requests below were "prepared against" (K1-DB01).
create temporary table pids (name text primary key, id bigint) on commit drop;
insert into pids select 'one-5-5', id from public.kingdom_plots where x = 5 and y = 5;

select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    pg_temp.with_kingdom('{"gold": 1200}', 5, 5), 'Kingtest One', 5, 'kingdoms', 1, 1,
    (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'release: p_data that still has a kingdom is refused (I-1)');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    null, 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'release: null p_data is refused');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1200}', 'Kingtest One', 5, 'kingdoms', 1, 1, null, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'release: a null plot id is refused');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb02', 7,
    '{"gold": 2000}', 'Kingtest Two', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRNOP', 'no_plot', 'release: a hero without a plot is refused (MRNOP), even naming another hero''s plot');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1200}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5') + 1000, array[]::bigint[]) $$,
  'MRSTL', 'plot_changed', 'release: naming a plot instance that isn''t the hero''s current one is refused (MRSTL)');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 3,
    '{"gold": 1200}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRVER', 'version_conflict', 'release: a stale version is refused (MRVER)');
select ok(exists (select 1 from public.kingdom_plots where x = 5 and y = 5 and character_id = '00000000-0000-4000-8000-00000000cb01')
          and (select version from public.characters where id = '00000000-0000-4000-8000-00000000cb01') = 4,
  'after the refused releases: the plot is still the hero''s, the hero unchanged');

insert into public.pending_rewards (character_id, source, gold, note) values
  ('00000000-0000-4000-8000-00000000cb01', 'hunt', 50, 'kr-one-c');
insert into ids select note, id from public.pending_rewards where note = 'kr-one-c';
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'),
    array[(select id from ids where note = 'kr-two-a')]) $$,
  'MRREW', 'rewards_conflict', 'release: another hero''s reward is refused (MRREW)');
select ok(exists (select 1 from public.kingdom_plots where x = 5 and y = 5)
          and (select claimed_at from public.pending_rewards where note = 'kr-two-a') is null,
  'after it: the plot is kept, the other hero''s reward still pending');
select is(public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'),
    array[(select id from ids where note = 'kr-one-c')]),
  5, 'release: returns the new version');
select ok(not exists (select 1 from public.kingdom_plots where x = 5 and y = 5)
          and (select version = 5 and data = '{"gold": 1250}' and updated_at = now()
               from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and (select claimed_at from public.pending_rewards where note = 'kr-one-c') = now(),
  'release: the plot is free, the hero saved without a kingdom, the staged reward claimed');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 5,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRNOP', 'no_plot', 'release: a retried release finds no plot and changes nothing');

-- A stale release (K1-DB01): the hero confirmed releasing one Kingdom, but meanwhile released it
-- and claimed another. The old confirmation names the old instance, so it can't release the new one.
select is(public.kingdom_claim('00000000-0000-4000-8000-00000000cb01', 5,
    pg_temp.with_kingdom('{"gold": 1250}', 6, 6), 'Kingtest One', 5, 'kingdoms', 1, 1, 6, 6, array[]::bigint[]),
  6, 'the hero claims a new plot');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 6,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, (select id from pids where name = 'one-5-5'), array[]::bigint[]) $$,
  'MRSTL', 'plot_changed', 'a stale release naming the old Kingdom is refused (MRSTL)');
select ok(exists (select 1 from public.kingdom_plots where x = 6 and y = 6 and character_id = '00000000-0000-4000-8000-00000000cb01')
          and (select version = 6 and data = pg_temp.with_kingdom('{"gold": 1250}', 6, 6)
               from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'after it: the new Kingdom and the hero are unchanged');
select is(public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 6,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1,
    (select id from public.kingdom_plots where x = 6 and y = 6), array[]::bigint[]),
  7, 'a release naming the current instance succeeds');

-- ------------------------------------------------------------ revoke: no construction
-- Kingdom fixtures written directly, as the table owner: a claimed plot and its hero's kingdom.
insert into public.kingdom_plots (x, y, status, character_id) values (10, 10, 'claimed', '00000000-0000-4000-8000-00000000cb01');
insert into pids select 'one-10-10', id from public.kingdom_plots where x = 10 and y = 10;
update public.characters set data = pg_temp.with_kingdom('{"gold": 1250}', 10, 10), version = 9
 where id = '00000000-0000-4000-8000-00000000cb01';

select throws_ok($$ select public.kingdom_revoke(0, 10, (select id from pids where name = 'one-10-10'),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'revoke: a plot outside 1 to 100 is refused');
select throws_ok($$ select public.kingdom_revoke(10, 10, null, '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'revoke: a null plot id is refused');
select throws_ok($$ select public.kingdom_revoke(10, 10, (select id from pids where name = 'one-10-10'), null, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'revoke: a null expected owner is refused');
select throws_ok($$ select public.kingdom_revoke(11, 11, 1, '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'test') $$,
  'MRNOP', 'no_plot', 'revoke: a free plot is refused (MRNOP)');
select throws_ok($$ select public.kingdom_revoke(10, 10, (select id from pids where name = 'one-10-10'),
    '00000000-0000-4000-8000-00000000cb02', null, 'staff', 'test') $$,
  'MRSTL', 'plot_changed', 'revoke: the right instance with the wrong expected owner is refused (MRSTL)');
select ok(exists (select 1 from public.kingdom_plots where x = 10 and y = 10)
          and (select version = 9 from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'after the refused revokes: the plot and the hero are unchanged');
select is(public.kingdom_revoke(10, 10, (select id from pids where name = 'one-10-10'),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'test reason'), 0::bigint, 'revoke: no construction refunds 0');
select ok(not exists (select 1 from public.kingdom_plots where x = 10 and y = 10)
          and (select data = '{"gold": 1250}' and version = 10 and updated_at = now()
               from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'revoke: the plot is free, the kingdom removed, the version raised by one from the current row (Q4)');
select ok(exists (select 1 from public.admin_log where action = 'kingdom:revoke'
                    and target_id = '00000000-0000-4000-8000-00000000cb01' and target_name = 'Kingtest One'
                    and details = jsonb_build_object('x', 10, 'y', 10, 'plot_id', (select id from pids where name = 'one-10-10'),
                                                     'reason', 'test reason', 'refund', 0, 'at_ms', (select ms from nowms))),
  'revoke: one audit entry, recording the plot, its instance, the reason, the refund and the time used');
-- A `game` request that read the hero before the revoke (version 9) can't write the Kingdom back.
insert into public.pending_rewards (character_id, source, gold, note) values
  ('00000000-0000-4000-8000-00000000cb01', 'hunt', 25, 'kr-one-d');
insert into ids select note, id from public.pending_rewards where note = 'kr-one-d';
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-00000000cb01', 9,
    pg_temp.with_kingdom('{"gold": 1250}', 10, 10), 'Kingtest One', 5, 'kingdoms', 1, 1,
    array[(select id from ids where note = 'kr-one-d')]) $$,
  'MRVER', 'version_conflict', 'after a revoke, a save from a read before it fails with MRVER');
select ok((select data = '{"gold": 1250}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'and the Kingdom isn''t written back');
select throws_ok($$ select public.kingdom_revoke(10, 10, (select id from pids where name = 'one-10-10'),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'test') $$,
  'MRNOP', 'no_plot', 'revoke: a retried revoke on a still-free plot finds no plot and refunds nothing');

-- ------------------------------------------------------------ revoke: stale requests (K1-DB01)
-- 1. The plot changes owners before a previously prepared revoke: staff inspected (12, 12) held by
--    hero one; hero one released it, and hero two claimed it. The old revoke must not touch hero two.
insert into public.kingdom_plots (x, y, status, character_id) values (12, 12, 'claimed', '00000000-0000-4000-8000-00000000cb01');
insert into pids select 'one-12-12', id from public.kingdom_plots where x = 12 and y = 12;
delete from public.kingdom_plots where x = 12 and y = 12;
select is(public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 7,
    pg_temp.with_kingdom('{"gold": 2000}', 12, 12), 'Kingtest Two', 5, 'kingdoms', 1, 1, 12, 12, array[]::bigint[]),
  8, 'hero two claims the plot hero one held');
create temporary table before_two on commit drop as
  select (select count(*) from public.admin_log where action = 'kingdom:revoke') as audits,
         (select data from public.characters where id = '00000000-0000-4000-8000-00000000cb02') as data;
select throws_ok($$ select public.kingdom_revoke(12, 12, (select id from pids where name = 'one-12-12'),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'prepared for hero one') $$,
  'MRSTL', 'plot_changed', 'a revoke prepared against the previous owner is refused (MRSTL)');
select ok((select character_id = '00000000-0000-4000-8000-00000000cb02' from public.kingdom_plots where x = 12 and y = 12)
          and (select version = 8 and data = (select data from before_two)
               from public.characters where id = '00000000-0000-4000-8000-00000000cb02')
          and (select count(*) from public.admin_log where action = 'kingdom:revoke') = (select audits from before_two),
  'after it: hero two''s plot, hero state and gold are unchanged, and no audit entry is written');

-- 2. A plot reacquired before a revoke retry: the first revoke succeeded, the same hero claimed the
--    same plot again, and the retry arrives. It names the old instance, so it changes nothing.
insert into pids select 'two-12-12', id from public.kingdom_plots where x = 12 and y = 12;
select is(public.kingdom_revoke(12, 12, (select id from pids where name = 'two-12-12'),
    '00000000-0000-4000-8000-00000000cb02', null, 'staff', 'first'), 0::bigint, 'the first revoke succeeds');
select is(public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 9,
    pg_temp.with_kingdom('{"gold": 2000}', 12, 12), 'Kingtest Two', 5, 'kingdoms', 1, 1, 12, 12, array[]::bigint[]),
  10, 'hero two claims the same plot again');
select ok((select id from public.kingdom_plots where x = 12 and y = 12) <> (select id from pids where name = 'two-12-12'),
  'the new claim is a new ownership instance, with a new id');
select throws_ok($$ select public.kingdom_revoke(12, 12, (select id from pids where name = 'two-12-12'),
    '00000000-0000-4000-8000-00000000cb02', null, 'staff', 'first') $$,
  'MRSTL', 'plot_changed', 'the retried revoke is refused (MRSTL): the same owner, but a newer instance');
select ok((select version = 10 and data = pg_temp.with_kingdom('{"gold": 2000}', 12, 12)
           from public.characters where id = '00000000-0000-4000-8000-00000000cb02')
          and exists (select 1 from public.kingdom_plots where x = 12 and y = 12)
          and (select count(*) from public.admin_log where action = 'kingdom:revoke' and details ->> 'reason' = 'first') = 1,
  'after it: the new Kingdom is unchanged, and the first revoke''s single audit entry is the only one');

-- ------------------------------------------------------------ revoke: the construction refund at its boundaries
insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'under way'), 500::bigint,
  'revoke before finishAt: returns the gold paid');
select ok((select data = '{"gold": 1500}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.admin_log where action = 'kingdom:revoke' and details ->> 'reason' = 'under way'
                        and (details ->> 'refund')::bigint = 500),
  'revoke before finishAt: the gold is added to the hero, the kingdom removed, the refund audited');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms), 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'at finish'), 0::bigint,
  'revoke exactly at finishAt: it has finished, so 0');
select ok((select data = '{"gold": 1000}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.admin_log where details ->> 'reason' = 'at finish' and (details ->> 'refund')::bigint = 0),
  'revoke exactly at finishAt: no gold added, refund 0 audited');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) - 1, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'after finish'), 0::bigint,
  'revoke after finishAt, the record not yet cleared: 0');
select ok((select data = '{"gold": 1000}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'revoke after finishAt: no gold added');

-- K1-DB02: a refund above the 32-bit integer range is exact.
insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 3000000007)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'large'), 3000000007::bigint,
  'revoke: a refund above 2,147,483,647 is returned exactly (K1-DB02)');
select ok((select data = '{"gold": 3000001007}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.admin_log where details ->> 'reason' = 'large' and (details ->> 'refund')::bigint = 3000000007),
  'and added and audited exactly');

-- The largest exact refund (JavaScript's Number.MAX_SAFE_INTEGER) is accepted; one more is refused.
insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 0}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 9007199254740991)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'max'), 9007199254740991::bigint,
  'revoke: a refund of exactly 9,007,199,254,740,991 is exact');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 0}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 9007199254740992))),
       version = 20
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'too large') $$,
  'MRARG', 'bad_arguments', 'revoke: a paid gold above the exact range is refused, not rounded');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 9007199254740000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 5000)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'sum too large') $$,
  'MRARG', 'bad_arguments', 'revoke: a refund that would take the hero''s gold above the exact range is refused');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20, '{"finishAt": 1, "paid": {"gold": 500.5}}')
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'fraction') $$,
  'MRARG', 'bad_arguments', 'revoke: a fractional paid gold is refused');

-- The hero's balance the refund changes must itself be a whole number from 0 to the exact range
-- (K1-DB02, re-review): a valid refund mustn't carry an invalid balance into the result.
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000.5}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'fractional balance') $$,
  'MRARG', 'bad_arguments', 'revoke: a fractional existing balance is refused (1,000.5 + 500)');
select ok((select data -> 'gold' = '1000.5'::jsonb and data ? 'kingdom' and version = 20
           from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.kingdom_plots where x = 20 and y = 20),
  'after it: the balance, the kingdom, the version and the plot unchanged');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": -1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'negative balance') $$,
  'MRARG', 'bad_arguments', 'revoke: a negative existing balance is refused (-1,000 + 500)');
select ok((select data -> 'gold' = '-1000'::jsonb and data ? 'kingdom' and version = 20
           from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.kingdom_plots where x = 20 and y = 20),
  'after it: the balance, the kingdom, the version and the plot unchanged');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": "1000"}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'string balance') $$,
  'MRARG', 'bad_arguments', 'revoke: a balance that isn''t a number is refused');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 9007199254740992}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 1)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'balance above range') $$,
  'MRARG', 'bad_arguments', 'revoke: an existing balance already above the exact range is refused');
select ok((select data -> 'gold' = '9007199254740992'::jsonb and version = 20
           from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and not exists (select 1 from public.admin_log where details ->> 'reason' in
                            ('fractional balance', 'negative balance', 'string balance', 'balance above range')),
  'after the refused balances: no audit entry for any of them, and nothing written');

update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20, '{"finishAt": "soon", "paid": {"gold": 500}}')
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'malformed') $$,
  'MRARG', 'bad_arguments', 'revoke: a malformed construction is refused rather than guessed');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20)
          and (select version = 20 and data ? 'kingdom' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and not exists (select 1 from public.admin_log where details ->> 'reason' in ('malformed', 'too large', 'sum too large', 'fraction')),
  'after the refused revokes: the plot, the kingdom and the version unchanged, and no audit entry');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20, '{"finishAt": 1, "paid": {"gold": -5}}')
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'negative') $$,
  'MRARG', 'bad_arguments', 'revoke: a negative paid gold is refused');

-- ------------------------------------------------------------ revoke: a failed audit insert changes nothing
update public.characters set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20) where id = '00000000-0000-4000-8000-00000000cb01';
create trigger kingdom_test_refuse_audit before insert on public.admin_log
  for each row execute function public.kingdom_test_refuse_audit();
select throws_ok($$ select public.kingdom_revoke(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'revoke: a failed audit insert fails the revoke');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20)
          and (select version = 20 and data ? 'kingdom' from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'after it: the plot, the kingdom and the version are unchanged');

-- ------------------------------------------------------------ reserve and unreserve
select throws_ok($$ select public.kingdom_reserve(30, 30, null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'reserve: a failed audit insert fails the reserve');
select ok(not exists (select 1 from public.kingdom_plots where x = 30 and y = 30), 'after it: the plot is still free');
insert into public.kingdom_plots (x, y, status) values (31, 31, 'reserved');
select throws_ok($$ select public.kingdom_unreserve(31, 31, (select id from public.kingdom_plots where x = 31 and y = 31),
    null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'unreserve: a failed audit insert fails the unreserve');
select ok(exists (select 1 from public.kingdom_plots where x = 31 and y = 31 and status = 'reserved'),
  'after it: the plot is still reserved');
drop trigger kingdom_test_refuse_audit on public.admin_log;
delete from public.kingdom_plots where x = 31 and y = 31;

select throws_ok($$ select public.kingdom_reserve(101, 30, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'reserve: a plot outside 1 to 100 is refused');
insert into pids values ('reserve-30-30', public.kingdom_reserve(30, 30, null, 'staff', 'keep back'));
select is((select id from pids where name = 'reserve-30-30'), (select id from public.kingdom_plots where x = 30 and y = 30),
  'reserve: returns the new reservation''s id');
select ok(exists (select 1 from public.kingdom_plots where x = 30 and y = 30 and status = 'reserved' and character_id is null)
          and exists (select 1 from public.admin_log where action = 'kingdom:reserve'
                        and details = jsonb_build_object('x', 30, 'y', 30, 'plot_id', (select id from pids where name = 'reserve-30-30'),
                                                         'reason', 'keep back')),
  'reserve: the plot is reserved, with one audit entry');
select throws_ok($$ select public.kingdom_reserve(30, 30, null, 'staff', 'again') $$,
  'MRPLT', 'plot_taken', 'reserve: a reserved plot is refused (MRPLT)');
select throws_ok($$ select public.kingdom_reserve(20, 20, null, 'staff', 'claimed') $$,
  'MRPLT', 'plot_taken', 'reserve: a claimed plot is refused (MRPLT); staff revoke it first');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb03', 0,
    pg_temp.with_kingdom('{"gold": 3000}', 30, 30), 'Kingtest Three', 5, 'kingdoms', 1, 1, 30, 30, array[]::bigint[]) $$,
  'MRPLT', 'plot_taken', 'claim: a reserved plot is refused (MRPLT)');
select throws_ok($$ select public.kingdom_unreserve(20, 20, (select id from public.kingdom_plots where x = 20 and y = 20),
    null, 'staff', 'claimed') $$,
  'MRSTL', 'plot_changed', 'unreserve: naming a claimed plot is refused (MRSTL)');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20 and status = 'claimed'),
  'after it: the claimed plot is untouched');
select throws_ok($$ select public.kingdom_revoke(30, 30, (select id from pids where name = 'reserve-30-30'),
    '00000000-0000-4000-8000-00000000cb01', null, 'staff', 'reserved') $$,
  'MRSTL', 'plot_changed', 'revoke: a reserved plot is refused (MRSTL): there is a plot, but no such claim');
select lives_ok($$ select public.kingdom_unreserve(30, 30, (select id from pids where name = 'reserve-30-30'), null, 'staff', 'release it') $$,
  'unreserve: a reserved plot can be freed');
select ok(not exists (select 1 from public.kingdom_plots where x = 30 and y = 30)
          and exists (select 1 from public.admin_log where action = 'kingdom:unreserve'
                        and details = jsonb_build_object('x', 30, 'y', 30, 'plot_id', (select id from pids where name = 'reserve-30-30'),
                                                         'reason', 'release it')),
  'unreserve: the plot is free, with one audit entry');
select throws_ok($$ select public.kingdom_unreserve(30, 30, (select id from pids where name = 'reserve-30-30'), null, 'staff', 'again') $$,
  'MRNOP', 'no_plot', 'unreserve: a retried unreserve on a still-free plot finds no plot');
select throws_ok($$ select public.kingdom_unreserve(30, null, 1, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'unreserve: a null coordinate is refused');
select throws_ok($$ select public.kingdom_unreserve(30, 30, null, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'unreserve: a null reservation id is refused');

-- 3. A reservation replaced before an old unreserve request (K1-DB01): the old request names the
--    first reservation; the plot was unreserved and reserved again since.
insert into pids values ('reserve-30-30-b', public.kingdom_reserve(30, 30, null, 'staff', 'kept back again'));
create temporary table before_unreserve on commit drop as
  select count(*) as audits from public.admin_log where action = 'kingdom:unreserve';
select throws_ok($$ select public.kingdom_unreserve(30, 30, (select id from pids where name = 'reserve-30-30'), null, 'staff', 'old request') $$,
  'MRSTL', 'plot_changed', 'an unreserve naming the replaced reservation is refused (MRSTL)');
select ok(exists (select 1 from public.kingdom_plots where x = 30 and y = 30 and status = 'reserved'
                    and id = (select id from pids where name = 'reserve-30-30-b'))
          and (select count(*) from public.admin_log where action = 'kingdom:unreserve') = (select audits from before_unreserve),
  'after it: the new reservation is unchanged, and no audit entry is written');


-- ------------------------------------------------------------ deleting a hero frees the plot (K-D7)
insert into public.kingdom_plots (x, y, status, character_id) values (40, 40, 'claimed', '00000000-0000-4000-8000-00000000cb03');
delete from public.characters where id = '00000000-0000-4000-8000-00000000cb03';
select ok(not exists (select 1 from public.kingdom_plots where x = 40 and y = 40), 'deleting a hero frees their plot');

-- ------------------------------------------------------------ the finder (K1-B05, Q1)
select throws_ok($$ select * from public.kingdom_free_plot(1, 1, null) $$,
  'MRARG', 'bad_arguments', 'finder: a null p_random is refused (Q1)');
select throws_ok($$ select * from public.kingdom_free_plot(null, 1, false) $$,
  'MRARG', 'bad_arguments', 'finder: nearest without a point is refused');
select throws_ok($$ select * from public.kingdom_free_plot(0, 1, false) $$,
  'MRARG', 'bad_arguments', 'finder: a point outside 1 to 100 is refused');
select results_eq($$ select x::int, y::int from public.kingdom_free_plot(1, 1, false) $$,
  $$ values (1, 1) $$, 'finder: the nearest free plot to a free point is that point');
-- (20, 20) is claimed: its ring-1 neighbours are equally near; the smallest y, then x, wins.
select results_eq($$ select x::int, y::int from public.kingdom_free_plot(20, 20, false) $$,
  $$ values (19, 19) $$, 'finder: ties go to the smallest y, then the smallest x');
-- With (19, 19) and (20, 19) taken, y first gives (21, 19); x first would give (19, 20).
insert into public.kingdom_plots (x, y, status) values (19, 19, 'reserved'), (20, 19, 'reserved');
select results_eq($$ select x::int, y::int from public.kingdom_free_plot(20, 20, false) $$,
  $$ values (21, 19) $$, 'finder: the tie-break is y before x');
insert into public.kingdom_plots (x, y, status)
  select gx, gy, 'reserved' from generate_series(19, 21) as gx, generate_series(19, 21) as gy
   where not (gx = 20 and gy = 20)
  on conflict do nothing;
select results_eq($$ select x::int, y::int from public.kingdom_free_plot(20, 20, false) $$,
  $$ values (18, 18) $$, 'finder: a full first ring moves to the next ring (Chebyshev distance)');
select is((select count(*)::int from public.kingdom_free_plot(0, 0, true)), 1,
  'finder: random ignores the point and returns one row');
select ok((select not exists (select 1 from public.kingdom_plots k where k.x = f.x and k.y = f.y)
           from public.kingdom_free_plot(null, null, true) f),
  'finder: the random plot is free');
set local role authenticated;
select is((select count(*)::int from public.kingdom_free_plot(1, 1, false)), 1,
  'finder: authenticated can call it');
select is((select count(*)::int from public.kingdom_plots where x between 19 and 21 and y between 19 and 21), 9,
  'authenticated can read the plots (RLS allows every row)');
reset role;

insert into public.kingdom_plots (x, y, status)
  select gx, gy, 'reserved' from generate_series(1, 100) as gx, generate_series(1, 100) as gy
  on conflict do nothing;
select is((select count(*)::int from public.kingdom_free_plot(50, 50, false)), 0, 'finder: a full map gives no nearest plot');
select is((select count(*)::int from public.kingdom_free_plot(null, null, true)), 0, 'finder: a full map gives no random plot');

select * from finish();
rollback;
