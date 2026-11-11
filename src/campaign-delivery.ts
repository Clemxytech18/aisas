import { renderMessage, validateMessages } from "./domain.ts";
export type DeliveryDb = {
  from: (table: string) => any;
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: any }>;
};
export const NYLAS_BASE = "https://api.us.nylas.com";
export const EMAIL_EVENT_TRIGGERS = [
  "message.created",
  "message.send_success",
  "message.send_failed",
  "message.bounce_detected",
  "message.opened",
  "thread.replied",
];
export function escapeEmailHtml(value: string) {
  return value
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    )
    .replace(/\n/g, "<br>");
}
export function sendPayload(
  delivery: any,
  campaignId: string,
  trackingUrl?: string,
) {
  const pixel =
    trackingUrl && (delivery.tracking_token || delivery.delivery_id)
      ? `<img src="${trackingUrl}?token=${encodeURIComponent(delivery.tracking_token || delivery.delivery_id)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0" />`
      : "";
  return {
    to: [{ email: delivery.lead.email }],
    ...(delivery.message_id
      ? { reply_to_message_id: delivery.message_id }
      : {}),
    subject: renderMessage(delivery.message.subject, delivery.lead),
    body:
      escapeEmailHtml(renderMessage(delivery.message.body, delivery.lead)) +
      pixel,
  };
}
export function sendFailure(status: number) {
  return {
    outcome: (status >= 400 && status < 500 && ![408, 409].includes(status)
      ? "failed"
      : "uncertain") as "failed" | "uncertain",
    message:
      status === 401 || status === 403
        ? "Sending account authorization failed. Reconnect the selected email account."
        : status === 429
          ? "The email provider rate limit was reached. Retry failed sends after the limit clears."
          : `The email provider could not confirm delivery (HTTP ${status}).`,
  };
}
async function checked<T extends { data: any; error: any }>(
  promise: PromiseLike<T>,
): Promise<T> {
  const r = await promise;
  if (r.error) throw new Error("database");
  return r;
}
export async function dispatchCampaignBatch(
  db: DeliveryDb,
  key: string,
  options: {
    campaignId?: string;
    limit?: number;
    trackingUrl?: string;
    fetcher?: typeof fetch;
    now?: () => number;
  } = {},
) {
  const fetcher = options.fetcher || fetch,
    now = options.now || Date.now;
  await checked(
    db
      .from("campaign_delivery_status")
      .update({
        last_run_at: new Date(now()).toISOString(),
        last_error_code: null,
      })
      .eq("id", true),
  );
  const claimed =
    (
      await checked(
        db.rpc("aisas_claim_delivery_batch", {
          p_campaign: options.campaignId || null,
        }),
      )
    ).data || [];
  const limit = Math.max(1, Math.min(5, options.limit || 5));
  for (const skipped of claimed.splice(limit))
    await checked(
      db
        .from("campaign_recipients")
        .update({ status: "pending", claim_token: null, claimed_at: null })
        .eq("id", skipped.id)
        .eq("claim_token", skipped.claim_token),
    );
  const outcomes = await Promise.all(
    claimed.map(async (recipient: any) => {
      let deliveryId: string | undefined;
      let submitted = false;
      try {
        const campaign = (
          await checked(
            db
              .from("campaigns")
              .select("*")
              .eq("id", recipient.campaign_id)
              .single(),
          )
        ).data;
        if (!campaign || !validateMessages(campaign.messages))
          throw new Error("sequence");
        const grant = (
          await checked(
            db.rpc("aisas_get_grant", { p_mailbox: campaign.mailbox_id }),
          )
        ).data;
        if (!grant) throw new Error("mailbox");
        const headers = {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        };
        if (recipient.thread_id) {
          const thread = await fetcher(
            `${NYLAS_BASE}/v3/grants/${encodeURIComponent(grant)}/threads/${encodeURIComponent(recipient.thread_id)}`,
            { headers, signal: AbortSignal.timeout(20000) },
          );
          if (!thread.ok) throw new Error("mailbox");
          const data = await thread.json();
          const received = Number(data.data?.latest_message_received_date || 0);
          const since =
            Date.parse(recipient.last_sent_at || recipient.created_at) / 1000;
          if (received > since) {
            const lead = (
              await checked(
                db
                  .from("leads")
                  .select("email")
                  .eq("id", recipient.lead_id)
                  .single(),
              )
            ).data;
            await checked(
              db.rpc("aisas_record_email_event", {
                p_event: {
                  id: `poll:${recipient.id}:${received}`,
                  kind: "replied",
                  grant_id: grant,
                  thread_id: recipient.thread_id,
                  sender: lead?.email || "",
                  message_ids: [],
                  at: new Date(received * 1000).toISOString(),
                },
              }),
            );
            return "replied";
          }
        }
        const delivery = (
          await checked(
            db.rpc("aisas_begin_campaign_send", {
              p_recipient: recipient.id,
              p_claim: recipient.claim_token,
            }),
          )
        ).data;
        if (!delivery) return "skipped";
        deliveryId = delivery.delivery_id;
        submitted = true;
        const response = await fetcher(
          `${NYLAS_BASE}/v3/grants/${encodeURIComponent(grant)}/messages/send`,
          {
            method: "POST",
            headers: {
              ...headers,
              "Idempotency-Key": `${delivery.delivery_id}:${delivery.attempt_count || 1}`,
            },
            body: JSON.stringify(
              sendPayload(delivery, campaign.id, options.trackingUrl),
            ),
            signal: AbortSignal.timeout(25000),
          },
        );
        if (!response.ok) {
          const failure = sendFailure(response.status);
          try {
            const detail = await response.json();
            const type = String(detail.error?.type || "");
            const message = String(detail.error?.message || "")
              .replaceAll(key, "[redacted]")
              .replace(/(?:nyk_|sk-proj-)[A-Za-z0-9_-]+/g, "[redacted]")
              .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
              .slice(0, 300);
            if (message) failure.message += ` ${type}: ${message}`;
          } catch {}
          await checked(
            db.rpc("aisas_finish_campaign_send", {
              p_delivery: deliveryId,
              p_outcome: failure.outcome,
              p_error: failure.message,
            }),
          );
          return failure.outcome;
        }
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error("unconfirmed");
        }
        if (!data.data?.id) throw new Error("unconfirmed");
        await checked(
          db.rpc("aisas_finish_campaign_send", {
            p_delivery: deliveryId,
            p_outcome: "sent",
            p_provider_id: String(data.data.id),
            p_thread_id: data.data.thread_id || null,
          }),
        );
        return "sent";
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        const message =
          reason === "sequence"
            ? "The campaign sequence is incomplete. Pause and review all four messages."
            : reason === "mailbox"
              ? "Sending account or thread lookup is unavailable. Reconnect the selected mailbox before retrying."
              : submitted
                ? "The provider outcome could not be confirmed. Automatic resend prevented. Check the sending mailbox."
                : "Delivery preparation failed. Retry after the connection recovers.";
        if (deliveryId)
          await db.rpc("aisas_finish_campaign_send", {
            p_delivery: deliveryId,
            p_outcome: submitted ? "uncertain" : "failed",
            p_error: message,
          });
        else
          await db
            .from("campaign_recipients")
            .update({
              status: "failed",
              last_error: message,
              claim_token: null,
              claimed_at: null,
            })
            .eq("id", recipient.id)
            .eq("claim_token", recipient.claim_token);
        return submitted ? "uncertain" : "failed";
      }
    }),
  );
  await checked(db.rpc("aisas_reconcile_email_events"));
  await checked(db.rpc("aisas_complete_finished_campaigns"));
  await checked(
    db
      .from("campaign_delivery_status")
      .update({
        last_success_at: new Date(now()).toISOString(),
        last_error_code: null,
      })
      .eq("id", true),
  );
  return {
    claimed: claimed.length,
    sent: outcomes.filter((x) => x === "sent").length,
    failed: outcomes.filter((x) => x === "failed").length,
    uncertain: outcomes.filter((x) => x === "uncertain").length,
  };
}
export async function verifyNylasSignature(
  raw: Uint8Array,
  signature: string,
  secret: string,
) {
  if (!/^[0-9a-f]{64}$/i.test(signature) || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const bytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((v) => parseInt(v, 16)),
  );
  return crypto.subtle.verify("HMAC", key, bytes, new Uint8Array(raw));
}
export type EmailEvent = {
  id: string;
  kind: "opened" | "replied" | "bounced" | "sent" | "failed";
  grant_id: string;
  label: string;
  message_ids: string[];
  provider_id: string;
  thread_id: string;
  sender: string;
  at: string;
  source?: string;
};
export function normalizeNylasEvent(
  payload: any,
  receivedAt = Date.now(),
): EmailEvent | null {
  const object = payload?.data?.object;
  if (!object || typeof object !== "object") return null;
  const type = String(payload.type || "");
  const kinds: Record<string, EmailEvent["kind"]> = {
    "message.created": "replied",
    "message.opened": "opened",
    "thread.replied": "replied",
    "message.bounce_detected": "bounced",
    "message.send_success": "sent",
    "message.send_failed": "failed",
  };
  const kind = kinds[type];
  if (!kind) return null;
  if (
    kind === "bounced" &&
    [object.type, object.bounce_reason, object.bounce_type].some(
      (v) => String(v).toLowerCase() === "automated_reply",
    )
  )
    return null;
  const grant = String(payload.data.grant_id || object.grant_id || "");
  if (!grant) return null;
  const str = (v: any) => (typeof v === "string" ? v : "");
  const messageIds = [
    object.root_message_id,
    object.origin?.id,
    object.originating_message_id,
    object.message_id,
    object.id,
  ]
    .map(str)
    .filter(Boolean);
  const incoming = type === "message.created";
  if (incoming && (!str(object.from?.[0]?.email) || !str(object.thread_id)))
    return null;
  const label = incoming ? "" : str(object.label || object.metadata?.key2);
  const rawTime = Number(object.timestamp || payload.time || 0);
  const timestamp = rawTime > 0 ? rawTime * 1000 : receivedAt;
  const at = new Date(
    Number.isFinite(timestamp) &&
      Math.abs(timestamp - receivedAt) < 366 * 86400000
      ? timestamp
      : receivedAt,
  ).toISOString();
  return {
    id: [
      str(payload.id) || "event",
      type,
      grant,
      messageIds[0] || label,
      rawTime || at,
    ]
      .join("|")
      .slice(0, 300),
    kind,
    source: type,
    grant_id: grant,
    label,
    message_ids: incoming ? [] : [...new Set(messageIds)].slice(0, 6),
    provider_id:
      kind === "replied"
        ? str(object.root_message_id || object.origin?.id)
        : str(object.message_id || object.id),
    thread_id: str(object.thread_id || object.origin?.thread_id),
    sender: str(object.from?.[0]?.email),
    at,
  };
}

export async function recordTrackedOpen(
  db: DeliveryDb,
  id: string,
  now = Date.now(),
) {
  const message = await db
    .from("campaign_messages")
    .select("id,mailbox_id,sent_at,provider_message_id,provider_thread_id")
    .eq("id", id)
    .maybeSingle();
  // An image preview must never turn a rejected or unconfirmed send into a successful one.
  if (message.error || !message.data?.sent_at) return false;
  const grant = await db.rpc("aisas_get_grant", {
    p_mailbox: message.data.mailbox_id,
  });
  if (grant.error || !grant.data) return false;
  const result = await db.rpc("aisas_record_email_event", {
    p_event: {
      id: `pixel:${id}`,
      kind: "opened",
      source: "aisas.pixel",
      grant_id: grant.data,
      label: id,
      message_ids: [],
      provider_id: message.data.provider_message_id,
      thread_id: message.data.provider_thread_id,
      at: new Date(now).toISOString(),
    },
  });
  return !result.error;
}
