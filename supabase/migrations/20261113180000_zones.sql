-- Editable world. Each row is one zone definition (see public/js/data/zones.js for the format).
-- Seeded from the built-in zones by tools/seed-zones.mjs. Edited through the admin console.
create table if not exists public.zones (
  id text primary key,
  data jsonb not null,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.zones enable row level security;
revoke all on public.zones from anon, authenticated;
grant select on public.zones to anon, authenticated;
drop policy if exists "Anyone can read zones" on public.zones;
create policy "Anyone can read zones" on public.zones for select to anon, authenticated using (true);
