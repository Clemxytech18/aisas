import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDEAL_FIELDS,
  emptyIdealCriteria,
  prepareIdealCriteria,
  groundQualification,
  idealObservation,
  withIdealObservation,
  type IdealCriteria,
  type ProspectEvidence,
} from "../src/ideal-profile";
import { generateIdealCriteria, qualifyIdealCandidates } from "../src/ideal-ai";
import { createIdealScoutState, idealScoutStep } from "../src/ideal-scout";
import { candidateSources } from "../src/ideal-evidence";
import { DEFAULT_SCOUT_OPTIONS } from "../src/scout-types";
import { renderMessage } from "../src/domain";
import { sendPayload } from "../src/campaign-delivery";
export const criteria: IdealCriteria = {
  business: "Residential HVAC repair contractors",
  decision_maker: "Owner responsible for scheduling",
  starting_segment: "3–20 field technicians",
  main_problem: "Missed calls during busy periods",
  secondary_problem: "Manual reminders",
  buying_triggers: "Hiring or peak-season growth",
  prospecting_signals: "Phone-first website or public reviews about callbacks",
};
const url = "https://acme.example/";
const quotes = {
  business: "We offer residential HVAC repair.",
  decision_maker: "Jane Doe is the owner overseeing scheduling.",
  starting_segment: "Our field team has 8 technicians.",
  prospecting_signals: "Call our office to request a callback.",
};
const source: ProspectEvidence = {
  url,
  kind: "website",
  text: Object.values(quotes).join(" ") + " Serving Austin, Texas.",
};
function rawReport(overrides: Record<string, any> = {}) {
  return {
    score: 100,
    decision_maker_name: "Jane Doe",
    decision_maker_role: "owner",
    checks: IDEAL_FIELDS.map(([area]) => ({
      area,
      status: area in quotes ? "match" : "unknown",
      reason: "Supported by the supplied source.",
      evidence:
        area in quotes
          ? [{ url, quote: quotes[area as keyof typeof quotes] }]
          : [],
      ...overrides[area],
    })),
  };
}
const response = (data: any) => Response.json(data);
test("all seven ideal fields are required and HVAC examples are placeholders rather than stored values", () => {
  assert.ok(IDEAL_FIELDS[0][2].includes("HVAC"));
  assert.ok(Object.values(emptyIdealCriteria()).every((v) => v === ""));
  assert.throws(() => prepareIdealCriteria({}), /Business/);
  assert.throws(
    () => prepareIdealCriteria({ ...criteria, starting_segment: " " }),
    /Starting segment/,
  );
  assert.throws(() =>
    prepareIdealCriteria({ ...criteria, business: "x".repeat(2001) }),
  );
  assert.deepEqual(prepareIdealCriteria(criteria), criteria);
});
test("qualification score is computed, core fit and a real opportunity signal are mandatory, and hypotheses remain unknown", () => {
  const report = groundQualification(rawReport(), criteria, [source]);
  assert.equal(report.score, 75);
  assert.equal(report.qualified, true);
  assert.equal(
    report.checks.find((c) => c.area === "main_problem")?.status,
    "unknown",
  );
  assert.equal(report.decision_maker_name, "Jane Doe");
  const missing = groundQualification(
    rawReport({ starting_segment: { status: "unknown", evidence: [] } }),
    criteria,
    [source],
  );
  assert.equal(missing.qualified, false);
  assert.equal(missing.score, 55);
  assert.equal(
    groundQualification(
      rawReport({ prospecting_signals: { status: "unknown", evidence: [] } }),
      criteria,
      [source],
    ).qualified,
    false,
  );
});
test("invented quotes, URLs, scores and expanded decision-maker names cannot become verified facts", () => {
  const invented = groundQualification(
    rawReport({
      starting_segment: {
        status: "match",
        evidence: [{ url, quote: "Our team has 12 full-time technicians." }],
      },
    }),
    criteria,
    [source],
  );
  assert.equal(invented.qualified, false);
  assert.equal(
    invented.checks.find((c) => c.area === "starting_segment")?.status,
    "unknown",
  );
  const wrongUrl = groundQualification(
    rawReport({
      decision_maker: {
        status: "match",
        evidence: [
          { url: "https://other.example", quote: quotes.decision_maker },
        ],
      },
    }),
    criteria,
    [source],
  );
  assert.equal(wrongUrl.qualified, false);
  const raw = { ...rawReport(), decision_maker_name: "Jane Alexandra Doe" };
  assert.equal(
    groundQualification(raw, criteria, [source]).decision_maker_name,
    undefined,
  );
});
test("review evidence stays an attributed opinion and rendered anchors are escaped in delivered email", () => {
  const review = {
    url: "https://www.google.com/maps/search/?api=1",
    kind: "review" as const,
    text: "Public review: We waited three days for a callback.",
  };
  const report = groundQualification(
    rawReport({
      prospecting_signals: {
        status: "match",
        evidence: [
          { url: review.url, quote: "We waited three days for a callback." },
        ],
      },
    }),
    criteria,
    [source, review],
  );
  assert.equal(report.qualified, true);
  assert.match(idealObservation(report), /^A public review mentions:/);
  const lead = { company: "Acme & Co", ideal_qualification: report };
  assert.match(
    renderMessage("{{company}}: {{ideal_observation}}", lead),
    /Acme & Co: A public review/,
  );
  const sent = sendPayload(
    {
      lead: { ...lead, email: "office@acme.example" },
      ideal_context: report,
      message: {
        subject: "Hello {{company}}",
        body: "Hi,\n{{ideal_observation}}\nIf callbacks are a priority, can we share ideas?",
      },
    },
    "campaign",
  );
  assert.match(sent.body, /A public review mentions/);
  assert.match(sent.subject, /Acme & Co/);
  assert.equal(
    renderMessage("{{ideal_observation}}", { company: "Generic" }),
    "",
  );
});
test("AI-defined criteria use the selected audience context and remain editable target hypotheses", async () => {
  let context: any;
  const generated = await generateIdealCriteria(
    { audience: "Dental clinics", offer: "Appointment reminders" },
    "PRIVATE",
    async (_input, init) => {
      context = JSON.parse(String(init?.body));
      return response({
        choices: [
          {
            message: {
              content: JSON.stringify({
                criteria: {
                  ...criteria,
                  business: "Independent dental clinics",
                },
              }),
            },
          },
        ],
      });
    },
  );
  assert.equal(generated.business, "Independent dental clinics");
  assert.match(context.messages[1].content, /Dental clinics/);
  assert.equal(context.messages[1].content.includes("PRIVATE"), false);
  assert.match(context.messages[0].content, /not a researched fact/);
});
test("malformed AI batches fail instead of silently assessing absent candidates as unsuitable", async () => {
  await assert.rejects(
    qualifyIdealCandidates(
      [
        {
          id: "one",
          company: "Acme",
          contact_name: "",
          location: "Austin",
          sources: [source],
        },
      ],
      criteria,
      "PRIVATE",
      async () =>
        response({ choices: [{ message: { content: '{"results":[]}' } }] }),
    ),
    /ideal_ai_unavailable/,
  );
});
const plan = {
  business_terms: ["residential HVAC contractors"],
  role_terms: ["owner"],
  signal_terms: ["callback"],
};
function state() {
  return createIdealScoutState(
    { audience: "HVAC", location: "Austin" },
    "company",
    {
      ...DEFAULT_SCOUT_OPTIONS,
      target: 1,
      searchBudget: 1,
      sourceBudget: 10,
      aiBudget: 5,
    },
    "boolean",
    { id: "ideal", name: "HVAC ideal" },
    criteria,
    plan,
  );
}
function fetcher(qualified = true): typeof fetch {
  return async (input, init) => {
    const u = new URL(String(input));
    if (u.hostname === "serpapi.com")
      return response({
        organic_results: [
          {
            title: "Acme Heating",
            link: url,
            website: url,
            email: "office@acme.example",
            snippet: source.text,
          },
        ],
      });
    if (u.hostname === "api.openai.com") {
      const data = JSON.parse(String(init?.body));
      const value = JSON.parse(data.messages[1].content);
      return response({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: value.candidates.map((c: any) => ({
                  id: c.id,
                  ...rawReport(
                    qualified
                      ? {}
                      : {
                          starting_segment: { status: "unknown", evidence: [] },
                        },
                  ),
                })),
              }),
            },
          },
        ],
      });
    }
    if (u.pathname === "/robots.txt")
      return new Response("User-agent: *\nAllow: /");
    return new Response(
      `<html><title>Acme Heating</title><body>${source.text}<a href="mailto:office@acme.example">Email</a></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  };
}
test("Ideal Prospects discovery never saves raw leads; a later grounded qualification step saves only qualified contact records", async () => {
  let s = state();
  const deps = {
    key: "PRIVATE",
    aiKey: "PRIVATE_AI",
    resolve: async () => ["93.184.216.34"],
    fetcher: fetcher(),
  };
  const discovery = await idealScoutStep(s, deps);
  assert.equal(discovery.changed.length, 0);
  assert.equal(discovery.state.stats.saved, 0);
  assert.ok(discovery.state.discovery.records.length > 0);
  let result = discovery;
  for (let i = 0; i < 8 && !result.state.done; i++)
    result = await idealScoutStep(
      JSON.parse(JSON.stringify(result.state)),
      deps,
    );
  assert.equal(result.state.done, true);
  assert.equal(result.state.reason, "qualified_target_reached");
  assert.equal(result.changed.length, 1);
  assert.equal(result.reports[0].report.score, 75);
  assert.equal(result.changed[0].contact_name, "Jane Doe");
  assert.equal(result.state.stats.saved, 1);
  assert.equal(JSON.stringify(result.state).includes("PRIVATE_AI"), false);
});
test("unknown segment evidence yields no ideal lead and unavailable AI never falls back to unqualified discovery", async () => {
  let s = state();
  const deps = {
    key: "PRIVATE",
    aiKey: "PRIVATE_AI",
    resolve: async () => ["93.184.216.34"],
    fetcher: fetcher(false),
  };
  for (let i = 0; i < 8 && !s.done; i++) {
    const step = await idealScoutStep(s, deps);
    assert.equal(step.changed.length, 0);
    assert.equal(step.reports.length, 0);
    s = step.state;
  }
  assert.equal(s.done, true);
  assert.equal(s.stats.saved, 0);
  assert.equal(s.stats.insufficient_evidence, 1);
  await assert.rejects(
    idealScoutStep(state(), { ...deps, aiKey: undefined }),
    /ideal_ai_authentication/,
  );
});
test("Maps ideal discovery can collect review snippets without author metadata or changing regular scouting", async () => {
  let s = createIdealScoutState(
    { audience: "HVAC", location: "Austin" },
    "company",
    { ...DEFAULT_SCOUT_OPTIONS, target: 1, searchBudget: 3 },
    "google_maps",
    { id: "ideal", name: "HVAC" },
    criteria,
    plan,
  );
  const deps = {
    key: "PRIVATE_MAP_KEY",
    aiKey: "PRIVATE_AI_KEY",
    resolve: async () => ["93.184.216.34"],
    fetcher: (async (input: any) => {
      const u = new URL(String(input));
      if (u.searchParams.get("engine") === "google_maps")
        return response({
          local_results: [
            {
              title: "Acme Heating",
              place_id: "place",
              data_id: "data",
              phone: "+1 512 555 0123",
            },
          ],
        });
      assert.equal(u.searchParams.get("engine"), "google_maps_reviews");
      return response({
        reviews: [
          {
            user: { name: "Do not retain reviewer" },
            snippet: "We waited three days for a callback.",
            date: "a month ago",
          },
        ],
      });
    }) as typeof fetch,
  };
  s = (await idealScoutStep(s, deps)).state;
  s = (await idealScoutStep(s, deps)).state;
  const id = s.discovery.records[0].id;
  assert.ok(candidateSources(s.discovery, id).some((s) => s.kind === "review"));
  assert.equal(JSON.stringify(s).includes("Do not retain reviewer"), false);
  assert.equal(JSON.stringify(s).includes("PRIVATE_MAP_KEY"), false);
});
test("verified observation placeholder is inserted once and preserves all message delays and follow-ups", () => {
  const messages = [
    { step: 0, body: "Hi {{contact_name}},\n\nOur offer.", delay_hours: 0 },
    { step: 1, body: "Follow up", delay_hours: 48 },
  ];
  const next = withIdealObservation(messages);
  assert.match(next[0].body, /ideal_observation/);
  assert.equal(next[1], messages[1]);
  assert.deepEqual(withIdealObservation(next), next);
});

test("review opinions cannot verify core business, role, or team-size facts", () => {
  const report = groundQualification(rawReport(), criteria, [
    { ...source, kind: "review" },
  ]);
  assert.equal(report.qualified, false);
  assert.ok(
    report.checks
      .filter((c) =>
        ["business", "decision_maker", "starting_segment"].includes(c.area),
      )
      .every((c) => c.status === "unknown"),
  );
});
