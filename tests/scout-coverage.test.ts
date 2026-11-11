import { test } from "node:test";
import assert from "node:assert/strict";
import { createScoutState, scoutCoverageStep } from "../src/scout-coverage";
import { coverageQueries, nextSearchTask } from "../src/scout-query";
import { cleanName, publicProspects } from "../src/scout-prospects";
import {
  parseSource,
  groundedAIRecords,
  publicAddress,
  sourceUrl,
  readSource,
  robotsPolicy,
  robotsAllowed,
} from "../src/scout-pages";
import { scoutOptions } from "../src/scout-types";
const context = {
  audience: "Dental cosmetics",
  location: "USA",
  kind: "person" as const,
};
const response = (data: any) =>
  new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
const resolve = async () => ["93.184.216.34"];
test("source-evidenced names accept scripts, single names, lowercase, initials, punctuation, and long names", () => {
  for (const name of [
    "Prince",
    "王小明",
    "أحمد بن علي",
    "john van der waals",
    "J. R. R. Tolkien",
    "d’Artagnan",
    "Maria de la Cruz y García López",
  ]) {
    assert.equal(cleanName(name), name);
    const p = publicProspects(
      {
        person_name: name,
        link: "https://example.com/team",
        job_title: "Dentist",
      },
      context,
    );
    assert.equal(p[0].contact_name, name);
  }
  assert.equal(cleanName("<script></script>"), "");
});
test("country expansion and pagination use canonical provider parameters without leaking next-page keys", () => {
  const queries = coverageQueries(context, "person");
  assert.ok(queries.some((q) => q.params.q?.includes("California")));
  assert.ok(queries.some((q) => q.params.q?.includes("Texas")));
  for (const [engine, field, value] of [
    ["google", "start", "10"],
    ["yahoo", "b", "11"],
    ["yandex", "p", "1"],
    ["google_maps", "start", "20"],
  ] as const) {
    const task = {
      engine,
      params: { q: "dentists" },
      purpose: "discovery" as const,
      page: 1,
    };
    const next = nextSearchTask(task, {}, engine === "google_maps" ? 20 : 10)!;
    assert.equal(next.params[field], value);
    assert.equal(next.page, 2);
  }
  const next = nextSearchTask(
    { ...queries[0], page: 1 },
    {
      serpapi_pagination: {
        next: "https://serpapi.com/search?engine=google&start=30&api_key=SECRET",
      },
    },
    2,
  )!;
  assert.equal(next.params.start, "30");
  assert.equal(JSON.stringify(next).includes("SECRET"), false);
  assert.equal(nextSearchTask({ ...queries[0], page: 20 }, {}, 10), null);
});
test("scouting continues beyond six, paginates, saves a target over 100, and survives serialization", async () => {
  let state = createScoutState(context, "person", {
    target: 125,
    searchBudget: 50,
    readPages: false,
    useAI: false,
  });
  const starts: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input));
    starts.push(u.searchParams.get("start") || "0");
    const offset = starts.length * 10;
    return response({
      organic_results: Array.from({ length: 10 }, (_, i) => ({
        person_name: `professional ${offset + i}`,
        email: `professional${offset + i}@public.example`,
        job_title: "Dentist",
        link: `https://practice.example.com/team/${offset + i}`,
      })),
      serpapi_pagination: {
        next: `https://serpapi.com/search?engine=${u.searchParams.get("engine")}&start=${Number(u.searchParams.get("start") || 0) + 10}`,
      },
    });
  };
  for (let i = 0; i < 30 && !state.done; i++) {
    state = JSON.parse(
      JSON.stringify(
        (await scoutCoverageStep(state, { key: "secret", fetcher, resolve }))
          .state,
      ),
    );
  }
  assert.equal(state.done, true);
  assert.equal(state.reason, "target_reached");
  assert.equal(state.records.length, 125);
  assert.ok(state.stats.search_requests > 5);
  assert.ok(starts.some((s) => Number(s) > 0));
  assert.equal(JSON.stringify(state).includes("secret"), false);
});
test("duplicates merge new contacts and request budget is never exceeded", async () => {
  let state = createScoutState(context, "person", {
    target: 100,
    searchBudget: 3,
    readPages: false,
    useAI: false,
  });
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    response({
      organic_results: [
        {
          person_name: "siti",
          link: "https://example.com/team/siti",
          email: ++calls === 1 ? "" : "siti@custom.dental",
        },
      ],
    });
  for (let i = 0; i < 5 && !state.done; i++)
    state = (
      await scoutCoverageStep(state, { key: "secret", fetcher, resolve })
    ).state;
  assert.equal(calls, 3);
  assert.equal(state.stats.search_requests, 3);
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].email, "siti@custom.dental");
  assert.equal(state.stats.duplicates, 2);
  assert.equal(state.reason, "search_budget_reached");
});
test("structured people and card-scoped contacts are extracted without format restrictions or group contact leakage", () => {
  const html = `<html><title>Our practitioners</title><body><script type="application/ld+json">{"@graph":[{"@type":"Person","name":"王小明","jobTitle":"Dentist","email":"wang@clinic.example"},{"@type":"Person","name":"siti","jobTitle":"Dentist"}]}</script><article class="person-card"><h3 class="person-name">Prince</h3><p>Dentist · prince@custom.dental</p></article><article class="person-card"><h3 class="person-name">maya de silva</h3><p>Dentist · maya@clinic.example</p></article><a href="/team?page=2">Next page</a><a href="/contact">Contact us</a></body></html>`;
  const page = parseSource(html, "https://clinic.example/team", context);
  assert.ok(
    page.prospects.some(
      (p) => p.contact_name === "王小明" && p.email === "wang@clinic.example",
    ),
  );
  assert.ok(page.prospects.some((p) => p.contact_name === "siti"));
  assert.ok(
    page.prospects.some(
      (p) => p.contact_name === "Prince" && p.email === "prince@custom.dental",
    ),
  );
  assert.ok(
    page.prospects.some(
      (p) =>
        p.contact_name === "maya de silva" && p.email === "maya@clinic.example",
    ),
  );
  assert.ok(page.links.includes("https://clinic.example/team?page=2"));
});
test("AI extraction accepts only exact source evidence for names and contacts", () => {
  const page = {
    title: "Our team",
    text: "Meet 李. 李 is a dentist. Contact 李 at li@custom.dental.",
    links: [],
    prospects: [],
  };
  const result = groundedAIRecords(
    {
      prospects: [
        {
          name: "李",
          email: "invented@example.com",
          evidence: "李 is a dentist.",
        },
        { name: "Invented Person", evidence: "Imagined evidence." },
      ],
    },
    page,
    "https://clinic.example/team",
    context,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].contact_name, "李");
  assert.equal(result[0].email, "");
});
test("crawler denies private IPs, DNS mixed answers, credentials, alternate ports, and robots-disallowed pages", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
  ])
    assert.equal(publicAddress(ip), false, ip);
  for (const url of [
    "http://127.0.0.1/",
    "http://2130706433/",
    "https://localhost.local/",
    "https://user:pass@example.com/",
    "https://example.com:8080/",
  ])
    assert.equal(sourceUrl(url), "", url);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response("User-agent: *\nDisallow: /team", {
      headers: { "Content-Type": "text/plain" },
    });
  };
  const denied = await readSource(
    { url: "https://example.com/team", depth: 0 },
    {},
    resolve,
    fetcher,
  );
  assert.equal(denied.status, "blocked");
  assert.equal(calls, 1);
  const dns = await readSource(
    { url: "https://example.com/team", depth: 0 },
    {},
    async () => ["93.184.216.34", "10.0.0.1"],
    fetcher,
  );
  assert.equal(dns.status, "blocked");
  assert.equal(calls, 1);
  const robots = robotsPolicy(
    "User-agent: *\nDisallow: /\nUser-agent: AISASBot\nDisallow: /private\nAllow: /private/public",
  );
  assert.equal(robotsAllowed("https://example.com/team", robots), true);
  assert.equal(robotsAllowed("https://example.com/private", robots), false);
  assert.equal(
    robotsAllowed("https://example.com/private/public", robots),
    true,
  );
});
test("public redirects are queued for a separate robots check and private redirects are rejected", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    return String(input).endsWith("robots.txt")
      ? new Response("", { status: 404 })
      : new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        });
  };
  const r = await readSource(
    { url: "https://example.com/team", depth: 0 },
    {},
    resolve,
    fetcher,
  );
  assert.equal(r.status, "blocked");
  assert.equal(calls, 2);
  const redirect = await readSource(
    { url: "https://example.com/team", depth: 0 },
    {},
    resolve,
    async (input) =>
      String(input).endsWith("robots.txt")
        ? new Response("", { status: 404 })
        : new Response(null, {
            status: 302,
            headers: { location: "/our-team" },
          }),
  );
  assert.equal(redirect.status, "redirect");
  assert.equal(redirect.url, "https://example.com/our-team");
});
test("public source discovery fills contacts, follows relevant links, and retains partial results on provider failure", async () => {
  let state = createScoutState(context, "person", {
    target: 100,
    searchBudget: 2,
    sourceBudget: 3,
    useAI: false,
  });
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input));
    if (u.host === "serpapi.com")
      return response({
        organic_results: [
          { title: "Our dental team", link: "https://example.com/team" },
        ],
      });
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    return new Response(
      '<html><title>Team</title><script type="application/ld+json">{"@type":"Person","name":"siti","email":"siti@custom.dental"}</script><body>Meet our dentists.</body></html>',
      { headers: { "Content-Type": "text/html" } },
    );
  };
  for (let i = 0; i < 5 && !state.done; i++)
    state = (
      await scoutCoverageStep(state, {
        key: "secret",
        fetcher,
        resolve,
        now: () => Date.now() + i * 10000,
      })
    ).state;
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].email, "siti@custom.dental");
  assert.equal(state.stats.source_pages, 1);
  assert.equal(state.stats.saved, 1);
  assert.throws(() => scoutOptions({ searchBudget: 101 }));
  assert.throws(() => scoutOptions({ target: 1001 }));
});

