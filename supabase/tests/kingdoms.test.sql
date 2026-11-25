-- Database tests for Kingdoms K1-1 (#83; docs/kingdoms-k1-plan.md, 2.1; docs/kingdoms-scope.md, 5.3.1).
-- Run on the local stack: npx supabase test db. Each run is one transaction, rolled back at the end,
-- so now() is fixed for the whole run: that is what makes the revoke's finish boundary exact.
--
-- Every failure case is followed by checks of the state after it (the plot, the hero, the rewards,
-- the audit log). That is what proves the rollback, not the error alone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(104);

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
select ok(has_column_privilege('authenticated', 'public.kingdom_plots', 'character_id', 'select'),
  'authenticated can read the plot columns');
select ok(not has_table_privilege('anon', 'public.kingdom_plots', 'select'), 'anon can''t read the table');
select ok(not has_table_privilege('authenticated', 'public.kingdom_plots', 'insert, update, delete, truncate'),
  'authenticated can''t write the table');
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
           from pg_proc p where p.oid = to_regprocedure('public.kingdom_release(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])')),
  'kingdom_release(): security definer, search_path public, service_role only');
select ok((select bool_and(p.prosecdef and 'search_path=public' = any (p.proconfig)
             and has_function_privilege('service_role', p.oid, 'execute')
             and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')
             and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
           from pg_proc p where p.oid in (
             to_regprocedure('public.kingdom_revoke(integer,integer,uuid,text,text)'),
             to_regprocedure('public.kingdom_reserve(integer,integer,uuid,text,text)'),
             to_regprocedure('public.kingdom_unreserve(integer,integer,uuid,text,text)'))
           having count(*) = 3),
  'kingdom_revoke(), kingdom_reserve() and kingdom_unreserve(): security definer, search_path public, service_role only');
select is((select format_type(prorettype, null) from pg_proc where oid = to_regprocedure('public.kingdom_revoke(integer,integer,uuid,text,text)')),
  'integer', 'kingdom_revoke() returns the refund as an integer');
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
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    pg_temp.with_kingdom('{"gold": 1200}', 5, 5), 'Kingtest One', 5, 'kingdoms', 1, 1, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'release: p_data that still has a kingdom is refused (I-1)');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    null, 'Kingtest One', 5, 'kingdoms', 1, 1, array[]::bigint[]) $$,
  'MRARG', 'bad_arguments', 'release: null p_data is refused');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb02', 7,
    '{"gold": 2000}', 'Kingtest Two', 5, 'kingdoms', 1, 1, array[]::bigint[]) $$,
  'MRNOP', 'no_plot', 'release: a hero without a plot is refused (MRNOP)');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 3,
    '{"gold": 1200}', 'Kingtest One', 5, 'kingdoms', 1, 1, array[]::bigint[]) $$,
  'MRVER', 'version_conflict', 'release: a stale version is refused (MRVER)');
select ok(exists (select 1 from public.kingdom_plots where x = 5 and y = 5 and character_id = '00000000-0000-4000-8000-00000000cb01')
          and (select version from public.characters where id = '00000000-0000-4000-8000-00000000cb01') = 4,
  'after the refused releases: the plot is still the hero''s, the hero unchanged');

insert into public.pending_rewards (character_id, source, gold, note) values
  ('00000000-0000-4000-8000-00000000cb01', 'hunt', 50, 'kr-one-c');
insert into ids select note, id from public.pending_rewards where note = 'kr-one-c';
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, array[(select id from ids where note = 'kr-two-a')]) $$,
  'MRREW', 'rewards_conflict', 'release: another hero''s reward is refused (MRREW)');
select ok(exists (select 1 from public.kingdom_plots where x = 5 and y = 5)
          and (select claimed_at from public.pending_rewards where note = 'kr-two-a') is null,
  'after it: the plot is kept, the other hero''s reward still pending');
select is(public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 4,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, array[(select id from ids where note = 'kr-one-c')]),
  5, 'release: returns the new version');
