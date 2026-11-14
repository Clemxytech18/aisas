export type UpworkJob = {
  id: string;
  external_id: string;
  title: string;
  description: string;
  url: string;
  company: string;
  location: string;
  budget: string;
  skills: string[];
  posted_at: string;
  context?: string;
};
export type UpworkContact = {
  kind: "email" | "phone" | "website" | "linkedin" | "social";
  value: string;
  source_url: string;
  quote: string;
};
export type UpworkReport = {
  outcome: "contact_found" | "profiles_found" | "nothing_found";
  company: string;
  summary: string;
  contacts: UpworkContact[];
  sources: { url: string; quote: string }[];
  searched_at: string;
  queries: string[];
  partial?: boolean;
};
export type UpworkApplication = {
  id: string;
  job_id: string;
  email: string;
  subject: string;
  body: string;
  status: "sending" | "sent" | "failed" | "uncertain";
  error?: string;
  created_at: string;
  sent_at?: string;
};
export const UPWORK_MCP = "https://mcp.upwork.com/mcp";
export const UPWORK_AUTHORIZE =
  "https://www.upwork.com/ab/account-security/oauth2/authorize";
export const UPWORK_TOKEN = "https://www.upwork.com/api/v3/oauth2/token";
export const UPWORK_REVOKE =
  "https://www.upwork.com/api/v3/oauth2/token/revoke";
