import { hasProspectContact } from "./prospect-contact.ts";
import type { ProspectKind } from "./prospect-pool.ts";
import { publicProspects } from "./scout-prospects.ts";
import { coverageQueries, nextSearchTask, serpApiUrl } from "./scout-query.ts";
import {
  aiPageProspects,
  aiSearchProspects,
  parseSource,
  readSource,
  sourceUrl,
  type Resolver,
} from "./scout-pages.ts";
import {
  scoutOptions,
  emptyScoutStats,
  type ScoutState,
  type ScoutOptions,
  type ScoutProspect,
  type SearchTask,
} from "./scout-types.ts";
export type StoredProspect = ScoutProspect & { id: string };
export type CoverageState = ScoutState & {
  records: StoredProspect[];
  identities: Record<string, number>;
  resultPages: string[];
  aiPages: { url: string; text: string; title: string }[];
  aiDisabled?: boolean;
  enrichmentNames?: string[];
};
export function createScoutState(
  profile: { audience: string; location: string },
  kind: ProspectKind,
  options: Partial<ScoutOptions> = {},
): CoverageState {
  return {
    version: 1,
    profile,
    kind,
    options: scoutOptions(options),
    searches: coverageQueries(profile, kind).map((q) => ({ ...q, page: 1 })),
    pages: [],
    searched: [],
    visited: [],
    seen: [],
    robots: {},
    stats: emptyScoutStats(),
    reason: null,
    warnings: [],
    done: false,
    records: [],
    identities: {},
    resultPages: [],
    aiPages: [],
  };
}
const norm = (s: string) =>
  s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export function prospectIdentity(p: ScoutProspect) {
  return p.prospect_kind === "person"
    ? `p:${norm(p.contact_name)}|${norm(p.company)}`
    : `c:${norm(p.company)}`;
}
export type StepDependencies = {
  key: string;
  aiKey?: string;
  fetcher?: typeof fetch;
  resolve: Resolver;
  now?: () => number;
};
export async function scoutCoverageStep(
  state: CoverageState,
  deps: StepDependencies,
): Promise<{ state: CoverageState; changed: StoredProspect[] }> {
  if (state.done) return { state, changed: [] };
  const fetcher = deps.fetcher || fetch,
    now = deps.now || Date.now,
    changed = new Map<string, StoredProspect>();
  let eligibleCount = state.records.filter(hasProspectContact).length;
  let aiThisStep = 0;
  const snippets: Record<string, any>[] = [];
  const snippetFallback: ScoutProspect[] = [];
  const aiActive =
    state.options.useAI &&
    !!deps.aiKey &&
    !state.aiDisabled &&
    state.stats.ai_requests < state.options.aiBudget;
  const warning = (message: string) => {
    if (!state.warnings.includes(message)) state.warnings.push(message);
  };
  function queueContactSearch(p: ScoutProspect) {
    if (hasProspectContact(p) || p.prospect_kind !== "person") return;
    const names = state.enrichmentNames || (state.enrichmentNames = []);
    const identity = prospectIdentity(p);
    if (
      names.includes(identity) ||
      names.length >= Math.min(20, Math.floor(state.options.searchBudget / 2))
    )
      return;
    names.push(identity);
    const literal = (s: string) =>
      '"' + s.replace(/["\\\r\n]/g, " ").slice(0, 200) + '"';
    state.searches.splice(Math.min(1, state.searches.length), 0, {
      engine: "google",
      purpose: "contact",
      page: 1,
      params: {
        q: `${literal(p.contact_name)} ${p.company ? literal(p.company) : ""} ${state.profile.location} ("email" OR "phone" OR "contact" OR "@")`,
      },
    });
  }
  function accept(p: ScoutProspect) {
    if (state.kind === "person" && !p.contact_name) return;
    state.stats.people_identified++;
    queueContactSearch(p);
    const identity = prospectIdentity(p),
      known = state.identities[identity];
    if (known !== undefined) {
      state.stats.duplicates++;
      const existing = state.records[known];
      let updated = false;
      const hadContact = hasProspectContact(existing);
      if (!hadContact && eligibleCount >= state.options.target) return;
      for (const key of [
        "email",
        "phone",
        "website",
        "linkedin",
        "job_title",
        "company",
        "industry",
        "department",
        "seniority",
        "domain",
      ] as const)
        if (!existing[key] && p[key]) {
          (existing as any)[key] = p[key];
          updated = true;
        }
      if (!hadContact && hasProspectContact(existing)) eligibleCount++;
      if (updated && hasProspectContact(existing))
        changed.set(existing.id, existing);
      return;
    }
    if (hasProspectContact(p) && eligibleCount >= state.options.target) return;
    if (
      !hasProspectContact(p) &&
      state.records.length >= state.options.target + 2000
    )
      return;
    const record = { ...p, id: crypto.randomUUID() };
    state.identities[identity] = state.records.length;
    state.records.push(record);
    if (hasProspectContact(record)) {
      eligibleCount++;
      changed.set(record.id, record);
    } else record.summary = record.summary.slice(0, 300);
  }
  function page(url: string, depth = 0, priority = false) {
    const safe = sourceUrl(url);
    if (
      !state.options.readPages ||
      !safe ||
      state.visited.includes(safe) ||
      state.pages.some((p) => p.url === safe) ||
      state.pages.length >= 1000
    )
      return;
    if (priority) state.pages.unshift({ url: safe, depth });
    else state.pages.push({ url: safe, depth });
  }
  const needSearch =
    state.pages.length < 12 ||
    !state.options.readPages ||
    state.stats.source_attempts >= state.options.sourceBudget;
  if (
    needSearch &&
    (!aiActive || state.aiPages.length < 8) &&
    state.stats.search_requests < state.options.searchBudget &&
    state.searches.length
  ) {
    const tasks: SearchTask[] = [];
    while (
      tasks.length < 2 &&
      state.searches.length &&
      state.stats.search_requests + tasks.length < state.options.searchBudget
    ) {
      const q = state.searches.shift()!;
      const sig = JSON.stringify([q.engine, q.params]);
      if (state.searched.includes(sig)) continue;
      state.searched.push(sig);
      tasks.push(q);
    }
    const results = await Promise.all(
      tasks.map(async (task) => {
        try {
          const r = await fetcher(serpApiUrl(task, deps.key), {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(25000),
          });
          const data = await r.json();
          return { task, data, status: r.status };
        } catch {
          return {
            task,
            data: { error: "Provider request failed" },
            status: 502,
          };
        }
      }),
    );
    for (const { task, data, status } of results) {
      state.stats.search_requests++;
      if (status >= 400 || data?.error) {
        state.stats.provider_errors++;
        const message = String(data?.error || "");
        if (
          status === 429 ||
          /credit|quota|run out|limit.*exceed/i.test(message)
        ) {
          warning(
            "Search-provider credits or rate limits reached. Available results are retained.",
          );
          state.searches = [];
          state.reason = "provider_limit";
        } else if (
          status === 401 ||
          status === 403 ||
          /invalid.*key|unauthorized/i.test(message)
        ) {
          warning(
            "Search provider configuration needs attention. Available results are retained.",
          );
          state.searches = [];
          state.reason = "provider_configuration";
        } else if (
          !/no results|no result|hasn.t returned any|empty/i.test(message)
        ) {
          warning(
            "Some search-provider requests failed. Other queries continued.",
          );
          if (!task.attempt) {
            state.searches.push({ ...task, attempt: 1 });
            state.searched = state.searched.filter(
              (s) => s !== JSON.stringify([task.engine, task.params]),
            );
          }
        }
        continue;
      }
      state.stats.search_pages++;
      const raw = [
        ...(Array.isArray(data?.organic_results) ? data.organic_results : []),
        ...(Array.isArray(data?.local_results)
          ? data.local_results
          : Array.isArray(data?.local_results?.places)
            ? data.local_results.places
            : []),
        ...(data?.place_results && typeof data.place_results === "object"
          ? [data.place_results]
          : []),
      ].filter((x) => x && typeof x === "object");
      state.stats.raw_results += raw.length;
      snippets.push(...raw);
      const fingerprint = JSON.stringify([
        task.engine,
        task.params.q || task.params.p || task.params.text,
        raw.map((r) => r.link || r.website || r.place_id || r.title),
      ]);
      const repeated = state.resultPages.includes(fingerprint);
      state.resultPages.push(fingerprint);
      for (let row of raw) {
        if (row.place_id && !row.link && !row.website && !row.links?.website) {
          const u = new URL("https://www.google.com/maps/search/");
          u.searchParams.set("api", "1");
          u.searchParams.set(
            "query",
            String(row.title || row.name || "Business"),
          );
          u.searchParams.set("query_place_id", String(row.place_id));
          row = { ...row, place_url: u.href };
        }
        for (const p of publicProspects(row, {
          ...state.profile,
          kind: state.kind,
          sourceFallback: data.search_metadata?.google_maps_url,
        })) {
          if (
            aiActive &&
            state.kind === "person" &&
            !row.person_name &&
            !row.contact_name &&
            !p.linkedin
          )
            snippetFallback.push(p);
          else accept(p);
        }
        for (const url of [row.link, row.website, row.links?.website])
          if (typeof url === "string") page(url);
      }
      const next = !repeated ? nextSearchTask(task, data, raw.length) : null;
      if (next)
        state.searches.splice(Math.min(2, state.searches.length), 0, next);
    }
  }
  if (
    state.reason === "provider_limit" ||
    state.reason === "provider_configuration"
  )
    state.searches = [];
  if (
    aiActive &&
    deps.aiKey &&
    snippets.length &&
    state.stats.ai_requests < state.options.aiBudget &&
    eligibleCount < state.options.target
  ) {
    state.stats.ai_requests++;
    aiThisStep++;
    try {
      for (const p of await aiSearchProspects(
        snippets,
        { ...state.profile, kind: state.kind },
        deps.aiKey,
        fetcher,
      ))
        accept(p);
    } catch (e) {
      for (const p of snippetFallback) accept(p);
      if (
        e instanceof Error &&
        ["ai_authentication", "ai_limit"].includes(e.message)
      ) {
        state.aiDisabled = true;
        warning(
          "AI extraction stopped because its provider rejected the credentials or reached a limit. Other extraction continued.",
        );
      } else
        warning(
          "Some AI snippet extraction requests were unavailable. Other extraction continued.",
        );
    }
  }
  if (
    state.options.readPages &&
    (!aiActive || state.aiPages.length < 8) &&
    eligibleCount < state.options.target &&
    state.stats.source_attempts < state.options.sourceBudget
  ) {
    const batch: typeof state.pages = [],
      origins = new Set<string>();
    for (
      let i = 0;
      i < state.pages.length &&
      batch.length < 4 &&
      state.stats.source_attempts + batch.length < state.options.sourceBudget;
    ) {
      const p = state.pages[i],
        origin = new URL(p.url).origin;
      const policy = state.robots[origin];
      if (origins.has(origin) || (policy && policy.next > now())) {
        i++;
        continue;
      }
      origins.add(origin);
      batch.push(...state.pages.splice(i, 1));
    }
    const results = await Promise.all(
      batch.map(async (task) => ({
        task,
        result: await readSource(
          task,
          state.robots,
          deps.resolve,
          fetcher,
          now(),
        ),
      })),
    );

    for (const { task, result } of results) {
      if (result.status === "deferred") {
        state.pages.push(task);
        continue;
      }
      state.stats.source_attempts++;
      state.visited.push(task.url);
      if (result.status === "redirect") {
        page(result.url, task.depth);
        continue;
      }
      if (result.status !== "ok") {
        state.stats[
          result.status === "blocked" ? "source_blocked" : "source_failed"
        ]++;
        continue;
      }
      state.stats.source_pages++;
      const context = { ...state.profile, kind: state.kind };
      let parsed;
      try {
        parsed = parseSource(result.html, result.url, context, aiActive);
      } catch {
        state.stats.source_failed++;
        continue;
      }
      for (const prospect of parsed.prospects) accept(prospect);
      if (task.depth < 2) {
        const links = [...parsed.links].sort(
          (a, b) => Number(/contact/i.test(a)) - Number(/contact/i.test(b)),
        );
        for (const link of links) page(link, task.depth + 1, true);
      }
      if (
        aiActive &&
        state.aiPages.length < Math.min(100, state.options.aiBudget) &&
        parsed.text.length > 100 &&
        state.stats.ai_requests < state.options.aiBudget
      )
        state.aiPages.push({
          url: result.url,
          title: parsed.title,
          text: parsed.text.slice(0, 22000),
        });
    }
  }
  if (
    aiActive &&
    !state.aiDisabled &&
    aiThisStep < 1 &&
    state.aiPages.length &&
    state.stats.ai_requests < state.options.aiBudget &&
    eligibleCount < state.options.target
  ) {
    const page = state.aiPages.shift()!;
    state.stats.ai_requests++;
    try {
      for (const p of await aiPageProspects(
        { ...page, links: [], prospects: [] },
        page.url,
        { ...state.profile, kind: state.kind },
        deps.aiKey!,
        fetcher,
      ))
        accept(p);
    } catch (e) {
      if (
        e instanceof Error &&
        ["ai_authentication", "ai_limit"].includes(e.message)
      )
        state.aiDisabled = true;
      warning(
        "Some AI page extraction requests were unavailable. Structured extraction continued.",
      );
    }
  }
  if (state.options.useAI && !deps.aiKey)
    warning(
      "AI extraction is not configured; public structured data and text extraction remain active.",
    );
  // Keep checkpoints bounded without forgetting crawl-delay timestamps.
  const origins = Object.keys(state.robots);
  for (const origin of origins.slice(0, -8)) {
    const p = state.robots[origin];
    state.robots[origin] = {
      rules: [],
      blocked: p.blocked,
      delay: p.delay,
      next: p.next,
      refresh: true,
    };
  }
  state.stats.saved = eligibleCount;
  if (eligibleCount >= state.options.target) {
    state.done = true;
    state.reason = "target_reached";
  } else {
    const searchDone =
      !state.searches.length ||
      state.stats.search_requests >= state.options.searchBudget;
    const pagesDone =
      !state.options.readPages ||
      !state.pages.length ||
      state.stats.source_attempts >= state.options.sourceBudget;
    if (
      searchDone &&
      pagesDone &&
      !(
        aiActive &&
        !state.aiDisabled &&
        state.aiPages.length &&
        state.stats.ai_requests < state.options.aiBudget
      )
    ) {
      state.done = true;
      state.reason =
        state.reason ||
        (state.stats.search_requests >= state.options.searchBudget
          ? "search_budget_reached"
          : state.stats.source_attempts >= state.options.sourceBudget &&
              state.options.readPages
            ? "source_budget_reached"
            : "sources_exhausted");
    }
  }
  return { state, changed: [...changed.values()].filter(hasProspectContact) };
}
