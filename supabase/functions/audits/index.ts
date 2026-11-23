import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { RuntimeConfig } from "../aisas-api/runtime-config.ts";
import {
  AUDIT_FIELDS,
  prepareAuditLeads,
  blankAuditLead,
  auditUrl,
} from "../../../src/audits.ts";
import {
  auditChecked as check,
  ownedAudit,
  auditDetail,
  processAudit,
  generateAuditedSequence,
} from "../../../src/audit-service.ts";
import {
  createScoutState,
  scoutCoverageStep,
} from "../../../src/scout-coverage.ts";
const config = new RuntimeConfig((k) => Deno.env.get(k));
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (v: unknown, status = 200) =>
  Response.json(v, {
    status,
    headers: { ...cors, "Cache-Control": "no-store" },
  });
const isId = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
async function resolve(host: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  const r = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  return r.flatMap((v) => (v.status === "fulfilled" ? v.value : []));
}
function publicRun(r: any) {
  return {
    id: r.id,
    terms: r.terms,
    location: r.location,
    details: r.details,
    method: r.method,
    status: r.status,
    stats: r.state.stats,
    warnings: r.state.warnings,
    reason: r.state.reason,
    leads: r.state.records.map((p: any) => {
      const row = blankAuditLead(p.id);
      const names = String(p.contact_name || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      row.first_name = names.shift() || "";
      row.last_name = names.join(" ");
      row.email = p.email || "";
      row.company = p.company || "";
      row.website = p.website || "";
      row.linkedin = auditUrl(p.linkedin, "linkedin");
      row.location = p.location || r.location;
      row.category = p.category || r.terms;
      row.source_url = p.source_url || "";
      return row;
    }),
  };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let runId: string | undefined,
    lease: string | undefined,
    owner: string | undefined;
  try {
    const token = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!token) return json({ error: "Sign in to use Audits." }, 401);
    const {
      data: { user },
      error,
    } = await db.auth.getUser(token);
    if (error || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    owner = user.id;
    if (Number(req.headers.get("content-length") || 0) > 2000000)
      return json(
        { error: "This list is too large. Split it into smaller lists." },
        413,
      );
    const raw = await req.text();
    if (raw.length > 2000000)
      return json(
        { error: "This list is too large. Split it into smaller lists." },
        413,
      );
    let b: any;
    try {
      b = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    if (!b || typeof b !== "object" || typeof b.action !== "string")
      return json({ error: "Invalid request" }, 400);
    const settings = () =>
      config.load(
        async () => (await check(db.rpc("aisas_runtime_config"))) || {},
      );
    const quota = async (kind: string) => {
      if (
        !(await check(
          db.rpc("aisas_audit_quota", { p_owner: owner, p_kind: kind }),
        ))
      )
        throw new Error("Daily feature limit reached. Try again tomorrow.");
    };
    if (b.action === "audit-lists")
      return json({
        lists: await check(db.rpc("aisas_list_audits", { p_owner: owner })),
      });
    if (b.action === "audit-search")
      return json(
        await check(
          db.rpc("aisas_search_audit_leads", {
            p_owner: owner,
            p_query:
              typeof b.query === "string" ? b.query.trim().slice(0, 200) : "",
            p_offset: Math.max(0, Math.floor(Number(b.offset) || 0)),
            p_audited: b.audited === true,
          }),
        ),
      );
    if (b.action === "audit-save") {
      if (
        !isId(b.list_id) ||
        typeof b.name !== "string" ||
        !b.name.trim() ||
        b.name.trim().length > 160 ||
        !["manual", "file", "ai"].includes(b.source)
      )
        throw new Error("Choose a list name and valid source.");
      const rows = prepareAuditLeads(b.leads);
      const list = await check(
        db.rpc("aisas_save_audit_list", {
          p_owner: owner,
          p_id: b.list_id,
          p_name: b.name.trim(),
          p_source: b.source,
          p_rows: rows,
          p_revision: Number.isInteger(b.revision) ? b.revision : null,
        }),
      );
      return json({ list });
    }
    if (b.action.startsWith("audit-discover")) {
      if (b.action === "audit-discover-list") {
        const rows = await check(
          db
            .from("audit_discovery_runs")
            .select("id,terms,location,method,status,created_at")
            .eq("owner_id", owner)
            .order("created_at", { ascending: false })
            .limit(20),
        );
        return json({ runs: rows });
      }
      if (!isId(b.run_id)) throw new Error("Choose a valid discovery run.");
      runId = b.run_id;
      if (b.action === "audit-discover-start") {
        if (
          typeof b.terms !== "string" ||
          !b.terms.trim() ||
          b.terms.length > 300 ||
          typeof b.location !== "string" ||
          !b.location.trim() ||
          b.location.length > 200 ||
          !["boolean", "google_maps"].includes(b.method)
        )
          throw new Error(
            "Enter a business niche, location and search method.",
          );
        const target = Number(b.target || 25);
        if (!Number.isInteger(target) || target < 1 || target > 500)
          throw new Error("Choose a target of 1–500 leads.");
        const prior = await check(
          db
            .from("audit_discovery_runs")
            .select("*")
            .eq("id", runId)
            .eq("owner_id", owner)
            .maybeSingle(),
        );
        if (prior) return json({ run: publicRun(prior) });
        await quota("discover");
        await settings();
        config.get("SERPAPI_KEY");
        config.get("OPENAI_API_KEY");
        const details =
          typeof b.details === "string" ? b.details.trim().slice(0, 1500) : "";
        const state = createScoutState(
          {
            audience: b.terms.trim() + (details ? `. ${details}` : ""),
            location: b.location.trim(),
          },
          "company",
          {
            target,
            searchBudget: Math.min(100, Math.ceil(target / 3) + 10),
            sourceBudget: Math.min(1000, target * 6 + 20),
            aiBudget: Math.min(1000, target * 3 + 10),
            readPages: true,
            useAI: true,
          },
          b.method,
        );
        const created = await check(
          db
            .from("audit_discovery_runs")
            .insert({
              id: runId,
              owner_id: owner,
              terms: b.terms.trim(),
              location: b.location.trim(),
              details,
              method: b.method,
              state,
            })
            .select("*")
            .single(),
        );
        return json({ run: publicRun(created) });
      }
      const current = await check(
        db
          .from("audit_discovery_runs")
          .select("*")
          .eq("id", runId)
          .eq("owner_id", owner)
          .single(),
      );
      if (
        b.action === "audit-discover-pause" ||
        b.action === "audit-discover-resume"
      ) {
        const status = b.action.endsWith("pause") ? "paused" : "running";
        const updated = await check(
          db
            .from("audit_discovery_runs")
            .update({ status, updated_at: new Date().toISOString() })
            .eq("id", runId)
            .eq("owner_id", owner)
            .select("*")
            .single(),
        );
        return json({ run: publicRun(updated) });
      }
      if (b.action === "audit-discover-status" || current.status !== "running")
        return json({ run: publicRun(current) });
      if (b.action !== "audit-discover-continue")
        throw new Error("Unsupported discovery action.");
      const claim = await check(
        db.rpc("aisas_claim_audit_discovery", { p_owner: owner, p_id: runId }),
      );
      if (!claim?.state)
        return json({ run: publicRun(current), busy: !!claim?.busy });
      lease = claim.lease;
      await settings();
      const result = await scoutCoverageStep(claim.state, {
        key: config.get("SERPAPI_KEY"),
        aiKey: config.get("OPENAI_API_KEY"),
        resolve,
      });
      const updated = await check(
        db
          .from("audit_discovery_runs")
          .update({
            state: result.state,
            ...(result.state.done ? { status: "completed" } : {}),
            lease_token: null,
            lease_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId)
          .eq("owner_id", owner)
          .eq("lease_token", lease)
          .select("*")
          .single(),
      );
      lease = undefined;
      return json({ run: publicRun(updated) });
    }
    if (!isId(b.list_id)) throw new Error("Choose an audit list.");
    await ownedAudit(db, owner, b.list_id);
    if (b.action === "audit-detail")
      return json(await auditDetail(db, owner, b.list_id));
    if (b.action === "audit-start") {
      await settings();
      config.get("OPENAI_API_KEY");
      await check(
        db.rpc("aisas_start_audit", { p_owner: owner, p_list: b.list_id }),
      );
      await check(db.rpc("aisas_request_audit_worker"));
      return json({
        started: true,
        ...(await auditDetail(db, owner, b.list_id)),
      });
    }
    if (b.action === "audit-step") {
      await settings();
      const result = await processAudit(
        db,
        {
          key: config.get("OPENAI_API_KEY"),
          searchKey: (() => {
            try {
              return config.get("SERPAPI_KEY");
            } catch {
              return undefined;
            }
          })(),
          resolve,
        },
        owner,
        b.list_id,
      );
      return json({ ...result, ...(await auditDetail(db, owner, b.list_id)) });
    }
    if (b.action === "audit-sequence") {
      await quota("sequence");
      await settings();
      const messages = await generateAuditedSequence(
        db,
        owner,
        b.list_id,
        config.get("OPENAI_API_KEY"),
        Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini",
      );
      return json({ messages });
    }
    return json({ error: "Unknown Audits action" }, 400);
  } catch (e) {
    if (runId && lease)
      await db
        .from("audit_discovery_runs")
        .update({ lease_token: null, lease_until: null })
        .eq("id", runId)
        .eq("owner_id", owner)
        .eq("lease_token", lease);
    const message =
      e instanceof Error ? e.message : "Audits is temporarily unavailable.";
    return json(
      {
        error: /^(?:ideal_ai|storage|configuration)/.test(message)
          ? "AI discovery could not finish. Your progress is saved; check the connection and resume."
          : message,
      },
      400,
    );
  }
});
