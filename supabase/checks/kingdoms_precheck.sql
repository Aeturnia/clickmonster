-- Before applying supabase/migrations/20261125120000_kingdoms.sql to production (#83, K1-1;
-- docs/kingdoms-k1-plan.md, 2.1 and 2.5). READ-ONLY: it changes nothing.
--   - Rows 2 and 3 must be "none": anything else means a table or function of those names already
--     exists, and the migration must not be applied until that is understood.
--   - Rows 4 and 5 must match their "expected" text: the functions rely on those columns.
--   - Row 6 must be "none": a database zone with the reserved id `kingdoms` or a path into it, an
--     Overworld path at its town cell, or a zone placed on the Overworld at that cell, would break
--     the Kingdom portal's integrity (K1-B03, K1-DB03).
--   - Rows 7 and 8 show the migration history, which decides how the migration is applied
--     (docs/landing-l3-report.md, section 4).
with cols(tbl, col) as (
  values ('characters', 'id'), ('characters', 'version'), ('characters', 'data'), ('characters', 'name'),
         ('characters', 'level'), ('characters', 'zone'), ('characters', 'x'), ('characters', 'y'),
         ('characters', 'updated_at'), ('pending_rewards', 'id'), ('pending_rewards', 'character_id'),
         ('pending_rewards', 'claimed_at'), ('admin_log', 'actor'), ('admin_log', 'actor_name'),
         ('admin_log', 'action'), ('admin_log', 'target_id'), ('admin_log', 'target_name'), ('admin_log', 'details')
),
types as (
  select string_agg(c.tbl || '.' || c.col || ':' || coalesce(i.data_type, 'MISSING'), ', ' order by c.tbl, c.col) as v
  from cols c left join information_schema.columns i
    on i.table_schema = 'public' and i.table_name = c.tbl and i.column_name = c.col
),
ow as (
  select data from public.zones where id = 'overworld'
),
-- The Overworld's town cell, where the Kingdom portal goes. Without an Overworld row the game uses
-- the built-in Overworld, whose town (the Crossroads) is (4, 4) in public/js/data/zones.js.
town as (
  select coalesce((select data -> 'town' ->> 'x' from ow), '4') as x,
         coalesce((select data -> 'town' ->> 'y' from ow), '4') as y
),
zone_problems as (
  select string_agg(problem, '; ' order by problem) as v from (
    select 'a zone with the id kingdoms' as problem from public.zones where id = 'kingdoms'
    union all
    select 'a path into kingdoms in ' || z.id from public.zones z, jsonb_array_elements(coalesce(z.data -> 'portals', '[]')) p
     where p ->> 'to' = 'kingdoms'
    union all
    select 'an Overworld path at its town cell' from ow, town, jsonb_array_elements(coalesce(ow.data -> 'portals', '[]')) p
     where (p ->> 'x') = town.x and (p ->> 'y') = town.y
    union all
    -- compileZone() turns each zone's Overworld placement into a path at that cell (K1-DB03).
    select 'a zone placed on the Overworld town cell: ' || z.id from public.zones z, town
     where z.id <> 'overworld' and jsonb_typeof(z.data -> 'overworld') = 'array'
       and (z.data -> 'overworld' ->> 0) = town.x and (z.data -> 'overworld' ->> 1) = town.y
  ) t
)
select n, item, value from (values
  (1, 'Postgres version', current_setting('server_version')),
  (2, 'table kingdom_plots (expected: none)', coalesce(to_regclass('public.kingdom_plots')::text, 'none')),
  (3, 'functions named kingdom_* (expected: none)', coalesce((
     select string_agg(p.oid::regprocedure::text, ', ' order by p.proname)
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname like 'kingdom\_%'), 'none')),
  (4, 'public.characters, public.pending_rewards and public.admin_log exist (expected: true)',
     (to_regclass('public.characters') is not null and to_regclass('public.pending_rewards') is not null
      and to_regclass('public.admin_log') is not null)::text),
  (5, 'column types (expected: admin_log.action:text, admin_log.actor:uuid, admin_log.actor_name:text, admin_log.details:jsonb, admin_log.target_id:uuid, admin_log.target_name:text, characters.data:jsonb, characters.id:uuid, characters.level:integer, characters.name:text, characters.updated_at:timestamp with time zone, characters.version:integer, characters.x:integer, characters.y:integer, characters.zone:text, pending_rewards.character_id:uuid, pending_rewards.claimed_at:timestamp with time zone, pending_rewards.id:bigint)',
     (select v from types)),
  (6, 'zone rows that break the Kingdom portal (expected: none)', coalesce((select v from zone_problems), 'none')),
  (7, 'migration history table exists', (to_regclass('supabase_migrations.schema_migrations') is not null)::text),
  (8, 'recorded migration versions', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text, 'none')
     end)
) as t(n, item, value)
order by n;
