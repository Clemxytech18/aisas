import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { RuntimeConfig } from "../aisas-api/runtime-config.ts";
import { processAudit, auditChecked } from "../../../src/audit-service.ts";
const config = new RuntimeConfig((k) => Deno.env.get(k));
async function resolve(host: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  const r = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  return r.flatMap((v) => (v.status === "fulfilled" ? v.value : []));
}
Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  try {
    await config.load(
      async () => (await auditChecked(db.rpc("aisas_runtime_config"))) || {},
    );
    if (
      req.headers.get("authorization") !== `Bearer ${config.get("CRON_SECRET")}`
    )
      return new Response("Unauthorized", { status: 401 });
    const result = await processAudit(db, {
      key: config.get("OPENAI_API_KEY"),
      searchKey: (() => {
        try {
          return config.get("SERPAPI_KEY");
        } catch {
          return undefined;
        }
      })(),
      resolve,
    });
    return Response.json(result);
  } catch {
    return Response.json(
      { error: "Audit worker unavailable. Saved audits can be resumed." },
      { status: 503 },
    );
  }
});
