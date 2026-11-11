import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { dispatchCampaignBatch } from "../../../src/campaign-delivery.ts";
import { RuntimeConfig } from "../aisas-api/runtime-config.ts";
const config = new RuntimeConfig((k) => Deno.env.get(k));
Deno.serve(async (req) => {
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    await config.load(async () => {
      const r = await db.rpc("aisas_runtime_config");
      if (r.error) throw new Error("configuration");
      return r.data || {};
    });
    if (
      req.headers.get("authorization") !== `Bearer ${config.get("CRON_SECRET")}`
    )
      return new Response("Unauthorized", { status: 401 });
    const raw = await req.text();
    if (raw.length > 1000)
      return new Response("Request too large", { status: 413 });
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return new Response("Invalid request", { status: 400 });
    }
    if (body.campaign_id && !/^[0-9a-f-]{36}$/i.test(body.campaign_id))
      return new Response("Invalid campaign", { status: 400 });
    const result = await dispatchCampaignBatch(
      db,
      config.get("NYLAS_API_KEY"),
      {
        campaignId: body.campaign_id || undefined,
        limit: Number(body.limit) || 5,
        trackingUrl:
          Deno.env.get("SUPABASE_URL") + "/functions/v1/campaign-events/open",
      },
    );
    console.info(JSON.stringify({ event: "campaign_dispatch", ...result }));
    return Response.json(result);
  } catch {
    await db
      .from("campaign_delivery_status")
      .update({
        last_error_code: "worker_unavailable",
        last_run_at: new Date().toISOString(),
      })
      .eq("id", true);
    return Response.json(
      { error: "Delivery worker unavailable. Queued messages remain saved." },
      { status: 503 },
    );
  }
});
