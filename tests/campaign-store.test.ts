import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { saveCampaignRecord } from "../src/campaign-store";
import type { Campaign } from "../src/domain";
const owner = "00000000-0000-4000-8000-000000000001";
const campaign: Campaign = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Campaign QA",
  list_id: "list",
  profile_id: "profile",
  mailbox_id: "mailbox",
  status: "running",
  start_at: "",
  approved: true,
  sent: 99,
  messages: [
    { step: 0, subject: "Hello", body: "First", delay_hours: 0 },
    ...[1, 2, 3].map((step) => ({
      step,
      subject: "Follow up",
      body: "Follow up",
      delay_hours: 24,
    })),
  ],
};
function fixture(existing = false, writeError = false) {
  const requests: {
    method: string;
    url: URL;
    body: any;
    prefer: string | null;
  }[] = [];
  const client = createClient(
    "https://campaign-qa.example.com",
    "sb_publishable_test_only",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (input, init) => {
          const method = init?.method || "GET";
          const url = new URL(String(input));
          const body = init?.body ? JSON.parse(String(init.body)) : null;
          requests.push({
            method,
            url,
            body,
            prefer: new Headers(init?.headers).get("prefer"),
          });
          if (method === "GET")
            return new Response(
              JSON.stringify(existing ? [{ id: campaign.id }] : []),
              { headers: { "Content-Type": "application/json" } },
            );
          if (writeError)
            return new Response(
              JSON.stringify({
                code: "42501",
                message: "permission denied for table campaigns",
              }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          return new Response(JSON.stringify({ id: campaign.id }), {
            status: method === "POST" ? 201 : 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    },
  );
  mock.method(client.auth, "getUser", async () => ({
    data: {
      user: {
        id: owner,
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      },
    },
    error: null,
  }));
  return { client, requests };
}
test("new campaign save issues a plain insert, so protected columns never enter an upsert update branch", async () => {
  const { client, requests } = fixture();
  await saveCampaignRecord(client, campaign);
  assert.deepEqual(
    requests.map((r) => r.method),
    ["GET", "POST"],
  );
  const create = requests[1];
  assert.equal(create.prefer?.includes("resolution=merge-duplicates"), false);
  assert.equal(create.url.searchParams.has("on_conflict"), false);
  assert.equal(create.body.owner_id, owner);
  assert.equal(create.body.id, campaign.id);
  assert.equal(create.body.status, undefined);
  assert.equal(create.body.sent, undefined);
  assert.equal(create.body.approved, true);
  assert.equal(requests[0].url.searchParams.get("owner_id"), `eq.${owner}`);
});
test("editing an existing campaign only patches editable fields and checks the signed-in owner", async () => {
  const { client, requests } = fixture(true);
  await saveCampaignRecord(client, campaign);
  assert.deepEqual(
    requests.map((r) => r.method),
    ["GET", "PATCH"],
  );
  const update = requests[1];
  assert.deepEqual(Object.keys(update.body).sort(), [
    "approved",
    "daily_send_limit",
    "list_id",
    "mailbox_id",
    "messages",
    "name",
    "profile_id",
    "send_timezone",
    "start_at",
  ]);
  assert.equal(update.body.start_at, null);
  assert.equal(update.url.searchParams.get("owner_id"), `eq.${owner}`);
  assert.equal(update.url.searchParams.get("id"), `eq.${campaign.id}`);
});
test("failed writes propagate the database error instead of claiming a campaign was saved", async () => {
  const { client } = fixture(false, true);
  await assert.rejects(saveCampaignRecord(client, campaign), {
    message: "permission denied for table campaigns",
  });
});
test("saving requires a validated user before accessing campaign records", async () => {
  const { client, requests } = fixture();
  mock.method(client.auth, "getUser", async () => ({
    data: { user: null },
    error: null,
  }));
  await assert.rejects(saveCampaignRecord(client, campaign), /sign in/);
  assert.equal(requests.length, 0);
});

test("campaign saves persist the daily cap and its reset timezone without exposing protected counters", async () => {
  const { client, requests } = fixture();
  await saveCampaignRecord(client, {
    ...campaign,
    daily_send_limit: 50,
    send_timezone: "Africa/Lagos",
  });
  assert.equal(requests[1].body.daily_send_limit, 50);
  assert.equal(requests[1].body.send_timezone, "Africa/Lagos");
  assert.equal(requests[1].body.daily_sent, undefined);
});
test("invalid daily caps fail before any campaign write and legacy campaigns preserve their unlimited setting", async () => {
  for (const daily_send_limit of [0, -1, 50.5, 10001, NaN]) {
    const { client, requests } = fixture();
    await assert.rejects(
      saveCampaignRecord(client, { ...campaign, daily_send_limit }),
      /daily email limit/,
    );
    assert.equal(requests.length, 0);
  }
  const { client, requests } = fixture();
  await saveCampaignRecord(client, campaign);
  assert.equal(requests[1].body.daily_send_limit, null);
  assert.equal(requests[1].body.send_timezone, "UTC");
});
