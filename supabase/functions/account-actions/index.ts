import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  deleteOwnAccount,
  validateDeletionRequest,
} from "../../../src/account-deletion.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
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
    if (!bearer) return json({ error: "Sign in to manage your account." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!,
      service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await db.auth.getUser(bearer);
    if (authError || !user?.email)
      return json({ error: "Your session expired. Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 5000) return json({ error: "Request too large" }, 413);
    let body;
    try {
      body = JSON.parse(raw);
      validateDeletionRequest(body);
    } catch {
      return json(
        { error: "Type DELETE and enter your current password to confirm." },
        400,
      );
    }
    if (body.action !== "delete-account")
      return json({ error: "Unknown account action" }, 400);
    const check = (result: { error: unknown }) => {
      if (result.error) throw new Error("Account operation failed");
    };
    let config: Record<string, string> = {};
    await deleteOwnAccount(body, {
      reauthenticate: async (password) => {
        // A separate non-persistent client validates the password; never trust a body user ID.
        const auth = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const result = await auth.auth.signInWithPassword({
          email: user.email!,
          password,
        });
        return !result.error && result.data.user?.id === user.id;
      },
      revokeSessions: async () =>
        check(await db.auth.admin.signOut(bearer, "global")),
      freeze: async () =>
        check(
          await db.auth.admin.updateUserById(user.id, { ban_duration: "1h" }),
        ),
      unfreeze: async () =>
        check(
          await db.auth.admin.updateUserById(user.id, { ban_duration: "none" }),
        ),
      pauseAndGetGrants: async () => {
        const r = await db.rpc("aisas_prepare_account_deletion", {
          p_owner: user.id,
        });
        check(r);
        const c = await db.rpc("aisas_runtime_config");
        check(c);
        config = c.data || {};
        return r.data || [];
      },
      removeImages: async () => {
        for (const bucket of ["avatars", "email-signatures"]) {
          for (;;) {
            const listed = await db.storage
              .from(bucket)
              .list(user.id, { limit: 1000 });
            check(listed);
            const files = listed.data || [];
            if (!files.length) break;
            check(
              await db.storage
                .from(bucket)
                .remove(files.map((f) => `${user.id}/${f.name}`)),
            );
          }
        }
      },
      revokeGrant: async (grant) => {
        const key = Deno.env.get("NYLAS_API_KEY") || config.NYLAS_API_KEY;
        if (!key) throw new Error("Email integration unavailable");
        const r = await fetch(
          `https://api.us.nylas.com/v3/grants/${encodeURIComponent(grant)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(20000),
          },
        );
        if (!r.ok && r.status !== 404)
          throw new Error("Email disconnect failed");
      },
      purgeEvents: async () =>
        check(await db.rpc("aisas_purge_account_events", { p_owner: user.id })),
      deleteUser: async () => check(await db.auth.admin.deleteUser(user.id)),
    });
    return json({ deleted: true });
  } catch (error) {
    return json(
      {
        error:
          error instanceof Error &&
          /current password|Account deletion did not complete/.test(
            error.message,
          )
            ? error.message
            : "Account deletion could not be completed. Please sign in again and retry.",
      },
      400,
    );
  }
});
