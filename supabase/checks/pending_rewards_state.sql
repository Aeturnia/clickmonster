-- The state of #102's migration, in one row (docs/pending-rewards-report.md, section 3).
-- READ-ONLY: a single SELECT; it changes nothing. Used before the migration, after it, after a
-- failed or ambiguous step (3.3's disposition table), and after a rollback.
--   function_present  whether save_hero_with_rewards(...) exists with the reviewed signature
--   definition_md5    md5 of pg_get_functiondef(); the reviewed value is 46cea39f9a83b467c847dc4916815ca2
--   definition_length the reviewed value is 1329
--   owner             the function's owner (it is SECURITY DEFINER, so it runs as this role)
--   history_recorded  whether the migration history records 20261123120000
--   history_versions  every version the history records
--   definition        the full text, to compare line by line if the md5 differs
with fn as (
  select to_regprocedure('public.save_hero_with_rewards(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])') as oid
),
def as (
  select case when (select oid from fn) is null then null else pg_get_functiondef((select oid from fn)) end as d
),
hist as (
  select case when to_regclass('supabase_migrations.schema_migrations') is null then null
    else (xpath('/row/v/text()', query_to_xml(
      'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text
    end as versions
)
select
  ((select oid from fn) is not null) as function_present,
  md5((select d from def)) as definition_md5,
  length((select d from def)) as definition_length,
  (select pg_get_userbyid(p.proowner) from pg_proc p where p.oid = (select oid from fn)) as owner,
  coalesce((select versions from hist) ~ '(^|, )20261123120000(,|$)', false) as history_recorded,
  coalesce((select versions from hist), 'no history table') as history_versions,
  (select d from def) as definition;
