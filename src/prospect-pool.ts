import { hasProspectContact } from "./prospect-contact.ts";
import type { Lead } from "./domain.ts";
export type ProspectKind = "company" | "person";
export type ProspectDetails = {
  prospect_kind?: ProspectKind;
  industry?: string;
  job_title?: string;
  department?: string;
  seniority?: string;
  company_size?: string;
  revenue?: number | null;
  funding_amount?: number | null;
  technologies?: string[];
  founded_year?: number | null;
  domain?: string;
  summary?: string;
  pool_prospect_id?: string | null;
};
export type PoolProspect = Pick<
  Lead,
  | "id"
  | "company"
  | "contact_name"
  | "category"
  | "location"
  | "email"
  | "phone"
  | "website"
  | "linkedin"
  | "source_url"
> &
  ProspectDetails & {
    prospect_kind: ProspectKind;
    first_seen_at: string;
    last_seen_at: string;
  };
export type PoolFilters = {
  company: string;
  person: string;
  location: string;
  industry: string;
  company_size: string;
  revenue_min: string;
  revenue_max: string;
  funding_min: string;
  funding_max: string;
  founded_min: string;
  founded_max: string;
  domain: string;
  keyword: string;
  job_title: string;
  department: string;
  seniority: string;
  technologies: string[];
  has_email: boolean;
  has_phone: boolean;
};
export const emptyPoolFilters = (): PoolFilters => ({
  company: "",
  person: "",
  location: "",
  industry: "",
  company_size: "",
  revenue_min: "",
  revenue_max: "",
  funding_min: "",
  funding_max: "",
  founded_min: "",
  founded_max: "",
  domain: "",
  keyword: "",
  job_title: "",
  department: "",
  seniority: "",
  technologies: [],
  has_email: false,
  has_phone: false,
});
export const INDUSTRIES = [
  "Accounting",
  "Advertising & Marketing",
  "Agriculture",
  "Architecture",
  "Automotive",
  "Banking & Finance",
  "Biotechnology",
  "Business Services",
  "Construction",
  "Consulting",
  "Consumer Goods",
  "Design",
  "E-commerce",
  "Education",
  "Energy",
  "Entertainment",
  "Food & Beverage",
  "Government",
  "Healthcare",
  "Hospitality",
  "Insurance",
  "Legal Services",
  "Logistics",
  "Manufacturing",
  "Media",
  "Nonprofit",
  "Real Estate",
  "Retail",
  "Software",
  "Technology",
  "Telecommunications",
  "Travel & Tourism",
];
export const COMPANY_SIZES = [
  "1-10",
  "11-50",
  "51-200",
  "201-500",
  "501-1000",
  "1001-5000",
  "5001-10000",
  "10001+",
];
export const TECHNOLOGIES = [
  "AWS",
  "Azure",
  "Google Cloud",
  "Google Analytics",
  "Google Tag Manager",
  "HubSpot",
  "Magento",
  "Microsoft 365",
  "React",
  "Salesforce",
  "Shopify",
  "Squarespace",
  "Stripe",
  "Webflow",
  "WooCommerce",
  "WordPress",
  "Zendesk",
];
export const DEPARTMENTS = [
  "Business Development",
  "Customer Success",
  "Engineering",
  "Finance",
  "Human Resources",
  "IT",
  "Legal",
  "Marketing",
  "Operations",
  "Product",
  "Sales",
];
export const SENIORITIES = [
  "Owner",
  "Founder",
  "C-level",
  "Partner",
  "VP",
  "Director",
  "Manager",
  "Individual contributor",
];
export function normalizeDomain(value: string): string {
  if (!value.trim()) return "";
  try {
    const u = new URL(
      /^https?:\/\//i.test(value.trim())
        ? value.trim()
        : `https://${value.trim()}`,
    );
    if (!["http:", "https:"].includes(u.protocol)) return "";
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
export function searchPayload(filters: PoolFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.length > 200)
      throw new Error("Keep each search field under 200 characters.");
    out[key] = typeof value === "string" ? value.trim() : value;
  }
  for (const prefix of ["revenue", "funding", "founded"]) {
    const low = filters[`${prefix}_min` as keyof PoolFilters] as string;
    const high = filters[`${prefix}_max` as keyof PoolFilters] as string;
    for (const value of [low, high])
      if (
        value.trim() &&
        (!/^\d+(\.\d+)?$/.test(value.trim()) ||
          !Number.isFinite(Number(value)) ||
          Number(value) > 1e15)
      )
        throw new Error("Enter valid, non-negative numbers for ranges.");
    if (low.trim() && high.trim() && Number(low) > Number(high))
      throw new Error("Minimum values must not exceed maximum values.");
    if (prefix === "founded")
      for (const value of [low, high])
        if (
          value.trim() &&
          (!Number.isInteger(Number(value)) ||
            Number(value) < 1000 ||
            Number(value) > 2100)
        )
          throw new Error("Enter founding years between 1000 and 2100.");
    out[`${prefix}_min`] = low.trim() ? Number(low) : null;
    out[`${prefix}_max`] = high.trim() ? Number(high) : null;
  }
  if (filters.domain.trim() && !normalizeDomain(filters.domain))
    throw new Error("Enter a valid company domain.");
  out.domain = normalizeDomain(filters.domain);
  out.technologies = [...new Set(filters.technologies)].slice(0, 20);
  return out;
}
export function matchesProspect(
  p: PoolProspect,
  kind: ProspectKind,
  f: PoolFilters,
): boolean {
  if (!hasProspectContact(p) || p.prospect_kind !== kind) return false;
  const includes = (value: string | undefined, query: string) =>
    !query.trim() ||
    (value || "").toLowerCase().includes(query.trim().toLowerCase());
  if (
    !includes(p.company, f.company) ||
    !includes(p.contact_name, f.person) ||
    !includes(p.location, f.location) ||
    !includes(p.industry || p.category, f.industry) ||
    !includes(p.job_title, f.job_title) ||
    !includes(p.department, f.department) ||
    !includes(p.seniority, f.seniority)
  )
    return false;
  if (f.company_size && p.company_size !== f.company_size) return false;
  if (f.domain && p.domain !== normalizeDomain(f.domain)) return false;
  if ((f.has_email && !p.email) || (f.has_phone && !p.phone)) return false;
  if (
    f.technologies.some(
      (t) => !p.technologies?.some((x) => x.toLowerCase() === t.toLowerCase()),
    )
  )
    return false;
  const values: Record<string, number | null | undefined> = {
    revenue: p.revenue,
    funding: p.funding_amount,
    founded: p.founded_year,
  };
  for (const [key, value] of Object.entries(values)) {
    const low = f[`${key}_min` as keyof PoolFilters] as string,
      high = f[`${key}_max` as keyof PoolFilters] as string;
    if ((low.trim() || high.trim()) && value == null) return false;
    if (
      (low.trim() && value! < Number(low)) ||
      (high.trim() && value! > Number(high))
    )
      return false;
  }
  const document = [
    p.company,
    p.contact_name,
    p.job_title,
    p.category,
    p.summary,
    p.location,
    ...(p.technologies || []),
  ]
    .join(" ")
    .toLowerCase();
  return f.keyword
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => document.includes(t));
}
export function poolLead(p: PoolProspect, listId: string, id: string): Lead {
  return {
    id,
    list_id: listId,
    pool_prospect_id: p.id,
    prospect_kind: p.prospect_kind,
    company: p.company,
    contact_name: p.contact_name,
    category: p.category,
    location: p.location,
    email: p.email,
    phone: p.phone,
    website: p.website,
    linkedin: p.linkedin,
    source_url: p.source_url,
    industry: p.industry,
    job_title: p.job_title,
    department: p.department,
    seniority: p.seniority,
    company_size: p.company_size,
    revenue: p.revenue,
    funding_amount: p.funding_amount,
    technologies: p.technologies,
    founded_year: p.founded_year,
    domain: p.domain,
    summary: p.summary,
    score: p.email ? 85 : p.phone ? 75 : 60,
    status: "new",
  };
}
export function demoPool(): PoolProspect[] {
  const base = {
    category: "Hospitality",
    location: "Sydney, Australia",
    phone: "",
    website: "https://harborhouse.example",
    linkedin: "",
    source_url: "https://example.com",
    company_size: "11-50",
    revenue: null,
    funding_amount: null,
    technologies: ["WordPress"],
    founded_year: 2016,
    domain: "harborhouse.example",
    summary: "Fictional boutique hospitality business. Demo data only.",
    first_seen_at: "2026-01-01T00:00:00Z",
    last_seen_at: "2026-01-01T00:00:00Z",
  };
  return [
    {
      ...base,
      id: "demo-company-1",
      prospect_kind: "company",
      company: "Harbor House",
      contact_name: "",
      email: "hello@harborhouse.example",
    },
    {
      ...base,
      id: "demo-company-2",
      prospect_kind: "company",
      company: "Verde Studio",
      contact_name: "",
      email: "team@verdestudio.example",
      category: "Design",
      location: "Lagos, Nigeria",
      domain: "verdestudio.example",
      website: "https://verdestudio.example",
      company_size: "1-10",
      technologies: ["Webflow"],
      founded_year: 2020,
    },
    {
      ...base,
      id: "demo-person-1",
      prospect_kind: "person",
      company: "Harbor House",
      contact_name: "Alex Morgan",
      job_title: "Founder",
      seniority: "Founder",
      department: "Operations",
      email: "alex@harborhouse.example",
    },
    {
      ...base,
      id: "demo-person-2",
      prospect_kind: "person",
      company: "Verde Studio",
      contact_name: "Jordan Ellis",
      job_title: "Marketing Director",
      seniority: "Director",
      department: "Marketing",
      email: "jordan@verdestudio.example",
      category: "Design",
      location: "Lagos, Nigeria",
      domain: "verdestudio.example",
      website: "https://verdestudio.example",
      company_size: "1-10",
      technologies: ["Webflow"],
    },
  ];
}
