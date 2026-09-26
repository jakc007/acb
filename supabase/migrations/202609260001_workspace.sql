-- Use Clerk Third-Party Auth; Clerk user IDs are text, not Supabase UUIDs.
create table if not exists public.acb_workspaces (
  owner_id text primary key default (auth.jwt()->>'sub'),
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null check (data ? 'packages' and data ? 'draft' and jsonb_typeof(data->'packages') = 'array' and jsonb_typeof(data->'draft') = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.acb_workspaces enable row level security;
revoke all on public.acb_workspaces from anon, authenticated;
grant select, insert, update on public.acb_workspaces to authenticated;
create policy "Read own workspace" on public.acb_workspaces for select to authenticated
  using (owner_id = (select auth.jwt()->>'sub'));
create policy "Insert own workspace" on public.acb_workspaces for insert to authenticated
  with check (owner_id = (select auth.jwt()->>'sub'));
create policy "Update own workspace" on public.acb_workspaces for update to authenticated
  using (owner_id = (select auth.jwt()->>'sub'))
  with check (owner_id = (select auth.jwt()->>'sub'));

-- Atomic compare-and-swap. An empty result means another device saved first.
create or replace function public.save_acb_workspace(expected_revision bigint, workspace_data jsonb)
returns table(revision bigint)
language plpgsql security invoker set search_path = '' as $$
begin
  if (auth.jwt()->>'sub') is null then raise exception 'Authentication required'; end if;
  if expected_revision = 0 then
    return query insert into public.acb_workspaces as w (owner_id, data)
      values (auth.jwt()->>'sub', workspace_data)
      on conflict (owner_id) do nothing returning w.revision;
  else
    return query update public.acb_workspaces as w
      set data = workspace_data, revision = w.revision + 1, updated_at = now()
      where w.owner_id = (auth.jwt()->>'sub') and w.revision = expected_revision
      returning w.revision;
  end if;
end;
$$;
revoke all on function public.save_acb_workspace(bigint, jsonb) from public, anon;
grant execute on function public.save_acb_workspace(bigint, jsonb) to authenticated;
