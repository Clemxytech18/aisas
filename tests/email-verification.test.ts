import { test } from "node:test";
import assert from "node:assert/strict";
import { emailProblem, verificationForEmail } from "../src/email-verification";
import {
  verifyEmailAddress,
  EmailVerificationError,
} from "../supabase/functions/aisas-api/email-verification";
const address = "person@business.tld";
const mock = (data: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(data), { status })) as typeof fetch;
test("invalid format and reserved demo addresses do not call a verification provider", async () => {
  let called = false;
  const request = (async () => {
    called = true;
    throw new Error();
  }) as typeof fetch;
  assert.equal(
    (await verifyEmailAddress("no-at-sign", undefined, request)).status,
    "invalid",
  );
  assert.equal(
    (await verifyEmailAddress("hello@sample.example", undefined, request))
      .reason,
    "reserved_domain",
  );
  assert.equal(called, false);
});
test("quoted or international local parts are delegated rather than falsely rejected", () => {
  assert.equal(emailProblem('"a b"@business.tld'), null);
  assert.equal(emailProblem("josé@business.tld"), null);
});
test("only a positive mailbox result becomes Verified", async () => {
  assert.equal(
    (
      await verifyEmailAddress(
        address,
        "test-key",
        mock({ address, status: "valid" }),
      )
    ).status,
    "verified",
  );
  assert.equal(
    (
      await verifyEmailAddress(
        address,
        "test-key",
        mock({ address, status: "invalid" }),
      )
    ).status,
    "invalid",
  );
  for (const status of [
    "unknown",
    "catch-all",
    "spamtrap",
    "do_not_mail",
    "abuse",
  ])
    assert.equal(
      (await verifyEmailAddress(address, "test-key", mock({ address, status })))
        .status,
      "unknown",
    );
});
test("missing keys, provider errors, and network failures never become Invalid", async () => {
  await assert.rejects(
    () => verifyEmailAddress(address, undefined),
    (e) => e instanceof EmailVerificationError && e.httpStatus === 503,
  );
  await assert.rejects(
    () =>
      verifyEmailAddress(
        address,
        "test-key",
        mock({ error: "test-key should never be exposed" }),
      ),
    (e) =>
      e instanceof EmailVerificationError && !e.message.includes("test-key"),
  );
  await assert.rejects(
    () => verifyEmailAddress(address, "test-key", mock({}, 500)),
    EmailVerificationError,
  );
  await assert.rejects(
    () =>
      verifyEmailAddress(address, "test-key", (async () => {
        throw new Error("network");
      }) as typeof fetch),
    EmailVerificationError,
  );
});
test("provider must return a result for the requested address", async () => {
  await assert.rejects(
    () =>
      verifyEmailAddress(
        address,
        "test-key",
        mock({ address: "different@business.tld", status: "valid" }),
      ),
    (e) => e instanceof EmailVerificationError && e.code === "address_mismatch",
  );
});
test("request credentials stay in the server-side POST body", async () => {
  let url = "",
    init: RequestInit | undefined;
  await verifyEmailAddress(address, "private-test-key", (async (u, i) => {
    url = String(u);
    init = i;
    return new Response(JSON.stringify({ address, status: "valid" }));
  }) as typeof fetch);
  assert.equal(url, "https://api.zerobounce.net/v2/validate");
  assert.equal(url.includes("private-test-key"), false);
  assert.equal(init?.method, "POST");
  assert.equal(
    new URLSearchParams(init?.body as URLSearchParams).get("api_key"),
    "private-test-key",
  );
});
test("a changed address cannot display a previous Verified badge", () => {
  assert.equal(
    verificationForEmail({
      email: address,
      email_verification_address: "old@business.tld",
      email_verification_status: "verified",
    }),
    "unverified",
  );
  assert.equal(
    verificationForEmail({
      email: address,
      email_verification_address: address,
      email_verification_status: "verified",
    }),
    "verified",
  );
});
