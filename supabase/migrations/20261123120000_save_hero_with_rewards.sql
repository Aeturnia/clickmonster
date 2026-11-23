-- Pending rewards delivered exactly once (#102, stage 1; docs/pending-rewards-scope.md, 5.2).
--
-- save_hero_with_rewards() saves a hero and claims the pending rewards whose effects that save
-- delivers, in one transaction, or neither. The `game` function stages rewards in memory, then
-- commits through this function instead of its ordinary versioned update. Stage 1 adds only the
-- function: nothing calls it until the `game` function changes in stage 2.
--
-- In order:
--   1. Refuse a bad id set: null, empty, a null element, or a duplicate id.
--   2. Claim the rewards: each must belong to p_char and be unclaimed. If fewer rows are claimed
--      than there are ids (one already claimed, another hero's, or missing), raise.
--   3. Save the hero with the version check (as saveRow() does): data, the public columns,
--      version + 1 and updated_at, where the version is still p_version. If no row is saved, raise.
--   4. Return the new version.
-- Any raise rolls back both updates: no reward is claimed without the hero's save, and no hero is
-- saved with rewards that weren't claimed. The function doesn't inspect p_data; applying the
-- rewards correctly is the engine's job.
--
-- Errors, each a fixed SQLSTATE and message, so the caller can tell a conflict from a mistake.
-- PostgREST reports the code as the error's `code` (and answers 400: none of them is in the PT
-- class, which PostgREST would read as an HTTP status):
--   MRREW  rewards_conflict   a reward is already claimed, another hero's, or missing  -> 409 in `game`
--   MRVER  version_conflict   the hero's version has changed, or the hero doesn't exist -> 409 in `game`
--   MRARG  invalid_reward_ids  null, empty, a null element, or duplicates               -> a server error
--
-- Callable by the service role only (the `game` function). Safe to re-run: create or replace,
-- with the grants restated.
create or replace function public.save_hero_with_rewards(
  p_char uuid, p_version int, p_data jsonb,
  p_name text, p_level int, p_zone text, p_x int, p_y int,
  p_reward_ids bigint[]
) returns int
language plpgsql security definer set search_path = public as $$
declare
  n_ids int := coalesce(cardinality(p_reward_ids), 0);
  n_claimed int;
  n_saved int;
begin
  if n_ids = 0
     or exists (select 1 from unnest(p_reward_ids) as u(id) where u.id is null)
     or (select count(distinct u.id) from unnest(p_reward_ids) as u(id)) <> n_ids then
    raise exception 'invalid_reward_ids' using errcode = 'MRARG';
  end if;

  update public.pending_rewards
     set claimed_at = now()
   where id = any (p_reward_ids) and character_id = p_char and claimed_at is null;
  get diagnostics n_claimed = row_count;
  if n_claimed <> n_ids then
    raise exception 'rewards_conflict' using errcode = 'MRREW';
  end if;

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

revoke execute on function public.save_hero_with_rewards(uuid, int, jsonb, text, int, text, int, int, bigint[]) from public, anon, authenticated;
grant execute on function public.save_hero_with_rewards(uuid, int, jsonb, text, int, text, int, int, bigint[]) to service_role;
