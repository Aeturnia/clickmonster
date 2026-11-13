-- Public news (landing L-3, docs/landing-scope.md): development updates, patch notes, releases,
-- scheduled maintenance and announcements, kept apart from in-game world events.
--
-- Who can do what:
--   - The public (anon) and signed-in players (authenticated) can read published entries whose
--     publication time has passed, and only the article columns. Nothing else, and no writes.
--   - Staff write only through the `admin` edge function (service role), admins only, and every
--     change is recorded in admin_log there.
-- The rules for changing entries (Q8) are enforced here as well as in the function:
--   - the address (slug) and the first publication time never change once published;
--   - a published entry can't be deleted, only unpublished;
--   - a draft has never been published.
-- Rollback: supabase/rollback/20261115090000_news_down.sql.

create table if not exists public.news (
  id bigint generated always as identity primary key,
  slug text not null unique,
  kind text not null default 'update',
  title text not null,
  summary text not null,
  body text not null,
  status text not null default 'draft',
  published_at timestamptz,          -- first publication; kept through unpublishing and republishing
  revised_at timestamptz,            -- last change to the text after first publication ("Updated")
  maintenance_starts_at timestamptz, -- kind = 'maintenance' only
  maintenance_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  constraint news_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  constraint news_kind check (kind in ('update', 'patch', 'release', 'maintenance', 'announcement')),
  constraint news_status check (status in ('draft', 'published', 'unpublished')),
  constraint news_title_length check (char_length(title) between 3 and 120),
  constraint news_summary_length check (char_length(summary) between 10 and 240),
  constraint news_body_length check (char_length(body) between 1 and 20000),
  constraint news_published_has_date check ((status = 'draft') = (published_at is null)),
  constraint news_revised_after_published check (revised_at is null or (published_at is not null and revised_at >= published_at)),
  constraint news_window_only_maintenance check (kind = 'maintenance' or (maintenance_starts_at is null and maintenance_ends_at is null)),
  constraint news_window_order check (maintenance_starts_at is null or maintenance_ends_at is null or maintenance_ends_at > maintenance_starts_at)
);

create index if not exists news_published_idx on public.news (published_at desc) where status = 'published';

-- The publication rules (Q8), whatever writes the row.
create or replace function public.news_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'A published news entry can''t be deleted; unpublish it first.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.published_at is not null then
    if new.slug is distinct from old.slug then
      raise exception 'The address of a news entry can''t change once it has been published.' using errcode = 'check_violation';
    end if;
    if new.published_at is distinct from old.published_at then
      raise exception 'The first publication time of a news entry can''t change.' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists news_guard on public.news;
create trigger news_guard before update or delete on public.news
  for each row execute function public.news_guard();

-- Access: column grants decide what can be read, row-level security decides which rows.
alter table public.news enable row level security;
revoke all on public.news from anon, authenticated;
grant select (id, slug, kind, title, summary, body, published_at, revised_at, maintenance_starts_at, maintenance_ends_at)
  on public.news to anon, authenticated;
drop policy if exists "Anyone can read published news" on public.news;
create policy "Anyone can read published news" on public.news for select to anon, authenticated
  using (status = 'published' and published_at <= now());

revoke all on function public.news_guard() from public, anon, authenticated;
