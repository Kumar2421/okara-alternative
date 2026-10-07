import crypto from "node:crypto";

/**
 * Small HMAC-signed, expiring tokens (used for the GitHub install `state` and for fix-proposal
 * tickets). Fail-closed: anything malformed, tampered, expired or for another purpose is null.
 */

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function mac(secret: string, body: string): Buffer {
  return crypto.createHmac("sha256", secret).update(body).digest();
}

export function signPayload(secret: string, purpose: string, data: Record<string, unknown>, ttlMs: number, now = Date.now()): string {
  if (!secret) throw new Error("A signing secret is required.");
  const body = b64url(JSON.stringify({ ...data, purpose, exp: now + ttlMs, nonce: crypto.randomBytes(8).toString("hex") }));
  return `${body}.${b64url(mac(secret, body))}`;
}

export function verifyPayload<T extends Record<string, unknown>>(secret: string, purpose: string, token: unknown, now = Date.now()): (T & { exp: number }) | null {
  if (!secret || typeof token !== "string" || token.length > 8000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.purpose !== purpose) return null;
    if (typeof parsed.exp !== "number" || parsed.exp < now) return null;
    return parsed as T & { exp: number };
  } catch {
    return null;
  }
}
