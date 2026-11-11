import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { Workspace, Campaign } from "./domain";
export async function loadWorkspace(): Promise<Workspace> {
  const tables = [
    "scouting_profiles",
    "lead_lists",
    "leads",
    "campaigns",
    "mailboxes",
  ] as const;
  const data = await Promise.all(
    tables.map(async (t) => {
      if (t !== "leads")
        return supabase
          .from(t)
          .select("*")
          .order("created_at", { ascending: false });
      // Supabase caps each response; fetch every page so larger scouts remain visible.
      const rows: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await supabase
          .from(t)
          .select("*")
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499);
        if (result.error) return result;
        rows.push(...(result.data || []));
        if ((result.data?.length || 0) < 500)
          return { data: rows, error: null };
      }
    }),
  );
  data.forEach((r) => {
    if (r.error) throw r.error;
  });
  return {
    profiles: data[0].data || [],
    lists: data[1].data || [],
    leads: data[2].data || [],
    campaigns: (data[3].data || []).map((c) => ({ ...c, sent: 0 })),
    mailboxes: data[4].data || [],
  };
}
export async function persistRow(table: string, row: Record<string, unknown>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in first.");
  const { error } = await supabase
    .from(table)
    .upsert({ ...row, owner_id: user.id });
  if (error) throw error;
}
export async function saveCampaign(c: Campaign) {
  const row = {
    name: c.name,
    list_id: c.list_id || null,
    profile_id: c.profile_id || null,
    mailbox_id: c.mailbox_id || null,
    start_at: c.start_at || null,
    messages: c.messages,
    approved: c.approved,
  };
  const { data: existing, error: readError } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", c.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    const { error } = await supabase
      .from("campaigns")
      .update(row)
      .eq("id", c.id)
      .select("id")
      .single();
    if (error) throw error;
  } else {
    await persistRow("campaigns", { id: c.id, ...row });
  }
}
export const saveDemo = (w: Workspace) =>
  AsyncStorage.setItem("aisas.demo.v1", JSON.stringify(w));
