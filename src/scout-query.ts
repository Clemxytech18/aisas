import type { ScoutingProfile } from "./domain.ts";
import type { ProspectKind } from "./prospect-pool.ts";
export const SERPAPI_ENDPOINT = "https://serpapi.com/search";
export const EMAIL_PROVIDERS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
];
export const CONTACT_SEARCH_GROUP = `("contact" OR "email" OR "phone" OR "@" OR ${EMAIL_PROVIDERS.map((domain) => `"${domain}"`).join(" OR ")})`;
const quote = (value: string) =>
  `"${value
    .replace(/["\\\r\n]/g, " ")
    .trim()
    .slice(0, 220)}"`;
export function booleanQuery(
  profile: Pick<ScoutingProfile, "audience" | "location">,
) {
  return `${quote(profile.audience)} AND ${quote(profile.location)} AND ${CONTACT_SEARCH_GROUP}`;
}
const terms = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !/^(AND|OR|NOT)$/i.test(word))
    .join(" ")
    .slice(0, 220);
const PROFESSIONALS =
  '("owner" OR "founder" OR "team" OR "professional" OR "Dr." OR "dentist" OR "director")';
function audienceTerms(value: string) {
  const audience = terms(value);
  // Common business terminology also has a practitioner/job-title form.
  if (/dental\s+cosmetics?|cosmetic\s+dent(?:al|istry|ist)/i.test(audience))
    return `(${quote(audience)} OR "cosmetic dentist" OR "cosmetic dentistry")`;
  return audience;
}
export type ScoutQuery = {
  engine: "google" | "google_maps" | "yahoo" | "yandex";
  params: Record<string, string>;
  purpose: "discovery" | "contact" | "fallback";
};
export function scoutQueries(
  profile: Pick<ScoutingProfile, "audience" | "location">,
  kind: ProspectKind,
  fallback = false,
): ScoutQuery[] {
  const audience = audienceTerms(profile.audience),
    place = terms(profile.location),
    natural = `${audience} ${place}`;
  if (kind === "person")
    return fallback
      ? [
          {
            engine: "google",
            params: { q: `${natural} ${PROFESSIONALS}` },
            purpose: "fallback",
          },
        ]
      : [
          {
            engine: "google",
            params: { q: `${natural} site:linkedin.com/in` },
            purpose: "discovery",
          },
          {
            engine: "google",
            params: { q: `${natural} ${CONTACT_SEARCH_GROUP}` },
            purpose: "contact",
          },
          {
            engine: "yahoo",
            params: {
              p: `${natural} ${PROFESSIONALS} ${CONTACT_SEARCH_GROUP}`,
            },
            purpose: "contact",
          },
          {
            engine: "yandex",
            params: { text: `${natural} ${PROFESSIONALS}` },
            purpose: "discovery",
          },
        ];
  return fallback
    ? [{ engine: "google", params: { q: natural }, purpose: "fallback" }]
    : [
        {
          engine: "google",
          params: { q: booleanQuery(profile) },
          purpose: "contact",
        },
        {
          engine: "google",
          params: { q: `${natural} ("business" OR "company" OR "directory")` },
          purpose: "discovery",
        },
        {
          engine: "yahoo",
          params: { p: `${natural} ${CONTACT_SEARCH_GROUP}` },
          purpose: "contact",
        },
        {
          engine: "yandex",
          params: { text: `${natural} ${CONTACT_SEARCH_GROUP}` },
          purpose: "contact",
        },
        {
          engine: "google_maps",
          params: { q: `${terms(profile.audience)} ${place}`, type: "search" },
          purpose: "discovery",
        },
      ];
}
export function serpApiUrl(query: ScoutQuery, key: string): URL {
  const url = new URL(SERPAPI_ENDPOINT);
  url.searchParams.set("engine", query.engine);
  for (const [k, v] of Object.entries(query.params)) url.searchParams.set(k, v);
  url.searchParams.set("output", "json");
  url.searchParams.set("api_key", key);
  return url;
}
