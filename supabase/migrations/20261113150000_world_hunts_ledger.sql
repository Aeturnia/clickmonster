-- Live world settings: base multipliers plus timed events. One row (id = 1).
create table if not exists public.world_config (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.world_config (id, data)
values (1, '{"base": {"xp": 1, "gold": 1, "drop": 1, "elite": 1, "mastery": 1}, "events": []}')
on conflict (id) do nothing;

-- World bosses with shared, persistent health.
create table if not exists public.hunts (
  id uuid primary key default gen_random_uuid(),
  zone text not null,
  name text not null,
  level int not null,
  max_hp bigint not null,
  hp bigint not null,
  status text not null default 'active' check (status in ('active', 'defeated', 'cancelled')),
  reward jsonb not null,
  ends_at timestamptz not null,
  killed_by uuid references public.characters (id) on delete set null,
  killed_by_name text,
  killed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hunts_active_idx on public.hunts (zone) where status = 'active';

create table if not exists public.hunt_hits (
  hunt_id uuid not null references public.hunts (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  name text not null,
  damage bigint not null default 0,
  hits int not null default 0,
  primary key (hunt_id, character_id)
);

-- Rewards delivered to a hero the next time they act (works while they're offline).
create table if not exists public.pending_rewards (
  id bigint generated always as identity primary key,
  character_id uuid not null references public.characters (id) on delete cascade,
  source text not null,
  gold bigint not null default 0,
  xp bigint not null default 0,
  items jsonb not null default '[]',
  gems jsonb not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index if not exists pending_rewards_open_idx on public.pending_rewards (character_id) where claimed_at is null;

-- Daily gold flow: positive = gold entering the world, negative = leaving it.
create table if not exists public.ledger (
  day date not null,
  source text not null,
  amount bigint not null default 0,
  count int not null default 0,
  primary key (day, source)
);

alter table public.world_config enable row level security;
alter table public.hunts enable row level security;
alter table public.hunt_hits enable row level security;
alter table public.pending_rewards enable row level security;
alter table public.ledger enable row level security;
revoke all on public.world_config, public.hunts, public.hunt_hits, public.pending_rewards, public.ledger from anon, authenticated;

grant select on public.world_config to authenticated;
grant select on public.hunts to authenticated;
grant select on public.hunt_hits to authenticated;
drop policy if exists "Players read world config" on public.world_config;
create policy "Players read world config" on public.world_config for select to authenticated using (true);
drop policy if exists "Players read hunts" on public.hunts;
create policy "Players read hunts" on public.hunts for select to authenticated using (true);
drop policy if exists "Players read hunt hits" on public.hunt_hits;
create policy "Players read hunt hits" on public.hunt_hits for select to authenticated using (true);

-- Atomic damage to a world boss. Only the server (service role) may call it.
create or replace function public.hunt_hit(p_hunt uuid, p_char uuid, p_name text, p_damage bigint)
returns table (hp bigint, max_hp bigint, killed boolean, status text)
language plpgsql security definer set search_path = public as $$
declare h public.hunts%rowtype;
begin
  select * into h from public.hunts where id = p_hunt for update;
  if not found then
    return query select 0::bigint, 0::bigint, false, 'gone'::text; return;
  end if;
  if h.status <> 'active' or h.ends_at < now() then
    return query select h.hp, h.max_hp, false, (case when h.status = 'active' then 'expired' else h.status end); return;
  end if;
  update public.hunts set hp = greatest(0, public.hunts.hp - greatest(0, p_damage)) where id = p_hunt returning * into h;
  insert into public.hunt_hits (hunt_id, character_id, name, damage, hits)
  values (p_hunt, p_char, p_name, greatest(0, p_damage), 1)
  on conflict (hunt_id, character_id)
  do update set damage = public.hunt_hits.damage + excluded.damage, hits = public.hunt_hits.hits + 1, name = excluded.name;
  if h.hp = 0 then
    update public.hunts set status = 'defeated', killed_by = p_char, killed_by_name = p_name, killed_at = now() where id = p_hunt;
    return query select 0::bigint, h.max_hp, true, 'defeated'::text; return;
  end if;
  return query select h.hp, h.max_hp, false, 'active'::text;
end $$;

create or replace function public.ledger_add(p_source text, p_amount bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.ledger (day, source, amount, count) values (current_date, p_source, p_amount, 1)
  on conflict (day, source) do update set amount = public.ledger.amount + excluded.amount, count = public.ledger.count + 1;
$$;

revoke execute on function public.hunt_hit(uuid, uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.ledger_add(text, bigint) from public, anon, authenticated;
grant execute on function public.hunt_hit(uuid, uuid, text, bigint) to service_role;
grant execute on function public.ledger_add(text, bigint) to service_role;