select ok(not exists (select 1 from public.kingdom_plots where x = 5 and y = 5)
          and (select version = 5 and data = '{"gold": 1250}' and updated_at = now()
               from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and (select claimed_at from public.pending_rewards where note = 'kr-one-c') = now(),
  'release: the plot is free, the hero saved without a kingdom, the staged reward claimed');
select throws_ok($$ select public.kingdom_release('00000000-0000-4000-8000-00000000cb01', 5,
    '{"gold": 1250}', 'Kingtest One', 5, 'kingdoms', 1, 1, array[]::bigint[]) $$,
  'MRNOP', 'no_plot', 'release: a retried release finds no plot and changes nothing');

-- ------------------------------------------------------------ revoke: no construction
-- Kingdom fixtures written directly, as the table owner: a claimed plot and its hero's kingdom.
insert into public.kingdom_plots (x, y, status, character_id) values (10, 10, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters set data = pg_temp.with_kingdom('{"gold": 1250}', 10, 10), version = 9
 where id = '00000000-0000-4000-8000-00000000cb01';

select throws_ok($$ select public.kingdom_revoke(0, 10, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'revoke: a plot outside 1 to 100 is refused');
select throws_ok($$ select public.kingdom_revoke(11, 11, null, 'staff', 'test') $$,
  'MRNOP', 'no_plot', 'revoke: a free plot is refused (MRNOP)');
select is(public.kingdom_revoke(10, 10, null, 'staff', 'test reason'), 0, 'revoke: no construction refunds 0');
select ok(not exists (select 1 from public.kingdom_plots where x = 10 and y = 10)
          and (select data = '{"gold": 1250}' and version = 10 and updated_at = now()
               from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'revoke: the plot is free, the kingdom removed, the version raised by one from the current row (Q4)');
select ok(exists (select 1 from public.admin_log where action = 'kingdom:revoke'
                    and target_id = '00000000-0000-4000-8000-00000000cb01' and target_name = 'Kingtest One'
                    and details = jsonb_build_object('x', 10, 'y', 10, 'reason', 'test reason', 'refund', 0, 'at_ms', (select ms from nowms))),
  'revoke: one audit entry, recording the plot, the reason, the refund and the time used');
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
select throws_ok($$ select public.kingdom_revoke(10, 10, null, 'staff', 'test') $$,
  'MRNOP', 'no_plot', 'revoke: a retried revoke finds no plot and refunds nothing');

-- ------------------------------------------------------------ revoke: the construction refund at its boundaries
insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) + 60000, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, null, 'staff', 'under way'), 500,
  'revoke before finishAt: returns the gold paid');
select ok((select data = '{"gold": 1500}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.admin_log where action = 'kingdom:revoke' and details ->> 'reason' = 'under way'
                        and (details ->> 'refund')::int = 500),
  'revoke before finishAt: the gold is added to the hero, the kingdom removed, the refund audited');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms), 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, null, 'staff', 'at finish'), 0, 'revoke exactly at finishAt: it has finished, so 0');
select ok((select data = '{"gold": 1000}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and exists (select 1 from public.admin_log where details ->> 'reason' = 'at finish' and (details ->> 'refund')::int = 0),
  'revoke exactly at finishAt: no gold added, refund 0 audited');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20,
         jsonb_build_object('finishAt', (select ms from nowms) - 1, 'paid', jsonb_build_object('gold', 500)))
 where id = '00000000-0000-4000-8000-00000000cb01';
select is(public.kingdom_revoke(20, 20, null, 'staff', 'after finish'), 0,
  'revoke after finishAt, the record not yet cleared: 0');
select ok((select data = '{"gold": 1000}' from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'revoke after finishAt: no gold added');

insert into public.kingdom_plots (x, y, status, character_id) values (20, 20, 'claimed', '00000000-0000-4000-8000-00000000cb01');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20, '{"finishAt": "soon", "paid": {"gold": 500}}'), version = 20
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, null, 'staff', 'malformed') $$,
  'MRARG', 'bad_arguments', 'revoke: a malformed construction is refused rather than guessed');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20)
          and (select version = 20 and data ? 'kingdom' from public.characters where id = '00000000-0000-4000-8000-00000000cb01')
          and not exists (select 1 from public.admin_log where details ->> 'reason' = 'malformed'),
  'after it: the plot, the kingdom and the version unchanged, and no audit entry');
update public.characters
   set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20, '{"finishAt": 1, "paid": {"gold": -5}}')
 where id = '00000000-0000-4000-8000-00000000cb01';
select throws_ok($$ select public.kingdom_revoke(20, 20, null, 'staff', 'negative') $$,
  'MRARG', 'bad_arguments', 'revoke: a negative paid gold is refused');

