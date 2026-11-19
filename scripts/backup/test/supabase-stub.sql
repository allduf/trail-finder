-- Just enough of Supabase's own schemas (auth, storage, roles) for supabase/*.sql to load into a plain local
-- Postgres. Only for scripts/backup/test/run.sh: never run this on the real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists auth.users (
  id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
  email_confirmed_at timestamptz, phone_confirmed_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
  provider text not null, provider_id text not null, identity_data jsonb not null default '{}',
  email text generated always as (lower(identity_data->>'email')) stored);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], owner uuid, created_at timestamptz default now());
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets, name text,
  owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(),
  path_tokens text[] generated always as (string_to_array(name, '/')) stored, unique (bucket_id, name));
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as
  $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as
  $$ select split_part(storage.filename(name), '.', -1) $$;
