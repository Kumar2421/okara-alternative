/**
 * Disconnecting a hosted provider must remove the Vault secret as well as the connection row,
 * otherwise the token stays in the vault after the user believes it is gone. The ports keep this
 * testable; the routes adapt the Supabase service client to them.
 */

export type HostedDisconnectPorts = {
  /** The row's api_key_secret_id, or null when there is no row or no secret. */
  readSecretId(): Promise<string | null>;
  /** Removes the connection row (and any related settings). Returns false on failure. */
  deleteRows(): Promise<boolean>;
  /** Deletes the Vault secret. May throw. */
  deleteSecret(id: string): Promise<void>;
};

export type HostedDisconnectResult = { ok: boolean; secretDeleted: boolean };

/** Reads the secret id first (the row is the only pointer to it), removes the rows, then the secret. */
export async function disconnectHosted(ports: HostedDisconnectPorts): Promise<HostedDisconnectResult> {
  const secretId = await ports.readSecretId();
  if (!(await ports.deleteRows())) return { ok: false, secretDeleted: false };
  if (!secretId) return { ok: true, secretDeleted: true };
  try {
    await ports.deleteSecret(secretId);
    return { ok: true, secretDeleted: true };
  } catch {
    // The connection is gone either way; report it so a caller can log (never the secret itself).
    return { ok: true, secretDeleted: false };
  }
}
