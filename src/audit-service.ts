import { auditBusiness } from "./audit-evidence.ts";
import {
  auditContext,
  auditInput,
  prepareAuditLeads,
  AUDIT_SEQUENCE_INSTRUCTIONS,
  validAuditSequence,
  type AuditReport,
} from "./audits.ts";
import { idealAIJson } from "./ideal-ai.ts";
import { validateMessages } from "./domain.ts";
import type { Resolver } from "./scout-pages.ts";
export type AuditDb = {
  from: (name: string) => any;
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: any }>;
};
export const AUDIT_REPORT_COLUMNS =
  "lead_id,owner_id,list_id,status,cro_performance,social_performance,issues,best_offer,evidence,findings,limitations,audited_at,last_error";
export async function auditChecked(
  promise: PromiseLike<{ data: any; error: any }>,
) {
  const r = await promise;
  if (r.error) {
    const m = String(r.error.message || "");
    if (
      /^(This list changed|Pause campaigns|A removed lead|Audit list unavailable|An audit is already running|Add leads before|Audit leads require)/.test(
        m,
      )
    )
      throw new Error(m);
    throw new Error(
      "Audit data could not be saved or loaded. Refresh and try again.",
    );
  }
  return r.data;
}
export async function ownedAudit(db: AuditDb, owner: string, list: string) {
  const r = await db
    .from("audit_lists")
    .select("*")
    .eq("id", list)
    .eq("owner_id", owner)
    .maybeSingle();
  if (r.error || !r.data)
    throw new Error("Choose an audit list in your own workspace.");
  return r.data;
}
export async function auditDetail(db: AuditDb, owner: string, list: string) {
  await ownedAudit(db, owner, list);
  const rows = await auditChecked(
    db
      .from("leads")
      .select("*")
      .eq("list_id", list)
      .eq("owner_id", owner)
      .order("created_at")
      .order("id")
      .limit(501),
  );
  const reports = await auditChecked(
    db
      .from("audit_reports")
      .select(AUDIT_REPORT_COLUMNS)
      .eq("list_id", list)
      .eq("owner_id", owner),
  );
  const lists = await auditChecked(
    db.rpc("aisas_list_audits", { p_owner: owner }),
  );
  return {
    list: lists.find((l: any) => l.id === list),
    leads: rows.map((l: any) => ({
      ...l,
      audit_report: reports.find((r: any) => r.lead_id === l.id) || null,
    })),
  };
}
export async function processAudit(
  db: AuditDb,
  deps: {
    key: string;
    searchKey?: string;
    resolve: Resolver;
    model?: string;
    fetcher?: typeof fetch;
  },
  owner?: string,
  list?: string,
) {
  const claim = await auditChecked(
    db.rpc("aisas_claim_audit", {
      p_owner: owner || null,
      p_list: list || null,
    }),
  );
  if (!claim) return { processed: false };
  try {
    const quota = await auditChecked(
      db.rpc("aisas_audit_quota", { p_owner: claim.owner_id, p_kind: "audit" }),
    );
    if (!quota)
      throw new Error("Daily audit limit reached. Retry this list tomorrow.");
    const [lead] = prepareAuditLeads([claim.lead]);
    const result = await auditBusiness(lead, deps);
    const committed = await auditChecked(
      db.rpc("aisas_finish_audit", {
        p_lead: lead.id,
        p_lease: claim.lease,
        p_result: { ...result, input_snapshot: auditInput(lead) },
      }),
    );
    return { processed: true, completed: !!committed };
  } catch (e) {
    const known =
      e instanceof Error &&
      /^(Daily audit limit|Lead \d|Add between)/.test(e.message)
        ? e.message
        : "This audit could not finish. Check the AI connection or credits, then retry the list.";
    await auditChecked(
      db.rpc("aisas_finish_audit", {
        p_lead: claim.lead.id,
        p_lease: claim.lease,
        p_error: known,
      }),
    );
    return { processed: true, completed: false };
  }
}
export async function auditedCampaignData(
  db: AuditDb,
  owner: string,
  listId: string,
) {
  const list = await ownedAudit(db, owner, listId);
  if (list.status !== "audited")
    throw new Error("Finish auditing this list before using it in a campaign.");
  const leads = await auditChecked(
    db
      .from("leads")
      .select("*")
      .eq("list_id", listId)
      .eq("owner_id", owner)
      .order("id")
      .limit(501),
  );
  if (!leads.length || leads.length > 500)
    throw new Error("Choose an audited list with 1–500 leads.");
  const reports: AuditReport[] = await auditChecked(
    db
      .from("audit_reports")
      .select(AUDIT_REPORT_COLUMNS)
      .eq("list_id", listId)
      .eq("owner_id", owner),
  );
  const contexts = new Map<string, ReturnType<typeof auditContext>>();
  for (const lead of leads) {
    const report = reports.find((r) => r.lead_id === lead.id);
    if (!report)
      throw new Error(
        "Audit results are missing for a lead. Audit this list again.",
      );
    contexts.set(lead.id, auditContext(lead, report));
  }
  return { list, leads, contexts };
}
export async function generateAuditedSequence(
  db: AuditDb,
  owner: string,
  listId: string,
  key: string,
  model?: string,
  fetcher: typeof fetch = fetch,
) {
  const { contexts } = await auditedCampaignData(db, owner, listId);
  const sample = [...contexts.values()].slice(0, 8);
  const raw = await idealAIJson(
    AUDIT_SEQUENCE_INSTRUCTIONS,
    { recipient_count: contexts.size, audit_examples: sample },
    key,
    fetcher,
    model,
  );
  if (!validateMessages(raw.messages) || !validAuditSequence(raw.messages))
    throw new Error(
      "AI did not return a complete personalized audited sequence. Generate again.",
    );
  return raw.messages;
}
