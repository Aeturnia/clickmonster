-- Rollback for supabase/migrations/20261123120000_save_hero_with_rewards.sql (#102, stage 1).
-- Not a migration: it lives outside supabase/migrations/ so it never runs by itself. Run it only
-- with the owner's go-ahead, in the SQL editor or with psql, if the migration must be undone.
--
-- Drop the function only while no deployed `game` function calls it. Once stage 2 is deployed,
-- redeploy the previous `game` version first. That brings back #102's reward loss until the fix
-- is redeployed (docs/pending-rewards-scope.md, section 7).
--
-- It changes no table and no data: claimed rewards stay claimed, and heroes stay as saved.
drop function if exists public.save_hero_with_rewards(uuid, int, jsonb, text, int, text, int, int, bigint[]);
