import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emailPlainText,
  normalizeInboxMessage,
  replyText,
  replySubject,
  inboxUnread,
  inboxNeedsReply,
  type Conversation,
} from "../src/campaign-inbox";
import {
  sendInboxReply,
  syncInboxConversation,
} from "../src/campaign-inbox-service";
const c = {
  id: "conversation",
  owner_id: "owner",
  campaign_id: "campaign",
  mailbox_id: "box",
  thread_id: "thread",
  last_reply_at: "2026-11-22T12:00:00.000Z",
  last_outbound_at: "2026-11-22T11:00:00.000Z",
  last_read_at: null,
} as Conversation;
const box = {
  id: "box",
  email: "sender@example.com",
  provider: "google",
  status: "connected",
};
const raw = {
  id: "message",
  thread_id: "thread",
  from: [{ name: "Ada", email: "Ada@example.com" }],
  to: [{ email: box.email }],
  date: 1795348800,
  body: "<p>Hello &amp; thanks!</p><p>Can you share details?</p>",
  subject: "An idea",
};
test("email content becomes readable plain text without scripts, styles or remote images", () => {
  const text = emailPlainText(
    '<html><head><style>body{display:none}</style></head><body><p>Hello &amp; welcome</p><script>steal()</script><img src="https://tracker.example/pixel"><p>&#x1F44B; &lt;quoted&gt;</p></body></html>',
  );
  assert.equal(text, "Hello & welcome\n👋 <quoted>");
  assert.ok(!text.includes("tracker"));
  assert.equal(emailPlainText("Plain text 1 < 2"), "Plain text 1 < 2");
});
test("messages must belong to this exact thread and cannot be drafts or delivery notices", () => {
  assert.equal(
    normalizeInboxMessage({ ...raw, thread_id: "other" }, box, "thread"),
    null,
  );
  assert.equal(
    normalizeInboxMessage({ ...raw, draft: true }, box, "thread"),
    null,
  );
  assert.equal(
    normalizeInboxMessage(
      { ...raw, from: [{ email: "mailer-daemon@example.com" }] },
      box,
      "thread",
    ),
    null,
  );
  assert.equal(
    normalizeInboxMessage({ ...raw, date: NaN }, box, "thread"),
    null,
  );
});
test("normalization identifies incoming senders and sent aliases; IMAP threading requires RFC Message-ID", () => {
  assert.equal(normalizeInboxMessage(raw, box, "thread")?.direction, "inbound");
  assert.equal(
    normalizeInboxMessage(
      { ...raw, from: [{ email: "SENDER@example.com" }] },
      box,
      "thread",
    )?.direction,
    "outbound",
  );
  assert.equal(
    normalizeInboxMessage(
      { ...raw, folders: ["SENT"], from: [{ email: "alias@example.com" }] },
      box,
      "thread",
    )?.direction,
    "outbound",
  );
  const imap = { ...box, provider: "imap" };
  assert.equal(normalizeInboxMessage(raw, imap, "thread")?.reply_reference, "");
  assert.equal(
    normalizeInboxMessage(
      { ...raw, headers: [{ name: "Message-ID", value: "<rfc@provider>" }] },
      imap,
      "thread",
    )?.reply_reference,
    "<rfc@provider>",
  );
});
test("unread and awaiting reply are independent and timestamps reflect later messages", () => {
  assert.equal(inboxUnread(c), true);
  assert.equal(inboxNeedsReply(c), true);
  assert.equal(inboxUnread({ ...c, last_read_at: c.last_reply_at }), false);
  assert.equal(
    inboxNeedsReply({ ...c, last_outbound_at: "2026-11-22T13:00:00.000Z" }),
    false,
  );
  assert.equal(
    inboxUnread({ ...c, last_read_at: "2026-11-22T11:59:59.000Z" }),
    true,
  );
});
test("reply validation rejects empty, oversized and NUL bodies and normalizes reply subject", () => {
  assert.throws(() => replyText("  "));
  assert.throws(() => replyText("a".repeat(12001)));
  assert.throws(() => replyText("hello\x00"));
  assert.equal(replyText(" Hi \n"), "Hi");
  assert.equal(replySubject("Re: Original"), "Re: Original");
  assert.equal(replySubject("Original\nHeader"), "Re: Original Header");
});
function mockDb(claimed = true) {
  const updates: any[] = [],
    calls: any[] = [];
  const parent = {
    ...normalizeInboxMessage(raw, box, "thread"),
    id: "inbound",
    conversation_id: c.id,
  };
  const db = {
    from(table: string) {
      let mutation: any;
      const q: any = {};
      for (const method of ["select", "eq", "in", "not", "order", "limit"]) {
        q[method] = () => q;
      }
      q.update = (data: any) => {
        mutation = data;
        return q;
      };
      q.single = async () => ({
        data:
          table === "mailboxes"
            ? box
            : table === "campaigns"
              ? { sender_name: "Actual sender", signature_text: "Agency" }
              : parent,
        error: null,
      });
      q.then = (resolve: any) => {
        if (mutation) updates.push({ table, ...mutation });
        return Promise.resolve({
          data:
            table === "campaign_messages"
              ? [{ attempted_at: "2026-11-20T00:00:00Z" }]
              : [],
          error: null,
        }).then(resolve);
      };
      return q;
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args });
      return {
        data:
          name === "aisas_get_grant"
            ? "grant"
            : name === "aisas_begin_inbox_reply"
              ? { id: "request", state: "sent", claimed }
              : null,
        error: null,
      };
    },
  };
  return { db, updates, calls };
}
test("sending derives the recipient, original mailbox and parent from owned database records", async () => {
  const { db, updates, calls } = mockDb();
  let sent: any;
  const fetcher = (async (url: any, init: any) => {
    sent = { url, body: JSON.parse(init.body), headers: init.headers };
    return Response.json({ data: { id: "delivered", date: 1795348900 } });
  }) as typeof fetch;
  const result = await sendInboxReply(
    db,
    "private-key",
    "owner",
    c,
    { request_id: "request", message_id: "inbound", body: "My actual answer" },
    fetcher,
  );
  assert.equal(result.request.state, "sent");
  assert.equal(
    sent.url,
    "https://api.us.nylas.com/v3/grants/grant/messages/send",
  );
  assert.equal(sent.body.to[0].email, "ada@example.com");
  assert.equal(sent.body.reply_to_message_id, "message");
  assert.ok(sent.body.body.includes("My actual answer"));
  assert.ok(sent.body.body.includes("Actual sender"));
  assert.equal(sent.headers["Idempotency-Key"], "request");
  assert.ok(calls.some((x) => x.name === "aisas_store_inbox_messages"));
  assert.ok(updates.some((x) => x.state === "sent"));
});
test("a replayed request never calls the provider a second time", async () => {
  const { db } = mockDb(false);
  let calls = 0;
  const result = await sendInboxReply(
    db,
    "key",
    "owner",
    c,
    { request_id: "request", message_id: "inbound", body: "Answer" },
    (async () => {
      calls++;
      throw new Error();
    }) as typeof fetch,
  );
  assert.equal(calls, 0);
  assert.equal(result.request.state, "sent");
});
test("ambiguous provider outcomes block automatic resend; clear provider rejections remain failures", async () => {
  for (const [response, expected] of [
    [null, "uncertain"],
    [503, "uncertain"],
    [400, "failed"],
    [401, "failed"],
  ] as const) {
    const { db, updates } = mockDb();
    const fetcher = (async () => {
      if (response === null) throw new Error("timeout");
      return new Response("rejected", { status: response });
    }) as typeof fetch;
    const r = await sendInboxReply(
      db,
      "key",
      "owner",
      c,
      { request_id: "request", message_id: "inbound", body: "Answer" },
      fetcher,
    );
    assert.equal(r.request.state, expected);
    assert.ok(updates.some((x) => x.state === expected));
  }
});
test("conversation sync only persists matching messages and never sends or approves mail", async () => {
  const { db, calls } = mockDb();
  const requests: any[] = [];
  const fetcher = (async (url: any, init: any) => {
    requests.push({ url, init });
    return Response.json({
      data: [raw, { ...raw, id: "foreign", thread_id: "other" }],
    });
  }) as typeof fetch;
  const result = await syncInboxConversation(db, "key", c, fetcher);
  assert.equal(result.synced, true);
  assert.equal(requests.length, 1);
  assert.ok(!requests[0].init.method);
  assert.ok(requests[0].url.includes("thread_id=thread"));
  const saved = calls.find((x) => x.name === "aisas_store_inbox_messages");
  assert.equal(saved.args.p_messages.length, 1);
  assert.equal(
    saved.args.p_messages[0].body_text,
    "Hello & thanks!\nCan you share details?",
  );
});
