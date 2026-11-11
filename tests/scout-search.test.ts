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
