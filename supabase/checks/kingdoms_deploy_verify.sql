-- After applying supabase/migrations/20261125120000_kingdoms.sql (#83, K1-1;
-- docs/kingdoms-k1-plan.md, 2.1 and 2.5). READ-ONLY: it changes nothing.
-- Every row's "ok" must be true. Record the result. The last row (the migration's history entry)
-- is true only once it is recorded: by the CLI after `db push`, or by `supabase migration repair`
-- after a manual apply. The Kingdom invariant itself is checked by kingdom_verify.sql (no rows).
with
fns(n, sig) as (values
  (1, 'public.kingdom_claim(uuid,integer,jsonb,text,integer,text,integer,integer,integer,integer,bigint[])'),
  (2, 'public.kingdom_release(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])'),
  (3, 'public.kingdom_revoke(integer,integer,uuid,text,text)'),
  (4, 'public.kingdom_reserve(integer,integer,uuid,text,text)'),
  (5, 'public.kingdom_unreserve(integer,integer,uuid,text,text)')
),
svc as (
  select bool_and(p.oid is not null and p.prosecdef and 'search_path=public' = any (p.proconfig)
                  and has_function_privilege('service_role', p.oid, 'execute')
                  and not has_function_privilege('authenticated', p.oid, 'execute')
                  and not has_function_privilege('anon', p.oid, 'execute')
                  and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as ok,
         count(p.oid) as found
  from fns f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
helper as (
  select oid from pg_proc where oid = to_regprocedure('public.kingdom_claim_staged_rewards(uuid,bigint[])')
),
finder as (
  select oid from pg_proc where oid = to_regprocedure('public.kingdom_free_plot(integer,integer,boolean)')
),
checks(n, item, expected, actual) as (values
  (1, 'table kingdom_plots exists', 'true', (to_regclass('public.kingdom_plots') is not null)::text),
  (2, 'its RLS is on', 'true', coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.kingdom_plots')), 'no table')),
  (3, 'its constraints', 'kingdom_plots_character_key, kingdom_plots_owner, kingdom_plots_pkey, kingdom_plots_status, kingdom_plots_x_range, kingdom_plots_y_range',
     coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint
               where conrelid = to_regclass('public.kingdom_plots') and contype in ('p', 'u', 'c')), 'none')),
  (4, 'the hero foreign key cascades on delete', 'c',
     coalesce((select confdeltype::text from pg_constraint where conrelid = to_regclass('public.kingdom_plots') and contype = 'f'), 'none')),
  (5, 'authenticated can read the plot columns, and not write', 'true',
     coalesce((select (has_column_privilege('authenticated', 'public.kingdom_plots', 'character_id', 'select')
               and not has_table_privilege('authenticated', 'public.kingdom_plots', 'insert, update, delete, truncate'))::text
               where to_regclass('public.kingdom_plots') is not null), 'no table')),
  (6, 'anon has no access to the table', 'false',
     coalesce((select has_table_privilege('anon', 'public.kingdom_plots', 'select, insert, update, delete')::text
               where to_regclass('public.kingdom_plots') is not null), 'no table')),
  (7, 'the five functions exist', '5', (select found::text from svc)),
  (8, 'the five: security definer, search_path public, service_role only', 'true', coalesce((select ok::text from svc), 'false')),
  (9, 'the private reward helper: security definer, executable by nobody', 'true',
     coalesce((select (p.prosecdef
               and not has_function_privilege('service_role', p.oid, 'execute')
               and not has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
               from pg_proc p where p.oid = (select oid from helper)), 'no function')),
  (10, 'the finder: volatile, security invoker, authenticated and service_role only', 'true',
     coalesce((select (p.provolatile = 'v' and not p.prosecdef
               and has_function_privilege('authenticated', p.oid, 'execute')
               and has_function_privilege('service_role', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
               from pg_proc p where p.oid = (select oid from finder)), 'no function')),
  (11, 'save_hero_with_rewards() is unchanged (md5 of its definition)', '46cea39f9a83b467c847dc4916815ca2',
     coalesce(md5(pg_get_functiondef(to_regprocedure('public.save_hero_with_rewards(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])'))), 'no function')),
  (12, 'the migration history records 20261125120000', 'true', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select (count(*) > 0)::text as v from supabase_migrations.schema_migrations where version = ''20261125120000''', false, true, '')))[1]::text, 'false')
     end)
)
select n, item, expected, actual, actual = expected as ok from checks order by n;