export function externalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2000) return "";
  try {
    const u = new URL(value);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes(".") ||
      /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|invalid|test)$/.test(u.hostname)
    )
      return "";
    u.hash = "";
    return u.href;
  } catch {
    return "";
  }
}
export function upworkJobUrl(value: unknown): string {
  const safe = externalUrl(value);
  if (!safe) return "";
  const u = new URL(safe);
  return /(?:^|\.)upwork\.com$/.test(u.hostname) &&
    /^\/(?:jobs|freelance-jobs|ab\/proposals\/job)\//.test(u.pathname)
    ? safe
    : "";
}
const str = (v: any): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
export function normalizeUpworkJobs(value: unknown): UpworkJob[] {
  const jobs = new Map<string, UpworkJob>();
  let visited = 0;
  function walk(v: any, depth = 0) {
    if (!v || depth > 18 || ++visited > 25000) return;
    if (typeof v === "string") {
      if (v.length < 1000000 && /^[\[{]/.test(v.trim()))
        try {
          walk(JSON.parse(v), depth + 1);
        } catch {}
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (typeof v !== "object") return;
    const title = str(v.title || v.jobTitle || v.job_title || v.headline),
      description = str(
        v.description ||
          v.jobDescription ||
          v.job_description ||
          v.summary ||
          v.snippet,
      );
    const original = str(
        v.url || v.link || v.jobUrl || v.job_url || v.canonicalUrl,
      ),
      cipher = str(v.ciphertext || v.ciphertextId || v.ciphertext_id),
      uid = str(v.id || v.uid || v.jobId || v.job_id || cipher);
    const url =
      upworkJobUrl(original) ||
      (/^~[a-z0-9]+$/i.test(cipher || uid)
        ? `https://www.upwork.com/jobs/${cipher || uid}`
        : "");
    if (title && uid && (description || url)) {
      const external_id = uid.slice(0, 200);
      const client = v.client || v.buyer || {};
      const company = str(
        v.companyName ||
          v.company_name ||
          v.company?.name ||
          client.company?.name ||
          client.companyName,
      );
      const location = str(
        v.location?.country ||
          v.location?.name ||
          v.location ||
          client.location?.country ||
          client.location?.city ||
          client.country,
      );
      const amount =
        v.budget?.amount ||
        v.budget ||
        v.amount?.amount ||
        v.fixedPriceAmount?.amount;
      const budget =
        typeof amount === "number" || typeof amount === "string"
          ? String(amount)
          : str(v.budget?.displayValue || v.compensation?.displayValue);
      const skillList = v.skills || v.ontologySkills || v.tags || [];
      const skills = Array.isArray(skillList)
        ? skillList
            .map((s) => str(s?.prettyName || s?.name || s))
            .filter(Boolean)
            .slice(0, 30)
        : [];
      jobs.set(external_id, {
        id: "",
        external_id,
        title: title.slice(0, 500),
        description: description.slice(0, 30000),
        url,
        company: company.slice(0, 300),
        location: location.slice(0, 300),
        budget: budget.slice(0, 200),
        skills,
        context: JSON.stringify(
          Object.fromEntries(
            Object.entries(v).filter(([k]) =>
              [
                "client",
                "buyer",
                "category",
                "subcategory",
                "projectType",
                "duration",
                "experienceLevel",
                "engagement",
                "workload",
              ].includes(k),
            ),
          ),
        ).slice(0, 16000),
        posted_at: str(
          v.createdDateTime ||
            v.publishedOn ||
            v.posted_at ||
            v.created_at ||
            v.dateCreated,
        ),
      });
    }
    for (const [k, x] of Object.entries(v))
      if (!["description", "jobDescription", "job_description"].includes(k))
        walk(x, depth + 1);
  }
  walk(value);
  return [...jobs.values()].slice(0, 50);
}
export function registeredUpworkClient(value: unknown): string {
  const client = typeof value === "string" ? value.trim() : "";
  if (
    !client ||
    client.length > 300 ||
    /[\s\x00-\x1f]/.test(client) ||
    /[:/\\?#]/.test(client)
  )
    throw new Error(
      "Upwork setup is incomplete. AISAS needs an approved, enabled Upwork OAuth client ID. Ask the administrator to configure aisas_UPWORK_CLIENT_ID in Supabase Vault.",
    );
  return client;
}
export function upworkOAuthReady(value: unknown): boolean {
  try {
    registeredUpworkClient(value);
    return true;
  } catch {
    return false;
  }
}
export function authorizationUrl(
  client: string,
  redirect: string,
  state: string,
  challenge: string,
) {
  const u = new URL(UPWORK_AUTHORIZE);
  Object.entries({
    response_type: "code",
    client_id: registeredUpworkClient(client),
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: UPWORK_MCP,
  }).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.href;
}
export function applicationInput(value: any) {
  const subject =
    typeof value?.subject === "string" ? value.subject.trim() : "";
  const body = typeof value?.body === "string" ? value.body.trim() : "";
  if (!subject || subject.length > 250 || /[\r\n\x00-\x1f]/.test(subject))
    throw new Error("Enter a subject of up to 250 characters on one line.");
  if (!body || body.length > 15000 || body.includes("\0"))
    throw new Error("Enter an application message of up to 15,000 characters.");
  if (value.permission_confirmed !== true)
    throw new Error(
      "Confirm that Upwork permits you to contact this client outside Upwork.",
    );
  return { subject, body };
}
export function groundedUpworkReport(
  raw: any,
  job: UpworkJob,
  sources: { url: string; text: string }[],
  queries: string[],
): UpworkReport {
  const company =
    typeof raw?.company === "string" ? raw.company.trim().slice(0, 300) : "";
  const verified = sources.filter((s) => externalUrl(s.url) && s.text);
  const proof = (v: any) =>
    typeof v?.quote === "string" &&
    v.quote.length >= 8 &&
    v.quote.length <= 700 &&
    verified.some(
      (s) =>
        s.url === v.source_url &&
        s.text.toLowerCase().includes(v.quote.toLowerCase()),
    );
  const identity = (
    Array.isArray(raw?.identity_evidence) ? raw.identity_evidence : []
  )
    .filter(proof)
    .filter(
      (p: any) =>
        p.quote.toLowerCase().includes(company.toLowerCase()) &&
        company.length >= 3,
    );
  // A masked client must be identified by a matching public job post, never by location or a guessed name.
  const known =
    company &&
    ((job.company && company.toLowerCase() === job.company.toLowerCase()) ||
      job.description.toLowerCase().includes(company.toLowerCase()));
  const matchingIdentity = identity.filter((p: any) => {
    const s = verified.find((x) => x.url === p.source_url)!;
    return (
      !!known ||
      (job.title.length >= 40 &&
        s.text.toLowerCase().includes(job.title.toLowerCase()))
    );
  });
  const contacts: UpworkContact[] = [];
  if (company && matchingIdentity.length)
    for (const c of Array.isArray(raw?.contacts) ? raw.contacts : []) {
      if (!proof(c) || typeof c.value !== "string") continue;
      const value = c.value.trim(),
        kind = c.kind;
      const source = verified.find((s) => s.url === c.source_url)!;
      const sameIdentity =
        source.text.toLowerCase().includes(company.toLowerCase()) ||
        matchingIdentity.some(
          (p: any) =>
            new URL(p.source_url).hostname === new URL(source.url).hostname,
        );
      if (!sameIdentity || !c.quote.toLowerCase().includes(value.toLowerCase()))
        continue;
      if (kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        continue;
      if (
        kind === "phone" &&
        (value.replace(/\D/g, "").length < 7 ||
          value.replace(/\D/g, "").length > 16)
      )
        continue;
      if (
        ["website", "linkedin", "social"].includes(kind) &&
        !externalUrl(value)
      )
        continue;
      if (!["email", "phone", "website", "linkedin", "social"].includes(kind))
        continue;
      if (
        kind === "linkedin" &&
        !/(?:^|\.)linkedin\.com$/.test(new URL(value).hostname)
      )
        continue;
      if (
        !contacts.some(
          (x) =>
            x.kind === kind && x.value.toLowerCase() === value.toLowerCase(),
        )
      )
        contacts.push({
          kind,
          value,
          source_url: c.source_url,
          quote: c.quote,
        });
    }
  const outcome = contacts.some((c) => c.kind === "email" || c.kind === "phone")
    ? "contact_found"
    : contacts.length
      ? "profiles_found"
      : "nothing_found";
  return {
    outcome,
    company: contacts.length ? company : "",
    summary: contacts.length
      ? "Public details matched to the identified client or company. Review the evidence before using them."
      : "Nothing found. No client identity and contact details could be confirmed from the available public sources.",
    contacts: contacts.slice(0, 20),
    sources: matchingIdentity
      .map((p: any) => ({ url: p.source_url, quote: p.quote }))
      .slice(0, 5),
    searched_at: new Date().toISOString(),
    queries,
  };
}
