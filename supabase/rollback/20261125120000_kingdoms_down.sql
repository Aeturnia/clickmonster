-- Rollback for supabase/migrations/20261125120000_kingdoms.sql (#83, K1-1).
-- Not a migration: it lives outside supabase/migrations/ so it never runs by itself. Run it only
-- with the owner's go-ahead, in the SQL editor or with psql, if the migration must be undone.
--
-- Only while Kingdoms have never been opened: dropping the table deletes every plot. While
-- Kingdoms are closed the table is empty (docs/kingdoms-k1-plan.md, section 3), and no hero has
-- data.kingdom. Check both first: kingdoms_state.sql (plot_rows 0) and kingdom_verify.sql (no
-- rows). Drop the functions only while no deployed `game` or `admin` function calls them: once
-- K1-2's functions are deployed, redeploy their previous versions first.
--
-- It changes no other table: heroes, rewards and the audit log stay as they are.
drop function if exists public.kingdom_free_plot(int, int, boolean);
drop function if exists public.kingdom_unreserve(int, int, bigint, uuid, text, text);
drop function if exists public.kingdom_reserve(int, int, uuid, text, text);
drop function if exists public.kingdom_revoke(int, int, bigint, uuid, uuid, text, text);
drop function if exists public.kingdom_release(uuid, int, jsonb, text, int, text, int, int, bigint, bigint[]);
drop function if exists public.kingdom_claim(uuid, int, jsonb, text, int, text, int, int, int, int, bigint[]);
drop function if exists public.kingdom_claim_staged_rewards(uuid, bigint[]);
drop table if exists public.kingdom_plots;
