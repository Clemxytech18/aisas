import type { ProspectKind } from "./prospect-pool.ts";
import type { ScoutQuery } from "./scout-query.ts";
import type { publicProspects } from "./scout-prospects.ts";
export type ScoutProspect = ReturnType<typeof publicProspects>[number] & {
  maps_place_id?: string;
};
export type ScoutMethod = "boolean" | "google_maps";
export function scoutMethod(value: unknown): ScoutMethod {
  if (value === undefined || value === null) return "boolean";
  if (value === "boolean" || value === "google_maps") return value;
  throw new Error("Choose Boolean Scouting or Google Maps Scouting.");
}
export const MAPS_SCOUT_OPTIONS: ScoutOptions = {
  target: 1000,
  searchBudget: 100,
  sourceBudget: 1000,
  aiBudget: 60,
  readPages: true,
  useAI: true,
};
export type ScoutOptions = {
  target: number;
  searchBudget: number;
  sourceBudget: number;
  aiBudget: number;
  readPages: boolean;
  useAI: boolean;
};
export const DEFAULT_SCOUT_OPTIONS: ScoutOptions = {
  target: 100,
  searchBudget: 30,
  sourceBudget: 200,
  aiBudget: 60,
  readPages: true,
  useAI: true,
};
export function scoutOptions(raw: Partial<ScoutOptions> = {}): ScoutOptions {
  const int = (x: unknown, fallback: number, min: number, max: number) => {
    const n = x === undefined ? fallback : Number(x);
    if (!Number.isInteger(n) || n < min || n > max)
      throw new Error("Choose valid scouting limits.");
    return n;
  };
  return {
    target: int(raw.target, 100, 1, 1000),
    searchBudget: int(raw.searchBudget, 30, 1, 100),
    sourceBudget: int(raw.sourceBudget, 200, 0, 1000),
    aiBudget: int(raw.aiBudget, 60, 0, 1000),
    readPages: raw.readPages !== false,
    useAI: raw.useAI !== false,
  };
}
export type ScoutStats = {
  search_requests: number;
  search_pages: number;
  raw_results: number;
  source_pages: number;
  source_attempts: number;
  source_blocked: number;
  source_failed: number;
  people_identified: number;
  duplicates: number;
  saved: number;
  ai_requests: number;
  provider_errors: number;
};
export const emptyScoutStats = (): ScoutStats => ({
  search_requests: 0,
  search_pages: 0,
  raw_results: 0,
  source_pages: 0,
  source_attempts: 0,
  source_blocked: 0,
  source_failed: 0,
  people_identified: 0,
  duplicates: 0,
  saved: 0,
  ai_requests: 0,
  provider_errors: 0,
});
export type SearchTask = ScoutQuery & { page: number; attempt?: number };
export type PageTask = { url: string; depth: number; companyId?: string };
export type RobotsPolicy = {
  rules: { path: string; allow: boolean }[];
  blocked: boolean;
  delay: number;
  next: number;
  refresh?: boolean;
};
export type ScoutState = {
  version: 1;
  method?: ScoutMethod;
  profile: { audience: string; location: string };
  kind: ProspectKind;
  options: ScoutOptions;
  searches: SearchTask[];
  pages: PageTask[];
  searched: string[];
  visited: string[];
  seen: string[];
  robots: Record<string, RobotsPolicy>;
  stats: ScoutStats;
  reason: string | null;
  warnings: string[];
  done: boolean;
};
export type ScoutRun = {
  method?: ScoutMethod;
  id: string;
  name: string;
  status: "running" | "paused" | "completed";
  kind: ProspectKind;
  target: number;
  list_id: string | null;
  stats: ScoutStats;
  reason: string | null;
  warnings: string[];
  created_at: string;
  updated_at: string;
  busy?: boolean;
};
export function scoutProgress(stats: ScoutStats) {
  return `${stats.search_pages} search pages · ${stats.source_pages} source pages · ${stats.people_identified} prospects identified · ${stats.duplicates} duplicates merged · ${stats.saved} saved`;
}
