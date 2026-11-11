import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchCampaignBatch,
  normalizeNylasEvent,
  verifyNylasSignature,
  sendFailure,
  recordTrackedOpen,
} from "../src/campaign-delivery";
import {
  campaignMetrics,
  type CampaignAnalytics,
} from "../src/campaign-analytics";
const sequence = [0, 1, 2, 3].map((step) => ({
  step,
  subject: "Hello {{contact_name}}",
  body: "Hi {{contact_name}}\nValue for {{company}} <review>",
  delay_hours: step ? 24 : 0,
}));
function fixture(
  options: { thread?: boolean; skip?: boolean; finishFailure?: boolean } = {},
) {
  const recipient = {
    id: "recipient",
    campaign_id: "campaign",
    claim_token: "claim",
    lead_id: "lead",
    thread_id: options.thread ? "thread" : null,
    last_sent_at: "2026-11-11T10:00:00Z",
    created_at: "2026-11-11T09:00:00Z",
  };
  const campaign = {
    id: "campaign",
    mailbox_id: "mailbox",
    messages: sequence,
  };
  const lead = {
    email: "prospect@public.example",
    contact_name: "Alex",
    company: "Example Practice",
  };
  const rpcCalls: { name: string; args: any }[] = [];
  const db = {
    from(table: string) {
      const query: any = {
        select() {
          return query;
        },
        update() {
          return query;
        },
        eq() {
          return query;
        },
        single: async () => ({
          data: table === "campaigns" ? campaign : lead,
          error: null,
        }),
        then(resolve: any, reject: any) {
          return Promise.resolve({ data: null, error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
    async rpc(name: string, args: any = {}) {
      rpcCalls.push({ name, args });
      if (name === "aisas_claim_delivery_batch")
        return { data: [recipient], error: null };
      if (name === "aisas_get_grant") return { data: "grant", error: null };
      if (name === "aisas_begin_campaign_send")
        return {
          data: options.skip
            ? null
            : {
                delivery_id: "delivery",
                attempt_count: 1,
                lead,
                message: sequence[0],
                message_id: null,
                step: 0,
              },
          error: null,
        };
      if (name === "aisas_finish_campaign_send" && options.finishFailure)
        return { data: null, error: { code: "db_error" } };
      return { data: { matched: true }, error: null };
    },
  };
  return { db, rpcCalls };
}
test("dispatch sends one tracked, personalized message with a persistent idempotency key and records provider acceptance", async () => {
  const { db, rpcCalls } = fixture();
  const requests: any[] = [];
  const result = await dispatchCampaignBatch(db, "PRIVATE_KEY", {
    trackingUrl: "https://tracking.example/open",
    fetcher: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      });
      return Response.json({
        data: { id: "provider-message", thread_id: "provider-thread" },
      });
    },
  });
  assert.equal(result.sent, 1);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/v3\/grants\/grant\/messages\/send$/);
  assert.equal(requests[0].headers.get("Idempotency-Key"), "delivery:1");
  assert.equal(requests[0].body.subject, "Hello Alex");
  assert.match(requests[0].body.body, /Example Practice &lt;review&gt;/);
  assert.equal(requests[0].body.tracking_options, undefined);
  assert.equal(requests[0].body.metadata, undefined);
  assert.match(
    requests[0].body.body,
    /<img src="https:\/\/tracking.example\/open\?token=delivery"/,
  );
  const finished = rpcCalls.find(
    (c) => c.name === "aisas_finish_campaign_send",
  );
  assert.equal(finished?.args.p_outcome, "sent");
  assert.equal(finished?.args.p_provider_id, "provider-message");
  assert.equal(JSON.stringify(rpcCalls).includes("PRIVATE_KEY"), false);
});
test("a paused/suppressed claim does not call the provider", async () => {
  const { db } = fixture({ skip: true });
  let sends = 0;
  const result = await dispatchCampaignBatch(db, "key", {
    fetcher: async () => {
      sends++;
      throw new Error("Unexpected send");
    },
  });
  assert.equal(sends, 0);
  assert.equal(result.sent, 0);
});
test("definite provider rejections are failed and ambiguous server/network outcomes are uncertain without a resend", async () => {
  for (const status of [400, 401, 429, 500, 504]) {
    const { db, rpcCalls } = fixture();
    let sends = 0;
    await dispatchCampaignBatch(db, "key", {
      fetcher: async () => {
        sends++;
        return new Response("{}", { status });
      },
    });
    assert.equal(sends, 1);
    const result = rpcCalls.find(
      (c) => c.name === "aisas_finish_campaign_send",
    );
    assert.equal(result?.args.p_outcome, status < 500 ? "failed" : "uncertain");
  }
  const { db, rpcCalls } = fixture();
  let sends = 0;
  const result = await dispatchCampaignBatch(db, "key", {
    fetcher: async () => {
      sends++;
      throw new Error("timeout");
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.uncertain, 1);
  assert.equal(
    rpcCalls.find((c) => c.name === "aisas_finish_campaign_send")?.args
      .p_outcome,
    "uncertain",
  );
  assert.equal(sendFailure(409).outcome, "uncertain");
});
test("a reply detected before a follow-up stops the send and records response evidence", async () => {
  const { db, rpcCalls } = fixture({ thread: true });
  let sends = 0;
  const result = await dispatchCampaignBatch(db, "key", {
    fetcher: async (input) => {
      assert.match(String(input), /\/threads\/thread$/);
      sends++;
      return Response.json({
        data: {
          latest_message_received_date:
            Date.parse("2026-11-11T11:00:00Z") / 1000,
        },
      });
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.sent, 0);
  assert.ok(
    rpcCalls.some(
      (c) =>
        c.name === "aisas_record_email_event" &&
        c.args.p_event.kind === "replied",
    ),
  );
  assert.equal(
    rpcCalls.some((c) => c.name === "aisas_begin_campaign_send"),
    false,
  );
});
test("a database failure after provider acceptance never submits the message again", async () => {
  const { db } = fixture({ finishFailure: true });
  let sends = 0;
  const result = await dispatchCampaignBatch(db, "key", {
    fetcher: async () => {
      sends++;
      return Response.json({ data: { id: "sent" } });
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.uncertain, 1);
});
test("webhook signatures authenticate exact raw bytes and reject tampered bodies", async () => {
  const raw = new TextEncoder().encode('{"id":"event"}');
  const secret = "TEST_WEBHOOK_SECRET";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, raw)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  assert.equal(await verifyNylasSignature(raw, signature, secret), true);
  assert.equal(
    await verifyNylasSignature(
      new TextEncoder().encode("{}"),
      signature,
      secret,
    ),
    false,
  );
  assert.equal(await verifyNylasSignature(raw, "invalid", secret), false);
});
test("official engagement/bounce schemas correlate the original message and ignore automated replies", () => {
  const base = {
    id: "notification",
    time: Date.now() / 1000,
    data: {
      grant_id: "grant",
      object: {
        message_id: "reply",
        root_message_id: "original",
        thread_id: "thread",
        label: "delivery",
      },
    },
  };
  const reply = normalizeNylasEvent({ ...base, type: "thread.replied" })!;
  assert.equal(reply.kind, "replied");
  assert.ok(reply.message_ids.includes("original"));
  assert.equal(reply.provider_id, "original");
  const bounce = normalizeNylasEvent({
    ...base,
    type: "message.bounce_detected",
    data: {
      grant_id: "grant",
      object: { origin: { id: "original", thread_id: "thread" } },
    },
  })!;
  assert.equal(bounce.kind, "bounced");
  assert.ok(bounce.message_ids.includes("original"));
  assert.equal(
    normalizeNylasEvent({
      ...base,
      type: "message.bounce_detected",
      data: { grant_id: "grant", object: { type: "automated_reply" } },
    }),
    null,
  );
  assert.equal(normalizeNylasEvent({ ...base, type: "unsupported" }), null);
});
test("tracking metrics remain unavailable until tracking is configured", () => {
  const analytics = {
    total_recipients: 159,
    valid_recipients: 63,
    total_sent: 5,
    total_fails: 1,
    bounce: 0,
    read: 0,
    response: 0,
    tracking_ready: false,
  } as CampaignAnalytics;
  const metrics = campaignMetrics(analytics);
  assert.equal(metrics.find((m) => m.label === "Read")?.value, null);
  assert.equal(metrics.find((m) => m.label === "Responses")?.value, null);
  assert.equal(metrics.find((m) => m.label === "Emails sent")?.value, 5);
});

test("an AISAS tracking image records an open only for a provider-accepted delivery", async () => {
  let accepted = false;
  const calls: any[] = [];
  const db = {
    from() {
      const q: any = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        maybeSingle: async () => ({
          data: {
            id: "delivery",
            mailbox_id: "mailbox",
            sent_at: accepted ? "2026-11-11T12:00:00Z" : null,
            provider_message_id: "provider",
            provider_thread_id: "thread",
          },
          error: null,
        }),
      };
      return q;
    },
    async rpc(name: string, args: any = {}) {
      calls.push({ name, args });
      return {
        data: name === "aisas_get_grant" ? "grant" : { matched: true },
        error: null,
      };
    },
  };
  assert.equal(await recordTrackedOpen(db, "delivery"), false);
  assert.equal(calls.length, 0);
  accepted = true;
  assert.equal(await recordTrackedOpen(db, "delivery"), true);
  const event = calls.find((c) => c.name === "aisas_record_email_event").args
    .p_event;
  assert.equal(event.kind, "opened");
  assert.equal(event.id, "pixel:delivery");
  assert.equal(event.grant_id, "grant");
});
test("standard mailbox events correlate replies by thread and sender without paid provider tracking", () => {
  const incoming = normalizeNylasEvent({
    id: "incoming",
    type: "message.created",
    time: Date.now() / 1000,
    data: {
      grant_id: "grant",
      object: {
        id: "inbound-id",
        thread_id: "thread",
        from: [{ email: "prospect@public.example" }],
        metadata: { key2: "must-not-use-outgoing-label" },
      },
    },
  })!;
  assert.equal(incoming.kind, "replied");
  assert.equal(incoming.source, "message.created");
  assert.equal(incoming.sender, "prospect@public.example");
  assert.deepEqual(incoming.message_ids, []);
  assert.equal(incoming.label, "");
});
