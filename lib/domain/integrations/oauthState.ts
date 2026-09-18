import crypto from "node:crypto";
import { getDb } from "@/lib/db";

export type OAuthState = {
  projectId: string;
  returnTo: "dashboard" | "settings";
};

export function createOAuthState(input: OAuthState): string {
  const state = crypto.randomBytes(32).toString("hex");
  getDb()
    .prepare(
      "INSERT INTO oauth_states (state, project_id, return_to, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(state, input.projectId, input.returnTo, Date.now() + 10 * 60 * 1000);
  return state;
}

export function consumeOAuthState(state: string): OAuthState | null {
  const db = getDb();
  const row = db
    .prepare("SELECT project_id, return_to, expires_at FROM oauth_states WHERE state = ?")
    .get(state) as
    | { project_id: string; return_to: "dashboard" | "settings"; expires_at: number }
    | undefined;

  db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

  if (!row || row.expires_at < Date.now()) return null;
  return { projectId: row.project_id, returnTo: row.return_to };
}
