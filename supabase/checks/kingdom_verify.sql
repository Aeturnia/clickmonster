-- The Kingdom invariant I-1 (docs/kingdoms-scope.md, 5.3.1; docs/kingdoms-k1-plan.md, 2.1).
-- READ-ONLY: a single SELECT; it changes nothing. Every row is an exception, so the expected
-- result is NO ROWS: in the test suites, and in production after each deploy.
--
-- I-1: a hero has data.kingdom if and only if a `claimed` plot has that hero's character_id, and
-- data.kingdom.plot equals that plot's x and y.
--   kingdom_without_plot  the hero's data has a kingdom, but no claimed plot is theirs
--   plot_without_kingdom  a claimed plot's hero has no kingdom in their data
--   plot_mismatch         the hero's data.kingdom.plot isn't the plot they hold
--   kingdom_malformed     data.kingdom is present but isn't an object
--   ownership_malformed   a plot breaks the claimed/owner rule (the table's CHECK prevents it)
with heroes as (
  select id, name, data -> 'kingdom' as k, jsonb_typeof(data -> 'kingdom') as kt
  from public.characters
  where data ? 'kingdom'
)
select 'kingdom_without_plot' as problem, h.id as character_id, h.name, null::smallint as x, null::smallint as y
  from heroes h
 where h.kt = 'object'
   and not exists (select 1 from public.kingdom_plots p where p.character_id = h.id and p.status = 'claimed')
union all
select 'plot_without_kingdom', p.character_id, c.name, p.x, p.y
  from public.kingdom_plots p join public.characters c on c.id = p.character_id
 where p.status = 'claimed' and jsonb_typeof(c.data -> 'kingdom') is distinct from 'object'
union all
select 'plot_mismatch', p.character_id, c.name, p.x, p.y
  from public.kingdom_plots p join public.characters c on c.id = p.character_id
 where p.status = 'claimed' and jsonb_typeof(c.data -> 'kingdom') = 'object'
   and (c.data -> 'kingdom' -> 'plot') is distinct from jsonb_build_object('x', p.x, 'y', p.y)
union all
select 'kingdom_malformed', h.id, h.name, null, null
  from heroes h
 where h.kt <> 'object'
union all
select 'ownership_malformed', p.character_id, null, p.x, p.y
  from public.kingdom_plots p
 where (p.status = 'claimed') <> (p.character_id is not null)
order by 1, 2;