test("AI snippet extraction accepts lowercase and single names without taking prose fragments as people", async () => {
  const state = createScoutState(context, "person", {
    target: 50,
    searchBudget: 2,
    readPages: false,
    useAI: true,
  });
  const source = {
    title: "Meet our dentist",
    snippet: "Our dentist is siti. Contact siti at siti@custom.dental.",
    link: "https://example.com/team",
  };
  let aiCalls = 0;
  const fetcher: typeof fetch = async (input) =>
    String(input).startsWith("https://api.openai.com")
      ? (aiCalls++,
        response({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  prospects: [
                    {
                      source_index: 0,
                      name: "siti",
                      email: "siti@custom.dental",
                      evidence:
                        "Our dentist is siti. Contact siti at siti@custom.dental.",
                    },
                  ],
                }),
              },
            },
          ],
        }))
      : response({ organic_results: [source] });
  const result = await scoutCoverageStep(state, {
    key: "search-secret",
    aiKey: "ai-secret",
    resolve,
    fetcher,
  });
  assert.equal(aiCalls, 1);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].contact_name, "siti");
  assert.equal(result.state.records[0].email, "siti@custom.dental");
  assert.equal(result.state.done, true);
  assert.equal(JSON.stringify(result.state).includes("ai-secret"), false);
});
test("queued AI page extraction runs after source/request limits and never drops unfinished pages", async () => {
  let state = createScoutState(context, "person", {
    target: 50,
    searchBudget: 1,
    sourceBudget: 1,
    useAI: true,
  });
  const fetcher: typeof fetch = async (input) => {
    const u = new URL(String(input));
    if (u.host === "serpapi.com")
      return response({
        organic_results: [
          { title: "Meet our team", link: "https://example.com/team" },
        ],
      });
    if (u.host === "api.openai.com")
      return response({
        choices: [{ message: { content: JSON.stringify({ prospects: [] }) } }],
      });
    if (u.pathname === "/robots.txt") return new Response("", { status: 404 });
    return new Response(
      "<html><body>Our practice has provided cosmetic dental care for decades. Meet our team of experienced professionals and contact us for details about our services and treatment options.</body></html>",
      { headers: { "Content-Type": "text/html" } },
    );
  };
  state = (
    await scoutCoverageStep(state, {
      key: "key",
      aiKey: "ai",
      resolve,
      fetcher,
    })
  ).state;
  assert.equal(state.done, false);
  assert.equal(state.aiPages.length, 1);
  state = (
    await scoutCoverageStep(state, {
      key: "key",
      aiKey: "ai",
      resolve,
      fetcher,
    })
  ).state;
  assert.equal(state.done, true);
  assert.equal(state.aiPages.length, 0);
  assert.equal(state.stats.ai_requests, 2);
});
test("an invalid AI key is tried once and does not prevent pagination or saving public source names", async () => {
  let state = createScoutState(context, "person", {
    target: 50,
    searchBudget: 4,
    readPages: false,
    useAI: true,
  });
  let aiCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    if (String(input).includes("api.openai.com")) {
      aiCalls++;
      return new Response("{}", { status: 401 });
    }
    return response({
      organic_results: [
        { title: "Dr. Alex Smith, DDS", link: "https://example.com/team/alex" },
      ],
    });
  };
  for (let i = 0; i < 4 && !state.done; i++)
    state = (
      await scoutCoverageStep(state, {
        key: "key",
        aiKey: "bad-key",
        resolve,
        fetcher,
      })
    ).state;
  assert.equal(aiCalls, 1);
  assert.equal(state.stats.search_requests, 4);
  assert.equal(state.records.length, 1);
  assert.equal(state.aiDisabled, true);
  assert.ok(state.warnings.some((m) => m.includes("credentials")));
});

