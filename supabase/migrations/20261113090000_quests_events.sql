-- Hourly quest board. Rows are created lazily by the `game` function (one batch per hour,
-- deterministic per hour so concurrent requests agree). First finisher claims it.
create table if not exists public.quests (
  id uuid primary key default gen_random_uuid(),
  bucket int not null,
  slot int not null,
  zone text not null,
  variant text not null,
  min_level int not null,
  max_level int not null,
  reward jsonb not null,
  expires_at timestamptz not null,
  completed_by uuid references public.characters (id) on delete set null,
  completed_by_name text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bucket, slot)
);
create index if not exists quests_open_idx on public.quests (expires_at) where completed_at is null;

-- Public announcements: quest wins, PvP kills, rare finds.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  kind text not null,
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists events_recent_idx on public.events (created_at desc);

alter table public.quests enable row level security;
alter table public.events enable row level security;
revoke all on public.quests, public.events from anon, authenticated;

grant select (id, bucket, slot, zone, variant, min_level, max_level, reward, expires_at, completed_by_name, completed_at)
  on public.quests to authenticated;
grant select on public.events to authenticated;

drop policy if exists "Signed-in players can read quests" on public.quests;
create policy "Signed-in players can read quests" on public.quests for select to authenticated using (true);
drop policy if exists "Signed-in players can read events" on public.events;
create policy "Signed-in players can read events" on public.events for select to authenticated using (true);
