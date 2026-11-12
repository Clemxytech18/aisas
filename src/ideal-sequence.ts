import type { IdealCriteria } from "./ideal-profile.ts";
export async function sequenceIdealCriteria(
  db: { from: (table: string) => any },
  owner: string,
  listId: unknown,
): Promise<IdealCriteria[]> {
  if (!listId) return [];
  const list = await db
    .from("lead_lists")
    .select("id")
    .eq("id", listId)
    .eq("owner_id", owner)
    .maybeSingle();
  if (list.error || !list.data) throw new Error("owned_list");
  const leads = await db
    .from("leads")
    .select("id")
    .eq("list_id", listId)
    .eq("owner_id", owner)
    .limit(1000);
  if (leads.error) throw new Error("storage");
  if (!leads.data?.length) return [];
  const reports = await db
    .from("ideal_qualifications")
    .select("report")
    .eq("owner_id", owner)
    .in(
      "lead_id",
      leads.data.map((l: any) => l.id),
    );
  if (reports.error) throw new Error("storage");
  const unique = new Map<string, IdealCriteria>();
  for (const q of reports.data || []) {
    if (q.report?.qualified && q.report?.criteria)
      unique.set(JSON.stringify(q.report.criteria), q.report.criteria);
  }
  return [...unique.values()].slice(0, 3);
}
