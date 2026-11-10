import type { ProspectKind } from "./prospect-pool.ts";
import { normalizeDomain } from "./prospect-pool.ts";
export function publicUrl(value: unknown): string {
  try {
    const u = new URL(String(value || ""));
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
const text = (value: unknown, max = 200) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
function industryFor(category: string): string {
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
/** Extract only values present in the public provider result. Financial data is never guessed. */
export function publicProspect(
  raw: Record<string, any>,
  context: {
    audience: string;
    location: string;
    kind: ProspectKind;
    sourceFallback?: string;
  },
) {
  const source = publicUrl(raw.link || raw.website || context.sourceFallback);
  if (!source) return null;
  const title = text(raw.title, 400),
    snippet = text(raw.snippet, 2000);
  const profile = /^https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//i.test(source);
  const structuredName = text(raw.contact_name || raw.person_name);
  const parts = title
    .replace(/\s*[|·]\s*LinkedIn\s*$/i, "")
    .split(/\s+[-–—]\s+/);
  const kind: ProspectKind =
    context.kind === "person" || profile ? "person" : "company";
  const contactName =
    kind === "person"
      ? structuredName || (profile && parts.length >= 2 ? parts[0] : "")
      : "";
  if (kind === "person" && !contactName) return null;
  const company =
    kind === "person"
      ? text(raw.company_name || (parts.length >= 3 ? parts[2] : ""))
      : text(raw.company_name || raw.title);
  if (kind === "company" && !company) return null;
  const website = publicUrl(
    raw.website ||
      (kind === "company" &&
      raw.link &&
      !/linkedin\.com|google\.[^/]+\/maps/i.test(source)
        ? source
        : ""),
  );
  const joined = `${title} ${snippet}`;
  const email =
    text(raw.email, 320) ||
    (joined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/) || [])[0] ||
    "";
  const category = text(raw.type || context.audience);
  const jobTitle =
    kind === "person" ? text(raw.job_title || (profile ? parts[1] : "")) : "";
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
  return {
    prospect_kind: kind,
    company,
    contact_name: contactName,
    category,
    industry: industryFor(category),
    location: text(raw.address || raw.location || context.location, 300),
    job_title: jobTitle,
    department,
    seniority,
    email,
    phone: text(raw.phone, 100),
    website,
    linkedin: profile || /linkedin\.com\/company\//i.test(source) ? source : "",
    source_url: source,
    domain: website ? normalizeDomain(website) : "",
    summary: snippet,
    company_size: "",
    revenue: null,
    funding_amount: null,
    founded_year: null,
    technologies: [] as string[],
    score: email ? 85 : raw.phone ? 75 : 60,
  };
}
