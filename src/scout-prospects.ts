import type { ProspectKind } from "./prospect-pool.ts";
import { normalizeDomain } from "./prospect-pool.ts";
export type PublicSourceContext = {
  audience: string;
  location: string;
  kind: ProspectKind;
  sourceFallback?: string;
};
export function publicUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
const text = (value: unknown, max = 200) =>
  typeof value === "string"
    ? value
        .replace(/&nbsp;/g, " ")
        .trim()
        .slice(0, max)
    : "";
const ROLE =
  /\b(founder|owner|chief|ceo|cfo|cto|coo|cmo|director|manager|president|partner|dentist|surgeon|physician|doctor|attorney|lawyer|engineer|consultant|architect|accountant|strategist|developer|professor)\b/i;
const NOT_A_NAME =
  /\b(our|your|meet|team|best|top|results|services|dental|dentist|dentistry|cosmetic|clinic|center|centre|group|company|agency|business|studio|solutions?|university|school|marketing|design|reviews|profile|directory|experience|dentists)\b/i;
function cleanName(value: string): string {
  const name = value
    .replace(/^(?:Dr\.?|Doctor|Prof\.?)\s+/i, "")
    .replace(/(?:,?\s+)(?:DDS|DMD|MD|DO|PhD|CPA|Esq)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.\u2026]+$/, "")
    .trim();
  const words = name.split(" ");
  return words.length >= 2 &&
    words.length <= 5 &&
    !NOT_A_NAME.test(name) &&
    words.every((word) => /^[\p{Lu}][\p{L}\p{M}'’.\-]*$/u.test(word))
    ? name
    : "";
}
type Identity = { name: string; role: string; fromSnippet: boolean };
function identities(
  raw: Record<string, any>,
  source: string,
  title: string,
  snippet: string,
): Identity[] {
  const structured = text(raw.contact_name || raw.person_name);
  if (structured)
    return [
      { name: structured, role: text(raw.job_title), fromSnippet: false },
    ];
  const cleanTitle = title.replace(/\s*[|·-]\s*LinkedIn\s*$/i, "");
  const parts = cleanTitle.split(/\s+[-–—|•]\s+/);
  const linkedIn =
    /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:in|pub)\/(?!dir\b)/i.test(
      source,
    );
  const profilePage =
    /\/(?:people|team|staff|doctors?|dentists?|providers?|professionals?|attorneys?|lawyers?)\//i.test(
      new URL(source).pathname,
    );
  const found: Identity[] = [];
  const titleName = cleanName(parts[0]);
  if (
    titleName &&
    (linkedIn || profilePage || ROLE.test(parts.slice(1).join(" ")))
  )
    found.push({
      name: titleName,
      role: text(raw.job_title || (parts.length > 1 ? parts[1] : "")),
      fromSnippet: false,
    });
  const namePattern =
    "([\\p{Lu}][\\p{L}\\p{M}'’-]*(?:\\s+(?:[\\p{Lu}]\\.|[\\p{Lu}][\\p{L}\\p{M}'’-]*)){1,3})";
  for (const [content, fromSnippet] of [
    [title, false],
    [snippet, true],
  ] as const) {
    for (const match of content.matchAll(
      new RegExp(`(?:\\bDr\\.?|\\bDoctor|\\bProf\\.?)\\s+${namePattern}`, "gu"),
    )) {
      const name = cleanName(match[1]);
      if (name) found.push({ name, role: "", fromSnippet });
    }
    for (const match of content.matchAll(
      new RegExp(`${namePattern},?\\s+(DDS|DMD|MD|DO|PhD|CPA|Esq)\\b`, "gu"),
    )) {
      const name = cleanName(match[1]);
      if (name)
        found.push({
          name,
          role: ["DDS", "DMD"].includes(match[2])
            ? "Dentist"
            : ["MD", "DO"].includes(match[2])
              ? "Physician"
              : match[2] === "CPA"
                ? "Accountant"
                : match[2] === "Esq"
                  ? "Attorney"
                  : "",
          fromSnippet,
        });
    }
    for (const match of content.matchAll(
      new RegExp(
        `\\b(?:founder|owner|CEO|director|Meet)\\s+(?:is\\s+)?${namePattern}`,
        "gu",
      ),
    )) {
      const name = cleanName(match[1]);
      if (name) found.push({ name, role: "", fromSnippet });
    }
  }
  const unique = new Map<string, Identity>();
  for (const identity of found) {
    const key = identity.name.toLowerCase();
    const existing = unique.get(key);
    if (!existing || (!existing.role && identity.role))
      unique.set(key, identity);
  }
  return [...unique.values()].slice(0, 5);
}
function industryFor(category: string) {
  const groups: [RegExp, string][] = [
    [/hotel|hospitality|resort|accommodation/i, "Hospitality"],
    [/software|saas/i, "Software"],
    [/marketing|advertising/i, "Advertising & Marketing"],
    [/real estate|realtor/i, "Real Estate"],
    [/health|medical|clinic|dental/i, "Healthcare"],
    [/restaurant|food|beverage/i, "Food & Beverage"],
    [/education|school|university/i, "Education"],
    [/e-commerce|ecommerce/i, "E-commerce"],
    [/consult/i, "Consulting"],
    [/design|creative/i, "Design"],
    [/manufactur/i, "Manufacturing"],
    [/logistic|shipping/i, "Logistics"],
    [/retail/i, "Retail"],
  ];
  return groups.find(([pattern]) => pattern.test(category))?.[1] || "";
}
export function publicProspects(
  raw: Record<string, any>,
  context: PublicSourceContext,
) {
  const source =
    [
      raw.link,
      raw.website,
      raw.links?.website,
      raw.place_url,
      context.sourceFallback,
    ]
      .map(publicUrl)
      .find(Boolean) || "";
  if (!source) return [];
  const title = text(raw.title || raw.name, 400),
    snippet = text(raw.snippet || raw.description, 2000);
  const profile =
    /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:in|pub)\/(?!dir\b)/i.test(
      source,
    );
  const kind: ProspectKind = profile ? "person" : context.kind;
  const people =
    kind === "person"
      ? identities(raw, source, title, snippet)
      : [{ name: "", role: "", fromSnippet: false }];
  const parts = title
    .replace(/\s*[|·-]\s*LinkedIn\s*$/i, "")
    .split(/\s+[-–—|•]\s+/);
  const website = publicUrl(
    raw.website ||
      raw.links?.website ||
      (kind === "company" &&
      raw.link &&
      !/linkedin\.com|google\.[^/]+\/maps/i.test(source)
        ? source
        : ""),
  );
  const category = text(raw.type || context.audience);
  const email =
    text(raw.email, 320) ||
    (`${title} ${snippet}`.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
    ) || [])[0] ||
    "";
  const phone =
    text(raw.phone || raw.phone_number, 100) ||
    (`${title} ${snippet}`.match(
      /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)|\d{2,4})[ .-]\d{3,4}[ .-]\d{3,4}\b/,
    ) || [])[0] ||
    "";
  return people.flatMap((person) => {
    const company =
      kind === "person"
        ? text(
            raw.company_name ||
              raw.organization_name ||
              (profile && parts.length >= 3 ? parts[2] : ""),
          )
        : text(raw.company_name || raw.title || raw.name);
    if (kind === "company" && !company) return [];
    const jobTitle = person.role;
    const seniority =
      (
        [
          [/\bfounder\b/i, "Founder"],
          [/\bowner\b/i, "Owner"],
          [/\b(chief|ceo|cfo|cto|coo|cmo)\b/i, "C-level"],
          [/\b(vp|vice president)\b/i, "VP"],
          [/\bdirector\b/i, "Director"],
          [/\bmanager\b/i, "Manager"],
          [/\bpartner\b/i, "Partner"],
        ] as [RegExp, string][]
      ).find(([pattern]) => pattern.test(jobTitle))?.[1] || "";
    const department =
      (
        [
          [/\bmarketing\b/i, "Marketing"],
          [/\bsales\b/i, "Sales"],
          [/\bengineer/i, "Engineering"],
          [/\b(finance|cfo)\b/i, "Finance"],
          [/\b(human resources|hr)\b/i, "Human Resources"],
          [/\boperations\b/i, "Operations"],
          [/\bbusiness development\b/i, "Business Development"],
          [/\bcustomer success\b/i, "Customer Success"],
          [/\bproduct\b/i, "Product"],
        ] as [RegExp, string][]
      ).find(([pattern]) => pattern.test(jobTitle))?.[1] || "";
    // A group snippet can name several people without attributing its contact details to any one person.
    const ambiguousContact =
      kind === "person" && person.fromSnippet && people.length > 1;
    return [
      {
        prospect_kind: kind,
        company,
        contact_name: person.name,
        category,
        industry: industryFor(category),
        location: text(raw.address || raw.location || context.location, 300),
        job_title: jobTitle,
        department,
        seniority,
        email: ambiguousContact ? "" : email,
        phone: ambiguousContact ? "" : phone,
        website,
        linkedin:
          profile || /linkedin\.com\/company\//i.test(source) ? source : "",
        source_url: source,
        domain: website ? normalizeDomain(website) : "",
        summary: snippet,
        company_size: "",
        revenue: null,
        funding_amount: null,
        founded_year: null,
        technologies: [] as string[],
        score:
          !ambiguousContact && email
            ? 85
            : !ambiguousContact && phone
              ? 75
              : 60,
      },
    ];
  });
}
export function publicProspect(
  raw: Record<string, any>,
  context: PublicSourceContext,
) {
  return publicProspects(raw, context)[0] || null;
}
