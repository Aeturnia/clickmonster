-- Database tests for save_hero_with_rewards() (#102, stage 1; docs/pending-rewards-scope.md, 5.2).
-- Run on the local stack: npx supabase test db. Each run is one transaction, rolled back at the end.
--
-- Every failure case is followed by checks of the state after it: the rewards it named are still
-- unclaimed and the hero is unchanged. That is what proves the rollback, not the error alone.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(40);

-- ------------------------------------------------------------ fixtures (as the table owner)
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000a01', 'rewards-one@example.test'),
  ('00000000-0000-4000-8000-000000000a02', 'rewards-two@example.test');
insert into public.characters (id, user_id, name, race, level, zone, x, y, data, version) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000a01', 'Rewardtest One', 'human', 2, 'ashford', 5, 5, '{"gold": 10}', 0),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000a02', 'Rewardtest Two', 'human', 2, 'ashford', 5, 5, '{"gold": 20}', 0);
-- Reward ids are generated, so each fixture is found by its note.
insert into public.pending_rewards (character_id, source, gold, note, claimed_at) values
  ('00000000-0000-4000-8000-0000000000c1', 'hunt', 100, 'rw-a', null),
  ('00000000-0000-4000-8000-0000000000c1', 'hunt', 200, 'rw-b', null),
  ('00000000-0000-4000-8000-0000000000c1', 'hunt', 300, 'rw-claimed', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000000c1', 'hunt', 400, 'rw-d', null),
  ('00000000-0000-4000-8000-0000000000c2', 'hunt', 500, 'rw-other', null);

create temporary table ids on commit drop as
  select note, id from public.pending_rewards where note like 'rw-%';

-- ------------------------------------------------------------ the function and its privileges
select has_function('public', 'save_hero_with_rewards',
  array['uuid', 'integer', 'jsonb', 'text', 'integer', 'text', 'integer', 'integer', 'bigint[]'],
  'save_hero_with_rewards() exists with the scope''s signature');
select function_returns('public', 'save_hero_with_rewards',
  array['uuid', 'integer', 'jsonb', 'text', 'integer', 'text', 'integer', 'integer', 'bigint[]'], 'integer',
  'it returns the new version (integer)');
select is_definer('public', 'save_hero_with_rewards',
  array['uuid', 'integer', 'jsonb', 'text', 'integer', 'text', 'integer', 'integer', 'bigint[]'],
  'it is security definer');
select ok((select 'search_path=public' = any (proconfig) from pg_proc where oid = 'public.save_hero_with_rewards(uuid,int,jsonb,text,int,text,int,int,bigint[])'::regprocedure),
  'its search_path is fixed to public');
select ok(not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.save_hero_with_rewards(uuid,int,jsonb,text,int,text,int,int,bigint[])'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC has no execute');
select ok(not has_function_privilege('anon', 'public.save_hero_with_rewards(uuid,int,jsonb,text,int,text,int,int,bigint[])', 'execute'),
  'anon has no execute');
select ok(not has_function_privilege('authenticated', 'public.save_hero_with_rewards(uuid,int,jsonb,text,int,text,int,int,bigint[])', 'execute'),
  'authenticated has no execute');
select ok(has_function_privilege('service_role', 'public.save_hero_with_rewards(uuid,int,jsonb,text,int,text,int,int,bigint[])', 'execute'),
  'service_role has execute');

set local role anon;
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[1]::bigint[]) $$,
  '42501', null, 'anon: calling it is refused');
reset role;
set local role authenticated;
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[1]::bigint[]) $$,
  '42501', null, 'authenticated: calling it is refused');
reset role;
select is((select count(*)::int from public.pending_rewards where note = 'rw-a' and claimed_at is null), 1,
  'after the refused calls, the reward is still unclaimed');

-- ------------------------------------------------------------ a bad id set (MRARG)
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[]::bigint[]) $$,
  'MRARG', 'invalid_reward_ids', 'an empty id set is refused');
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    null::bigint[]) $$,
  'MRARG', 'invalid_reward_ids', 'a null id set is refused');
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[(select id from ids where note = 'rw-d'), null]) $$,
  'MRARG', 'invalid_reward_ids', 'a null id in the set is refused');
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[(select id from ids where note = 'rw-d'), (select id from ids where note = 'rw-d')]) $$,
  'MRARG', 'invalid_reward_ids', 'a duplicate id is refused');
select is((select claimed_at from public.pending_rewards where note = 'rw-d'), null,
  'after the bad id sets, the reward is still unclaimed');
select results_eq($$ select version, data from public.characters where id = '00000000-0000-4000-8000-0000000000c1' $$,
  $$ values (0, '{"gold": 10}'::jsonb) $$,
  'after the bad id sets, the hero is unchanged');

-- ------------------------------------------------------------ reward conflicts (MRREW)
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[(select id from ids where note = 'rw-claimed'), (select id from ids where note = 'rw-d')]) $$,
  'MRREW', 'rewards_conflict', 'a set with an already claimed reward is refused');
