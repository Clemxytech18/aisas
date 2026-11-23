import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { RuntimeConfig } from "../aisas-api/runtime-config.ts";
import {
  inboxChecked as check,
  syncInboxBatch,
  syncInboxConversation,
  sendInboxReply,
} from "../../../src/campaign-inbox-service.ts";
import { replyText } from "../../../src/campaign-inbox.ts";
import { idealAIJson } from "../../../src/ideal-ai.ts";
const config = new RuntimeConfig((k) => Deno.env.get(k));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token)
    return json({ error: "Sign in to open your campaign inbox." }, 401);
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user)
    return json({ error: "Your session expired. Sign in again." }, 401);
  try {
    const raw = await req.text();
    if (raw.length > 25000) return json({ error: "Request too large" }, 413);
    let b: any;
    try {
      b = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    if (!b || typeof b !== "object")
      return json({ error: "Invalid request" }, 400);
    const owned = async (table: string, value: unknown) => {
      if (!id(value))
        throw new Error("Choose a valid conversation or message.");
      return check(
        db
          .from(table)
          .select("*")
          .eq("id", value)
          .eq("owner_id", user.id)
          .single(),
      );
    };
    const settings = () =>
      config.load(
        async () => (await check(db.rpc("aisas_runtime_config"))) || {},
      );
    const quota = async (kind: string) => {
      if (
        !(await check(
          db.rpc("aisas_inbox_quota", { p_owner: user.id, p_kind: kind }),
        ))
      )
        throw new Error("Daily inbox limit reached. Try again tomorrow.");
    };
    const campaign = b.campaign_id;
    if (campaign) {
      await owned("campaigns", campaign);
    }
    if (b.action === "inbox-list") {
      await check(db.rpc("aisas_seed_campaign_inbox", { p_owner: user.id }));
      let q = db
        .from("campaign_conversations")
        .select("*", { count: "exact" })
        .eq("owner_id", user.id);
      if (campaign) q = q.eq("campaign_id", campaign);
      if (b.filter === "responses") q = q.not("last_reply_at", "is", null);
      // Unread/awaiting comparisons are evaluated in SQL through a server-only list RPC.
      const offset = Math.max(
        0,
        Math.min(100000, Math.floor(Number(b.offset) || 0)),
      );
      const search =
        typeof b.search === "string"
          ? b.search
              .replace(/[^\p{L}\p{N}@. _-]/gu, "")
              .trim()
              .slice(0, 100)
          : "";
      if (search)
        q = q.or(
          [
            "contact_email",
            "contact_name",
            "company",
            "last_sender_email",
            "last_sender_name",
            "last_preview",
          ]
            .map((k) => `${k}.ilike.%${search}%`)
            .join(","),
        );
      const result = await q
        .order("last_message_at", { ascending: false })
        .order("id")
        .range(offset, offset + 29);
      if (result.error)
        throw new Error(
          "Your campaign inbox could not be loaded. Try refreshing.",
        );
      const summary = await check(
        db.rpc("aisas_inbox_summary", {
          p_owner: user.id,
          p_campaign: campaign || null,
        }),
      );
      return json({
        conversations: result.data || [],
        summary,
        total: result.count || 0,
        next_offset: offset + 30 < (result.count || 0) ? offset + 30 : null,
      });
    }
    if (b.action === "inbox-sync") {
      await quota("sync");
      await settings();
      return json(
        await syncInboxBatch(
          db,
          config.get("NYLAS_API_KEY"),
          user.id,
          campaign,
        ),
      );
    }
    const c = await owned("campaign_conversations", b.conversation_id);
    if (b.action === "inbox-read") {
      if (typeof b.through !== "string" || Number.isNaN(Date.parse(b.through)))
        throw new Error("Invalid read timestamp.");
      await check(
        db.rpc("aisas_read_inbox", {
          p_owner: user.id,
          p_conversation: c.id,
          p_through: new Date(b.through).toISOString(),
        }),
      );
      return json({ read: true });
    }
    if (b.action === "inbox-open") {
      let sync: any;
      if (b.sync !== false) {
        await quota("sync");
        await settings();
        sync = await syncInboxConversation(db, config.get("NYLAS_API_KEY"), c);
      }
      let q = db
        .from("campaign_inbox_messages")
        .select("*")
        .eq("conversation_id", c.id)
        .eq("owner_id", user.id);
      if (b.before) {
        if (
          !id(b.before.id) ||
          typeof b.before.at !== "string" ||
          Number.isNaN(Date.parse(b.before.at))
        )
          throw new Error("Invalid history cursor.");
        const at = new Date(b.before.at).toISOString();
        q = q.or(
          `received_at.lt.${at},and(received_at.eq.${at},id.lt.${b.before.id})`,
        );
      }
      const rows = await check(
        q
          .order("received_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(51),
      );
      const hasMore = rows.length > 50;
      const displayed = rows.slice(0, 50).reverse();
      const requests = await check(
        db
          .from("campaign_reply_sends")
          .select("id,state,last_error,created_at")
          .eq("conversation_id", c.id)
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1),
      );
      return json({
        conversation: await owned("campaign_conversations", c.id),
        messages: displayed,
        sync,
        next_before: hasMore
          ? { at: displayed[0].received_at, id: displayed[0].id }
          : null,
        request: requests[0] || null,
      });
    }
    if (b.action === "inbox-draft") {
      const parent = await owned("campaign_inbox_messages", b.message_id);
      if (parent.conversation_id !== c.id || parent.direction !== "inbound")
        throw new Error("Choose an incoming message to draft a reply.");
      await quota("draft");
      await settings();
      const campaign = await owned("campaigns", c.campaign_id);
      const profile = campaign.profile_id
        ? await owned("scouting_profiles", campaign.profile_id)
        : null;
      const history = await check(
        db
          .from("campaign_inbox_messages")
          .select("direction,from_name,from_email,body_text,received_at")
          .eq("conversation_id", c.id)
          .eq("owner_id", user.id)
          .order("received_at", { ascending: false })
          .limit(12),
      );
      try {
        const draft = await idealAIJson(
          'Write a helpful, concise email reply for the account owner to the selected incoming message. Return JSON {"body":"plain text reply"}. Address their actual question and use the conversation and supplied business profile for context. Do not invent prices, capabilities, appointments, promises, facts, or that actions have already happened. If the sender asks to stop contact, acknowledge the request without another sales pitch. Never sign with a fictional name; omit signature because the campaign signature is appended automatically. Do not include a subject, HTML or markdown fences. The user will review this draft and explicitly send it.',
          {
            selected_message: {
              from: parent.from_email,
              subject: parent.subject,
              body: parent.body_text.slice(0, 12000),
            },
            history: history
              .reverse()
              .map((m: any) => ({
                ...m,
                body_text: m.body_text.slice(0, 3000),
              })),
            profile,
            company: c.company,
            sender_name: campaign.sender_name,
            drafting_notes:
              typeof b.notes === "string" ? b.notes.slice(0, 1000) : "",
          },
          config.get("OPENAI_API_KEY"),
          fetch,
          Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
        );
        return json({ body: replyText(draft.body) });
      } catch {
        throw new Error(
          "AI drafting is unavailable right now. You can type your reply manually or try again.",
        );
      }
    }
    if (b.action === "inbox-send") {
      if (!id(b.request_id) || !id(b.message_id))
        throw new Error("Choose a message and a valid reply request.");
      replyText(b.body);
      await quota("send");
      await settings();
      return json(
        await sendInboxReply(db, config.get("NYLAS_API_KEY"), user.id, c, {
          request_id: b.request_id,
          message_id: b.message_id,
          body: b.body,
        }),
      );
    }
    return json({ error: "Unknown inbox action" }, 400);
  } catch (e) {
    return json(
      {
        error:
          e instanceof Error
            ? e.message
            : "The campaign inbox is temporarily unavailable.",
      },
      400,
    );
  }
});
