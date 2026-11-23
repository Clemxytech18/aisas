import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  blankAuditLead,
  prepareAuditLeads,
  auditLeadErrors,
  auditUrl,
  draftAuditMessages,
  validAuditSequence,
  type AuditSource,
  type AuditReport,
} from "../src/audits";
import {
  readLeadFile,
  importGrid,
  guessMapping,
  mapLeadRows,
} from "../src/audit-import";
import {
  auditHtml,
  groundedAudit,
  auditBusiness,
  collectAuditSources,
} from "../src/audit-evidence";
import {
  generateAuditedSequence,
  auditedCampaignData,
} from "../src/audit-service";
import { sourceUrl } from "../src/scout-pages";
import { renderMessage, validateMessages } from "../src/domain";
import { sendPayload } from "../src/campaign-delivery";
const id = "10000000-0000-4000-8000-000000000001";
const lead = {
  ...blankAuditLead(id),
  first_name: "Ada",
  email: "Ada@fashion.example",
  company: "Fashion Studio",
  website: "https://fashion.example",
};
const publicIp = async () => ["93.184.216.34"];
test("audit inputs require first name, email, business and website while lastname and social links remain optional", () => {
  assert.deepEqual(auditLeadErrors(lead), {});
  assert.equal(Object.keys(auditLeadErrors(blankAuditLead(id))).length, 4);
  const saved = prepareAuditLeads([lead])[0];
  assert.equal(saved.email, "ada@fashion.example");
  assert.equal(saved.website, "https://fashion.example/");
  assert.equal(saved.last_name, "");
  assert.throws(() =>
    prepareAuditLeads([
      lead,
      { ...lead, id: "20000000-0000-4000-8000-000000000002" },
    ]),
  );
  assert.throws(() => prepareAuditLeads([{ ...lead, email: "bad" }]));
  assert.throws(() => prepareAuditLeads(Array(501).fill(lead)));
});
test("public URLs reject private destinations, credentials and mismatched social platforms", () => {
  for (const url of [
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://host.internal",
    "https://user:pass@example.com",
    "file:///etc/passwd",
    "http://example.com:9000",
    "http://[::1]",
  ])
    assert.equal(auditUrl(url), "");
  assert.equal(
    auditUrl("https://instagram.com/brand", "instagram_url"),
    "https://instagram.com/brand",
  );
  assert.equal(
    auditUrl("https://instagram.com.evil.example/brand", "instagram_url"),
    "",
  );
  assert.equal(auditUrl("https://tiktok.com/@brand", "facebook_url"), "");
});
test("CSV imports retain quoted commas and support explicit column mapping with optional fields missing", () => {
  const csv =
    'First name,Email,Store/Business name,Store/website url\r\nAda,ada@fashion.example,"Fashion, Studio",https://fashion.example\r\n';
  const file = readLeadFile(new TextEncoder().encode(csv), "leads.csv");
  const grid = importGrid(file, file.sheets[0]);
  const mapping = guessMapping(grid.headers);
  const rows = mapLeadRows(grid, mapping, () => id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company, "Fashion, Studio");
  assert.equal(rows[0].first_name, "Ada");
  assert.equal(rows[0].last_name, "");
  assert.equal(mapping.website, 3);
  const duplicate = { ...mapping, last_name: mapping.first_name };
  assert.throws(() => mapLeadRows(grid, duplicate, () => id));
});
test("Excel imports support sheet selection and never evaluate formula cells", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["Other"], ["Ignore"]]),
    "Notes",
  );
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Firstname", "Email", "Business name", "Website"],
    ["Ada", "ada@fashion.example", "Fashion Studio", "https://fashion.example"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Leads");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = readLeadFile(bytes, "leads.xlsx");
  assert.deepEqual(file.sheets, ["Notes", "Leads"]);
  let grid = importGrid(file, "Leads");
  assert.equal(
    mapLeadRows(grid, guessMapping(grid.headers), () => id)[0].first_name,
    "Ada",
  );
  file.workbook.Sheets.Leads.A2 = {
    t: "s",
    v: "Ada",
    f: 'HYPERLINK("https://example.com","Ada")',
  };
  grid = importGrid(file, "Leads");
  assert.throws(
    () => mapLeadRows(grid, guessMapping(grid.headers), () => id),
    /formula/,
  );
  assert.throws(() =>
    readLeadFile(new Uint8Array(5 * 1024 * 1024 + 1), "too-large.xlsx"),
  );
  assert.throws(() => readLeadFile(bytes, "document.pdf"));
});
test("formula protection still applies after blank rows and when the sheet starts away from A1", () => {
  const ws = XLSX.utils.sheet_add_aoa(
    {},
    [
      ["Firstname", "Email", "Business name", "Website"],
      ["Ada", "ada@fashion.example", "Fashion", "https://fashion.example"],
      [],
      ["Joe", "joe@fashion.example", "Other", "https://other.example"],
    ],
    { origin: "C5" },
  );
  ws.C8 = { t: "s", v: "Joe", f: '"Joe"' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const file = { workbook: wb, sheets: ["Leads"] };
  const grid = importGrid(file, "Leads");
  assert.throws(
    () => mapLeadRows(grid, guessMapping(grid.headers), () => id),
    /formula/,
  );
});
const html =
  '<html><head><title>Fashion Studio</title></head><body><h1>Our collection</h1><p>Browse our latest designs and read about our craft.</p><a href="/contact">Contact us</a><script>not visible</script></body></html>';
const source = auditHtml(html, lead.website, "cro", "website");
test("CRO observations describe fetched HTML and never pretend to measure conversion or speed", () => {
  assert.ok(
    source.observations.some((s) => s.startsWith("No mobile viewport")),
  );
  assert.ok(source.observations.some((s) => s.includes("Contact us")));
  assert.ok(!source.text.includes("not visible"));
  assert.ok(source.observations.some((s) => s.includes("were not measured")));
});
test("grounded audits reject invented quotes, unsupported numerical claims and ungrounded offers", () => {
  const result = groundedAudit(
    {
      findings: [
        {
          area: "cro",
          source_id: "website",
          quote: source.observations[1],
          issue: "The fetched HTML does not contain a mobile viewport tag.",
          solution: "Review mobile presentation",
        },
        {
          area: "cro",
          source_id: "website",
          quote: "This quote does not exist",
          issue: "Invented loss",
          solution: "Fix",
        },
        {
          area: "cro",
          source_id: "website",
          quote: source.observations[1],
          issue: "Conversion dropped 45%",
          solution: "Fix",
        },
      ],
      best_offer:
        "a mobile presentation and clarity review with a practical improvement plan",
      offer_source_ids: ["website"],
    },
    [source],
  );
  assert.equal(result.findings.length, 1);
  assert.ok(result.best_offer.includes("mobile presentation"));
  assert.ok(!result.issues.includes("45%"));
  assert.ok(result.social_performance.includes("No social links"));
  const noEvidence = groundedAudit(
    { best_offer: "Guaranteed double revenue", offer_source_ids: [] },
    [],
  );
  assert.ok(noEvidence.cro_performance.includes("unknown"));
  assert.ok(!noEvidence.best_offer.includes("Guaranteed"));
});
test("blocked social pages are unknown rather than poor social performance", () => {
  const social: AuditSource = {
    id: "social-1",
    area: "social",
    url: "https://instagram.com/brand",
    title: "",
    status: "blocked",
    text: "",
    observations: [],
  };
  const result = groundedAudit(
    {
      findings: [
        {
          area: "social",
          source_id: social.id,
          quote: "Their engagement is poor",
          issue: "Bad engagement",
          solution: "Social management",
        },
      ],
    },
    [source, social],
  );
  assert.equal(result.findings.length, 0);
  assert.ok(result.social_performance.includes("unknown"));
  assert.ok(!result.social_performance.includes("Bad engagement"));
});
test("audit fetching retains DNS/robots protections and grants social access only explicitly", async () => {
  assert.equal(sourceUrl("https://instagram.com/brand"), "");
  assert.equal(
    sourceUrl("https://instagram.com/brand", true),
    "https://instagram.com/brand",
  );
  let calls = 0;
  const fetcher = (async (url: any) => {
    calls++;
    if (String(url).endsWith("/robots.txt"))
      return new Response("User-agent: *\nDisallow: /", {
        headers: { "Content-Type": "text/plain" },
      });
    throw new Error("Page must not be fetched");
  }) as typeof fetch;
  const result = await collectAuditSources(
    { ...lead, instagram_url: "https://instagram.com/brand" },
    { resolve: publicIp, fetcher },
  );
  assert.equal(calls, 2);
  assert.ok(result.every((s) => s.status === "blocked"));
  let aiCalls = 0;
  const audited = await auditBusiness(lead, {
    key: "test",
    resolve: async () => ["127.0.0.1"],
    fetcher: (async () => {
      aiCalls++;
      throw new Error();
    }) as typeof fetch,
  });
  assert.equal(aiCalls, 0);
  assert.ok(audited.cro_performance.includes("unknown"));
});
test("audited campaign messages use each recipient's actual issue and offer without cross-recipient leakage", () => {
  const messages = draftAuditMessages();
  assert.equal(validateMessages(messages), true);
  assert.equal(validAuditSequence(messages), true);
  const a = {
    ...lead,
    contact_name: "Ada",
    audit_context: {
      ...lead,
      last_name: "",
      cro_performance: "CRO A",
      social_performance: "Social A",
      issues: "Observed issue A",
      best_offer: "Offer A",
    },
  };
  const b = {
    ...a,
    first_name: "Joe",
    company: "Other",
    audit_context: {
      ...a.audit_context,
      first_name: "Joe",
      company: "Other",
      issues: "Issue B",
      best_offer: "Offer B",
    },
  };
  const first = renderMessage(messages[0].body, a);
  const second = renderMessage(messages[0].body, b);
  assert.ok(
    first.includes("Ada") &&
      first.includes("Observed issue A") &&
      first.includes("Offer A"),
  );
  assert.ok(!second.includes("Offer A"));
  assert.ok(second.includes("Joe") && second.includes("Offer B"));
  const payload = sendPayload(
    {
      lead: a,
      message: messages[0],
      audit_context: a.audit_context,
      ideal_context: {},
      sender_name: "Sender",
    },
    "campaign",
  );
  assert.ok(payload.body.includes("Offer A"));
  assert.ok(payload.body.includes("Sender"));
  assert.equal(
    validAuditSequence(
      messages.map((m) => ({ ...m, body: "Generic sales pitch" })),
    ),
    false,
  );
});
function campaignDb(report: AuditReport | undefined, owned = true) {
  const calls: any[] = [];
  return {
    calls,
    db: {
      from(table: string) {
        const q: any = {
          select: () => q,
          eq: (key: string, value: string) => {
            calls.push({ table, key, value });
            return q;
          },
          order: () => q,
          limit: () => q,
        };
        q.maybeSingle = async () => ({
          data: owned ? { id: "list", status: "audited" } : null,
          error: null,
        });
        q.then = (resolve: any) =>
          Promise.resolve({
            data: table === "leads" ? [lead] : report ? [report] : [],
            error: null,
          }).then(resolve);
        return q;
      },
      rpc: async () => ({ data: null, error: null }),
    },
  };
}
const report: AuditReport = {
  ...groundedAudit({}, [source]),
  lead_id: id,
  list_id: "list",
  status: "completed",
  audited_at: new Date().toISOString(),
  last_error: null,
};
test("audited campaign preparation checks list ownership and requires a completed report for every lead", async () => {
  const { db, calls } = campaignDb(report);
  const r = await auditedCampaignData(db, "owner", "list");
  assert.equal(r.contexts.size, 1);
  assert.ok(calls.some((c) => c.key === "owner_id" && c.value === "owner"));
  await assert.rejects(
    auditedCampaignData(campaignDb(undefined).db, "owner", "list"),
  );
  await assert.rejects(
    auditedCampaignData(campaignDb(report, false).db, "other", "list"),
  );
});
test("AI sequence generation uses audit fields and rejects output that omits recipient-specific offers", async () => {
  let input: any;
  const fetcher = (async (_u: any, init: any) => {
    input = JSON.parse(init.body);
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({ messages: draftAuditMessages() }),
          },
        },
      ],
    });
  }) as typeof fetch;
  const sequence = await generateAuditedSequence(
    campaignDb(report).db,
    "owner",
    "list",
    "test-key",
    undefined,
    fetcher,
  );
  assert.equal(sequence.length, 4);
  assert.ok(input.messages[1].content.includes("best_offer"));
  assert.ok(input.messages[1].content.includes("cro_performance"));
  const bad = (async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              messages: draftAuditMessages().map((m) => ({
                ...m,
                body: "No personalized offer",
              })),
            }),
          },
        },
      ],
    })) as typeof fetch;
  await assert.rejects(
    generateAuditedSequence(
      campaignDb(report).db,
      "owner",
      "list",
      "key",
      undefined,
      bad,
    ),
  );
});
