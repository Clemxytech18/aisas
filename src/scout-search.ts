import type { ScoutingProfile } from "./domain.ts";
import type { ProspectKind } from "./prospect-pool.ts";
import { publicProspects } from "./scout-prospects.ts";
import { scoutQueries, serpApiUrl, type ScoutQuery } from "./scout-query.ts";
type ErrorCategory =
  "authentication" | "quota" | "timeout" | "provider_error" | "no_results";
export type ScoutDiagnostic = {
  engine: string;
  purpose: string;
  status: "ok" | "empty" | "failed";
  raw_results: number;
  accepted: number;
  error?: ErrorCategory;
};
function category(message: string, status: number): ErrorCategory {
  if (
    status === 401 ||
    status === 403 ||
    /invalid.*key|unauthorized/i.test(message)
  )
    return "authentication";
  if (status === 429 || /credits|quota|run out|limit.*exceed/i.test(message))
    return "quota";
  if (/no results|no result|hasn.t returned any|empty/i.test(message))
    return "no_results";
  return "provider_error";
}
function providerRows(data: any): Record<string, any>[] {
  const rows: unknown[] = [
    ...(Array.isArray(data?.organic_results) ? data.organic_results : []),
    ...(Array.isArray(data?.local_results)
      ? data.local_results
      : Array.isArray(data?.local_results?.places)
        ? data.local_results.places
        : []),
    ...(data?.place_results &&
    typeof data.place_results === "object" &&
    !Array.isArray(data.place_results)
      ? [data.place_results]
      : []),
  ];
  return rows.filter(
    (row): row is Record<string, any> =>
      !!row && typeof row === "object" && !Array.isArray(row),
  );
}
function mapSource(row: Record<string, any>): Record<string, any> {
  if (row.place_id && !row.link && !row.website && !row.links?.website) {
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", String(row.title || row.name || "Business"));
    url.searchParams.set("query_place_id", String(row.place_id));
    return { ...row, place_url: url.href };
  }
  return row;
}
export async function runScoutSearch(
  profile: Pick<ScoutingProfile, "audience" | "location">,
  kind: ProspectKind,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  const diagnostics: ScoutDiagnostic[] = [];
  const prospects: ReturnType<typeof publicProspects> = [];
  const seen = new Set<string>();
  async function batch(queries: ScoutQuery[]) {
    const responses = await Promise.all(
      queries.map(async (query) => {
        try {
          const response = await fetcher(serpApiUrl(query, key), {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(25000),
          });
          let data: any;
          try {
            data = await response.json();
          } catch {
            return {
              query,
              rows: [],
              data: null,
              error: "provider_error" as ErrorCategory,
            };
          }
          if (!response.ok || data?.error)
            return {
              query,
              rows: [],
              data: null,
              error: category(String(data?.error || ""), response.status),
            };
          return { query, rows: providerRows(data), data, error: undefined };
        } catch (error: any) {
          return {
            query,
            rows: [],
            data: null,
            error: ["AbortError", "TimeoutError"].includes(error?.name)
              ? ("timeout" as const)
              : ("provider_error" as const),
          };
        }
      }),
    );
    for (const result of responses) {
      let accepted = 0;
      for (const row of result.rows) {
        const source = mapSource(row);
        const mapped = publicProspects(source, {
          ...profile,
          kind,
          sourceFallback: result.data?.search_metadata?.google_maps_url,
        });
        for (const prospect of mapped) {
          const identity = (
            prospect.prospect_kind === "person"
              ? prospect.linkedin ||
                `${prospect.contact_name}|${prospect.company}|${prospect.email}`
              : `${prospect.company}|${prospect.domain}|${prospect.email}`
          )
            .toLowerCase()
            .replace(/\/$/, "");
          if (seen.has(identity)) continue;
          seen.add(identity);
          accepted++;
          if (prospects.length < 100) prospects.push(prospect);
        }
      }
      diagnostics.push({
        engine: result.query.engine,
        purpose: result.query.purpose,
        status: result.error ? "failed" : result.rows.length ? "ok" : "empty",
        raw_results: result.rows.length,
        accepted,
        ...(result.error ? { error: result.error } : {}),
      });
    }
  }
  await batch(scoutQueries(profile, kind));
  const fatal = diagnostics.some(
    (d) => d.error === "authentication" || d.error === "quota",
  );
  const fallbackUsed = !fatal && prospects.length < (kind === "person" ? 5 : 1);
  if (fallbackUsed) await batch(scoutQueries(profile, kind, true));
  const responded = diagnostics.filter(
    (d) => d.status !== "failed" || d.error === "no_results",
  ).length;
  let failure: string | null = null;
  if (!prospects.length) {
    if (diagnostics.some((d) => d.error === "authentication"))
      failure =
        "The search provider rejected its API key. Ask your administrator to check the SerpAPI configuration.";
    else if (diagnostics.some((d) => d.error === "quota"))
      failure =
        "SerpAPI search credits or rate limits were reached. Check the provider account before retrying.";
    else if (!responded)
      failure =
        "The search providers could not complete this scout. Please try again shortly.";
    else
      failure =
        kind === "person"
          ? "No named professionals were found in the returned public sources. Try a broader business category or a nearby city, or switch to Companies. No empty list was created."
          : "No businesses matched the returned public sources. Try a broader category or location. No empty list was created.";
  }
  const error_status = !failure
    ? 200
    : diagnostics.some((d) => d.error === "authentication")
      ? 503
      : diagnostics.some((d) => d.error === "quota")
        ? 429
        : !responded
          ? 502
          : 422;
  return {
    error_status,
    prospects,
    diagnostics,
    engines_responded: responded,
    fallback_used: fallbackUsed,
    failure,
  };
}
