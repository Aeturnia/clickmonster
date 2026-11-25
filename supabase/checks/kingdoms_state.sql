-- The state of Kingdoms K1-1's migration, in one row (#83; docs/kingdoms-k1-plan.md, 2.5).
-- READ-ONLY: a single SELECT; it changes nothing. Used before the migration, after it, after a
-- failed or ambiguous step, and after a rollback.
--   table_present     whether public.kingdom_plots exists
--   plot_rows         its row count (0 while Kingdoms are closed)
--   functions_present how many of the seven kingdom_* functions (the five, the helper, the finder) exist with the reviewed signatures
--   definitions_md5   md5 of the seven pg_get_functiondef() texts, in signature order, joined by
--                     newlines; the reviewed value is recorded in the K-1 report, measured on LF text
--   owners            the functions' owners (they are SECURITY DEFINER, except the finder)
--   history_recorded  whether the migration history records 20261125120000
--   history_versions  every version the history records
with fns(n, sig) as (values
  (1, 'public.kingdom_claim(uuid,integer,jsonb,text,integer,text,integer,integer,integer,integer,bigint[])'),
  (2, 'public.kingdom_claim_staged_rewards(uuid,bigint[])'),
  (3, 'public.kingdom_free_plot(integer,integer,boolean)'),
  (4, 'public.kingdom_release(uuid,integer,jsonb,text,integer,text,integer,integer,bigint[])'),
  (5, 'public.kingdom_reserve(integer,integer,uuid,text,text)'),
  (6, 'public.kingdom_revoke(integer,integer,uuid,text,text)'),
  (7, 'public.kingdom_unreserve(integer,integer,uuid,text,text)')
),
found as (
  select f.n, p.oid, p.proowner from fns f left join pg_proc p on p.oid = to_regprocedure(f.sig)
),
hist as (
  select case when to_regclass('supabase_migrations.schema_migrations') is null then null
    else (xpath('/row/v/text()', query_to_xml(
      'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text
    end as versions
)
select
  (to_regclass('public.kingdom_plots') is not null) as table_present,
  (xpath('/row/c/text()', query_to_xml(
     case when to_regclass('public.kingdom_plots') is null then 'select null::int as c'
          else 'select count(*) as c from public.kingdom_plots' end, false, true, '')))[1]::text as plot_rows,
  (select count(oid) from found) as functions_present,
  md5((select string_agg(pg_get_functiondef(oid), E'\n' order by n) from found where oid is not null)) as definitions_md5,
  (select string_agg(distinct pg_get_userbyid(proowner), ', ') from found where oid is not null) as owners,
  coalesce((select versions from hist) ~ '(^|, )20261125120000(,|$)', false) as history_recorded,
  coalesce((select versions from hist), 'no history table') as history_versions;
