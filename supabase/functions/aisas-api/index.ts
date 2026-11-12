import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  booleanQuery,
  renderMessage,
  validateMessages,
} from "../../../src/domain.ts";
import {
  sequenceProfile,
  withProfileProof,
  SEQUENCE_INSTRUCTIONS,
} from "../../../src/profile-proof.ts";
import { sequenceIdealCriteria } from "../../../src/ideal-sequence.ts";
import {
  IDEAL_SEQUENCE_GUIDANCE,
  withIdealObservation,
} from "../../../src/ideal-profile.ts";
import { mailboxConnectUrl } from "../../../src/mailbox.ts";
import { RuntimeConfig } from "./runtime-config.ts";
const runtimeConfig = new RuntimeConfig((key) => Deno.env.get(key));
const env = (key: string) => runtimeConfig.get(key);
const admin = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
function must<T extends { error: unknown }>(r: T): T {
  if (r.error)
    throw new Error(
      "Database operation failed. Please retry or contact support.",
    );
  return r;
}
async function provider(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  if (!r.ok)
    throw new Error(
      `Provider returned ${r.status}. Check the integration configuration.`,
    );
  return r.json();
}
const nylasBase = "https://api.us.nylas.com";
const nylasHeaders = () => ({
  Authorization: `Bearer ${env("NYLAS_API_KEY")}`,
  "Content-Type": "application/json",
});
function safeUrl(v: string) {
  try {
    const u = new URL(v);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const db = admin();
    await runtimeConfig.load(async () => {
      const result = await db.rpc("aisas_runtime_config");
      if (result.error)
        throw new Error(
          "Server configuration could not be loaded. Please try again.",
        );
      return result.data || {};
    });
    if (
      req.method === "GET" &&
      (url.searchParams.has("error") || url.searchParams.has("error_type"))
    ) {
      const state = url.searchParams.get("state");
      if (state) await db.rpc("aisas_consume_oauth", { p_state: state });
      const redirect = new URL(env("APP_ORIGIN"));
      redirect.searchParams.set("mailbox_error", "connection_failed");
      return Response.redirect(redirect.href, 303);
    }
    if (req.method === "GET" && url.searchParams.has("code")) {
      const state = url.searchParams.get("state") || "";
      const { data: owner, error } = await db.rpc("aisas_consume_oauth", {
        p_state: state,
      });
      if (error || !owner)
        return json(
          {
            error:
              "This connection link expired. Start again from Email accounts.",
          },
          400,
        );
      const token = await provider(`${nylasBase}/v3/connect/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env("NYLAS_CLIENT_ID"),
          client_secret: env("NYLAS_CLIENT_SECRET"),
          redirect_uri: env("NYLAS_REDIRECT_URI"),
          grant_type: "authorization_code",
          code: url.searchParams.get("code"),
        }),
      });
      if (!token.grant_id || !token.email)
        throw new Error("Email provider did not return a usable mailbox.");
      const box = must(
        await db
          .from("mailboxes")
          .upsert(
            {
              owner_id: owner,
              email: token.email,
              provider: token.provider || "imap",
              status: "connected",
            },
            { onConflict: "owner_id,email" },
          )
          .select("id")
          .single(),
      ).data!;
      must(
        await db.rpc("aisas_set_grant", {
          p_mailbox: box.id,
          p_grant: token.grant_id,
        }),
      );
      const redirect = new URL(env("APP_ORIGIN"));
      redirect.searchParams.set("mailbox_connected", "1");
      return Response.redirect(redirect.href, 303);
    }
    if (req.method !== "POST")
      return json({ error: "Method not allowed" }, 405);
    if (Number(req.headers.get("content-length") || 0) > 20000)
      return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 20000) return json({ error: "Request too large" }, 413);
    const body = JSON.parse(raw);
    if (body.action === "dispatch") {
      if (req.headers.get("authorization") !== `Bearer ${env("CRON_SECRET")}`)
        return json({ error: "Unauthorized" }, 401);
      const queued = must(await db.rpc("aisas_request_campaign_dispatch"));
      return json({ queued: true, request_id: queued.data });
    }
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!bearer) return json({ error: "Sign in to continue." }, 401);
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    if (
      ["scout", "generate-sequence", "connect-mailbox"].includes(body.action)
    ) {
      const quota = must(
        await db.rpc("aisas_reserve_usage", {
          p_owner: user.id,
          p_kind: body.action,
        }),
      );
      if (!quota.data)
        return json(
          { error: "Daily integration limit reached. Try again tomorrow." },
          429,
        );
    }
    const owned = async (table: string, id: string) => {
      const { data, error } = await db
        .from(table)
        .select("*")
        .eq("id", id)
        .eq("owner_id", user.id)
        .single();
      if (error || !data)
        throw new Error("Record not found in your workspace.");
      return data;
    };
    if (body.action === "scout") {
      env("SERPAPI_KEY");
      const p = await owned("scouting_profiles", body.profile_id);
      const name = String(body.list_name || "").trim();
      if (!name || name.length > 160)
        return json({ error: "Choose a list name under 160 characters." }, 400);
      const base = booleanQuery(p);
      const searches: Record<string, string>[] = [
        { engine: "google", q: base },
        {
          engine: "google",
          q: `${base} (site:linkedin.com/company OR "directory" OR "blog")`,
        },
        { engine: "yahoo", p: base },
        { engine: "yandex", text: base },
        {
          engine: "google_maps",
          q: `${p.audience} ${p.location}`,
          type: "search",
        },
      ];
      const results = await Promise.allSettled(
        searches.map(async (params) => {
          const search = new URL("https://serpapi.com/search.json");
          Object.entries(params).forEach(([k, v]) =>
            search.searchParams.set(k, v),
          );
          search.searchParams.set("api_key", env("SERPAPI_KEY"));
          return provider(search.href);
        }),
      );
      const rows: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      let successful = 0;
      for (const r of results) {
        if (r.status !== "fulfilled" || r.value.error) continue;
        successful++;
        for (const x of [
          ...(r.value.organic_results || []),
          ...(Array.isArray(r.value.local_results)
            ? r.value.local_results
            : r.value.local_results?.places || []),
        ]) {
          const text = `${x.title || ""} ${x.snippet || ""} ${x.address || ""}`;
          const company = String(x.title || "").slice(0, 200);
          if (!company) continue;
          const website = safeUrl(x.website || x.link || "");
          const source = safeUrl(
            x.link ||
              x.website ||
              r.value.search_metadata?.google_maps_url ||
              "",
          );
          const email =
            (text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) ||
              [])[0] || "";
          const key = `${company.toLowerCase()}|${email.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            owner_id: user.id,
            company,
            contact_name: "",
            category: p.audience,
            location: x.address || p.location,
            email,
            phone: x.phone || "",
            website,
            linkedin: website.includes("linkedin.com/") ? website : "",
            source_url: source,
            score: email ? 85 : x.phone ? 75 : 60,
          });
        }
      }
      if (!successful)
        throw new Error(
          "Search providers did not return results. Check your SerpAPI account and engine access.",
        );
      const list = must(
        await db
          .from("lead_lists")
          .insert({ owner_id: user.id, name })
          .select("id")
          .single(),
      ).data!;
      if (rows.length)
        must(
          await db
            .from("leads")
            .insert(
              rows.slice(0, 100).map((l) => ({ ...l, list_id: list.id })),
            ),
        );
      return json({
        list_id: list.id,
        count: Math.min(rows.length, 100),
        engines_responded: successful,
      });
    }
    if (body.action === "generate-sequence") {
      const p = await owned("scouting_profiles", body.profile_id);
      const idealCriteria = await sequenceIdealCriteria(
        db,
        user.id,
        body.list_id,
      );
      const completion = await provider(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  SEQUENCE_INSTRUCTIONS +
                  (idealCriteria.length ? " " + IDEAL_SEQUENCE_GUIDANCE : ""),
              },
              {
                role: "user",
                content: JSON.stringify({
                  ...sequenceProfile(p),
                  ...(idealCriteria.length
                    ? { ideal_criteria: idealCriteria }
                    : {}),
                }),
              },
            ],
          }),
        },
      );
      const messages = JSON.parse(
        completion.choices[0].message.content,
      ).messages;
      if (!validateMessages(messages))
        throw new Error(
          "AI returned an incomplete sequence. Please generate again.",
        );
      const sequence = withProfileProof(messages, p);
      return json({
        messages: idealCriteria.length
          ? withIdealObservation(sequence)
          : sequence,
      });
    }
    if (body.action === "connect-mailbox") {
      if (!["google", "microsoft", "yahoo", "imap"].includes(body.provider))
        return json({ error: "Choose a supported provider." }, 400);
      env("NYLAS_API_KEY");
      env("NYLAS_CLIENT_SECRET");
      const state = crypto.randomUUID();
      must(
        await db.rpc("aisas_store_oauth", { p_state: state, p_owner: user.id }),
      );
      const url = mailboxConnectUrl({
        baseUrl: nylasBase,
        clientId: env("NYLAS_CLIENT_ID"),
        redirectUri: env("NYLAS_REDIRECT_URI"),
        state,
        provider: body.provider,
      });
      return json({ url });
    }
    if (body.action === "campaign-status") {
      const c = await owned("campaigns", body.campaign_id);
      if (body.status === "paused") {
        must(
          await db
            .from("campaigns")
            .update({ status: "paused" })
            .eq("id", c.id),
        );
        return json({ status: "paused" });
      }
      if (body.status !== "running")
        return json({ error: "Unsupported campaign status." }, 400);
      env("NYLAS_API_KEY");
      env("CRON_SECRET");
      if (!c.approved || !validateMessages(c.messages))
        throw new Error(
          "Review and approve all four messages before launching.",
        );
      if (!c.mailbox_id || !c.list_id)
        throw new Error("Select a sending mailbox and audience list.");
      await owned("mailboxes", c.mailbox_id);
      const grant = must(
        await db.rpc("aisas_get_grant", { p_mailbox: c.mailbox_id }),
      ).data;
      if (!grant) throw new Error("Reconnect your sending mailbox.");
      const leads =
        must(
          await db
            .from("leads")
            .select("id,email,status")
            .eq("list_id", c.list_id)
            .eq("owner_id", user.id),
        ).data || [];
      const eligible = leads.filter(
        (l) => l.email && !["replied", "unsubscribed"].includes(l.status),
      );
      if (!eligible.length)
        throw new Error("This list has no eligible email contacts.");
      must(
        await db.from("campaign_recipients").upsert(
          eligible.map((l) => ({
            owner_id: user.id,
            campaign_id: c.id,
            lead_id: l.id,
            next_send_at: c.start_at || new Date().toISOString(),
          })),
          { onConflict: "campaign_id,lead_id", ignoreDuplicates: true },
        ),
      );
      const status =
        c.start_at && Date.parse(c.start_at) > Date.now()
          ? "scheduled"
          : "running";
      must(
        await db
          .from("campaigns")
          .update({
            status,
            recipient_total: leads.length,
            recipient_valid: leads.filter((l) => l.email?.trim()).length,
            launched_at: c.launched_at || new Date().toISOString(),
          })
          .eq("id", c.id),
      );
      // Persist the queue before an asynchronous worker request; cron also retries every minute.
      const wake = await db.rpc("aisas_request_campaign_dispatch", {
        p_campaign: c.id,
      });
      if (wake.error)
        await db
          .from("campaign_delivery_status")
          .update({ last_error_code: "wakeup_pending" })
          .eq("id", true);
      return json({ status, recipients: eligible.length });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error(
      "AISAS request failed",
      e instanceof Error ? e.name : "Error",
    );
    return json(
      {
        error:
          e instanceof Error ? e.message : "Unable to complete the request.",
      },
      400,
    );
  }
});
