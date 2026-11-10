import { test } from "node:test";
import assert from "node:assert/strict";
import { mailboxConnectUrl } from "../src/mailbox";
import { RuntimeConfig } from "../supabase/functions/aisas-api/runtime-config";
const connect = (provider: string) =>
  new URL(
    mailboxConnectUrl({
      baseUrl: "https://api.us.nylas.com",
      clientId: "test-client",
      redirectUri: "https://app.example/callback",
      state: "test-state",
      provider,
    }),
  );
test("custom domain connection requires personal SMTP configuration and generic IMAP", () => {
  const url = connect("imap");
  assert.equal(url.searchParams.get("provider"), "generic");
  assert.equal(url.searchParams.get("options"), "smtp_required");
  assert.equal(url.searchParams.get("access_type"), "online");
  assert.equal(url.searchParams.get("state"), "test-state");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    "https://app.example/callback",
  );
});
test("Gmail mailbox authorization remains separate and does not request SMTP details", () => {
  const url = connect("google");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.has("options"), false);
});
test("unrecognized mailbox providers cannot construct authorization links", () =>
  assert.throws(() => connect("__proto__")));
test("server configuration uses environment overrides, restricts keys, and refreshes cached Vault values", async () => {
  let clock = 1,
    calls = 0;
  const config = new RuntimeConfig(
    (k) => (k === "OPENAI_API_KEY" ? "environment-key" : undefined),
    () => clock,
  );
  const load = async () => {
    calls++;
    return {
      SERPAPI_KEY: "vault-key",
      OPENAI_API_KEY: "vault-openai",
      unexpected: "hidden",
    };
  };
  await Promise.all([config.load(load), config.load(load)]);
  assert.equal(calls, 1);
  assert.equal(config.get("SERPAPI_KEY"), "vault-key");
  assert.equal(config.get("OPENAI_API_KEY"), "environment-key");
  assert.throws(() => config.get("unexpected"));
  clock = 61_001;
  await config.load(load);
  assert.equal(calls, 2);
});
test("server config errors do not reveal configured values", async () => {
  const config = new RuntimeConfig(() => undefined);
  await config.load(async () => ({ SERPAPI_KEY: "do-not-disclose" }));
  assert.throws(
    () => config.get("NYLAS_API_KEY"),
    (e) => e instanceof Error && !e.message.includes("do-not-disclose"),
  );
});
