import assert from "node:assert/strict";
import test from "node:test";

import { getPlatformRuntimeConfig } from "../lib/platform/runtimeConfig";

test("self-host mode does not require Supabase runtime variables", () => {
  const result = getPlatformRuntimeConfig({
    NEXT_PUBLIC_SELF_HOST: "true",
  });

  assert.deepEqual(result, {
    platformMode: false,
    missing: [],
  });
});

test("explicit platform mode requires all Supabase runtime variables", () => {
  const result = getPlatformRuntimeConfig({
    NEXT_PUBLIC_PLATFORM_MODE: "true",
  });

  assert.deepEqual(result, {
    platformMode: true,
    missing: [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SECRET_KEY",
    ],
  });
});

test("Supabase public configuration enables platform mode and still requires the secret", () => {
  const result = getPlatformRuntimeConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  });

  assert.deepEqual(result, {
    platformMode: true,
    missing: ["SUPABASE_SECRET_KEY"],
  });
});

test("complete platform configuration passes the runtime gate", () => {
  const result = getPlatformRuntimeConfig({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SECRET_KEY: "secret",
  });

  assert.deepEqual(result, {
    platformMode: true,
    missing: [],
  });
});
