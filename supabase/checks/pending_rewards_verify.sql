-- After applying supabase/migrations/20261123120000_save_hero_with_rewards.sql (#102,
-- docs/pending-rewards-scope.md, section 7). READ-ONLY: it changes nothing.
-- Paste into the Supabase SQL editor; every row's "ok" must be true. Record the result.
-- The last row (the migration's history entry) is true only once it is recorded: by the CLI if
-- the migration went through `db push`, or by `supabase migration repair` after a manual apply.
with
fn as (
  select to_regprocedure('public.save_hero_with_rewards(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])') as oid
),
checks(n, item, expected, actual) as (values
  (1, 'the function exists with the scope''s signature', 'true', ((select oid from fn) is not null)::text),
  (2, 'only one function of that name', '1', (select count(*)::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = 'save_hero_with_rewards')),
  (3, 'it returns integer', 'integer', coalesce((select format_type(prorettype, null) from pg_proc where oid = (select oid from fn)), 'no function')),
  (4, 'it is security definer', 'true', coalesce((select prosecdef::text from pg_proc where oid = (select oid from fn)), 'no function')),
  (5, 'its search_path is public', 'true', coalesce((select ('search_path=public' = any (proconfig))::text from pg_proc where oid = (select oid from fn)), 'no function')),
  (6, 'PUBLIC has no execute', 'false', coalesce((select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = (select oid from fn) and a.grantee = 0 and a.privilege_type = 'EXECUTE')::text where (select oid from fn) is not null), 'no function')),
  (7, 'anon has no execute', 'false', coalesce((select has_function_privilege('anon', (select oid from fn), 'execute')::text where (select oid from fn) is not null), 'no function')),
  (8, 'authenticated has no execute', 'false', coalesce((select has_function_privilege('authenticated', (select oid from fn), 'execute')::text where (select oid from fn) is not null), 'no function')),
  (9, 'service_role has execute', 'true', coalesce((select has_function_privilege('service_role', (select oid from fn), 'execute')::text where (select oid from fn) is not null), 'no function')),
  (10, 'the migration history records 20261123120000', 'true', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select (count(*) > 0)::text as v from supabase_migrations.schema_migrations where version = ''20261123120000''', false, true, '')))[1]::text, 'false')
     end)
)
select n, item, expected, actual, actual = expected as ok from checks order by n;
