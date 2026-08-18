-- Slayers Squad schema (Postgres / Neon)
create extension if not exists "pgcrypto";

create table if not exists teams (
  id             text primary key,
  name           text not null,
  handicap_basis int  not null default 220,
  handicap_pct   int  not null default 90,
  post_code      text not null
);

create table if not exists bowlers (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references teams(id) on delete cascade,
  name       text not null,
  hand       text not null default 'R',
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references teams(id) on delete cascade,
  bowler_id  uuid not null references bowlers(id) on delete cascade,
  date       date not null,
  house      text,
  games      int[] not null,
  strikes    int[],
  spares     int[],
  frames     jsonb,
  created_at timestamptz not null default now()
);

-- if the sessions table already existed, add the newer columns safely:
alter table sessions add column if not exists frames jsonb;
alter table sessions add column if not exists house  text;
-- the opponents/matches/matchups tables above are new; running this file on an
-- existing DB creates them (all use "if not exists"). No further migration needed.

-- opponent teams we scout / play (owned by our team)
create table if not exists opponents (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references teams(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

-- one tour stop
create table if not exists matches (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null references teams(id) on delete cascade,
  date          date not null,
  house         text,
  opponent_id   uuid references opponents(id) on delete set null,
  opponent_name text,
  opp_bowlers   jsonb,        -- optional [{name, avg}] scouting on their bowlers
  created_at    timestamptz not null default now()
);

-- the 3 matchups within a stop: scratch, hcp1, hcp2
create table if not exists matchups (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references matches(id) on delete cascade,
  slot        text not null,          -- 'scratch' | 'hcp1' | 'hcp2'
  our_bowlers uuid[],                 -- our bowler ids in this trio (lead..anchor)
  our_score   int,
  opp_score   int,
  created_at  timestamptz not null default now()
);

create index if not exists idx_sessions_team  on sessions(team_id);
create index if not exists idx_bowlers_team   on bowlers(team_id);
create index if not exists idx_matches_team    on matches(team_id);
create index if not exists idx_matchups_match  on matchups(match_id);
create index if not exists idx_opponents_team  on opponents(team_id);

-- Seed your team. CHANGE THE POST CODE to something only your squad knows.
insert into teams (id, name, post_code)
values ('slayers', 'Slayers', 'CHANGE-ME-2026')
on conflict (id) do nothing;

-- ===== Cloud backup & sync (opt-in, app-wide — not team-scoped) =====
-- Users are identified by a random sync key; no emails or passwords are stored.
create table if not exists app_users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  sync_key   text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists user_games (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references app_users(id) on delete cascade,
  cid        text not null,          -- client-side game id (dedupe/upsert handle)
  d          date,
  house      text,
  ball       text,
  score      int,
  frames     jsonb,
  adj        jsonb,                  -- Caddy adjustment timeline
  imported   boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, cid)
);

create index if not exists idx_user_games_user on user_games(user_id);

-- availability RSVPs per scheduled event (event_key = client-derived stable slug)
create table if not exists team_avail (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references teams(id) on delete cascade,
  event_key  text not null,
  name       text not null,
  status     text not null check (status in ('yes','no')),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_team_avail_uniq on team_avail (team_id, event_key, lower(name));
create index if not exists idx_team_avail_team on team_avail(team_id);
