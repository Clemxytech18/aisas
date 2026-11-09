import { test } from "node:test";
import assert from "node:assert/strict";
import {
  booleanQuery,
  renderMessage,
  draftMessages,
  validateMessages,
  demoWorkspace,
} from "../src/domain";
test("boolean query quotes user input and neutralizes embedded quotes", () => {
  assert.equal(
    booleanQuery({ audience: 'Hotels" OR *', location: "Lagos" }),
    '"Hotels  OR *" AND "Lagos" AND ("contact" OR "email" OR "phone")',
  );
});
test("personalization uses safe fallback when a person is unknown", () => {
  assert.equal(
    renderMessage("Hi {{contact_name}}, {{company}} in {{location}}", {
      company: "Acme",
      location: "Lagos",
    }),
    "Hi there, Acme in Lagos",
  );
});
test("sequence requires a first message and exactly three delayed follow-ups", () => {
  const w = demoWorkspace();
  const m = draftMessages(w.profiles[0]);
  assert.equal(validateMessages(m), true);
  assert.equal(validateMessages(m.slice(1)), false);
  m[1].delay_hours = -1;
  assert.equal(validateMessages(m), false);
});
