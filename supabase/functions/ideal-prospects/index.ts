import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { generateIdealCriteria } from "../../../src/ideal-ai.ts";
import { prepareProfile, sequenceProfile } from "../../../src/profile-proof.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!bearer)
      return json({ error: "Sign in to define ideal prospects." }, 401);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const {
      data: { user },
      error,
    } = await db.auth.getUser(bearer);
    if (error || !user)
      return json({ error: "Sign in again to continue." }, 401);
    if (Number(req.headers.get("content-length") || 0) > 30000)
      return json({ error: "Request too large" }, 413);
    const text = await req.text();
    if (text.length > 30000) return json({ error: "Request too large" }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    let profile;
    if (body.profile_id) {
      const p = await db
        .from("scouting_profiles")
        .select("*")
        .eq("id", body.profile_id)
        .eq("owner_id", user.id)
        .single();
      if (p.error || !p.data)
        return json(
          { error: "Choose an audience profile in your own workspace." },
          404,
        );
      profile = p.data;
    } else {
      try {
        profile = prepareProfile({
          ...body.audience_profile,
          id: crypto.randomUUID(),
        });
      } catch {
        return json(
          {
            error:
              "Complete the audience profile before asking AI to define ideal prospects.",
          },
          400,
        );
      }
    }
    const context = sequenceProfile(profile);
    const quota = await db.rpc("aisas_reserve_usage", {
      p_owner: user.id,
      p_kind: "generate-sequence",
    });
    if (quota.error) return json({ error: "Usage check unavailable" }, 503);
    if (!quota.data)
      return json(
        { error: "Daily AI generation limit reached. Try again tomorrow." },
        429,
      );
    const config = await db.rpc("aisas_runtime_config");
    if (config.error)
      return json({ error: "AI configuration unavailable" }, 503);
    const key = Deno.env.get("OPENAI_API_KEY") || config.data?.OPENAI_API_KEY;
    if (!key) return json({ error: "AI generation is not configured." }, 503);
    const criteria = await generateIdealCriteria(
      context,
      key,
      fetch,
      Deno.env.get("OPENAI_MODEL") ||
        config.data?.OPENAI_MODEL ||
        "gpt-4.1-mini",
    );
    return json({ criteria });
  } catch {
    return json(
      {
        error:
          "AI could not define the ideal prospect. Your form is preserved; retry or fill it manually.",
      },
      503,
    );
  }
});
