-- Before applying supabase/migrations/20261123120000_save_hero_with_rewards.sql to production
-- (#102, docs/pending-rewards-scope.md, section 7). READ-ONLY: it changes nothing.
-- Paste into the Supabase SQL editor and record the whole result.
--   - Row 2 must be "none": anything else means a function of that name already exists, and the
--     migration must not be applied until that is understood.
--   - Rows 3 to 5 must match their "expected" text: the function relies on those columns.
--   - Rows 6 and 7 show the migration history, which decides how the migration is applied
--     (docs/landing-l3-report.md, section 4). An older migration's history entry is never added
--     just because its file exists.
with cols(tbl, col) as (
  values ('characters', 'id'), ('characters', 'version'), ('characters', 'data'), ('characters', 'name'),
         ('characters', 'level'), ('characters', 'zone'), ('characters', 'x'), ('characters', 'y'),
         ('characters', 'updated_at'), ('pending_rewards', 'id'), ('pending_rewards', 'character_id'),
         ('pending_rewards', 'claimed_at')
),
types as (
  select string_agg(c.tbl || '.' || c.col || ':' || coalesce(i.data_type, 'MISSING'), ', ' order by c.tbl, c.col) as v
  from cols c left join information_schema.columns i
    on i.table_schema = 'public' and i.table_name = c.tbl and i.column_name = c.col
)
select n, item, value from (values
  (1, 'Postgres version', current_setting('server_version')),
  (2, 'functions named save_hero_with_rewards (expected: none)', coalesce((
     select string_agg(p.oid::regprocedure::text, ', ')
     from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = 'save_hero_with_rewards'), 'none')),
  (3, 'public.characters exists (expected: true)', (to_regclass('public.characters') is not null)::text),
  (4, 'public.pending_rewards exists (expected: true)', (to_regclass('public.pending_rewards') is not null)::text),
  (5, 'column types (expected: characters.data:jsonb, characters.id:uuid, characters.level:integer, characters.name:text, characters.updated_at:timestamp with time zone, characters.version:integer, characters.x:integer, characters.y:integer, characters.zone:text, pending_rewards.character_id:uuid, pending_rewards.claimed_at:timestamp with time zone, pending_rewards.id:bigint)',
     (select v from types)),
  (6, 'migration history table exists', (to_regclass('supabase_migrations.schema_migrations') is not null)::text),
  (7, 'recorded migration versions', case
     when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
     else coalesce((xpath('/row/v/text()', query_to_xml(
       'select string_agg(version, '', '' order by version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text, 'none')
     end)
) as t(n, item, value)
order by n;
