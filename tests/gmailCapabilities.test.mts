import test from "node:test";
import assert from "node:assert/strict";
import { gmailCapabilities, GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE } from "../lib/domain/shared/gmailCapabilities.ts";

const EMAIL = "https://www.googleapis.com/auth/userinfo.email";

test("both Gmail scopes granted: can send and read", () => {
  assert.deepEqual(gmailCapabilities([GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, EMAIL]), { canSend: true, canRead: true, known: true });
});

test("only send granted: can send, cannot read replies", () => {
  assert.deepEqual(gmailCapabilities([GMAIL_SEND_SCOPE, EMAIL]), { canSend: true, canRead: false, known: true });
});

test("only read granted: cannot send", () => {
  assert.deepEqual(gmailCapabilities([GMAIL_READ_SCOPE]), { canSend: false, canRead: true, known: true });
});

test("a user who unticked Gmail on the consent screen has neither", () => {
  assert.deepEqual(gmailCapabilities([EMAIL, "https://www.googleapis.com/auth/analytics.readonly"]), { canSend: false, canRead: false, known: true });
});

test("a space-separated string from Google's tokeninfo works", () => {
  assert.equal(gmailCapabilities(`${GMAIL_SEND_SCOPE} ${EMAIL}`).canSend, true);
});

test("broader Gmail scopes imply the narrower ones", () => {
  assert.deepEqual(gmailCapabilities(["https://mail.google.com/"]), { canSend: true, canRead: true, known: true });
  assert.deepEqual(gmailCapabilities(["https://www.googleapis.com/auth/gmail.modify"]), { canSend: true, canRead: true, known: true });
});

test("unrecorded scopes are unknown and optimistic, so older connections are not locked out", () => {
  for (const empty of [null, undefined, [], "", "   "]) {
    assert.deepEqual(gmailCapabilities(empty), { canSend: true, canRead: true, known: false });
  }
});
