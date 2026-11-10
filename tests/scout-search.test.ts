import { test } from "node:test";
import assert from "node:assert/strict";
import {
  booleanQuery,
  CONTACT_SEARCH_GROUP,
  EMAIL_PROVIDERS,
  serpApiUrl,
  scoutQueries,
} from "../src/scout-query";
import { publicProspects } from "../src/scout-prospects";
import { runScoutSearch } from "../src/scout-search";
const target = { audience: "Dental cosmetics", location: "Texas, USA" };
const directory = {
  title: "Top Dentists in Texas",
  link: "https://directory.example/dentists",
  snippet:
    "Avery Stone, DDS · 40 Reviews. Morgan Reed, DMD · 20 Reviews. Email office@clinic.example.",
};
const named = {
  title: "Dr. Alex Smith, DDS | Cosmetic Dentist",
  link: "https://clinic.example/team/alex-smith",
  snippet: "Contact alex@independent-practice.dental or (713) 555-1234.",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
test("Google requests use the requested endpoint and contact boolean includes providers plus custom-domain @ searches", () => {
  const url = serpApiUrl(
    {
      engine: "google",
      params: { q: booleanQuery(target) },
      purpose: "contact",
    },
    "PRIVATE_TEST_KEY",
  );
  assert.equal(url.origin + url.pathname, "https://serpapi.com/search");
  assert.equal(url.searchParams.get("engine"), "google");
  assert.equal(url.searchParams.get("output"), "json");
  assert.ok(CONTACT_SEARCH_GROUP.includes('"@"'));
  for (const provider of EMAIL_PROVIDERS)
    assert.ok(CONTACT_SEARCH_GROUP.includes(`"${provider}"`));
  assert.ok(booleanQuery(target).includes(" OR "));
  for (const kind of ["person", "company"] as const) {
    const queries = [
      ...scoutQueries(target, kind),
      ...scoutQueries(target, kind, true),
    ];
    assert.ok(
      queries.some((q) =>
        Object.values(q.params).some((value) =>
          value.includes(CONTACT_SEARCH_GROUP),
        ),
      ),
    );
    assert.ok(
      queries.every((q) => Object.values(q.params).join(" ").includes("Texas")),
    );
  }
});
test("People search accepts source-backed non-LinkedIn names and does not assign a group email to every professional", () => {
  const people = publicProspects(directory, { ...target, kind: "person" });
  assert.deepEqual(
    people.map((p) => p.contact_name),
    ["Avery Stone", "Morgan Reed"],
  );
  assert.ok(
    people.every(
      (p) =>
        p.email === "" &&
        p.company === "" &&
        p.linkedin === "" &&
        p.source_url === directory.link,
    ),
  );
  const individual = publicProspects(named, { ...target, kind: "person" });
  assert.equal(individual[0].contact_name, "Alex Smith");
  assert.equal(individual[0].email, "alex@independent-practice.dental");
  assert.equal(individual[0].phone, "(713) 555-1234");
  assert.deepEqual(
    publicProspects(
      {
        title: "Cosmetic Dental Center",
        link: "https://clinic.example",
        snippet: "Our team offers dental services.",
      },
      { ...target, kind: "person" },
    ),
    [],
  );
});
test("single-name LinkedIn title formats and Unicode names remain supported", () => {
  const people = publicProspects(
    {
      title: "Élodie Martin | LinkedIn",
      link: "https://fr.linkedin.com/in/elodie-martin",
    },
    { ...target, kind: "person" },
  );
  assert.equal(people[0].contact_name, "Élodie Martin");
});
test("People fallback rescues the zero-results regression without duplicating names across providers", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (input) => {
    calls++;
    const url = new URL(String(input));
    if (calls <= 4)
      return response({
        organic_results: [
          {
            title: "Dental Cosmetic Center",
            link: "https://clinic.example",
            snippet: "A business, not a named person.",
          },
        ],
      });
    return response({ organic_results: [directory, named] });
  };
  const result = await runScoutSearch(target, "person", "secret", fetcher);
  assert.equal(calls, 5);
  assert.equal(result.fallback_used, true);
  assert.equal(result.prospects.length, 3);
  assert.equal(result.failure, null);
  assert.equal(result.error_status, 200);
  assert.ok(
    result.prospects.every(
      (p) => p.prospect_kind === "person" && p.contact_name,
    ),
  );
});
test("empty results are actionable failures, not successful empty lists", async () => {
  const result = await runScoutSearch(target, "person", "secret", async () =>
    response({ organic_results: [] }),
  );
  assert.equal(result.prospects.length, 0);
  assert.match(result.failure!, /No named professionals/);
  assert.match(result.failure!, /No empty list/);
  assert.equal(result.error_status, 422);
});
test("quota/authentication errors stop expensive fallbacks and diagnostics never echo credentials", async () => {
  let calls = 0;
  const key = "NEVER_EXPOSE_THIS_KEY";
  const result = await runScoutSearch(target, "person", key, async () => {
    calls++;
    return response({ error: `Invalid API key ${key}` }, 401);
  });
  assert.equal(calls, 4);
  assert.equal(result.fallback_used, false);
  assert.equal(result.error_status, 503);
  assert.equal(JSON.stringify(result).includes(key), false);
  const quota = await runScoutSearch(target, "person", key, async () =>
    response({ error: "Search credits exceeded" }, 429),
  );
  assert.equal(quota.error_status, 429);
});
test("Maps single-place and nested local responses preserve their source links", async () => {
  let calls = 0;
  const result = await runScoutSearch(target, "company", "secret", async () => {
    calls++;
    return response(
      calls === 1
        ? {
            place_results: {
              title: "Example Cosmetic Dentistry",
              place_id: "actual-public-place-id",
              phone: "+1 713 555 1234",
            },
          }
        : { local_results: { places: [] } },
    );
  });
  assert.equal(result.prospects.length, 1);
  assert.equal(result.prospects[0].company, "Example Cosmetic Dentistry");
  assert.ok(
    result.prospects[0].source_url.includes(
      "query_place_id=actual-public-place-id",
    ),
  );
  assert.equal(result.fallback_used, false);
});
