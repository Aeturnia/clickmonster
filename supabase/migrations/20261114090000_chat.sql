-- Chat: Global, Zone and Whisper channels. Messages are written only by the `game` edge
-- function (which enforces mutes, level, rate limits and link blocking). Row-level security
-- decides who receives what, including over Supabase Realtime.
create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('global', 'zone', 'whisper')),
  zone text,
  sender_id uuid references public.characters (id) on delete set null,
  sender_name text not null,
  sender_role text,
  recipient_id uuid references public.characters (id) on delete set null,
  recipient_name text,
  text text not null,
  original_text text,            -- kept privately when staff remove a message
  deleted_at timestamptz,
  deleted_by text,
  created_at timestamptz not null default now()
);
create index if not exists chat_recent_idx on public.chat_messages (channel, created_at desc);
create index if not exists chat_zone_idx on public.chat_messages (zone, created_at desc) where channel = 'zone';
create index if not exists chat_sender_idx on public.chat_messages (sender_id, created_at desc);
create index if not exists chat_recipient_idx on public.chat_messages (recipient_id, created_at desc);

create table if not exists public.chat_ignores (
  owner_id uuid not null references public.characters (id) on delete cascade,
  ignored_id uuid not null references public.characters (id) on delete cascade,
  ignored_name text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, ignored_id)
);

create table if not exists public.chat_reports (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.chat_messages (id) on delete cascade,
  reporter_id uuid references public.characters (id) on delete set null,
  reporter_name text,
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (message_id, reporter_id)
);

alter table public.chat_messages enable row level security;
alter table public.chat_ignores enable row level security;
alter table public.chat_reports enable row level security;
revoke all on public.chat_messages, public.chat_ignores, public.chat_reports from anon, authenticated;

-- Players never see original_text.
grant select (id, channel, zone, sender_id, sender_name, sender_role, recipient_id, recipient_name, text, deleted_at, created_at)
  on public.chat_messages to authenticated;
grant select on public.chat_ignores to authenticated;

-- Helper: the signed-in player's character (security definer so policies can use it cheaply).
create or replace function public.my_character()
returns table (id uuid, zone text)
language sql stable security definer set search_path = public as $$
  select c.id, c.zone from public.characters c where c.user_id = auth.uid() limit 1;
$$;
revoke execute on function public.my_character() from public, anon;
grant execute on function public.my_character() to authenticated;

drop policy if exists "Read chat you are part of" on public.chat_messages;
create policy "Read chat you are part of" on public.chat_messages for select to authenticated using (
  channel = 'global'
  or (channel = 'zone' and zone = (select m.zone from public.my_character() m))
  or (channel = 'whisper' and (select m.id from public.my_character() m) in (sender_id, recipient_id))
);

drop policy if exists "Read your ignore list" on public.chat_ignores;
create policy "Read your ignore list" on public.chat_ignores for select to authenticated using (
  owner_id = (select m.id from public.my_character() m)
);

-- Live delivery.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'events') then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;
