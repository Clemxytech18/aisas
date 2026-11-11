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

// Country-wide profiles gain regional discovery as well as deeper result pages.
const REGIONS: Record<string, string[]> = {
  us: [
    "California",
    "Texas",
    "Florida",
    "New York",
    "Illinois",
    "Pennsylvania",
    "Ohio",
    "Georgia",
    "North Carolina",
    "Michigan",
    "New Jersey",
    "Virginia",
    "Washington",
    "Arizona",
    "Massachusetts",
    "Tennessee",
    "Indiana",
    "Missouri",
    "Maryland",
    "Wisconsin",
    "Colorado",
    "Minnesota",
    "South Carolina",
    "Alabama",
    "Louisiana",
    "Kentucky",
    "Oregon",
    "Oklahoma",
    "Connecticut",
    "Iowa",
    "Mississippi",
    "Arkansas",
    "Nevada",
    "Kansas",
    "Utah",
    "New Mexico",
    "Nebraska",
    "Idaho",
    "West Virginia",
    "Hawaii",
    "New Hampshire",
    "Maine",
    "Montana",
    "Rhode Island",
    "Delaware",
    "South Dakota",
    "North Dakota",
    "Alaska",
    "Vermont",
    "Wyoming",
  ],
  gb: [
    "London",
    "Manchester",
    "Birmingham",
    "Leeds",
    "Glasgow",
    "Edinburgh",
    "Bristol",
    "Liverpool",
    "Cardiff",
    "Belfast",
  ],
  au: [
    "Sydney",
    "Melbourne",
    "Brisbane",
    "Perth",
    "Adelaide",
    "Canberra",
    "Hobart",
    "Darwin",
  ],
  ca: [
    "Ontario",
    "Quebec",
    "British Columbia",
    "Alberta",
    "Manitoba",
    "Saskatchewan",
    "Nova Scotia",
    "New Brunswick",
    "Newfoundland",
    "Prince Edward Island",
  ],
  ng: [
    "Lagos",
    "Abuja",
    "Port Harcourt",
    "Kano",
    "Ibadan",
    "Benin City",
    "Enugu",
    "Kaduna",
  ],
};
export function countryCode(place: string): string {
  if (/^(usa?|united states(?: of america)?)$/i.test(place.trim())) return "us";
  if (/^(uk|united kingdom|great britain)$/i.test(place.trim())) return "gb";
  return (
    (
      { australia: "au", canada: "ca", nigeria: "ng" } as Record<string, string>
    )[place.trim().toLowerCase()] || ""
  );
}
export function coverageQueries(
  profile: Pick<ScoutingProfile, "audience" | "location">,
  kind: ProspectKind,
): ScoutQuery[] {
  const a = audienceTerms(profile.audience),
    place = terms(profile.location),
    n = `${a} ${place}`;
  const basic = [
    ...scoutQueries(profile, kind),
    ...scoutQueries(profile, kind, true),
  ];
  const expanded: ScoutQuery[] = [
    {
      engine: "google",
      params: { q: `${n} ("team" OR "about us" OR "leadership" OR "staff")` },
      purpose: "discovery",
    },
    {
      engine: "google",
      params: { q: `${n} ("directory" OR "members" OR "find a professional")` },
      purpose: "discovery",
    },
    {
      engine: "google",
      params: {
        q: `${n} ("gmail.com" OR "yahoo.com" OR "outlook.com" OR "proton.me")`,
      },
      purpose: "contact",
    },
    {
      engine: "google",
      params: { q: `${n} ("email" OR "@") -site:linkedin.com` },
      purpose: "contact",
    },
  ];
  const regions = REGIONS[countryCode(profile.location)] || [];
  const regional: ScoutQuery[] = regions.map((region) => ({
    engine: "google",
    params: {
      q: `${a} ${region} ${place} ${kind === "person" ? '("team" OR "owner" OR "professional")' : '("contact" OR "business")'}`,
    },
    purpose: "discovery",
  }));
  const gl = countryCode(profile.location);
  return [...basic, ...expanded, ...regional].map((q) => ({
    ...q,
    params: { ...q.params, ...(gl && q.engine === "google" ? { gl } : {}) },
  }));
}
export function nextSearchTask(
  task: ScoutQuery & { page: number },
  data: any,
  rawCount: number,
): (ScoutQuery & { page: number }) | null {
  if (task.page >= 20 || !rawCount) return null;
  const supplied = data?.serpapi_pagination?.next || data?.pagination?.next;
  const params = { ...task.params };
  let explicit = false;
  if (typeof supplied === "string")
    try {
      const u = new URL(supplied);
      if (
        u.protocol === "https:" &&
        u.hostname === "serpapi.com" &&
        (!u.searchParams.get("engine") ||
          u.searchParams.get("engine") === task.engine)
      )
        for (const k of ["start", "b", "p", "next_page_token"]) {
          const v = u.searchParams.get(k);
          if (v && v.length < 1000) {
            params[k] = v;
            explicit = true;
          }
        }
    } catch {}
  if (!explicit) {
    if (rawCount < (task.engine === "google_maps" ? 20 : 10)) return null;
    const field =
      task.engine === "yahoo" ? "b" : task.engine === "yandex" ? "p" : "start";
    const step =
      task.engine === "google_maps" ? 20 : task.engine === "yandex" ? 1 : 10;
    params[field] = String(
      Number(task.params[field] || (field === "b" ? 1 : 0)) + step,
    );
  }
  return { ...task, params, page: task.page + 1 };
}
