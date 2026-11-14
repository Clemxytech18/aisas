import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizationUrl,
  registeredUpworkClient,
  upworkOAuthReady,
  UPWORK_MCP,
  normalizeUpworkJobs,
  externalUrl,
  groundedUpworkReport,
  applicationInput,
  type UpworkJob,
} from "../src/upwork";
import {
  readableJobTool,
  selectJobTools,
  validateMcpArguments,
  UpworkMcp,
} from "../src/upwork-mcp";
import {
  researchClues,
  newUpworkResearch,
  upworkResearchStep,
} from "../src/upwork-research";
const job: UpworkJob = {
  id: "job",
  external_id: "~12345",
  title: "Build an AI receptionist for Acme HVAC scheduling",
  description: "Acme HVAC needs an AI receptionist for our dispatch team.",
  company: "Acme HVAC",
  location: "Austin",
  budget: "500",
  skills: [],
  url: "https://www.upwork.com/jobs/~12345",
  posted_at: "",
};
const tool = (name: string, extra: any = {}) => ({
  name,
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  ...extra,
});
test("OAuth uses official endpoints, PKCE, resource binding and state; no password or key in client URL", () => {
  const u = new URL(
    authorizationUrl(
      "approved-fixture-client",
      "https://backend.example/callback",
      "state-value",
      "pkce-challenge",
    ),
  );
  assert.equal(u.origin, "https://www.upwork.com");
  assert.equal(u.searchParams.get("resource"), UPWORK_MCP);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("state"), "state-value");
  assert.equal(u.searchParams.has("client_secret"), false);
});
test("real MCP job JSON and text-wrapped GraphQL results normalize without fabricating details", () => {
  const jobs = normalizeUpworkJobs({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          data: {
            jobs: {
              edges: [
                {
                  node: {
                    id: 123,
                    ciphertext: "~12345",
                    title: job.title,
                    description: job.description,
                    client: {
                      company: { name: "Acme HVAC" },
                      location: { country: "USA" },
                    },
                    skills: [{ name: "AI" }],
                  },
                },
              ],
            },
          },
        }),
      },
    ],
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, "Acme HVAC");
  assert.equal(jobs[0].url, job.url);
  assert.deepEqual(jobs[0].skills, ["AI"]);
  assert.deepEqual(normalizeUpworkJobs({ data: { jobs: [] } }), []);
  assert.deepEqual(normalizeUpworkJobs({ id: 1, title: "tool metadata" }), []);
});
test("external links reject executable schemes, credentials and local hosts", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://foo:bar@evil.example",
    "http://127.0.0.1/",
    "https://internal",
    "https://host.local",
  ])
    assert.equal(externalUrl(value), "");
  assert.equal(
    externalUrl("http://business.example/contact"),
    "http://business.example/contact",
  );
});
test("MCP adapter refuses mutation tools and never selects arbitrary GraphQL execution", () => {
  for (const name of [
    "submit_job_proposal",
    "get_job_and_send_email",
    "create_job",
    "execute_job_query",
    "delete_job",
  ])
    assert.equal(readableJobTool(tool(name)), false, name);
  assert.equal(readableJobTool(tool("search_jobs")), true);
  assert.equal(
    readableJobTool(
      tool("search_jobs", { annotations: { destructiveHint: true } }),
    ),
    false,
  );
  assert.deepEqual(
    selectJobTools(
      [tool("get_job_feed"), tool("search_jobs"), tool("send_proposal")],
      "feed",
    ).map((t) => t.name),
    ["get_job_feed", "search_jobs"],
  );
  assert.deepEqual(
    selectJobTools(
      [tool("get_job_details"), tool("search_jobs")],
      "detail",
    ).map((t) => t.name),
    ["get_job_details"],
  );
});
test("actual tool schema constrains AI-produced arguments including nested refs and required properties", () => {
  const s = {
    type: "object",
    required: ["input"],
    properties: { input: { $ref: "#/$defs/input" } },
    additionalProperties: false,
    $defs: {
      input: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        additionalProperties: false,
      },
    },
  };
  assert.equal(
    validateMcpArguments({ input: { query: "HVAC", limit: 20 } }, s),
    true,
  );
  for (const v of [
    {},
    { input: { query: "" } },
    { input: { query: "HVAC", limit: 1000 } },
    { input: { query: "HVAC", write: true } },
    { input: { query: "HVAC" }, other: 1 },
  ])
    assert.equal(validateMcpArguments(v, s), false);
});
test("MCP initializes sessions, discovers schemas and consumes SSE replies without waiting for stream closure", async () => {
  const methods: string[] = [];
  const f: typeof fetch = async (_u, options) => {
    const b = JSON.parse(String(options?.body));
    methods.push(b.method);
    if (b.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    assert.equal(
      new Headers(options?.headers).get("authorization"),
      "Bearer fixture-token",
    );
    const result =
      b.method === "initialize"
        ? { protocolVersion: "2025-03-26" }
        : b.method === "tools/list"
          ? { tools: [tool("search_jobs")] }
          : { content: [{ type: "text", text: "[]" }] };
    if (b.method === "tools/call")
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: b.id, result })}\n\n`,
              ),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    return Response.json(
      { jsonrpc: "2.0", id: b.id, result },
      { headers: { "Mcp-Session-Id": "fixture-session" } },
    );
  };
  const m = new UpworkMcp("fixture-token", f);
  await m.initialize();
  const tools = await m.tools();
  await m.call(tools[0], { query: "HVAC" });
  await assert.rejects(m.call(tool("submit_job_proposal"), { query: "HVAC" }));
  assert.deepEqual(methods, [
    "initialize",
    "notifications/initialized",
    "tools/list",
    "tools/call",
  ]);
});
test("MCP authorization failures request reconnection without exposing provider body", async () => {
  const m = new UpworkMcp(
    "fixture",
    async () => new Response("private provider details", { status: 401 }),
  );
  await assert.rejects(m.initialize(), /^Error: upwork_reconnect$/);
});
const source = {
  url: "https://acme.example/contact",
  text: "Acme HVAC offers local heating services. Contact Acme HVAC at hello@acme.example or +1 512 555 0134. Website https://acme.example/",
};
const grounded = {
  company: "Acme HVAC",
  identity_evidence: [
    {
      source_url: source.url,
      quote: "Acme HVAC offers local heating services.",
    },
  ],
  contacts: [
    {
      kind: "email",
      value: "hello@acme.example",
      source_url: source.url,
      quote: "Contact Acme HVAC at hello@acme.example or +1 512 555 0134.",
    },
  ],
};
test("contacts require literal evidence and confirmed identity; fabricated contacts and URLs disappear", () => {
  const r = groundedUpworkReport(
    {
      ...grounded,
      contacts: [
        ...grounded.contacts,
        { ...grounded.contacts[0], value: "guessed@acme.example" },
        { ...grounded.contacts[0], source_url: "https://fabricated.example" },
        {
          kind: "website",
          value: "javascript:alert(1)",
          source_url: source.url,
          quote: source.text,
        },
      ],
    },
    job,
    [source],
    ["Acme HVAC"],
  );
  assert.equal(r.outcome, "contact_found");
  assert.equal(r.contacts.length, 1);
  assert.equal(r.contacts[0].value, "hello@acme.example");
});
test("anonymous clients cannot be linked to unrelated company contacts based on a generic title or city", () => {
  const anonymous = {
    ...job,
    company: "",
    description: "Need a website built in Austin",
    title: "Website developer",
  };
  const r = groundedUpworkReport(grounded, anonymous, [source], []);
  assert.equal(r.outcome, "nothing_found");
  assert.deepEqual(r.contacts, []);
});
test("a matching distinctive public job repost can establish a client identity", () => {
  const anonymous = {
    ...job,
    company: "",
    description: "Build an AI receptionist for our dispatch team.",
  };
  const r = groundedUpworkReport(
    grounded,
    anonymous,
    [{ ...source, text: source.text + " " + job.title }],
    [],
  );
  assert.equal(r.outcome, "contact_found");
});
test("website/social fallback is distinct from contact details and an empty result is explicit", () => {
  const r = groundedUpworkReport(
    {
      ...grounded,
      contacts: [
        {
          kind: "website",
          value: "https://acme.example/",
          source_url: source.url,
          quote: "Website https://acme.example/",
        },
      ],
    },
    job,
    [source],
    [],
  );
  assert.equal(r.outcome, "profiles_found");
  assert.equal(
    groundedUpworkReport({}, job, [source], []).outcome,
    "nothing_found",
  );
});
test("research clue expansion accepts only literal job/source quotes, never invented company names", () => {
  assert.deepEqual(
    researchClues(
      {
        clues: [
          { value: "Acme HVAC", quote: "Acme HVAC needs an AI receptionist" },
          { value: "Invented Ltd", quote: "Invented Ltd needs help" },
        ],
      },
      job.description,
    ),
    [{ value: "Acme HVAC", quote: "Acme HVAC needs an AI receptionist" }],
  );
});
test("deep scouting completes multiple discovery stages with mocked providers and source-grounded contact", async () => {
  let aiCalls = 0;
  const f: typeof fetch = async (input, options) => {
    const u = new URL(String(input));
    if (u.hostname === "api.openai.com") {
      aiCalls++;
      const payload = JSON.parse(String(options?.body));
      const system = payload.messages[0].content;
      const response = system.startsWith("Analyze")
        ? {
            clues: [
              {
                value: "Acme HVAC",
                quote: "Acme HVAC needs an AI receptionist",
              },
            ],
            queries: ['"Acme HVAC" contact'],
          }
        : system.startsWith("Follow")
          ? { clues: [], queries: [] }
          : grounded;
      return Response.json({
        choices: [{ message: { content: JSON.stringify(response) } }],
      });
    }
    if (u.hostname === "serpapi.com")
      return Response.json({
        organic_results: [
          { title: job.title, link: source.url, snippet: source.text },
        ],
      });
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    return new Response(
      `<html><title>Acme HVAC</title><body>${source.text}</body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  };
  let state = newUpworkResearch(job);
  for (let i = 0; i < 40 && state.phase !== "done"; i++)
    state = await upworkResearchStep(state, job, {
      key: "fixture-serp",
      aiKey: "fixture-ai",
      resolve: async () => ["8.8.8.8"],
      fetcher: f,
    });
  assert.equal(state.phase, "done");
  assert.equal(state.report?.outcome, "contact_found");
  assert.ok(state.requests >= 3);
  assert.ok(state.pagesRead >= 1);
  assert.equal(aiCalls, 3);
});
test("search provider failure does not masquerade as a completed nothing-found result", async () => {
  const state = newUpworkResearch(job);
  state.phase = "report";
  state.requests = 2;
  state.failures = 2;
  await assert.rejects(
    upworkResearchStep(state, job, {
      key: "fixture",
      aiKey: "fixture",
      resolve: async () => [],
      fetcher: async () => Response.json({}),
    }),
    /could not complete/,
  );
});
test("application sending requires review fields and explicit off-platform contact permission", () => {
  assert.throws(
    () => applicationInput({ subject: "Hi", body: "Application" }),
    /permits/,
  );
  assert.throws(
    () =>
      applicationInput({
        subject: "Hi\r\nBcc: other@example.com",
        body: "Application",
        permission_confirmed: true,
      }),
    /subject/,
  );
  assert.throws(
    () =>
      applicationInput({ subject: "Hi", body: "", permission_confirmed: true }),
    /application message/,
  );
  assert.deepEqual(
    applicationInput({
      subject: " Hi ",
      body: " Application ",
      permission_confirmed: true,
    }),
    { subject: "Hi", body: "Application" },
  );
});

test("connection requires a registered client ID and rejects the old metadata URL before redirecting", () => {
  for (const client of [
    undefined,
    "",
    "  ",
    "https://aisas.clemxytech.com/upwork-oauth-client.json",
    "https://disabled.example/client",
    "invalid client",
    "client?x=1",
  ]) {
    assert.equal(upworkOAuthReady(client), false);
    assert.throws(() => registeredUpworkClient(client), /approved, enabled/);
    assert.throws(
      () =>
        authorizationUrl(
          client as string,
          "https://callback.example",
          "state",
          "challenge",
        ),
      /setup is incomplete/,
    );
  }
  assert.equal(
    registeredUpworkClient("  approved-client-123  "),
    "approved-client-123",
  );
  assert.equal(upworkOAuthReady("approved-client-123"), true);
  assert.equal(
    new URL(
      authorizationUrl(
        "approved-client-123",
        "https://callback.example",
        "state",
        "challenge",
      ),
    ).searchParams.get("client_id"),
    "approved-client-123",
  );
});
