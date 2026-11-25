-- Kingdoms K-1, stage K1-1: the database foundation (#83; docs/kingdoms-scope.md, 5.3 and 5.3.1;
-- docs/kingdoms-k1-plan.md, 2.1).
--
-- Adds the plot table, the five functions that change what crosses a plot and its hero, a
-- private reward-claim helper, and the plot finder. Nothing calls them until K1-2 changes the
-- `game` and `admin` functions, and Kingdoms ship closed: while closed, nothing writes a plot.
--
-- The invariant (I-1, 5.3.1): a hero has data.kingdom if and only if a `claimed` plot has that
-- hero's character_id, and data.kingdom.plot equals that plot's x and y. Every change that could
-- break it is one of the functions below, each one transaction.
--
-- Errors, each a fixed SQLSTATE and message (the plan's 2.1). PostgREST reports the code as the
-- error's `code`; none is in the PT class, so PostgREST answers 400 and the edge functions map it:
--   MRPLT  plot_taken        the plot is claimed or reserved (the primary key)       -> 409
--   MRHAS  has_kingdom       the hero already has a plot (the unique character_id)    -> 409
--   MRNOP  no_plot           release, revoke or unreserve find no plot to act on      -> 409
--   MRSTL  plot_changed      there is a plot, but not the ownership instance named:
--                            it changed hands, or was released and taken again       -> 409
--   MRREW  rewards_conflict  a staged reward is claimed, another hero's, or missing  -> 409 (busy)
--   MRVER  version_conflict  the hero's version changed, or the hero doesn't exist   -> 409 (busy)
--   MRARG  bad_arguments     a malformed call, or p_data that breaks I-1             -> a server error
--
-- save_hero_with_rewards() (#102) is not changed.

-- ------------------------------------------------------------ the plots
create table if not exists public.kingdom_plots (
  -- The ownership instance (K1-DB01): every claim or reservation gets a new id, never reused, so a
  -- destructive request names the exact instance it was prepared against, and a later owner or
  -- reservation of the same plot can't be removed by a stale confirmation or a retry.
  id bigint generated always as identity,
  x smallint not null,
  y smallint not null,
  status text not null,
  character_id uuid references public.characters (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  constraint kingdom_plots_pkey primary key (x, y),
  constraint kingdom_plots_id_key unique (id),
  constraint kingdom_plots_x_range check (x between 1 and 100),
  constraint kingdom_plots_y_range check (y between 1 and 100),
  constraint kingdom_plots_status check (status in ('claimed', 'reserved')),
  -- A claimed plot has an owner; a reserved one has none (5.3.1).
  constraint kingdom_plots_owner check ((status = 'claimed') = (character_id is not null)),
  -- One plot per hero (K-D7, 5.4). Several reserved plots may each have no owner.
  constraint kingdom_plots_character_key unique (character_id)
);

alter table public.kingdom_plots enable row level security;

-- Nobody writes from the browser. Signed-in players can read the plot columns (5.3), including the
-- ownership instance's id, which a release names (K1-DB01); anon nothing.
revoke all on public.kingdom_plots from anon, authenticated;
grant select (id, x, y, status, character_id, claimed_at) on public.kingdom_plots to authenticated;

drop policy if exists "Signed-in players can see the plots" on public.kingdom_plots;
create policy "Signed-in players can see the plots"
  on public.kingdom_plots for select to authenticated using (true);

-- ------------------------------------------------------------ the private reward claim
-- Claims exactly the staged reward ids for p_char, with #102's checks (amendment 1): no null set,
-- no null element, no duplicate; each owned by p_char and unclaimed, or raise. An empty set claims
-- nothing. Called only by kingdom_claim() and kingdom_release(), inside their transaction.
create or replace function public.kingdom_claim_staged_rewards(p_char uuid, p_reward_ids bigint[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  n_ids int;
  n_claimed int;
begin
  if p_reward_ids is null
     or exists (select 1 from unnest(p_reward_ids) as u(id) where u.id is null) then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;
  n_ids := cardinality(p_reward_ids);
  if n_ids = 0 then
    return;
  end if;
  if (select count(distinct u.id) from unnest(p_reward_ids) as u(id)) <> n_ids then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;

  update public.pending_rewards
     set claimed_at = now()
   where id = any (p_reward_ids) and character_id = p_char and claimed_at is null;
  get diagnostics n_claimed = row_count;
  if n_claimed <> n_ids then
    raise exception 'rewards_conflict' using errcode = 'MRREW';
  end if;
end $$;

revoke execute on function public.kingdom_claim_staged_rewards(uuid, bigint[]) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------ claim (the `game` function)
-- In order (5.3.1): check the arguments and p_data; insert the plot; claim the staged rewards;
-- save the hero with the version check (version = p_version + 1, the plan's Q4). Any raise rolls
-- back everything, the reward claims included. Returns the new version.
create or replace function public.kingdom_claim(
  p_char uuid, p_version int, p_data jsonb,
  p_name text, p_level int, p_zone text, p_x int, p_y int,
  p_plot_x int, p_plot_y int, p_reward_ids bigint[]
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n_saved int;
  v_constraint text;
begin
  if p_char is null or p_version is null
     or p_plot_x is null or p_plot_y is null
     or p_plot_x not between 1 and 100 or p_plot_y not between 1 and 100
     or p_data is null or jsonb_typeof(p_data) <> 'object'
     or jsonb_typeof(p_data -> 'kingdom') is distinct from 'object'
     or (p_data -> 'kingdom' -> 'plot') is distinct from jsonb_build_object('x', p_plot_x, 'y', p_plot_y) then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;

  begin
    insert into public.kingdom_plots (x, y, status, character_id)
    values (p_plot_x, p_plot_y, 'claimed', p_char);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'kingdom_plots_character_key' then
        raise exception 'has_kingdom' using errcode = 'MRHAS';
      end if;
      raise exception 'plot_taken' using errcode = 'MRPLT';
    when foreign_key_violation then
      raise exception 'version_conflict' using errcode = 'MRVER';
  end;

  perform public.kingdom_claim_staged_rewards(p_char, p_reward_ids);

  update public.characters
     set data = p_data, name = p_name, level = p_level, zone = p_zone, x = p_x, y = p_y,
         version = p_version + 1, updated_at = now()
   where id = p_char and version = p_version;
  get diagnostics n_saved = row_count;
  if n_saved = 0 then
    raise exception 'version_conflict' using errcode = 'MRVER';
  end if;

  return p_version + 1;
end $$;

-- ------------------------------------------------------------ release (the `game` function)
-- In order (5.3.1): check the arguments and p_data (no kingdom); delete the hero's claimed plot,
-- only if it is still the ownership instance p_plot_id that the release was prepared against
-- (K1-DB01); claim the staged rewards; save the hero with the version check. Returns the new
-- version. If the hero holds a different plot instance now, MRSTL; if none, MRNOP.
create or replace function public.kingdom_release(
  p_char uuid, p_version int, p_data jsonb,
  p_name text, p_level int, p_zone text, p_x int, p_y int,
  p_plot_id bigint, p_reward_ids bigint[]
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n_deleted int;
  n_saved int;
begin
  if p_char is null or p_version is null or p_plot_id is null
     or p_data is null or jsonb_typeof(p_data) <> 'object' or p_data ? 'kingdom' then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;

  delete from public.kingdom_plots where id = p_plot_id and character_id = p_char and status = 'claimed';
  get diagnostics n_deleted = row_count;
  if n_deleted = 0 then
    if exists (select 1 from public.kingdom_plots where character_id = p_char) then
      raise exception 'plot_changed' using errcode = 'MRSTL';
    end if;
    raise exception 'no_plot' using errcode = 'MRNOP';
  end if;

  perform public.kingdom_claim_staged_rewards(p_char, p_reward_ids);

  update public.characters
     set data = p_data, name = p_name, level = p_level, zone = p_zone, x = p_x, y = p_y,
         version = p_version + 1, updated_at = now()
   where id = p_char and version = p_version;
  get diagnostics n_saved = row_count;
  if n_saved = 0 then
    raise exception 'version_conflict' using errcode = 'MRVER';
  end if;

  return p_version + 1;
end $$;

-- ------------------------------------------------------------ revoke (the `admin` function)
-- In order (5.3.1): lock the claimed plot, only if it is still the ownership instance the staff
-- member inspected (p_plot_id, owned by p_character_id; K1-DB01), and delete it; lock its hero's
-- row; remove data.kingdom and raise the version unconditionally (version = version + 1, on the
-- locked current row, the plan's Q4), so any `game` request that read the hero before the revoke
-- fails its save with 409; refund a construction's paid gold only if it is still under way at the
-- transaction's time (question 9); insert the audit entry. Returns the gold refunded (0 when
-- nothing is under way; K1-B06).
--
-- A stale request (the plot changed hands, or was released and taken again) raises MRSTL and
-- changes nothing; a plot with no claim at all raises MRNOP.
--
-- The construction record is K-2's. Its refund reads construction.paid.gold and
-- construction.finishAt (milliseconds since the epoch). The refund is exact (K1-DB02): paid.gold
-- must be a whole number from 0 to 9,007,199,254,740,991 (JavaScript's Number.MAX_SAFE_INTEGER, the
-- engine's largest exact integer), and so must the hero's gold after the refund. Anything else, or
-- a construction that is present but malformed, raises MRARG rather than guess or round. Values
-- are checked as numeric before any conversion. "Under way" is
-- finishAt > floor(extract(epoch from now()) * 1000): at or after finishAt it has finished.
create or replace function public.kingdom_revoke(
  p_x int, p_y int, p_plot_id bigint, p_character_id uuid,
  p_staff uuid, p_staff_name text, p_reason text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  c_max_exact constant numeric := 9007199254740991;
  v_char uuid;
  v_data jsonb;
  v_name text;
  v_construction jsonb;
  v_now_ms bigint := floor(extract(epoch from now()) * 1000)::bigint;
  v_paid numeric;
  v_refund bigint := 0;
  v_gold numeric;
begin
  if p_x is null or p_y is null or p_x not between 1 and 100 or p_y not between 1 and 100
     or p_plot_id is null or p_character_id is null then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;

  select character_id into v_char
    from public.kingdom_plots
   where x = p_x and y = p_y and status = 'claimed' and id = p_plot_id and character_id = p_character_id
   for update;
  if not found then
    if exists (select 1 from public.kingdom_plots where x = p_x and y = p_y) then
      raise exception 'plot_changed' using errcode = 'MRSTL';
    end if;
    raise exception 'no_plot' using errcode = 'MRNOP';
  end if;
  delete from public.kingdom_plots where id = p_plot_id;

  select data, name into v_data, v_name from public.characters where id = v_char for update;

  v_construction := v_data -> 'kingdom' -> 'construction';
  if v_construction is not null and jsonb_typeof(v_construction) <> 'null' then
    if jsonb_typeof(v_construction) <> 'object'
       or jsonb_typeof(v_construction -> 'finishAt') is distinct from 'number'
       or jsonb_typeof(v_construction -> 'paid') is distinct from 'object'
       or jsonb_typeof(v_construction -> 'paid' -> 'gold') is distinct from 'number' then
      raise exception 'bad_arguments' using errcode = 'MRARG';
    end if;
    v_paid := (v_construction -> 'paid' ->> 'gold')::numeric;
    if v_paid < 0 or v_paid > c_max_exact or v_paid <> trunc(v_paid) then
      raise exception 'bad_arguments' using errcode = 'MRARG';
    end if;
    if (v_construction ->> 'finishAt')::numeric > v_now_ms then
      v_refund := v_paid::bigint;
    end if;
  end if;

  v_data := v_data - 'kingdom';
  if v_refund > 0 then
    v_gold := coalesce((v_data ->> 'gold')::numeric, 0);
    if v_gold + v_refund > c_max_exact then
      raise exception 'bad_arguments' using errcode = 'MRARG';
    end if;
    v_data := jsonb_set(v_data, '{gold}', to_jsonb(v_gold + v_refund));
  end if;

  update public.characters
     set data = v_data, version = version + 1, updated_at = now()
   where id = v_char;

  insert into public.admin_log (actor, actor_name, action, target_id, target_name, details)
  values (p_staff, p_staff_name, 'kingdom:revoke', v_char, v_name,
          jsonb_build_object('x', p_x, 'y', p_y, 'plot_id', p_plot_id, 'reason', p_reason,
                             'refund', v_refund, 'at_ms', v_now_ms));

  return v_refund;
end $$;

-- ------------------------------------------------------------ reserve and unreserve (the `admin` function)
-- Reserve returns the new reservation's id, which an unreserve names (K1-DB01).
create or replace function public.kingdom_reserve(
  p_x int, p_y int, p_staff uuid, p_staff_name text, p_reason text
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  if p_x is null or p_y is null or p_x not between 1 and 100 or p_y not between 1 and 100 then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;
  begin
    insert into public.kingdom_plots (x, y, status, character_id) values (p_x, p_y, 'reserved', null)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'plot_taken' using errcode = 'MRPLT';
  end;
  insert into public.admin_log (actor, actor_name, action, target_id, target_name, details)
  values (p_staff, p_staff_name, 'kingdom:reserve', null, null,
          jsonb_build_object('x', p_x, 'y', p_y, 'plot_id', v_id, 'reason', p_reason));
  return v_id;
end $$;

-- Unreserve removes only the reservation p_plot_id: a reservation that was removed and made again,
-- or a plot claimed since, raises MRSTL and changes nothing; a free plot raises MRNOP.
create or replace function public.kingdom_unreserve(
  p_x int, p_y int, p_plot_id bigint, p_staff uuid, p_staff_name text, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  n_deleted int;
begin
  if p_x is null or p_y is null or p_x not between 1 and 100 or p_y not between 1 and 100
     or p_plot_id is null then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;
  delete from public.kingdom_plots where x = p_x and y = p_y and id = p_plot_id and status = 'reserved';
  get diagnostics n_deleted = row_count;
  if n_deleted = 0 then
    if exists (select 1 from public.kingdom_plots where x = p_x and y = p_y) then
      raise exception 'plot_changed' using errcode = 'MRSTL';
    end if;
    raise exception 'no_plot' using errcode = 'MRNOP';
  end if;
  insert into public.admin_log (actor, actor_name, action, target_id, target_name, details)
  values (p_staff, p_staff_name, 'kingdom:unreserve', null, null,
          jsonb_build_object('x', p_x, 'y', p_y, 'plot_id', p_plot_id, 'reason', p_reason));
end $$;

revoke execute on function public.kingdom_claim(uuid, int, jsonb, text, int, text, int, int, int, int, bigint[]) from public, anon, authenticated;
grant execute on function public.kingdom_claim(uuid, int, jsonb, text, int, text, int, int, int, int, bigint[]) to service_role;
revoke execute on function public.kingdom_release(uuid, int, jsonb, text, int, text, int, int, bigint, bigint[]) from public, anon, authenticated;
grant execute on function public.kingdom_release(uuid, int, jsonb, text, int, text, int, int, bigint, bigint[]) to service_role;
revoke execute on function public.kingdom_revoke(int, int, bigint, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.kingdom_revoke(int, int, bigint, uuid, uuid, text, text) to service_role;
revoke execute on function public.kingdom_reserve(int, int, uuid, text, text) from public, anon, authenticated;
grant execute on function public.kingdom_reserve(int, int, uuid, text, text) to service_role;
revoke execute on function public.kingdom_unreserve(int, int, bigint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.kingdom_unreserve(int, int, bigint, uuid, text, text) to service_role;

-- ------------------------------------------------------------ the plot finder (K1-B05, Q1)
-- The free plot nearest (p_x, p_y), or (p_random) a uniformly random free plot. Advisory only:
-- the claim's transaction decides who gets a plot. At most one row; none when every plot is
-- taken. Nearest is the smallest Chebyshev distance (the window's rings), ties going to the
-- smallest y, then the smallest x. VOLATILE because of the random branch. SECURITY INVOKER: it
-- reads kingdom_plots under the caller's RLS and column grants.
create or replace function public.kingdom_free_plot(p_x int, p_y int, p_random boolean)
returns table (x smallint, y smallint)
language plpgsql volatile security invoker set search_path = public as $$
#variable_conflict use_column
begin
  if p_random is null then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;
  if not p_random and (p_x is null or p_y is null or p_x not between 1 and 100 or p_y not between 1 and 100) then
    raise exception 'bad_arguments' using errcode = 'MRARG';
  end if;

  if p_random then
    return query
      select gx.cx::smallint, gy.cy::smallint
        from generate_series(1, 100) as gx(cx) cross join generate_series(1, 100) as gy(cy)
       where not exists (select 1 from public.kingdom_plots k where k.x = gx.cx and k.y = gy.cy)
       order by random()
       limit 1;
  else
    return query
      select gx.cx::smallint, gy.cy::smallint
        from generate_series(1, 100) as gx(cx) cross join generate_series(1, 100) as gy(cy)
       where not exists (select 1 from public.kingdom_plots k where k.x = gx.cx and k.y = gy.cy)
       order by greatest(abs(gx.cx - p_x), abs(gy.cy - p_y)), gy.cy, gx.cx
       limit 1;
  end if;
end $$;

revoke execute on function public.kingdom_free_plot(int, int, boolean) from public, anon;
grant execute on function public.kingdom_free_plot(int, int, boolean) to authenticated, service_role;
