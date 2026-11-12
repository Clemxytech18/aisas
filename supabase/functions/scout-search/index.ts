import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  createIdealScoutState,
  idealScoutStep,
  type IdealScoutState,
} from "../../../src/ideal-scout.ts";
import { prepareIdealCriteria } from "../../../src/ideal-profile.ts";
import { planIdealSearch } from "../../../src/ideal-ai.ts";
import {
  createScoutState,
  scoutCoverageStep,
  type CoverageState,
} from "../../../src/scout-coverage.ts";
import {
  scoutOptions,
  scoutMethod,
  MAPS_SCOUT_OPTIONS,
} from "../../../src/scout-types.ts";
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicColumns =
  "id,name,kind,target,status,list_id,stats,reason,warnings,created_at,updated_at,method:state->>method,goal:state->>goal";
async function resolve(host: string): Promise<string[]> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  const records = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  return records.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let activeId: string | undefined,
    lease: string | undefined,
    owner: string | undefined;
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!token) return json({ error: "Sign in to scout." }, 401);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    owner = user.id;
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
    const action = body.operation || "start";
    if (action === "list") {
      const runs = await db
        .from("scout_runs")
        .select(publicColumns)
        .eq("owner_id", owner)
        .order("status", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(24);
      if (runs.error) throw new Error("storage");
      return json({ runs: runs.data });
    }
    if (!["start", "continue", "pause", "resume", "status"].includes(action))
      return json({ error: "Invalid scouting operation" }, 400);
    if (action === "start") {
      let method;
      try {
        method = scoutMethod(body.scouting_method);
      } catch {
        return json(
          { error: "Choose Boolean Scouting or Google Maps Scouting." },
          400,
        );
      }
      const kind = body.prospect_kind || "company";
      if (method === "google_maps" && kind !== "company")
        return json(
          {
            error:
              "Google Maps Scouting finds companies and local businesses. Choose Boolean Scouting to find people.",
          },
          400,
        );
      if (!["person", "company"].includes(kind))
        return json({ error: "Choose People or Companies." }, 400);
      const name = String(body.list_name || "").trim();
      if (!name || name.length > 160)
        return json({ error: "Choose a list name under 160 characters." }, 400);
      let options;
      try {
        options = scoutOptions(
          method === "google_maps"
            ? { ...MAPS_SCOUT_OPTIONS, ...body.options }
            : body.options,
        );
      } catch {
        return json(
          {
            error:
              "Choose a target of 1–1,000 prospects and a search budget of 1–100 requests.",
          },
          400,
        );
      }
      const profile = await db
        .from("scouting_profiles")
        .select("audience,location")
        .eq("id", body.profile_id)
        .eq("owner_id", owner)
        .single();
      if (profile.error || !profile.data)
        return json(
          { error: "Choose a scouting profile in your own workspace." },
          404,
        );
      activeId = body.run_id || crypto.randomUUID();
      if (!UUID.test(activeId!))
        return json({ error: "Invalid run identifier" }, 400);
      const prior = await db
        .from("scout_runs")
        .select(publicColumns)
        .eq("id", activeId)
        .eq("owner_id", owner)
        .maybeSingle();
      if (prior.error) throw new Error("storage");
      if (prior.data)
        return json({
          run: prior.data,
          done: prior.data.status === "completed",
        });
      let initialState: CoverageState = createScoutState(
        profile.data,
        kind,
        options,
        method,
      );
      if (body.ideal_profile_id) {
        const ideal = await db
          .from("ideal_profiles")
          .select("*")
          .eq("id", body.ideal_profile_id)
          .eq("owner_id", owner)
          .eq("audience_profile_id", body.profile_id)
          .single();
        if (ideal.error || !ideal.data)
          return json(
            {
              error:
                "Choose an ideal profile linked to this audience in your own workspace.",
            },
            404,
          );
        if (!options.useAI || !options.readPages || options.aiBudget < 1)
          return json(
            {
              error:
                "Ideal Prospects requires public-page reading and AI qualification.",
            },
            400,
          );
        const cfg = await db.rpc("aisas_runtime_config");
        if (cfg.error) throw new Error("configuration");
        const aiKey =
          Deno.env.get("OPENAI_API_KEY") || cfg.data?.OPENAI_API_KEY;
        if (!aiKey) throw new Error("ideal_ai_authentication");
        const criteria = prepareIdealCriteria(ideal.data);
        const planQuota = await db.rpc("aisas_reserve_usage", {
          p_owner: owner,
          p_kind: "generate-sequence",
        });
        if (planQuota.error) throw new Error("configuration");
        if (!planQuota.data)
          return json(
            { error: "Daily AI planning limit reached. Try again tomorrow." },
            429,
          );
        const plan = await planIdealSearch(
          criteria,
          profile.data.location,
          aiKey,
          fetch,
          Deno.env.get("OPENAI_MODEL") ||
            cfg.data?.OPENAI_MODEL ||
            "gpt-4.1-mini",
          profile.data.audience,
        );
        initialState = createIdealScoutState(
          profile.data,
          kind,
          options,
          method,
          ideal.data,
          criteria,
          plan,
        );
      }
      const created = await db.rpc("aisas_start_scout_run", {
        p_id: activeId,
        p_owner: owner,
        p_profile: body.profile_id,
        p_name: name,
        p_state: initialState,
      });
      if (created.error) {
        const m = created.error.message;
        return json(
          {
            error: /Daily scouting limit|Pause an existing scout/.test(m)
              ? m
              : "Could not start scouting. Please try again.",
          },
          /Daily|Pause/.test(m) ? 429 : 500,
        );
      }
    } else {
      activeId = String(body.run_id || "");
      if (!UUID.test(activeId))
        return json({ error: "Choose a saved scouting run." }, 400);
    }
    const getRun = async () => {
      const r = await db
        .from("scout_runs")
        .select(publicColumns)
        .eq("id", activeId)
        .eq("owner_id", owner!)
        .single();
      if (r.error || !r.data) throw new Error("not_found");
      return r.data;
    };
    const before = await getRun();
    if (action === "start" && body.operation)
      return json({ run: before, done: false });
    if (action === "pause" || action === "resume") {
      if (before.status !== "completed") {
        const result = await db
          .from("scout_runs")
          .update({
            status: action === "pause" ? "paused" : "running",
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeId)
          .eq("owner_id", owner);
        if (result.error) throw new Error("storage");
      }
      return json({ run: await getRun(), done: before.status === "completed" });
    }
    if (action === "status" || before.status !== "running")
      return json({ run: before, done: before.status === "completed" });
    const claimed = await db.rpc("aisas_claim_scout_run", {
      p_id: activeId,
      p_owner: owner,
    });
    if (claimed.error) throw new Error("storage");
    if (!claimed.data?.state)
      return json({
        run: { ...(await getRun()), busy: !!claimed.data?.busy },
        done: before.status === "completed",
      });
    lease = claimed.data.lease;
    let config: Record<string, string> = {};
    if (!Deno.env.get("SERPAPI_KEY") || !Deno.env.get("OPENAI_API_KEY")) {
      const r = await db.rpc("aisas_runtime_config");
      if (r.error) throw new Error("configuration");
      config = r.data || {};
    }
    const key = Deno.env.get("SERPAPI_KEY") || config.SERPAPI_KEY;
    if (!key) throw new Error("configuration");
    const deps = {
      key,
      aiKey: Deno.env.get("OPENAI_API_KEY") || config.OPENAI_API_KEY,
      resolve,
      aiModel:
        Deno.env.get("OPENAI_MODEL") || config.OPENAI_MODEL || "gpt-4.1-mini",
    };
    const idealRun = claimed.data.state.goal === "ideal";
    const step = idealRun
      ? await idealScoutStep(claimed.data.state as IdealScoutState, deps)
      : await scoutCoverageStep(claimed.data.state as CoverageState, deps);
    const saved = await db.rpc(
      idealRun ? "aisas_checkpoint_ideal_run" : "aisas_checkpoint_scout_run",
      {
        p_id: activeId,
        p_owner: owner,
        p_lease: lease,
        p_state: step.state,
        p_rows: step.changed,
        ...(idealRun
          ? {
              p_reports: (step as Awaited<ReturnType<typeof idealScoutStep>>)
                .reports,
            }
          : {}),
      },
    );
    if (saved.error) throw new Error("checkpoint");
    lease = undefined;
    const run = await getRun();
    console.info(
      JSON.stringify({
        event: "scout_coverage_step",
        run_id: activeId,
        stats: run.stats,
        reason: run.reason,
      }),
    );
    // count/list_id keep older web clients compatible while newer clients continue the saved run.
    return json({
      run,
      done: run.status === "completed",
      count: run.stats?.saved || 0,
      list_id: run.list_id,
    });
  } catch (e) {
    if (activeId && owner && lease)
      await db
        .from("scout_runs")
        .update({ lease_token: null, lease_until: null })
        .eq("id", activeId)
        .eq("owner_id", owner)
        .eq("lease_token", lease);
    const code = e instanceof Error ? e.message : "";
    return json(
      {
        error:
          code === "not_found"
            ? "Scouting run unavailable."
            : code.startsWith("ideal_ai")
              ? "AI qualification is unavailable. No unqualified leads were saved; check the AI configuration or credits and resume."
              : code === "configuration"
                ? "Scouting configuration is unavailable. Your progress is saved."
                : "This scouting step could not finish. Your saved progress can be resumed.",
      },
      code === "not_found" ? 404 : 503,
    );
  }
});
