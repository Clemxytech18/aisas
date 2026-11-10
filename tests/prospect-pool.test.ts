import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPoolFilters,
  searchPayload,
  normalizeDomain,
  matchesProspect,
  demoPool,
  poolLead,
} from "../src/prospect-pool";
import { publicProspect } from "../src/scout-prospects";
test("ranges reject inversions, malformed values, and invalid years", () => {
  assert.throws(
    () =>
      searchPayload({
        ...emptyPoolFilters(),
        revenue_min: "20",
        revenue_max: "10",
      }),
    /Minimum/,
  );
  for (const value of ["NaN", "-1", "1e6", "Infinity"])
    assert.throws(
      () => searchPayload({ ...emptyPoolFilters(), funding_min: value }),
      /valid/,
    );
  assert.throws(
    () => searchPayload({ ...emptyPoolFilters(), founded_min: "2018.5" }),
    /years/,
  );
  assert.equal(
    searchPayload({ ...emptyPoolFilters(), funding_min: "0" }).funding_min,
    0,
  );
});
test("company domains normalize consistently and financial unknowns do not become zero", () => {
  assert.equal(normalizeDomain("www.ContactOut.com/about"), "contactout.com");
  assert.equal(
    searchPayload({
      ...emptyPoolFilters(),
      domain: "https://WWW.ContactOut.com/path",
    }).domain,
    "contactout.com",
  );
  const unknown = demoPool()[0];
  assert.equal(
    matchesProspect(unknown, "company", {
      ...emptyPoolFilters(),
      revenue_min: "0",
    }),
    false,
  );
  assert.equal(
    matchesProspect({ ...unknown, revenue: 0 }, "company", {
      ...emptyPoolFilters(),
      revenue_min: "0",
      revenue_max: "0",
    }),
    true,
  );
});
test("people filters combine employer, role, seniority, and availability", () => {
  const p = demoPool().find((p) => p.contact_name === "Alex Morgan")!;
  const filters = {
    ...emptyPoolFilters(),
    person: "Alex",
    company: "Harbor",
    job_title: "Founder",
    seniority: "Founder",
    has_email: true,
  };
  assert.equal(matchesProspect(p, "person", filters), true);
  assert.equal(matchesProspect(p, "company", filters), false);
  assert.equal(
    matchesProspect(p, "person", { ...filters, has_phone: true }),
    false,
  );
});
test("saved pool copies carry only descriptive fields and reset private status", () => {
  const p = {
    ...demoPool()[0],
    owner_id: "other-user",
    status: "unsubscribed",
    email_verification_status: "verified",
  };
  const lead = poolLead(p, "own-list", "new-id");
  assert.equal(lead.pool_prospect_id, p.id);
  assert.equal(lead.list_id, "own-list");
  assert.equal(lead.status, "new");
  assert.equal("owner_id" in lead, false);
  assert.equal("email_verification_status" in lead, false);
});
test("public professional profile extraction is source-backed, does not invent financial data or contacts", () => {
  const person = publicProspect(
    {
      title: "Alex Morgan - Founder - Harbor House | LinkedIn",
      link: "https://www.linkedin.com/in/alex-morgan",
      snippet: "Hospitality leader",
    },
    { kind: "person", audience: "Hotels", location: "Sydney, Australia" },
  );
  assert.equal(person?.contact_name, "Alex Morgan");
  assert.equal(person?.job_title, "Founder");
  assert.equal(person?.company, "Harbor House");
  assert.equal(person?.email, "");
  assert.equal(person?.revenue, null);
  assert.equal(person?.founded_year, null);
  assert.equal(
    publicProspect(
      {
        title: "Directory of professionals",
        link: "https://directory.example/list",
      },
      { kind: "person", audience: "Hotels", location: "Sydney" },
    ),
    null,
  );
  assert.equal(
    publicProspect(
      { title: "No source" },
      { kind: "company", audience: "Hotels", location: "Sydney" },
    ),
    null,
  );
});
test("structured source emails are extracted without constructing guessed addresses", () => {
  const company = publicProspect(
    {
      title: "Harbor House",
      link: "https://harbor.example",
      snippet: "Contact team@harbor.example",
      phone: "+61 1234",
    },
    { kind: "company", audience: "Boutique hotels", location: "Sydney" },
  );
  assert.equal(company?.email, "team@harbor.example");
  assert.equal(company?.domain, "harbor.example");
  assert.equal(company?.industry, "Hospitality");
});
