create extension if not exists pgcrypto;

create table if not exists public.accidents (
  id uuid primary key default gen_random_uuid(),
  accident_id text unique not null,
  accident_date date,
  accident_time text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  location text,
  road_name text,
  severity text check (severity in ('Fatal','Serious Injury','Minor Injury','Property Damage')),
  fatalities integer not null default 0 check (fatalities >= 0),
  injuries integer not null default 0 check (injuries >= 0),
  vehicle_type text,
  weather text,
  road_condition text,
  lighting text,
  contributing_factor text,
  created_at timestamptz not null default now()
);

create index if not exists accidents_date_idx on public.accidents (accident_date);
create index if not exists accidents_road_idx on public.accidents (road_name);
create index if not exists accidents_location_idx on public.accidents (location);

-- Secure default: RLS enabled and no public read/write policies.
-- Add authenticated policies appropriate to your roles before connecting a public frontend.
alter table public.accidents enable row level security;

create table if not exists public.road_segments (
  id uuid primary key default gen_random_uuid(),
  road_name text not null unique,
  accident_count integer not null default 0,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text,
  updated_at timestamptz not null default now()
);

create table if not exists public.hotspots (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accident_count integer not null default 0,
  fatalities integer not null default 0,
  risk_score integer not null default 0 check (risk_score between 0 and 100),
  risk_level text,
  primary_factor text,
  created_at timestamptz not null default now()
);

create table if not exists public.interventions (
  id uuid primary key default gen_random_uuid(),
  hotspot_id uuid references public.hotspots(id) on delete set null,
  recommendation text not null,
  priority text not null default 'Medium',
  status text not null default 'Identified' check (status in ('Identified','Under Investigation','Intervention Planned','Work in Progress','Resolved','Monitoring')),
  assigned_authority text,
  created_at timestamptz not null default now()
);
