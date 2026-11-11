import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  normalizeNylasEvent,
  recordTrackedOpen,
  verifyNylasSignature,
} from "../../../src/campaign-delivery.ts";
let cachedSecret = "",
  expires = 0;
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("challenge")) {
    const challenge = url.searchParams.get("challenge") || "";
    return new Response(challenge, {
      status: challenge.length <= 4096 ? 200 : 400,
      headers: { "Content-Type": "text/plain" },
    });
  }
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    url.pathname.endsWith("/open")
  ) {
    const token = url.searchParams.get("token") || "";
    if (
      req.method === "GET" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      try {
        const db = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        await recordTrackedOpen(db, token);
      } catch {}
    }
    const pixel = Uint8Array.from(
      atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
      (c) => c.charCodeAt(0),
    );
    return new Response(req.method === "HEAD" ? null : pixel, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (Number(req.headers.get("content-length") || 0) > 512000)
    return new Response("Request too large", { status: 413 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 512000)
    return new Response("Request too large", { status: 413 });
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  try {
    if (Date.now() > expires) {
      const r = await db.rpc("aisas_email_webhook_secret");
      if (r.error) throw new Error("configuration");
      cachedSecret = Deno.env.get("NYLAS_WEBHOOK_SECRET") || r.data || "";
      expires = Date.now() + 60000;
    }
    if (
      !(await verifyNylasSignature(
        raw,
        req.headers.get("x-nylas-signature") || "",
        cachedSecret,
      ))
    )
      return new Response("Invalid signature", { status: 401 });
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const event = normalizeNylasEvent(payload);
    if (!event) return Response.json({ accepted: true, ignored: true });
    if (event.source === "message.created") {
      const boxes = await db
        .from("mailboxes")
        .select("id,email")
        .ilike("email", event.sender.replace(/([%_\\])/g, "\\$1"));
      for (const box of boxes.data || []) {
        const grant = await db.rpc("aisas_get_grant", { p_mailbox: box.id });
        if (grant.data === event.grant_id)
          return Response.json({ accepted: true, ignored: true });
      }
    }
    const saved = await db.rpc("aisas_record_email_event", { p_event: event });
    if (saved.error) throw new Error("storage");
    return Response.json({ accepted: true });
  } catch {
    return Response.json(
      { error: "Event could not be recorded; retry delivery." },
      { status: 503 },
    );
  }
});
