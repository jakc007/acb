begin;
-- Run after the migration as the SQL Editor's postgres role.
select set_config('request.jwt.claims', '{"sub":"acb_test_a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r bigint;
begin
  select revision into r from public.save_acb_workspace(0, '{"packages":[],"draft":{}}');
  if r <> 1 or r is null then raise exception 'First write failed'; end if;
  select revision into r from public.save_acb_workspace(1, '{"packages":[],"draft":{"name":"A"}}');
  if r <> 2 or r is null then raise exception 'Update failed'; end if;
  select revision into r from public.save_acb_workspace(1, '{"packages":[],"draft":{"name":"stale"}}');
  if r is not null then raise exception 'Stale write was accepted'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"acb_test_b","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.acb_workspaces where owner_id = 'acb_test_a') then raise exception 'Cross-account read'; end if;
  update public.acb_workspaces set data = '{"packages":[],"draft":{}}' where owner_id = 'acb_test_a';
  if found then raise exception 'Cross-account update'; end if;
  begin
    insert into public.acb_workspaces(owner_id, data) values ('acb_test_a', '{"packages":[],"draft":{}}');
    raise exception 'Cross-account insert';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$
begin
  begin
    perform * from public.acb_workspaces;
    raise exception 'Anonymous read';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.save_acb_workspace(0, '{"packages":[],"draft":{}}');
    raise exception 'Anonymous write';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
