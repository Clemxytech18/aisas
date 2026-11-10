import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { validateMessages } from "../../../src/domain.ts";
import {
  sequenceProfile,
  withProfileProof,
  SEQUENCE_INSTRUCTIONS,
} from "../../../src/profile-proof.ts";
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
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!bearer) return json({ error: "Sign in to generate a sequence." }, 401);
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user)
      return json({ error: "Your session expired. Sign in again." }, 401);
    if (Number(req.headers.get("content-length") || 0) > 10000)
      return json({ error: "Request too large" }, 413);
    const raw = await req.text();
    if (raw.length > 10000) return json({ error: "Request too large" }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request" }, 400);
    }
    const { data: profile, error: profileError } = await db
      .from("scouting_profiles")
      .select("*")
      .eq("id", body.profile_id)
      .eq("owner_id", user.id)
      .single();
    if (profileError || !profile)
      return json(
        { error: "Choose a service profile in your own workspace." },
        404,
      );
    let context;
    try {
      context = sequenceProfile(profile);
    } catch {
      return json(
        {
          error:
            "Review your profile fields and optional links before generating.",
        },
        400,
      );
    }
    const quota = await db.rpc("aisas_reserve_usage", {
      p_owner: user.id,
      p_kind: "generate-sequence",
    });
    if (quota.error)
      return json({ error: "Usage check unavailable. Please retry." }, 503);
    if (!quota.data)
      return json(
        { error: "Daily AI generation limit reached. Try again tomorrow." },
        429,
      );
    const config = await db.rpc("aisas_runtime_config");
    if (config.error)
      return json({ error: "AI configuration unavailable." }, 503);
    const key = Deno.env.get("OPENAI_API_KEY") || config.data?.OPENAI_API_KEY;
    if (!key)
      return json({ error: "AI generation is not configured yet." }, 503);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:
          Deno.env.get("OPENAI_MODEL") ||
          config.data?.OPENAI_MODEL ||
          "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SEQUENCE_INSTRUCTIONS },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
      return json(
        {
          error:
            "AI generation is unavailable. Please retry or check your provider credits.",
        },
        502,
      );
    const completion = await response.json();
    const messages = JSON.parse(
      completion.choices?.[0]?.message?.content || "{}",
    ).messages;
    if (!Array.isArray(messages) || !validateMessages(messages))
      return json(
        { error: "AI returned an incomplete sequence. Please generate again." },
        502,
      );
    return json({ messages: withProfileProof(messages, profile) });
  } catch {
    return json(
      { error: "The sequence could not be generated. Please try again." },
      500,
    );
  }
});
