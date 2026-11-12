import type { ScoutQuery } from "./scout-query.ts";
import type { ScoutProspect } from "./scout-types.ts";
import { publicProspects, publicUrl } from "./scout-prospects.ts";
export function mapsQuery(profile: {
  audience: string;
  location: string;
}): string {
  return `${profile.audience} ${profile.location}`
    .replace(/[\r\n\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
export function mapsSearches(profile: {
  audience: string;
  location: string;
}): (ScoutQuery & { page: number })[] {
  return [
    {
      engine: "google_maps",
      params: { q: mapsQuery(profile), type: "search", start: "0", hl: "en" },
      purpose: "discovery",
      page: 1,
    },
  ];
}
const coordinates = (value: unknown): string =>
  typeof value === "string" &&
  /^@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+(?:\.\d+)?[zm]$/.test(value)
    ? value
    : "";
export function nextMapsTask(
  task: ScoutQuery & { page: number },
  data: any,
  rawCount: number,
): (ScoutQuery & { page: number }) | null {
  if (!rawCount) return null;
  const current = Number(task.params.start || 0),
    params = { ...task.params };
  let offset: number | undefined;
  const next = data?.serpapi_pagination?.next || data?.pagination?.next;
  if (typeof next === "string") {
    try {
      const url = new URL(next);
      if (
        url.protocol !== "https:" ||
        url.hostname !== "serpapi.com" ||
        url.username ||
        url.password ||
        !["/search", "/search.json"].includes(url.pathname) ||
        !["google_maps", null].includes(url.searchParams.get("engine"))
      )
        return null;
      const start = url.searchParams.get("start");
      if (!start || !/^\d+$/.test(start)) return null;
      offset = Number(start);
      const ll = coordinates(url.searchParams.get("ll"));
      if (ll) params.ll = ll;
    } catch {
      return null;
    }
  } else if (rawCount >= 20) offset = current + 20;
  if (
    offset === undefined ||
    !Number.isSafeInteger(offset) ||
    offset <= current
  )
    return null;
  params.start = String(offset);
  const ll = coordinates(data?.search_parameters?.ll);
  if (!params.ll && ll) params.ll = ll;
  // Rebuild from an allowlist; never persist or follow provider URLs carrying an API key.
  return {
    engine: "google_maps",
    params: Object.fromEntries(
      Object.entries(params).filter(([key]) =>
        ["q", "type", "start", "hl", "ll"].includes(key),
      ),
    ),
    purpose: "discovery",
    page: task.page + 1,
  };
}
export function mapsProspect(
  raw: Record<string, any>,
  profile: { audience: string; location: string },
): ScoutProspect | null {
  const name = String(raw.title || raw.name || "").trim();
  if (!name) return null;
  const placeId = String(raw.place_id || "").slice(0, 300),
    dataId = String(raw.data_id || raw.data_cid || "").slice(0, 300);
  const map = new URL("https://www.google.com/maps/search/");
  map.searchParams.set("api", "1");
  map.searchParams.set(
    "query",
    `${name} ${raw.address || profile.location}`.slice(0, 600),
  );
  if (placeId) map.searchParams.set("query_place_id", placeId);
  const website = publicUrl(raw.website || raw.links?.website);
  const p = publicProspects(
    { ...raw, link: map.href, website },
    { ...profile, kind: "company" },
  )[0];
  if (!p) return null;
  return {
    ...p,
    source_url: map.href,
    maps_place_id:
      placeId ||
      dataId ||
      `${name.toLowerCase()}|${String(raw.address || profile.location).toLowerCase()}`,
  };
}