test("contactless candidates do not count toward the target or persist, but can gain a published contact later", async () => {
  const state = createScoutState(context, "person", {
    target: 1,
    searchBudget: 4,
    readPages: false,
    useAI: false,
  });
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    response({
      organic_results: [
        {
          person_name: "siti",
          link: "https://example.com/team/siti",
          email: ++calls > 2 ? "siti@custom.dental" : "",
        },
      ],
    });
  const first = await scoutCoverageStep(state, {
    key: "key",
    resolve,
    fetcher,
  });
  assert.equal(first.state.stats.saved, 0);
  assert.equal(first.changed.length, 0);
  assert.equal(first.state.done, false);
  const next = await scoutCoverageStep(first.state, {
    key: "key",
    resolve,
    fetcher,
  });
  assert.equal(next.state.stats.saved, 1);
  assert.equal(next.changed.length, 1);
  assert.equal(next.changed[0].email, "siti@custom.dental");
  assert.equal(next.state.reason, "target_reached");
});

test("business names and groups inside directory cards are not mislabeled as individual people", () => {
  const html =
    '<html><body><article class="person-card"><h3 class="person-name">Mason Family Dental</h3><p>Dentist · (713) 555-1234</p></article><article class="person-card"><h3 class="person-name">Kulkarni Orthodontics</h3><p>Dentist · (713) 555-1234</p></article><article class="person-card"><h3 class="person-name">Drs. Renz & Howard</h3><p>Dentists · (713) 555-1234</p></article></body></html>';
  const parsed = parseSource(
    html,
    "https://example.com/directory",
    context,
    true,
  );
  assert.equal(parsed.prospects.length, 0);
});
