export type Conversation = {
  id: string;
  owner_id: string;
  campaign_id: string;
  mailbox_id: string;
  thread_id: string;
  contact_email: string;
  contact_name: string;
  company: string;
  last_message_at: string;
  last_preview: string;
  last_reply_at: string | null;
  last_outbound_at: string | null;
  last_read_at: string | null;
  reply_count: number;
  last_sender_name: string;
  last_sender_email: string;
  synced_at: string | null;
  sync_cursor: string | null;
  sync_error: string | null;
};
export type InboxMessage = {
  id: string;
  conversation_id: string;
  provider_message_id: string;
  direction: "inbound" | "outbound";
  from_email: string;
  from_name: string;
  to_emails: string[];
  subject: string;
  body_text: string;
  body_truncated: boolean;
  received_at: string;
  reply_reference: string;
};
export type ReplySend = {
  id: string;
  state: "sending" | "sent" | "failed" | "uncertain";
  last_error?: string | null;
};
export const inboxUnread = (c: Conversation) =>
  !!c.last_reply_at && (!c.last_read_at || c.last_reply_at > c.last_read_at);
export const inboxNeedsReply = (c: Conversation) =>
  !!c.last_reply_at &&
  (!c.last_outbound_at || c.last_reply_at > c.last_outbound_at);
export function replyText(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 12000 ||
    /\x00/.test(value)
  )
    throw new Error("Write a reply between 1 and 12,000 characters.");
  return value.trim();
}
/** Text only: email HTML never enters a WebView, innerHTML, or remote image loader. */
export function emailPlainText(value: unknown): string {
  let text = typeof value === "string" ? value : "";
  if (/<\/?[a-z][^>]*>/i.test(text))
    text = text
      .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(
        /<\s*br\b[^>]*>|<\/(?:p|div|tr|li|h[1-6]|blockquote)\s*>/gi,
        "\n",
      )
      .replace(/<[^>]+>/g, "");
  return text
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (whole, entity: string) => {
        const names: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        if (!entity.startsWith("#"))
          return names[entity.toLowerCase()] || whole;
        const n =
          entity[1].toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
          ? String.fromCodePoint(n)
          : "";
      },
    )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
export function normalizeInboxMessage(
  raw: any,
  box: { email: string; provider: string },
  threadId: string,
): Omit<InboxMessage, "id" | "conversation_id"> | null {
  if (
    !raw ||
    typeof raw.id !== "string" ||
    raw.thread_id !== threadId ||
    raw.draft
  )
    return null;
  const from = raw.from?.[0];
  if (typeof from?.email !== "string" || !from.email.includes("@")) return null;
  const fromEmail = from.email.trim().toLowerCase();
  if (/^(mailer-daemon|postmaster)@/i.test(fromEmail)) return null;
  const date = Number(raw.date);
  if (
    !Number.isFinite(date) ||
    date <= 0 ||
    date * 1000 > Date.now() + 86400000
  )
    return null;
  const body = emailPlainText(raw.body || raw.snippet);
  const header = Array.isArray(raw.headers)
    ? raw.headers.find(
        (h: any) => String(h.name).toLowerCase() === "message-id",
      )?.value
    : undefined;
  const imap = /imap|generic|yahoo|icloud/i.test(box.provider);
  return {
    provider_message_id: raw.id,
    direction:
      fromEmail === box.email.trim().toLowerCase() ||
      (Array.isArray(raw.folders) &&
        raw.folders.some(
          (f: unknown) =>
            typeof f === "string" && /^(sent|sentmail|sentitems)$/i.test(f),
        ))
        ? "outbound"
        : "inbound",
    from_email: fromEmail,
    from_name: String(from.name || "").slice(0, 200),
    to_emails: (Array.isArray(raw.to) ? raw.to : [])
      .map((a: any) => String(a.email || ""))
      .filter(Boolean)
      .slice(0, 50),
    subject: String(raw.subject || "(No subject)").slice(0, 1000),
    body_text: body.slice(0, 100000),
    body_truncated: body.length > 100000,
    received_at: new Date(date * 1000).toISOString(),
    reply_reference: imap
      ? typeof header === "string"
        ? header.slice(0, 1000)
        : ""
      : raw.id,
  };
}
export function replySubject(subject: string) {
  return (/^re\s*:/i.test(subject) ? subject : `Re: ${subject}`)
    .replace(/[\r\n]/g, " ")
    .slice(0, 998);
}
export function filterConversations(
  rows: Conversation[],
  filter: string,
  search: string,
) {
  const needle = search.trim().toLowerCase();
  return rows.filter(
    (c) =>
      (filter === "all" ||
        (filter === "unread"
          ? inboxUnread(c)
          : filter === "awaiting"
            ? inboxNeedsReply(c)
            : !!c.last_reply_at)) &&
      (!needle ||
        [
          c.company,
          c.contact_name,
          c.contact_email,
          c.last_sender_name,
          c.last_sender_email,
          c.last_preview,
        ].some((v) => v.toLowerCase().includes(needle))),
  );
}
