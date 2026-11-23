// Server only. Provider credentials must never be returned to the application.
import {
  normalizeInboxMessage,
  replySubject,
  replyText,
  type Conversation,
  type InboxMessage,
} from "./campaign-inbox.ts";
import { emailBodyHtml } from "./email-signature.ts";
import {
  NYLAS_BASE,
  sendFailure,
  type DeliveryDb,
} from "./campaign-delivery.ts";
export async function inboxChecked(
  promise: PromiseLike<{ data: any; error: any }>,
): Promise<any> {
  const result = await promise;
  if (result.error)
    throw new Error(
      "Campaign inbox data could not be saved or loaded. Refresh and try again.",
    );
  return result.data;
}
async function mailboxGrant(db: DeliveryDb, c: Conversation) {
  const box = await inboxChecked(
    db
      .from("mailboxes")
      .select("id,email,provider,status")
      .eq("id", c.mailbox_id)
      .eq("owner_id", c.owner_id)
      .single(),
  );
  const grant = await inboxChecked(
    db.rpc("aisas_get_grant", { p_mailbox: box.id }),
  );
  if (!grant || box.status !== "connected")
    throw new Error(
      "Reconnect this conversation’s sending account in Email accounts.",
    );
  return { box, grant: String(grant) };
}
export async function syncInboxConversation(
  db: DeliveryDb,
  key: string,
  c: Conversation,
  fetcher: typeof fetch = fetch,
) {
  try {
    const { box, grant } = await mailboxGrant(db, c);
    const first = await inboxChecked(
      db
        .from("campaign_messages")
        .select("attempted_at")
        .eq("recipient_id", c.id)
        .not("sent_at", "is", null)
        .order("attempted_at")
        .limit(1),
    );
    const since = first?.[0]?.attempted_at
      ? Date.parse(first[0].attempted_at) - 60000
      : 0;
    const messages: ReturnType<typeof normalizeInboxMessage>[] = [];
    const page = async (cursor?: string | null) => {
      const query = new URLSearchParams({
        thread_id: c.thread_id,
        limit: "50",
        fields: "include_basic_headers",
      });
      if (cursor) query.set("page_token", cursor);
      const r = await fetcher(
        `${NYLAS_BASE}/v3/grants/${encodeURIComponent(grant)}/messages?${query}`,
        {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(20000),
        },
      );
      if (!r.ok)
        throw new Error(
          r.status === 401 || r.status === 403
            ? "Reconnect this conversation’s sending account in Email accounts."
            : "The mailbox could not be synced. Your saved conversation is still available; try refreshing shortly.",
        );
      const data = await r.json();
      if (!Array.isArray(data.data))
        throw new Error(
          "The mailbox returned an unreadable conversation. Try refreshing shortly.",
        );
      for (const raw of data.data) {
        const m = normalizeInboxMessage(raw, box, c.thread_id);
        if (m && Date.parse(m.received_at) >= since) messages.push(m);
        // Reconcile a timed-out reply only with the request ID returned by Nylas.
        const requestId = raw.metadata?.key2;
        if (
          m?.direction === "outbound" &&
          raw.metadata?.key1 === "aisas-reply" &&
          typeof requestId === "string" &&
          /^[a-f0-9-]{36}$/i.test(requestId)
        )
          await inboxChecked(
            db
              .from("campaign_reply_sends")
              .update({
                state: "sent",
                provider_message_id: raw.id,
                last_error: null,
              })
              .eq("id", requestId)
              .eq("conversation_id", c.id)
              .in("state", ["sending", "uncertain"]),
          );
      }
      return typeof data.next_cursor === "string" ? data.next_cursor : null;
    };
    const newestCursor = await page();
    // Always fetch recent messages, even while older history is being backfilled.
    let cursor = c.sync_cursor || newestCursor;
    if (cursor) cursor = await page(cursor);
    await inboxChecked(
      db.rpc("aisas_store_inbox_messages", {
        p_conversation: c.id,
        p_messages: messages.filter(Boolean),
      }),
    );
    await inboxChecked(
      db
        .from("campaign_conversations")
        .update({
          synced_at: new Date().toISOString(),
          sync_cursor: cursor,
          sync_error: null,
        })
        .eq("id", c.id)
        .eq("owner_id", c.owner_id),
    );
    return { synced: true, partial: !!cursor };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "Conversation sync failed. Try refreshing shortly.";
    await db
      .from("campaign_conversations")
      .update({ synced_at: new Date().toISOString(), sync_error: message })
      .eq("id", c.id);
    return { synced: false, error: message };
  }
}
export async function syncInboxBatch(
  db: DeliveryDb,
  key: string,
  owner?: string,
  campaign?: string,
  fetcher: typeof fetch = fetch,
) {
  await inboxChecked(
    db.rpc("aisas_seed_campaign_inbox", { p_owner: owner || null }),
  );
  let query = db
    .from("campaign_conversations")
    .select("*")
    .order("synced_at", { ascending: true, nullsFirst: true })
    .order("last_reply_at", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false })
    .limit(6);
  if (owner) query = query.eq("owner_id", owner);
  if (campaign) query = query.eq("campaign_id", campaign);
  const rows = await inboxChecked(query);
  const results = [];
  for (let i = 0; i < rows.length; i += 3)
    results.push(
      ...(await Promise.all(
        rows
          .slice(i, i + 3)
          .map((c: Conversation) => syncInboxConversation(db, key, c, fetcher)),
      )),
    );
  return {
    checked: results.length,
    synced: results.filter((r) => r.synced).length,
    errors: results.filter((r) => !r.synced).length,
  };
}
export async function captureInboxEvent(
  db: DeliveryDb,
  payload: any,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  if (!["message.created", "thread.replied"].includes(payload?.type)) return;
  const raw = payload.data?.object;
  const thread = raw?.thread_id || raw?.origin?.thread_id;
  const grant = payload.data?.grant_id || raw?.grant_id;
  if (typeof thread !== "string" || typeof grant !== "string") return;
  await inboxChecked(db.rpc("aisas_seed_campaign_inbox", { p_owner: null }));
  const rows = await inboxChecked(
    db.from("campaign_conversations").select("*").eq("thread_id", thread),
  );
  for (const c of rows) {
    const actual = await inboxChecked(
      db.rpc("aisas_get_grant", { p_mailbox: c.mailbox_id }),
    );
    if (actual !== grant) continue;
    await syncInboxConversation(db, key, c, fetcher);
  }
}
export async function sendInboxReply(
  db: DeliveryDb,
  key: string,
  owner: string,
  c: Conversation,
  input: { request_id: string; message_id: string; body: string },
  fetcher: typeof fetch = fetch,
) {
  const body = replyText(input.body);
  // Authenticate and derive both recipient and threading reference from saved records.
  const parent: InboxMessage = await inboxChecked(
    db
      .from("campaign_inbox_messages")
      .select("*")
      .eq("id", input.message_id)
      .eq("conversation_id", c.id)
      .eq("owner_id", owner)
      .eq("direction", "inbound")
      .single(),
  );
  const { box, grant } = await mailboxGrant(db, c);
  const campaign = await inboxChecked(
    db
      .from("campaigns")
      .select("sender_name,signature_text,signature_image_url")
      .eq("id", c.campaign_id)
      .eq("owner_id", owner)
      .single(),
  );
  const payload = {
    to: [{ email: parent.from_email, name: parent.from_name }],
    subject: replySubject(parent.subject),
    reply_to_message_id: parent.reply_reference,
    body: emailBodyHtml(body, campaign),
    metadata: { key1: "aisas-reply", key2: input.request_id },
  };
  const claim = await inboxChecked(
    db.rpc("aisas_begin_inbox_reply", {
      p_owner: owner,
      p_conversation: c.id,
      p_request: input.request_id,
      p_message: input.message_id,
      p_body: body,
    }),
  );
  if (!claim.claimed) return { request: claim };
  let confirmed = false;
  try {
    const r = await fetcher(
      `${NYLAS_BASE}/v3/grants/${encodeURIComponent(grant)}/messages/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": input.request_id,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok) {
      const failure = sendFailure(r.status);
      await r.body?.cancel();
      const state = failure.outcome;
      await inboxChecked(
        db
          .from("campaign_reply_sends")
          .update({ state, last_error: failure.message })
          .eq("id", input.request_id),
      );
      return {
        request: { id: input.request_id, state, last_error: failure.message },
      };
    }
    const data = (await r.json()).data;
    if (typeof data?.id !== "string") throw new Error("unconfirmed");
    confirmed = true;
    await inboxChecked(
      db
        .from("campaign_reply_sends")
        .update({
          state: "sent",
          provider_message_id: data.id,
          last_error: null,
        })
        .eq("id", input.request_id),
    );
    const raw = {
      ...data,
      thread_id: c.thread_id,
      from: [{ email: box.email, name: campaign.sender_name || box.email }],
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      date: Number(data.date) || Math.floor(Date.now() / 1000),
    };
    const message = normalizeInboxMessage(raw, box, c.thread_id);
    if (message)
      await inboxChecked(
        db.rpc("aisas_store_inbox_messages", {
          p_conversation: c.id,
          p_messages: [message],
        }),
      );
    return { request: { id: input.request_id, state: "sent" } };
  } catch {
    const state = confirmed ? "sent" : "uncertain";
    const last_error = confirmed
      ? "Reply sent. Refresh to load it in the conversation."
      : "Delivery could not be confirmed. Automatic resend is blocked; refresh and check the sending mailbox before trying again.";
    await db
      .from("campaign_reply_sends")
      .update({ state, last_error })
      .eq("id", input.request_id);
    return { request: { id: input.request_id, state, last_error } };
  }
}
