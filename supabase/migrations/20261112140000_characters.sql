-- One character per account. The full game state lives in `data` (jsonb) and is
-- only ever written by the `game` edge function (service role). Signed-in players
-- may read the public columns so they can see who is in the same cell.
create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  name text not null,
  race text not null,
  level int not null default 1,
  zone text not null,
  x int not null,
  y int not null,
  data jsonb not null,
  version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists characters_name_lower_key on public.characters (lower(name));
create index if not exists characters_location_idx on public.characters (zone, x, y, updated_at desc);

alter table public.characters enable row level security;

-- Nobody writes from the browser. Reads are limited to public columns.
revoke all on public.characters from anon, authenticated;
grant select (id, name, race, level, zone, x, y, updated_at) on public.characters to authenticated;

drop policy if exists "Signed-in players can see other players" on public.characters;
create policy "Signed-in players can see other players"
  on public.characters for select to authenticated using (true);
