import { test } from "node:test";
import assert from "node:assert/strict";
import { hasProspectContact } from "../src/prospect-contact";
import {
  demoPool,
  emptyPoolFilters,
  matchesProspect,
} from "../src/prospect-pool";
test("email OR phone is required; websites, LinkedIn, blanks and placeholders do not qualify", () => {
  for (const p of [
    {},
    { email: "unknown", phone: "N/A" },
    { email: "not-an-email", phone: "123" },
    { phone: "000" },
  ])
    assert.equal(hasProspectContact(p), false);
  for (const p of [
    { email: "hello@custom.dental" },
    { phone: "+1 (713) 555-1234" },
    { phone: "٠١٢٣٤٥٦٧٨٩" },
  ])
    assert.equal(hasProspectContact(p), true);
  const base = demoPool()[0];
  assert.equal(
    matchesProspect(
      { ...base, email: "", phone: "" },
      "company",
      emptyPoolFilters(),
    ),
    false,
  );
  assert.equal(
    matchesProspect(
      { ...base, email: "", phone: "+1 713 555 1234" },
      "company",
      emptyPoolFilters(),
    ),
    true,
  );
});
