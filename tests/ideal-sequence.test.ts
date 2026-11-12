import { test } from "node:test";
import assert from "node:assert/strict";
import { sequenceIdealCriteria } from "../src/ideal-sequence";
const criteria = {
  business: "HVAC",
  decision_maker: "Owner",
  starting_segment: "Small team",
  main_problem: "Calls",
  secondary_problem: "Reminders",
  buying_triggers: "Growth",
  prospecting_signals: "Callback form",
};
function fixture(owned = true) {
  const calls: any[] = [];
  return {
    calls,
    db: {
      from(table: string) {
        const filters: any = { table };
        calls.push(filters);
        const q: any = {
          select() {
            return q;
          },
          eq(k: string, v: any) {
            filters[k] = v;
            return q;
          },
          in(k: string, v: any) {
            filters[k] = v;
            return q;
          },
          limit() {
            return q;
          },
          maybeSingle: async () => ({
            data: owned ? { id: "list" } : null,
            error: null,
          }),
          then(resolve: any, reject: any) {
            return Promise.resolve({
              data:
                table === "leads"
                  ? [{ id: "lead" }]
                  : [
                      { report: { qualified: true, criteria } },
                      { report: { qualified: true, criteria } },
                      {
                        report: {
                          qualified: false,
                          criteria: { business: "Ignore" },
                        },
                      },
                    ],
              error: null,
            }).then(resolve, reject);
          },
        };
        return q;
      },
    },
  };
}
test("generic sequence generation remains independent of ideal profiles when no list is supplied", async () => {
  const { db, calls } = fixture();
  assert.deepEqual(await sequenceIdealCriteria(db, "owner", undefined), []);
  assert.equal(calls.length, 0);
});
test("ideal message context comes only from qualifications on the selected owned list and is deduplicated", async () => {
  const { db, calls } = fixture();
  assert.deepEqual(await sequenceIdealCriteria(db, "owner", "list"), [
    criteria,
  ]);
  assert.ok(calls.every((c) => c.owner_id === "owner"));
  assert.deepEqual(calls[2].lead_id, ["lead"]);
  assert.equal(calls[1].list_id, "list");
});
test("another user cannot select a private audience list to obtain its ideal criteria", async () => {
  const { db, calls } = fixture(false);
  await assert.rejects(
    sequenceIdealCriteria(db, "owner", "other-list"),
    /owned_list/,
  );
  assert.equal(calls.length, 1);
});
