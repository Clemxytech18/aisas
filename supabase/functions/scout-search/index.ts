import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { booleanQuery } from "../../../src/domain.ts";
import { publicProspect } from "../../../src/scout-prospects.ts";
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
    const base = booleanQuery(profile);
    const people = `"${profile.audience.replace(/["\\\r\n]/g, " ")}" AND "${profile.location.replace(/["\\\r\n]/g, " ")}" site:linkedin.com/in`;
    const searches: Record<string, string>[] =
      kind === "person"
        ? [
            { engine: "google", q: people },
            { engine: "yahoo", p: people },
            { engine: "yandex", text: people },
          ]
        : [
            { engine: "google", q: base },
            {
              engine: "google",
              q: `${base} (site:linkedin.com/company OR "directory" OR "blog")`,
            },
            { engine: "yahoo", p: base },
            { engine: "yandex", text: base },
            {
              engine: "google_maps",
              q: `${profile.audience} ${profile.location}`,
              type: "search",
            },
          ];
    const results = await Promise.allSettled(
      searches.map(async (params) => {
        const url = new URL("https://serpapi.com/search.json");
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        url.searchParams.set("api_key", key!);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(25000),
        });
        if (!response.ok) throw new Error("Search provider failed");
        return response.json();
      }),
    );
    const leads: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    let succeeded = 0;
    for (const result of results) {
      if (result.status !== "fulfilled" || result.value.error) continue;
      succeeded++;
      for (const raw of [
        ...(result.value.organic_results || []),
        ...(Array.isArray(result.value.local_results)
          ? result.value.local_results
          : result.value.local_results?.places || []),
      ]) {
        const p = publicProspect(raw, {
          audience: profile.audience,
          location: profile.location,
          kind,
          sourceFallback: result.value.search_metadata?.google_maps_url,
        });
        if (!p) continue;
        const identity =
          p.prospect_kind === "person"
            ? p.linkedin || `${p.contact_name}|${p.company}|${p.email}`
            : `${p.company}|${p.domain}|${p.email}`;
        if (seen.has(identity.toLowerCase())) continue;
        seen.add(identity.toLowerCase());
        leads.push({ ...p, owner_id: user.id });
      }
    }
    if (!succeeded)
      return json(
        {
          error:
            "Search providers did not return results. Check your SerpAPI engine access and credits.",
        },
        502,
      );
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
    return json({ ...data, engines_responded: succeeded });
  } catch {
    return json({ error: "Scouting could not complete. Please retry." }, 500);
  }
});
