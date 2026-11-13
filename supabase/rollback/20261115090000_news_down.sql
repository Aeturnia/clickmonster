-- Rollback for supabase/migrations/20261115090000_news.sql (landing L-3).
-- Not a migration: it lives outside supabase/migrations/ so it never runs by itself. Run it only
-- with the owner's go-ahead, in the SQL editor or with psql, if the news migration must be undone.
-- It removes every news entry, published or not. Nothing else depends on the table.
drop policy if exists "Anyone can read published news" on public.news;
drop trigger if exists news_guard on public.news;
drop table if exists public.news;
drop function if exists public.news_guard();
