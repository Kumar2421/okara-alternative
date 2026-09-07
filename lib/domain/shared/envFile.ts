import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env.local");

/** Only these keys can ever be written here — this is not a general-purpose
 * env writer, just the one real use case (Gmail OAuth Client ID/Secret are
 * static app config, but the user asked to set them from the UI instead of
 * hand-editing a file). Restricting the allowlist keeps this from becoming
 * an arbitrary-file-write surface. */
const ALLOWED_ENV_KEYS = new Set(["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"]);

/** Next.js only reads .env.local at server startup — writing here does NOT
 * take effect until the dev/prod server process restarts. Callers must
 * disclose that in the UI rather than implying it's live immediately. */
export async function writeEnvVar(key: string, value: string): Promise<void> {
  if (!ALLOWED_ENV_KEYS.has(key)) {
    throw new Error(`Refusing to write unlisted env key: ${key}`);
  }
  // Strip newlines — a value containing one would otherwise inject an
  // arbitrary extra line into the env file.
  const safeValue = value.replace(/[\r\n]/g, "");

  let existing = "";
  try {
    existing = await readFile(ENV_PATH, "utf8");
  } catch {
    existing = "";
  }

  const lines = existing.split("\n").filter((l) => l.trim().length > 0);
  const withoutKey = lines.filter((l) => !l.startsWith(`${key}=`));
  withoutKey.push(`${key}=${safeValue}`);

  await writeFile(ENV_PATH, withoutKey.join("\n") + "\n", "utf8");
}
