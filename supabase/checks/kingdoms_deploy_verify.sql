-- After applying supabase/migrations/20261125120000_kingdoms.sql (#83, K1-1;
-- docs/kingdoms-k1-plan.md, 2.1 and 2.5). READ-ONLY: it changes nothing.
-- Every row's "ok" must be true. Record the result. The last row (the migration's history entry)
-- is true only once it is recorded: by the CLI after `db push`, or by `supabase migration repair`
-- after a manual apply. The Kingdom invariant itself is checked by kingdom_verify.sql (no rows).
--
-- has_column_privilege() is true when a role holds the privilege on the column OR on the whole
-- table, so the column rows below cover both levels (K1-DB03). DELETE and TRUNCATE exist only at
-- table level. PUBLIC is checked separately, from the table's and the columns' ACLs.
with
cols(col) as (values ('id'), ('x'), ('y'), ('status'), ('character_id'), ('claimed_at')),
tbl as (select to_regclass('public.kingdom_plots') as oid),
fns(n, sig) as (values
  (1, 'public.kingdom_claim(uuid,integer,jsonb,text,integer,text,integer,integer,integer,integer,bigint[])'),
  (2, 'public.kingdom_release(uuid,integer,jsonb,text,integer,text,integer,integer,bigint,bigint[])'),
  (3, 'public.kingdom_revoke(integer,integer,bigint,uuid,uuid,text,text)'),
  (4, 'public.kingdom_reserve(integer,integer,uuid,text,text)'),
  (5, 'public.kingdom_unreserve(integer,integer,bigint,uuid,text,text)')
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
policies as (
  select string_agg(format('%s %s %s to %s using (%s) check (%s)', p.polname,
                           case when p.polpermissive then 'permissive' else 'restrictive' end,
                           p.polcmd,
                           (select string_agg(coalesce(r.rolname, 'public'), ',' order by r.rolname)
                              from unnest(p.polroles) as u(oid) left join pg_roles r on r.oid = u.oid),
                           coalesce(pg_get_expr(p.polqual, p.polrelid), 'none'),
                           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), 'none')), '; ' order by p.polname) as v
  from pg_policy p where p.polrelid = (select oid from tbl)
),
checks(n, item, expected, actual) as (values
  (1, 'table kingdom_plots exists', 'true', ((select oid from tbl) is not null)::text),
  (2, 'its RLS is on', 'true', coalesce((select relrowsecurity::text from pg_class where oid = (select oid from tbl)), 'no table')),
  (3, 'its only policy: everyone signed in may read every row, nothing else',
     'Signed-in players can see the plots permissive r to authenticated using (true) check (none)',
     coalesce((select v from policies), 'none')),
  (4, 'its constraints', 'kingdom_plots_character_key, kingdom_plots_id_key, kingdom_plots_owner, kingdom_plots_pkey, kingdom_plots_status, kingdom_plots_x_range, kingdom_plots_y_range',
     coalesce((select string_agg(conname, ', ' order by conname) from pg_constraint
               where conrelid = (select oid from tbl) and contype in ('p', 'u', 'c')), 'none')),
  (5, 'the hero foreign key cascades on delete', 'c',
     coalesce((select confdeltype::text from pg_constraint where conrelid = (select oid from tbl) and contype = 'f'), 'none')),
  (6, 'the id is an identity column, generated always', 'a',
     coalesce((select attidentity::text from pg_attribute where attrelid = (select oid from tbl) and attname = 'id'), 'no column')),
  (7, 'authenticated can read all six plot columns', 'true',
     coalesce((select bool_and(has_column_privilege('authenticated', (select oid from tbl), c.col, 'select'))::text
               from cols c where (select oid from tbl) is not null), 'no table')),
  (8, 'authenticated can''t write: no insert, update or references on any column, no delete, truncate or trigger', 'false',
     coalesce((select (bool_or(has_column_privilege('authenticated', (select oid from tbl), c.col, 'insert, update, references'))
                       or has_table_privilege('authenticated', (select oid from tbl), 'delete, truncate, trigger'))::text
               from cols c where (select oid from tbl) is not null), 'no table')),
  (9, 'anon has nothing: no column or table privilege of any kind', 'false',
     coalesce((select (bool_or(has_column_privilege('anon', (select oid from tbl), c.col, 'select, insert, update, references'))
                       or has_table_privilege('anon', (select oid from tbl), 'delete, truncate, trigger'))::text
               from cols c where (select oid from tbl) is not null), 'no table')),
  (10, 'PUBLIC has nothing, on the table or any column', 'false',
     coalesce((select (exists (select 1 from pg_class t, aclexplode(t.relacl) a where t.oid = (select oid from tbl) and a.grantee = 0)
                       or exists (select 1 from pg_attribute at, aclexplode(at.attacl) a
                                  where at.attrelid = (select oid from tbl) and at.attnum > 0 and a.grantee = 0))::text
               where (select oid from tbl) is not null), 'no table')),
  (11, 'the five functions exist', '5', (select found::text from svc)),
  (12, 'the five: security definer, search_path public, service_role only', 'true', coalesce((select ok::text from svc), 'false')),
  (13, 'kingdom_revoke() returns the refund as bigint', 'bigint',
     coalesce((select format_type(prorettype, null) from pg_proc where oid = to_regprocedure('public.kingdom_revoke(integer,integer,bigint,uuid,uuid,text,text)')), 'no function')),
  (14, 'the private reward helper: security definer, executable by nobody', 'true',
     coalesce((select (p.prosecdef
               and not has_function_privilege('service_role', p.oid, 'execute')
               and not has_function_privilege('authenticated', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
               from pg_proc p where p.oid = (select oid from helper)), 'no function')),
  (15, 'the finder: volatile, security invoker, authenticated and service_role only', 'true',
     coalesce((select (p.provolatile = 'v' and not p.prosecdef
               and has_function_privilege('authenticated', p.oid, 'execute')
               and has_function_privilege('service_role', p.oid, 'execute')
               and not has_function_privilege('anon', p.oid, 'execute')
               and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))::text
               from pg_proc p where p.oid = (select oid from finder)), 'no function')),
  (16, 'save_hero_with_rewards() is unchanged (md5 of its definition)', '46cea39f9a83b467c847dc4916815ca2',
     coalesce(md5(pg_get_functiondef(to_regprocedure('public.save_hero_with_rewards(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])'))), 'no function')),
  (17, 'the migration history records 20261125120000', 'true', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select (count(*) > 0)::text as v from supabase_migrations.schema_migrations where version = ''20261125120000''', false, true, '')))[1]::text, 'false')
     end)
)
select n, item, expected, actual, actual = expected as ok from checks order by n;
