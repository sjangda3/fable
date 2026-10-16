-- Minimal Supabase platform schemas for testing our migration against real PostgreSQL.
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;end$$;
do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;end$$;
do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls;end if;end$$;
create schema auth;
create schema storage;
create table auth.users(id uuid primary key);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
grant usage on schema auth,storage to anon,authenticated,service_role;
grant select on storage.objects to authenticated;
grant all on storage.objects,storage.buckets to service_role;
