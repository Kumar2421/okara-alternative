import { createServiceClient } from "@/utils/supabase/serviceClient";
import { disconnectHosted, type HostedDisconnectResult } from "@/lib/domain/cms/connectionCleanup";

/**
 * Hosted (Supabase) disconnect for one provider: deletes the connection row, any related
 * user_settings keys, AND the Vault secret the row points at (api_key_secret_id).
 * Needs the vault_delete_secret function from migration 20261013000000.
 */
export async function disconnectHostedProvider(userId: string, providerId: string, settingKeys: readonly string[] = []): Promise<HostedDisconnectResult> {
  const db = createServiceClient();
  const result = await disconnectHosted({
    readSecretId: async () => {
      const { data } = await db.from("provider_connections").select("api_key_secret_id").eq("user_id", userId).eq("provider_id", providerId).maybeSingle();
      return (data?.api_key_secret_id as string | null | undefined) ?? null;
    },
    deleteRows: async () => {
      const conn = await db.from("provider_connections").delete().eq("user_id", userId).eq("provider_id", providerId);
      if (conn.error) return false;
      for (const key of settingKeys) {
        const { error } = await db.from("user_settings").delete().eq("user_id", userId).eq("key", key);
        if (error) return false;
      }
      return true;
    },
    deleteSecret: async (id) => {
      const { error } = await db.rpc("vault_delete_secret", { p_id: id });
      if (error) throw new Error("vault delete failed");
    },
  });
  if (result.ok && !result.secretDeleted) console.error(`[disconnect] provider ${providerId}: connection removed but its vault secret could not be deleted`);
  return result;
}
