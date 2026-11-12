export const IDEAL_FIELDS = [
  [
    "business",
    "Business",
    "Independent residential HVAC contractors offering AC repair, heating repair, maintenance, and system replacement estimates",
  ],
  [
    "decision_maker",
    "Decision-maker",
    "Owner, general manager, or service manager who oversees scheduling and dispatch",
  ],
  [
    "starting_segment",
    "Starting segment",
    "Local companies with roughly 3–20 field technicians and a small office team",
  ],
  [
    "main_problem",
    "Main problem",
    "Calls go to voicemail while the office is busy or closed. By the time someone follows up, the homeowner may have booked another contractor.",
  ],
  [
    "secondary_problem",
    "Secondary problem",
    "Staff spend time confirming appointments, sending reminders, and coordinating reschedules.",
  ],
  [
    "buying_triggers",
    "Buying triggers",
    "Peak-season demand, paid ads driving more calls, recurring after-hours inquiries, or an office team struggling to keep up",
  ],
  [
    "prospecting_signals",
    "Prospecting signals",
    "A phone-first website, a callback form as the main booking option, limited office hours, or public reviews mentioning slow callbacks",
  ],
] as const;
export type IdealArea = (typeof IDEAL_FIELDS)[number][0];
export type IdealCriteria = Record<IdealArea, string>;
export type IdealProfile = IdealCriteria & {
  id: string;
  name: string;
  audience_profile_id: string;
  created_at?: string;
};
export const emptyIdealCriteria = (): IdealCriteria =>
  Object.fromEntries(IDEAL_FIELDS.map(([key]) => [key, ""])) as IdealCriteria;
export function prepareIdealCriteria(raw: unknown): IdealCriteria {
  if (!raw || typeof raw !== "object")
    throw new Error("Complete all seven ideal-prospect fields.");
  const out = emptyIdealCriteria();
  for (const [key, label] of IDEAL_FIELDS) {
    const value = (raw as any)[key];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > 2000
    )
      throw new Error(`${label} must contain 1–2,000 characters.`);
    out[key] = value.trim();
  }
  return out;
}
export type ProspectEvidence = {
  url: string;
  text: string;
  kind: "website" | "listing" | "search" | "review";
};
export type FitCheck = {
  area: IdealArea;
  status: "match" | "mismatch" | "unknown";
  reason: string;
  evidence: { url: string; quote: string; kind: ProspectEvidence["kind"] }[];
};
export type IdealQualification = {
  qualified: boolean;
  score: number;
  checks: FitCheck[];
  criteria: IdealCriteria;
  ideal_profile_id?: string;
  profile_name?: string;
  assessed_at: string;
  decision_maker_name?: string;
  decision_maker_role?: string;
};
const norm = (s: string) =>
  s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
export const IDEAL_WEIGHTS: Record<IdealArea, number> = {
  business: 25,
  decision_maker: 15,
  starting_segment: 20,
  main_problem: 10,
  secondary_problem: 5,
  buying_triggers: 10,
  prospecting_signals: 15,
};
export function groundQualification(
  raw: any,
  criteria: IdealCriteria,
  sources: ProspectEvidence[],
  now = new Date(),
): IdealQualification {
  const checks: FitCheck[] = IDEAL_FIELDS.map(([area]) => {
    const value = Array.isArray(raw?.checks)
      ? raw.checks.find((c: any) => c?.area === area)
      : null;
    const evidence: FitCheck["evidence"] = [];
    for (const item of Array.isArray(value?.evidence)
      ? value.evidence.slice(0, 2)
      : []) {
      const quote = typeof item?.quote === "string" ? item.quote.trim() : "";
      const source = sources.find(
        (s) =>
          s.url === item?.url &&
          norm(s.text).includes(norm(quote)) &&
          !(
            s.kind === "review" &&
            ["business", "decision_maker", "starting_segment"].includes(area)
          ),
      );
      if (
        source &&
        quote.length >= 8 &&
        quote.length <= 400 &&
        norm(source.text).includes(norm(quote))
      )
        evidence.push({ url: source.url, quote, kind: source.kind });
    }
    const status: FitCheck["status"] =
      evidence.length && ["match", "mismatch"].includes(value?.status)
        ? value.status
        : "unknown";
    return {
      area,
      status,
      reason:
        status === "unknown"
          ? "Insufficient published evidence to verify this criterion."
          : String(value?.reason || "Source-backed assessment.").slice(0, 350),
      evidence: status === "unknown" ? [] : evidence,
    };
  });
  const score = checks.reduce(
    (n, c) => n + (c.status === "match" ? IDEAL_WEIGHTS[c.area] : 0),
    0,
  );
  const core = ["business", "decision_maker", "starting_segment"];
  const qualified =
    score >= 70 &&
    core.every((area) =>
      checks.some((c) => c.area === area && c.status === "match"),
    ) &&
    checks.some(
      (c) =>
        [
          "main_problem",
          "secondary_problem",
          "buying_triggers",
          "prospecting_signals",
        ].includes(c.area) && c.status === "match",
    );
  const dm = checks.find((c) => c.area === "decision_maker")!;
  const name = String(raw?.decision_maker_name || "")
      .trim()
      .slice(0, 200),
    role = String(raw?.decision_maker_role || "")
      .trim()
      .slice(0, 200);
  const named =
    dm.status === "match" &&
    name &&
    role &&
    dm.evidence.some(
      (e) =>
        norm(e.quote).includes(norm(name)) &&
        norm(e.quote).includes(norm(role)),
    );
  return {
    qualified,
    score,
    checks,
    criteria: prepareIdealCriteria(criteria),
    assessed_at: now.toISOString(),
    ...(named ? { decision_maker_name: name, decision_maker_role: role } : {}),
  };
}
export function idealObservation(
  report?: Partial<IdealQualification> | null,
): string {
  if (!report?.qualified) return "";
  const priority: IdealArea[] = [
    "prospecting_signals",
    "buying_triggers",
    "main_problem",
    "secondary_problem",
    "business",
  ];
  for (const area of priority) {
    const e = report.checks?.find(
      (c) => c.area === area && c.status === "match",
    )?.evidence[0];
    if (!e) continue;
    const label =
      e.kind === "review"
        ? "A public review"
        : e.kind === "listing"
          ? "Your public business listing"
          : e.kind === "search"
            ? "A public search result for your business"
            : "Your website";
    return `${label} mentions: “${e.quote}”`;
  }
  return "";
}
export const IDEAL_SEQUENCE_GUIDANCE =
  "When ideal_criteria is supplied, tailor the offer and all four messages to that target business, decision-maker, segment and potential needs. Those criteria are targeting hypotheses, not facts about a recipient. Include {{ideal_observation}} naturally in the first message; AISAS replaces it with a verified, cited observation for each qualified recipient. Never invent staffing, missed calls, budgets, buying intent, private operations or review content. Frame possible needs conditionally, never as established problems. Do not add other prospect-specific factual claims beyond the supplied verified context and personalization tokens.";
export function withIdealObservation<T extends { step: number; body: string }>(
  messages: T[],
): T[] {
  return messages.map((m) =>
    m.step === 0 && !m.body.includes("{{ideal_observation}}")
      ? { ...m, body: `{{ideal_observation}}\n\n${m.body}` }
      : m,
  );
}
