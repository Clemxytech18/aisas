import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  verifyEmailAddress,
  EmailVerificationError,
} from "./email-verification.ts";
// This endpoint only verifies saved prospect addresses. It has no campaign/send actions.
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
  const bearer = req.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer)
    return json({ error: "Sign in to verify an email address." }, 401);
  try {
    const url = Deno.env.get("SUPABASE_URL"),
      serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey)
      return json({ error: "Verification service is unavailable." }, 503);
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Validate ES256/legacy user tokens with Supabase Auth before any data/config access.
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    if (Number(req.headers.get("content-length") || 0) > 2000)
      return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 2000) return json({ error: "Request too large" }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid verification request" }, 400);
    }
    if (
      typeof body?.lead_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        body.lead_id,
      )
    )
      return json({ error: "Choose a saved prospect to verify." }, 400);
    const { data: lead, error: leadError } = await db
      .from("leads")
      .select("id,email")
      .eq("id", body.lead_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (leadError) throw new Error("Lead lookup failed");
    if (!lead)
      return json(
        { error: "This prospect was not found in your workspace." },
        404,
      );
    if (!lead.email)
      return json(
        { error: "No email address is available for this prospect." },
        400,
      );
    const quota = await db.rpc("aisas_reserve_usage", {
      p_owner: user.id,
      p_kind: "verify-email",
    });
    if (quota.error) throw new Error("Usage check failed");
    if (!quota.data)
      return json(
        { error: "Daily verification limit reached. Try again tomorrow." },
        429,
      );
    let key = Deno.env.get("ZEROBOUNCE_API_KEY");
    if (!key) {
      // Read only the verifier credential, never the platform's email-sending credentials.
      const config = await db.rpc("aisas_email_verification_key");
      if (config.error) throw new Error("Verifier configuration unavailable");
      key = config.data || undefined;
    }
    const result = await verifyEmailAddress(lead.email, key);
    const fields = {
      email_verification_status: result.status,
      email_verification_reason: result.reason,
      email_verification_provider: result.provider,
      email_verification_address: lead.email,
      email_verification_checked_at: new Date().toISOString(),
    };
    const saved = await db
      .from("leads")
      .update(fields)
      .eq("id", lead.id)
      .eq("owner_id", user.id)
      .eq("email", lead.email)
      .select("id")
      .maybeSingle();
    if (saved.error) throw new Error("Could not save verification");
    if (!saved.data)
      return json(
        {
          error:
            "This email changed during verification. Refresh the list and try again.",
        },
        409,
      );
    return json({ lead_id: lead.id, email: lead.email, ...fields });
  } catch (e) {
    if (e instanceof EmailVerificationError)
      return json({ error: e.message, code: e.code }, e.httpStatus);
    console.error(
      "Email verification request failed",
      e instanceof Error ? e.name : "Error",
    );
    return json(
      { error: "Email verification could not be completed. Please try again." },
      500,
    );
  }
});
