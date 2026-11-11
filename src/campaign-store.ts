import type { SupabaseClient } from "@supabase/supabase-js";
import type { Campaign } from "./domain";

export async function saveCampaignRecord(
  client: Pick<SupabaseClient, "auth" | "from">,
  campaign: Campaign,
): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    throw new Error("Please sign in before saving a campaign.");
  const row = {
    name: campaign.name,
    list_id: campaign.list_id || null,
    profile_id: campaign.profile_id || null,
    mailbox_id: campaign.mailbox_id || null,
    start_at: campaign.start_at || null,
    messages: campaign.messages,
    approved: campaign.approved,
  };
  const { data: existing, error: readError } = await client
    .from("campaigns")
    .select("id")
    .eq("id", campaign.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) throw readError;
  // Upsert would require UPDATE on id/owner_id even when creating a new row.
  // The database deliberately reserves those columns and status for trusted server code.
  const result = existing
    ? await client
        .from("campaigns")
        .update(row)
        .eq("id", campaign.id)
        .eq("owner_id", user.id)
        .select("id")
        .single()
    : await client
        .from("campaigns")
        .insert({ id: campaign.id, owner_id: user.id, ...row })
        .select("id")
        .single();
  if (result.error) throw result.error;
}
