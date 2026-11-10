import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { runScoutSearch } from "../../../src/scout-search.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!bearer) return json({ error: "Sign in to scout." }, 401);
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    if (Number(req.headers.get("content-length") || 0) > 20000)
      return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 20000) return json({ error: "Request too large" }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const kind = body.prospect_kind || "company";
    if (!["person", "company"].includes(kind))
      return json({ error: "Choose People or Companies." }, 400);
    const name = String(body.list_name || "").trim();
    if (!name || name.length > 160)
      return json({ error: "Choose a list name under 160 characters." }, 400);
    const { data: profile, error: profileError } = await db
      .from("scouting_profiles")
      .select("audience,location")
      .eq("id", body.profile_id)
      .eq("owner_id", user.id)
      .single();
    if (profileError || !profile)
      return json(
        { error: "Choose a scouting profile in your own workspace." },
        404,
      );
    const quota = await db.rpc("aisas_reserve_usage", {
      p_owner: user.id,
      p_kind: "scout",
    });
    if (quota.error)
      return json({ error: "Usage check unavailable. Please retry." }, 503);
    if (!quota.data)
      return json(
        { error: "Daily scouting limit reached. Try again tomorrow." },
        429,
      );
    let key = Deno.env.get("SERPAPI_KEY");
    if (!key) {
      const config = await db.rpc("aisas_runtime_config");
      if (config.error)
        return json({ error: "Scouting configuration unavailable." }, 503);
      key = config.data?.SERPAPI_KEY;
    }
    if (!key) return json({ error: "Scouting is not configured yet." }, 503);
    const result = await runScoutSearch(profile, kind, key);
    const diagnosticId = crypto.randomUUID();
    // Counts and categories only: never log keys, query URLs, profiles, or contact data.
    console.info(
      JSON.stringify({
        event: "scout_search_summary",
        diagnostic_id: diagnosticId,
        kind,
        accepted: result.prospects.length,
        fallback_used: result.fallback_used,
        providers: result.diagnostics,
      }),
    );
    if (result.failure)
      return json(
        { error: result.failure, diagnostic_id: diagnosticId },
        result.error_status,
      );
    const leads = result.prospects.map((prospect) => ({
      ...prospect,
      owner_id: user.id,
    }));
    // One transaction creates the private list and public-source pool entries together.
    const { data, error } = await db.rpc("aisas_save_scout_results", {
      p_owner: user.id,
      p_name: name,
      p_rows: leads.slice(0, 100),
    });
    if (error)
      return json(
        { error: "Could not save scouting results. Please retry." },
        500,
      );
    if (!data?.count)
      return json(
        {
          error:
            "The search returned prospects, but none could be saved. Please retry or contact support.",
          diagnostic_id: diagnosticId,
        },
        500,
      );
    return json({
      ...data,
      engines_responded: result.engines_responded,
      fallback_used: result.fallback_used,
      contacts_with_email: result.prospects.filter((p) => p.email).length,
      contacts_with_phone: result.prospects.filter((p) => p.phone).length,
      sources_searched: result.diagnostics.length,
      diagnostic_id: diagnosticId,
    });
  } catch {
    return json({ error: "Scouting could not complete. Please retry." }, 500);
  }
});