select is((select claimed_at from public.pending_rewards where note = 'rw-d'), null,
  'after it, the other reward in the set is still unclaimed (its claim rolled back)');
select results_eq($$ select version, data from public.characters where id = '00000000-0000-4000-8000-0000000000c1' $$,
  $$ values (0, '{"gold": 10}'::jsonb) $$,
  'after it, the hero is unchanged');

select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array(select id from ids where note = 'rw-other')) $$,
  'MRREW', 'rewards_conflict', 'another hero''s reward is refused');
select is((select claimed_at from public.pending_rewards where note = 'rw-other'), null,
  'after it, the other hero''s reward is still unclaimed');

select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array[(select id from ids where note = 'rw-d'), (select max(id) + 1000 from public.pending_rewards)]) $$,
  'MRREW', 'rewards_conflict', 'a missing reward id is refused');
select is((select claimed_at from public.pending_rewards where note = 'rw-d'), null,
  'after it, the existing reward in the set is still unclaimed');

select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c9', 0, '{"gold": 99}', 'Nobody', 2, 'ashford', 5, 5,
    array(select id from ids where note = 'rw-d')) $$,
  'MRREW', 'rewards_conflict', 'a hero that doesn''t exist owns no reward, so it is refused');

-- ------------------------------------------------------------ a stale version (MRVER)
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 5, '{"gold": 99}', 'Rewardtest One', 2, 'ashford', 5, 5,
    array(select id from ids where note in ('rw-a', 'rw-b'))) $$,
  'MRVER', 'version_conflict', 'a stale version is refused');
select is((select count(*)::int from public.pending_rewards where note in ('rw-a', 'rw-b') and claimed_at is null), 2,
  'after it, both rewards are still unclaimed: the claims made before the version check rolled back');
select results_eq($$ select version, data from public.characters where id = '00000000-0000-4000-8000-0000000000c1' $$,
  $$ values (0, '{"gold": 10}'::jsonb) $$,
  'after it, the hero is unchanged');

-- ------------------------------------------------------------ success
select is(public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 10, "bank": 300}', 'Rewardtest One', 3, 'marsh', 2, 3,
    array(select id from ids where note in ('rw-a', 'rw-b'))),
  1, 'a valid call returns the new version, 1');
select is((select count(*)::int from public.pending_rewards where note in ('rw-a', 'rw-b') and claimed_at is not null), 2,
  'both named rewards are claimed');
select is((select claimed_at from public.pending_rewards where note = 'rw-d'), null,
  'a reward not named in the set stays unclaimed');
select is((select claimed_at from public.pending_rewards where note = 'rw-other'), null,
  'the other hero''s reward stays unclaimed');
select results_eq($$ select version, data, level, zone, x, y from public.characters where id = '00000000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, '{"gold": 10, "bank": 300}'::jsonb, 3, 'marsh'::text, 2, 3) $$,
  'the hero is saved: version 1, the new data and public columns');
select results_eq($$ select version, data from public.characters where id = '00000000-0000-4000-8000-0000000000c2' $$,
  $$ values (0, '{"gold": 20}'::jsonb) $$,
  'the other hero is untouched');

-- ------------------------------------------------------------ retries after success
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 0, '{"gold": 10, "bank": 600}', 'Rewardtest One', 3, 'marsh', 2, 3,
    array(select id from ids where note in ('rw-a', 'rw-b'))) $$,
  'MRREW', 'rewards_conflict', 'replaying the same call is refused: its rewards are already claimed');
select throws_ok($$ select public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 1, '{"gold": 10, "bank": 600}', 'Rewardtest One', 3, 'marsh', 2, 3,
    array(select id from ids where note = 'rw-a')) $$,
  'MRREW', 'rewards_conflict', 'claiming a delivered reward again, even at the current version, is refused');
select results_eq($$ select version, data from public.characters where id = '00000000-0000-4000-8000-0000000000c1' $$,
  $$ values (1, '{"gold": 10, "bank": 300}'::jsonb) $$,
  'after the retries, the hero still has version 1 and the delivery saved once');

-- ------------------------------------------------------------ a later delivery at the new version
select is(public.save_hero_with_rewards('00000000-0000-4000-8000-0000000000c1', 1, '{"gold": 10, "bank": 700}', 'Rewardtest One', 3, 'marsh', 2, 3,
    array(select id from ids where note = 'rw-d')),
  2, 'the remaining reward is delivered at the current version, returning 2');
select is((select count(*)::int from public.pending_rewards where character_id = '00000000-0000-4000-8000-0000000000c1' and claimed_at is null), 0,
  'the hero has no unclaimed reward left');
select is((select version from public.characters where id = '00000000-0000-4000-8000-0000000000c1'), 2,
  'and the hero is at version 2');

select * from finish();
rollback;
