\set ON_ERROR_STOP on
begin;
insert into auth.users values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into auth.sessions values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222'),('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111');
set local role service_role;
select public.fable_register('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','Mac');
select public.fable_register('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','Windows');
select public.fable_prepare('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666',100);
select public.fable_push('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','opaque-object','66666666-6666-4666-8666-666666666666',null,'11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666',100);
-- Idempotent retry must not increment the sequence or leak an upload reservation.
select public.fable_prepare('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','66666666-6666-4666-8666-666666666666',100);
select public.fable_push('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','opaque-object','66666666-6666-4666-8666-666666666666',null,'11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666',100);
do $$begin assert (select next_sequence=1 from public.fable_vaults);assert (select count(*)=0 from public.fable_uploads);end$$;
insert into storage.objects(bucket_id,name) values('encrypted-vaults','11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/66666666-6666-4666-8666-666666666666');
do $$begin
  begin perform public.fable_register('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','33333333-3333-4333-8333-333333333333','77777777-7777-4777-8777-777777777777','Attacker');raise exception 'cross-account registration succeeded';exception when others then if sqlerrm not like '%ACCESS_DENIED%' then raise;end if;end;
end$$;
select public.fable_prepare('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','88888888-8888-4888-8888-888888888888',100);
do $$begin
  begin perform public.fable_push('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','opaque-object','88888888-8888-4888-8888-888888888888',null,'11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-888888888888',100);raise exception 'stale head succeeded';exception when others then if sqlerrm not like '%HEAD_MISMATCH%' then raise;end if;end;
end$$;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
do $$begin assert (select count(*)=1 from public.fable_vaults);assert(select count(*)=1 from public.fable_revisions);assert(select count(*)=1 from storage.objects);end$$;
do $$begin
  begin insert into public.fable_vaults(id,owner_id) values(gen_random_uuid(),auth.uid());raise exception 'direct write succeeded';exception when insufficient_privilege then null;end;
  begin perform public.fable_authorize(auth.uid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444');raise exception 'direct RPC succeeded';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}',true);
do $$begin assert (select count(*)=0 from public.fable_vaults);assert(select count(*)=0 from public.fable_revisions);assert(select count(*)=0 from public.fable_heads);assert(select count(*)=0 from storage.objects);end$$;
set local role anon;
do $$begin begin perform * from public.fable_vaults;raise exception 'anonymous read succeeded';exception when insufficient_privilege then null;end;end$$;
set local role service_role;
select public.fable_revoke('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
do $$begin assert (select count(*)=0 from public.fable_vaults);assert(select count(*)=0 from storage.objects);end$$;
rollback;
\echo 'PASS: ownership, RLS, service-only mutations, idempotency, compare-and-swap, session revocation'
