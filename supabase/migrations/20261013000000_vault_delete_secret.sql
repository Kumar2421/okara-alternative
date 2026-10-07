-- Lets the server remove a provider's Vault secret when the connection is disconnected.
create or replace function public.vault_delete_secret(p_id uuid)
returns void language sql security definer set search_path to 'public', 'vault' as $$
  delete from vault.secrets where id = p_id;
$$;

-- Service-role only, like the other vault helpers.
revoke execute on function public.vault_delete_secret(uuid) from public, anon, authenticated;