-- ------------------------------------------------------------ revoke: a failed audit insert changes nothing
update public.characters set data = pg_temp.with_kingdom('{"gold": 1000}', 20, 20) where id = '00000000-0000-4000-8000-00000000cb01';
create trigger kingdom_test_refuse_audit before insert on public.admin_log
  for each row execute function public.kingdom_test_refuse_audit();
select throws_ok($$ select public.kingdom_revoke(20, 20, null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'revoke: a failed audit insert fails the revoke');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20)
          and (select version = 20 and data ? 'kingdom' from public.characters where id = '00000000-0000-4000-8000-00000000cb01'),
  'after it: the plot, the kingdom and the version are unchanged');

-- ------------------------------------------------------------ reserve and unreserve
select throws_ok($$ select public.kingdom_reserve(30, 30, null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'reserve: a failed audit insert fails the reserve');
select ok(not exists (select 1 from public.kingdom_plots where x = 30 and y = 30), 'after it: the plot is still free');
insert into public.kingdom_plots (x, y, status) values (31, 31, 'reserved');
select throws_ok($$ select public.kingdom_unreserve(31, 31, null, 'staff', 'audit fails') $$,
  'P0001', 'audit refused (test)', 'unreserve: a failed audit insert fails the unreserve');
select ok(exists (select 1 from public.kingdom_plots where x = 31 and y = 31 and status = 'reserved'),
  'after it: the plot is still reserved');
drop trigger kingdom_test_refuse_audit on public.admin_log;
delete from public.kingdom_plots where x = 31 and y = 31;

select throws_ok($$ select public.kingdom_reserve(101, 30, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'reserve: a plot outside 1 to 100 is refused');
select lives_ok($$ select public.kingdom_reserve(30, 30, null, 'staff', 'keep back') $$, 'reserve: a free plot can be reserved');
select ok(exists (select 1 from public.kingdom_plots where x = 30 and y = 30 and status = 'reserved' and character_id is null)
          and exists (select 1 from public.admin_log where action = 'kingdom:reserve'
                        and details = '{"x": 30, "y": 30, "reason": "keep back"}'),
  'reserve: the plot is reserved, with one audit entry');
select throws_ok($$ select public.kingdom_reserve(30, 30, null, 'staff', 'again') $$,
  'MRPLT', 'plot_taken', 'reserve: a reserved plot is refused (MRPLT)');
select throws_ok($$ select public.kingdom_reserve(20, 20, null, 'staff', 'claimed') $$,
  'MRPLT', 'plot_taken', 'reserve: a claimed plot is refused (MRPLT); staff revoke it first');
select throws_ok($$ select public.kingdom_claim('00000000-0000-4000-8000-00000000cb02', 7,
    pg_temp.with_kingdom('{"gold": 1500}', 30, 30), 'Kingtest Two', 5, 'kingdoms', 1, 1, 30, 30, array[]::bigint[]) $$,
  'MRPLT', 'plot_taken', 'claim: a reserved plot is refused (MRPLT)');
select throws_ok($$ select public.kingdom_unreserve(20, 20, null, 'staff', 'claimed') $$,
  'MRNOP', 'no_plot', 'unreserve: a claimed plot is refused (MRNOP)');
select ok(exists (select 1 from public.kingdom_plots where x = 20 and y = 20 and status = 'claimed'),
  'after it: the claimed plot is untouched');
select throws_ok($$ select public.kingdom_revoke(30, 30, null, 'staff', 'reserved') $$,
  'MRNOP', 'no_plot', 'revoke: a reserved plot is refused (MRNOP)');
select lives_ok($$ select public.kingdom_unreserve(30, 30, null, 'staff', 'release it') $$, 'unreserve: a reserved plot can be freed');
select ok(not exists (select 1 from public.kingdom_plots where x = 30 and y = 30)
          and exists (select 1 from public.admin_log where action = 'kingdom:unreserve'
                        and details = '{"x": 30, "y": 30, "reason": "release it"}'),
  'unreserve: the plot is free, with one audit entry');
select throws_ok($$ select public.kingdom_unreserve(30, 30, null, 'staff', 'again') $$,
  'MRNOP', 'no_plot', 'unreserve: a retried unreserve finds no plot');
select throws_ok($$ select public.kingdom_unreserve(30, null, null, 'staff', 'test') $$,
  'MRARG', 'bad_arguments', 'unreserve: a null coordinate is refused');

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
