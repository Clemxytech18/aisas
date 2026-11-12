import {
  createScoutState,
  scoutCoverageStep,
  type CoverageState,
  type StoredProspect,
  type StepDependencies,
} from "./scout-coverage.ts";
import { candidateSources, addIdealEvidence } from "./ideal-evidence.ts";
import { qualifyIdealCandidates, type IdealSearchPlan } from "./ideal-ai.ts";
import {
  prepareIdealCriteria,
  type IdealCriteria,
  type IdealQualification,
  type ProspectEvidence,
} from "./ideal-profile.ts";
import { hasProspectContact } from "./prospect-contact.ts";
import type { ScoutMethod, ScoutOptions } from "./scout-types.ts";
import type { ProspectKind } from "./prospect-pool.ts";
export type IdealScoutState = CoverageState & {
  goal: "ideal";
  ideal_profile_id: string;
  ideal_profile_name: string;
  criteria: IdealCriteria;
  discovery: CoverageState;
  qualifiedIds: string[];
  assessed: Record<
    string,
    {
      version: number;
      qualified: boolean;
      unknown: boolean;
      excerpts: ProspectEvidence[];
    }
  >;
  qualificationRequests: number;
};
export function createIdealScoutState(
  profile: { audience: string; location: string },
  kind: ProspectKind,
  options: ScoutOptions,
  method: ScoutMethod,
  ideal: { id: string; name: string },
  criteria: IdealCriteria,
  plan: IdealSearchPlan,
): IdealScoutState {
  if (!options.readPages || !options.useAI || options.aiBudget < 1)
    throw new Error(
      "Ideal Prospects requires public-page reading and AI qualification.",
    );
  const discovery = createScoutState(
    { ...profile, audience: plan.business_terms[0] },
    kind,
    { ...options, target: 1000, useAI: false },
    method,
  );
  discovery.collectEvidence = true;
  discovery.collectReviews =
    method === "google_maps" &&
    /review|feedback|testimonial/i.test(
      criteria.prospecting_signals + " " + criteria.buying_triggers,
    );
  if (method === "boolean") {
    const literal = (s: string) => '"' + s.replace(/["\\\r\n]/g, " ") + '"';
    const focus = plan.business_terms[0] + " " + profile.location;
    const extra = [
      ...plan.role_terms.map((t) => `${focus} ${literal(t)}`),
      ...plan.signal_terms.map((t) => `${focus} ${literal(t)}`),
    ].map((q) => ({
      engine: "google" as const,
      params: { q },
      purpose: "discovery" as const,
      page: 1,
    }));
    discovery.searches.splice(2, 0, ...extra);
  } else
    for (const term of plan.business_terms.slice(1))
      discovery.searches.push({
        engine: "google_maps",
        params: {
          q: `${term} ${profile.location}`,
          type: "search",
          start: "0",
          hl: "en",
        },
        purpose: "discovery",
        page: 1,
      });
  return {
    ...createScoutState(profile, kind, options, method),
    goal: "ideal",
    ideal_profile_id: ideal.id,
    ideal_profile_name: ideal.name,
    criteria: prepareIdealCriteria(criteria),
    discovery,
    qualifiedIds: [],
    assessed: {},
    qualificationRequests: 0,
  };
}
export async function idealScoutStep(
  state: IdealScoutState,
  deps: StepDependencies & { aiModel?: string },
): Promise<{
  state: IdealScoutState;
  changed: StoredProspect[];
  reports: { lead_id: string; report: IdealQualification }[];
}> {
  if (state.done) return { state, changed: [], reports: [] };
  if (!deps.aiKey) throw new Error("ideal_ai_authentication");
  if (
    state.discovery.reviewTasks?.length &&
    state.discovery.stats.search_requests < state.options.searchBudget
  ) {
    const task = state.discovery.reviewTasks.shift()!;
    (state.discovery.reviewed ||= []).push(task.id);
    const url = new URL("https://serpapi.com/search");
    url.searchParams.set("engine", "google_maps_reviews");
    url.searchParams.set("hl", "en");
    url.searchParams.set("num", "10");
    url.searchParams.set(
      task.data_id ? "data_id" : "place_id",
      task.data_id || task.place_id!,
    );
    url.searchParams.set("api_key", deps.key);
    state.discovery.stats.search_requests++;
    try {
      const r = await (deps.fetcher || fetch)(url, {
        signal: AbortSignal.timeout(25000),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error("reviews");
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      for (const review of reviews.slice(0, 10)) {
        const text = String(
          review.snippet || review.extracted_snippet?.original || "",
        );
        if (text)
          addIdealEvidence(state.discovery, [task.id], {
            url: task.url,
            kind: "review",
            text:
              "Public review (" +
              String(review.date || "date unavailable") +
              "): " +
              text,
          });
      }
    } catch {
      state.discovery.stats.provider_errors++;
      if (
        !state.discovery.warnings.includes(
          "Some public review evidence was unavailable; missing signals remain unknown.",
        )
      )
        state.discovery.warnings.push(
          "Some public review evidence was unavailable; missing signals remain unknown.",
        );
    }
    state.stats = {
      ...state.discovery.stats,
      saved: state.qualifiedIds.length,
      qualified: state.qualifiedIds.length,
      analyzed: Object.keys(state.assessed).length,
      qualification_requests: state.qualificationRequests,
      ai_requests: state.qualificationRequests + 1,
    };
    state.warnings = [...state.discovery.warnings];
    return { state, changed: [], reports: [] };
  }
  if (state.discovery.stats.search_requests >= state.options.searchBudget)
    state.discovery.reviewTasks = [];
  const ready = state.discovery.records.filter(
    (p) =>
      hasProspectContact(p) &&
      !state.qualifiedIds.includes(p.id) &&
      state.assessed[p.id]?.version !==
        (state.discovery.evidenceVersions?.[p.id] || 0) &&
      (state.discovery.done ||
        !state.discovery.options.readPages ||
        state.discovery.stats.source_attempts >=
          state.discovery.options.sourceBudget ||
        !state.discovery.pages.some(
          (t) => t.companyId === p.id || t.evidenceIds?.includes(p.id),
        )),
  );
  const changed: StoredProspect[] = [],
    reports: { lead_id: string; report: IdealQualification }[] = [];
  if (ready.length) {
    if (state.qualificationRequests >= state.options.aiBudget) {
      state.done = true;
      state.reason = "qualification_budget_reached";
      return { state, changed, reports };
    }
    const batch = ready.slice(
      0,
      Math.min(3, state.options.target - state.qualifiedIds.length),
    );
    const candidates = batch.map((p) => ({
      id: p.id,
      company: p.company,
      contact_name: p.contact_name,
      location: p.location,
      sources: [
        ...(state.assessed[p.id]?.excerpts || []),
        ...candidateSources(state.discovery, p.id),
      ].slice(-10),
    }));
    const results = await qualifyIdealCandidates(
      candidates,
      state.criteria,
      deps.aiKey,
      deps.fetcher,
      deps.aiModel,
      state.profile,
    );
    state.qualificationRequests++;
    for (const result of results) {
      const p = batch.find((c) => c.id === result.id)!;
      const report = {
        ...result.report,
        ideal_profile_id: state.ideal_profile_id,
        profile_name: state.ideal_profile_name,
      };
      state.assessed[p.id] = {
        version: state.discovery.evidenceVersions?.[p.id] || 0,
        qualified: report.qualified,
        unknown: report.checks.some((c) => c.status === "unknown"),
        excerpts: report.checks
          .flatMap((c) =>
            c.evidence.map((e) => ({
              url: e.url,
              text: e.quote,
              kind: e.kind,
            })),
          )
          .slice(0, 8),
      };
      if (report.qualified) {
        state.qualifiedIds.push(p.id);
        changed.push({
          ...p,
          ...(report.decision_maker_name
            ? {
                contact_name: report.decision_maker_name,
                job_title: report.decision_maker_role || p.job_title,
              }
            : {}),
        });
        reports.push({ lead_id: p.id, report });
      }
    }
  } else if (!state.discovery.done) {
    state.discovery = (await scoutCoverageStep(state.discovery, deps)).state;
  }
  state.stats = {
    ...state.discovery.stats,
    ai_requests: state.qualificationRequests + 1,
    qualification_requests: state.qualificationRequests,
    saved: state.qualifiedIds.length,
    qualified: state.qualifiedIds.length,
    analyzed: Object.keys(state.assessed).length,
    rejected: Object.values(state.assessed).filter(
      (a) => !a.qualified && !a.unknown,
    ).length,
    insufficient_evidence: Object.values(state.assessed).filter(
      (a) => !a.qualified && a.unknown,
    ).length,
  };
  state.warnings = [...state.discovery.warnings];
  if (state.stats.insufficient_evidence)
    state.warnings.push(
      "Candidates with missing or unverified criteria remain unqualified. Refine the ideal profile or increase source coverage to gather more evidence.",
    );
  if (state.qualifiedIds.length >= state.options.target) {
    state.done = true;
    state.reason = "qualified_target_reached";
  } else if (
    state.discovery.done &&
    !state.discovery.records.some(
      (p) =>
        hasProspectContact(p) &&
        !state.qualifiedIds.includes(p.id) &&
        state.assessed[p.id]?.version !==
          (state.discovery.evidenceVersions?.[p.id] || 0),
    )
  ) {
    state.done = true;
    state.reason = state.discovery.reason || "sources_exhausted";
  }
  return { state, changed, reports };
}
