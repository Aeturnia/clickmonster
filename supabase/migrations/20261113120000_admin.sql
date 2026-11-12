-- Admin and moderation. Staff roles are checked by the `admin` and `game` edge functions
-- (service role); browsers can only read their own staff row.
create table if not exists public.staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;
drop policy if exists "Staff can see their own role" on public.staff;
create policy "Staff can see their own role" on public.staff for select to authenticated using (user_id = auth.uid());

-- Sanctions live on the character so the game server can check them on every action.
alter table public.characters
  add column if not exists banned_until timestamptz,
  add column if not exists jailed_until timestamptz,
  add column if not exists muted_until timestamptz,
  add column if not exists sanction_reason text,
  add column if not exists strikes int not null default 0;

-- History of every sanction.
create table if not exists public.sanctions (
  id bigint generated always as identity primary key,
  character_id uuid not null references public.characters (id) on delete cascade,
  kind text not null check (kind in ('mute', 'jail', 'ban', 'warn', 'lift')),
  reason text not null,
  until timestamptz,
  by_user uuid references auth.users (id) on delete set null,
  by_name text,
  created_at timestamptz not null default now()
);
create index if not exists sanctions_character_idx on public.sanctions (character_id, created_at desc);

-- Audit trail of every staff action.
create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  actor uuid references auth.users (id) on delete set null,
  actor_name text,
  action text not null,
  target_id uuid,
  target_name text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_log_recent_idx on public.admin_log (created_at desc);

alter table public.sanctions enable row level security;
alter table public.admin_log enable row level security;
revoke all on public.sanctions, public.admin_log from anon, authenticated;
