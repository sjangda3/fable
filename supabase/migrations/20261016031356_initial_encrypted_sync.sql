-- Only ciphertext and opaque revision identities reach this database.
create schema if not exists fable_private;
revoke all on schema fable_private from public, anon;
grant usage on schema fable_private to authenticated, service_role;
create table fable_private.limits (singleton boolean primary key default true check(singleton), account_bytes bigint not null default 1073741824 check(account_bytes>0), pending_uploads int not null default 5 check(pending_uploads>0));
insert into fable_private.limits default values;
revoke all on fable_private.limits from public,anon,authenticated;
grant select on fable_private.limits to service_role;

create table public.fable_vaults (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  next_sequence bigint not null default 0,
  created_at timestamptz not null default now()
);
create index fable_vault_owner on public.fable_vaults(owner_id);

create table public.fable_devices (
  id uuid primary key,
  vault_id uuid not null references public.fable_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  name text not null check (length(name) <= 160),
  acknowledged_sequence bigint not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index fable_devices_vault on public.fable_devices(vault_id, revoked_at);
create index fable_devices_owner on public.fable_devices(owner_id);

create table public.fable_revisions (
  revision_id uuid primary key,
  vault_id uuid not null references public.fable_vaults(id) on delete cascade,
  object_id text not null check (length(object_id) between 1 and 200),
  parent_revision uuid,
  sequence bigint not null,
  blob_path text not null unique,
  bytes bigint not null check (bytes > 0 and bytes <= 104857600),
  device_id uuid not null references public.fable_devices(id),
  created_at timestamptz not null default now(),
  unique(vault_id, sequence)
);
create index fable_revisions_object on public.fable_revisions(vault_id, object_id, sequence desc);
create index fable_revisions_device on public.fable_revisions(device_id);
create table public.fable_heads (
  vault_id uuid not null references public.fable_vaults(id) on delete cascade,
  object_id text not null,
  revision_id uuid not null references public.fable_revisions(revision_id),
  primary key(vault_id, object_id)
);
create index fable_heads_revision on public.fable_heads(revision_id);
create table public.fable_uploads (
  revision_id uuid primary key,
  vault_id uuid not null references public.fable_vaults(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.fable_devices(id),
  blob_path text not null unique,
  bytes bigint not null check(bytes > 0 and bytes <= 104857600),
  expires_at timestamptz not null default (now() + interval '2 hours')
);
create index fable_uploads_owner on public.fable_uploads(owner_id, expires_at);
create index fable_uploads_vault on public.fable_uploads(vault_id);
create index fable_uploads_device on public.fable_uploads(device_id);

-- Auth session lookup requires narrowly scoped elevated access to auth.sessions.
create function fable_private.active_session(p_user uuid, p_session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions where id = p_session and user_id = p_user);
$$;
revoke all on function fable_private.active_session(uuid,uuid) from public,anon;
grant execute on function fable_private.active_session(uuid,uuid) to authenticated,service_role;

alter table public.fable_vaults enable row level security;
alter table public.fable_devices enable row level security;
alter table public.fable_revisions enable row level security;
alter table public.fable_heads enable row level security;
alter table public.fable_uploads enable row level security;

create policy own_vaults on public.fable_vaults for select to authenticated using (
  owner_id = (select auth.uid()) and fable_private.active_session((select auth.uid()), nullif((select auth.jwt())->>'session_id','')::uuid)
);
create policy own_devices on public.fable_devices for select to authenticated using (
  owner_id = (select auth.uid()) and fable_private.active_session((select auth.uid()), nullif((select auth.jwt())->>'session_id','')::uuid)
);
create policy own_revisions on public.fable_revisions for select to authenticated using (
  exists(select 1 from public.fable_vaults v where v.id=vault_id and v.owner_id=(select auth.uid()))
);
create policy own_heads on public.fable_heads for select to authenticated using (
  exists(select 1 from public.fable_vaults v where v.id=vault_id and v.owner_id=(select auth.uid()))
);
revoke all on public.fable_vaults,public.fable_devices,public.fable_heads,public.fable_revisions,public.fable_uploads from anon,authenticated;
grant select on public.fable_vaults,public.fable_devices,public.fable_heads,public.fable_revisions to authenticated;
grant all on public.fable_vaults,public.fable_devices,public.fable_heads,public.fable_revisions,public.fable_uploads to service_role;

-- RPCs are callable only by the Edge Function's service role after getUser(jwt).
-- All identity parameters below come from the verified token, never the body.
create function public.fable_authorize(p_user uuid,p_session uuid,p_vault uuid,p_device uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not fable_private.active_session(p_user,p_session) or not exists(
    select 1 from public.fable_devices d join public.fable_vaults v on v.id=d.vault_id
    where d.id=p_device and d.vault_id=p_vault and d.owner_id=p_user and v.owner_id=p_user and d.session_id=p_session and d.revoked_at is null
  ) then raise exception 'ACCESS_DENIED'; end if;
end;$$;
create function public.fable_register(p_user uuid,p_session uuid,p_vault uuid,p_device uuid,p_name text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if not fable_private.active_session(p_user,p_session) then raise exception 'ACCESS_DENIED';end if;
  insert into public.fable_vaults(id,owner_id) values(p_vault,p_user) on conflict(id) do nothing;
  if not exists(select 1 from public.fable_vaults where id=p_vault and owner_id=p_user) then raise exception 'ACCESS_DENIED';end if;
  insert into public.fable_devices(id,vault_id,owner_id,session_id,name) values(p_device,p_vault,p_user,p_session,p_name)
  on conflict(id) do update set session_id=excluded.session_id,name=excluded.name,last_seen_at=now()
  where fable_devices.owner_id=p_user and fable_devices.vault_id=p_vault and fable_devices.revoked_at is null;
  if not found then raise exception 'DEVICE_REVOKED';end if;
end;$$;
create function public.fable_prepare(p_user uuid,p_session uuid,p_vault uuid,p_device uuid,p_revision uuid,p_bytes bigint) returns text
language plpgsql security invoker set search_path='' as $$
declare used_bytes bigint;pending_bytes bigint;object_path text;
begin
  perform public.fable_authorize(p_user,p_session,p_vault,p_device);
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  if p_bytes<=0 or p_bytes>104857600 then raise exception 'FILE_TOO_LARGE';end if;
  object_path:=p_user::text||'/'||p_vault::text||'/'||p_revision::text;
  if exists(select 1 from public.fable_revisions where revision_id=p_revision and vault_id=p_vault and blob_path=object_path and bytes=p_bytes) then return object_path;end if;
  if exists(select 1 from public.fable_uploads where revision_id=p_revision and owner_id=p_user and vault_id=p_vault and device_id=p_device and bytes=p_bytes) then
    update public.fable_uploads set expires_at=now()+interval '2 hours' where revision_id=p_revision;
    return object_path;
  end if;
  select coalesce(sum(r.bytes),0) into used_bytes from public.fable_revisions r join public.fable_vaults v on v.id=r.vault_id where v.owner_id=p_user;
  select coalesce(sum(bytes),0) into pending_bytes from public.fable_uploads where owner_id=p_user;
  if used_bytes+pending_bytes+p_bytes>(select account_bytes from fable_private.limits where singleton) then raise exception 'QUOTA';end if;
  if (select count(*) from public.fable_uploads where owner_id=p_user)>=(select pending_uploads from fable_private.limits where singleton) then raise exception 'UPLOADS_PENDING';end if;
  object_path:=p_user::text||'/'||p_vault::text||'/'||p_revision::text;
  insert into public.fable_uploads(revision_id,vault_id,owner_id,device_id,blob_path,bytes) values(p_revision,p_vault,p_user,p_device,object_path,p_bytes)
    on conflict(revision_id) do nothing;
  if not exists(select 1 from public.fable_uploads where revision_id=p_revision and owner_id=p_user and vault_id=p_vault and device_id=p_device and bytes=p_bytes) then raise exception 'ACCESS_DENIED';end if;
  return object_path;
end;$$;
create function public.fable_push(p_user uuid,p_session uuid,p_vault uuid,p_device uuid,p_object text,p_revision uuid,p_parent uuid,p_blob text,p_bytes bigint) returns bigint
language plpgsql security invoker set search_path='' as $$
declare current_head uuid;next_seq bigint;existing public.fable_revisions;used_bytes bigint;
begin
  perform public.fable_authorize(p_user,p_session,p_vault,p_device);
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  perform 1 from public.fable_vaults where id=p_vault for update;
  select * into existing from public.fable_revisions where revision_id=p_revision;
  if found then
    if existing.vault_id<>p_vault or existing.object_id<>p_object or existing.parent_revision is distinct from p_parent or existing.blob_path<>p_blob then raise exception 'IDEMPOTENCY_MISMATCH';end if;
    return existing.sequence;
  end if;
  if not exists(select 1 from public.fable_uploads where revision_id=p_revision and vault_id=p_vault and device_id=p_device and owner_id=p_user and blob_path=p_blob and bytes=p_bytes and expires_at>now()) then raise exception 'UPLOAD_NOT_PREPARED';end if;
  select revision_id into current_head from public.fable_heads where vault_id=p_vault and object_id=p_object;
  if current_head is distinct from p_parent then raise exception 'HEAD_MISMATCH';end if;
  select coalesce(sum(r.bytes),0) into used_bytes from public.fable_revisions r join public.fable_vaults v on v.id=r.vault_id where v.owner_id=p_user;
  if used_bytes+p_bytes>(select account_bytes from fable_private.limits where singleton) then raise exception 'QUOTA';end if;
  update public.fable_vaults set next_sequence=next_sequence+1 where id=p_vault returning next_sequence into next_seq;
  insert into public.fable_revisions(revision_id,vault_id,object_id,parent_revision,sequence,blob_path,bytes,device_id)
    values(p_revision,p_vault,p_object,p_parent,next_seq,p_blob,p_bytes,p_device);
  insert into public.fable_heads(vault_id,object_id,revision_id) values(p_vault,p_object,p_revision)
    on conflict(vault_id,object_id) do update set revision_id=excluded.revision_id;
  delete from public.fable_uploads where revision_id=p_revision;
  return next_seq;
end;$$;

create function fable_private.end_session(p_user uuid,p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
begin delete from auth.sessions where id=p_session and user_id=p_user;end;$$;
revoke all on function fable_private.end_session(uuid,uuid) from public,anon,authenticated;
grant execute on function fable_private.end_session(uuid,uuid) to service_role;
create function public.fable_revoke(p_user uuid,p_session uuid,p_vault uuid,p_device uuid,p_target uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare target_session uuid;
begin
  perform public.fable_authorize(p_user,p_session,p_vault,p_device);
  update public.fable_devices set revoked_at=now() where id=p_target and vault_id=p_vault and owner_id=p_user returning session_id into target_session;
  if not found then raise exception 'ACCESS_DENIED';end if;
  perform fable_private.end_session(p_user,target_session);
end;$$;

revoke all on function public.fable_authorize(uuid,uuid,uuid,uuid),public.fable_register(uuid,uuid,uuid,uuid,text),public.fable_prepare(uuid,uuid,uuid,uuid,uuid,bigint),public.fable_push(uuid,uuid,uuid,uuid,text,uuid,uuid,text,bigint),public.fable_revoke(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.fable_authorize(uuid,uuid,uuid,uuid),public.fable_register(uuid,uuid,uuid,uuid,text),public.fable_prepare(uuid,uuid,uuid,uuid,uuid,bigint),public.fable_push(uuid,uuid,uuid,uuid,text,uuid,uuid,text,bigint),public.fable_revoke(uuid,uuid,uuid,uuid,uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('encrypted-vaults','encrypted-vaults',false,104857600,array['application/octet-stream']) on conflict(id) do nothing;
create policy fable_read_own_ciphertext on storage.objects for select to authenticated using(
 bucket_id='encrypted-vaults' and (storage.foldername(name))[1]=(select auth.uid())::text
 and fable_private.active_session((select auth.uid()),nullif((select auth.jwt())->>'session_id','')::uuid)
);

-- No destructive retention job is enabled. Retaining all revisions satisfies
-- the minimum 30-day history and preserves every offline device's ancestors.
