import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createScoutState,
  scoutCoverageStep,
  type CoverageState,
} from "../src/scout-coverage";
import { mapsSearches, nextMapsTask, mapsProspect } from "../src/scout-maps";
import { scoutMethod } from "../src/scout-types";
import { hasProspectContact } from "../src/prospect-contact";
const profile = {
  audience: "Dental cosmetics",
  location: "Austin, Texas, USA",
};
const resolve = async () => ["93.184.216.34"];
const response = (data: any) => Response.json(data);
const mapsState = (options: any = {}) =>
  createScoutState(
    profile,
    "company",
    {
      target: 1000,
      searchBudget: 100,
      readPages: false,
      useAI: false,
      ...options,
    },
    "google_maps",
  );
async function finish(state: CoverageState, fetcher: typeof fetch) {
  const changed: any[] = [];
  let clock = Date.now();
  for (let i = 0; i < 100 && !state.done; i++) {
    const step = await scoutCoverageStep(state, {
      key: "PRIVATE_TEST_KEY",
      fetcher,
      resolve,
      now: () => (clock += 10000),
    });
    changed.push(...step.changed);
    state = JSON.parse(JSON.stringify(step.state));
  }
  assert.equal(state.done, true, "Scout should finish");
  return { state, changed };
}
test("new scout modes are isolated, natural Maps queries include the target location, and legacy clients default to Boolean", () => {
  assert.equal(scoutMethod(undefined), "boolean");
  assert.throws(() => scoutMethod("maps_reviews"));
  for (const kind of ["person", "company"] as const)
    assert.ok(
      createScoutState(profile, kind).searches.every(
        (q) => q.engine === "google",
      ),
    );
  const maps = mapsState();
  assert.equal(maps.method, "google_maps");
  assert.equal(maps.kind, "company");
  assert.ok(maps.searches.every((q) => q.engine === "google_maps"));
  assert.equal(
    maps.searches[0].params.q,
    "Dental cosmetics Austin, Texas, USA",
  );
  assert.equal(maps.searches[0].params.type, "search");
});
test("Maps follows explicit pagination beyond 20 pages and keeps coordinates without persisting provider credentials", async () => {
  const seen: number[] = [];
  const { state } = await finish(mapsState(), async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://serpapi.com/search");
    assert.equal(url.searchParams.get("engine"), "google_maps");
    const start = Number(url.searchParams.get("start"));
    seen.push(start);
    if (start > 0)
      assert.equal(url.searchParams.get("ll"), "@30.2672,-97.7431,13z");
    return response({
      local_results: [
        {
          title: `Clinic ${start}`,
          place_id: `place-${start}`,
          phone: "+1 512 555 0123",
        },
      ],
      ...(start < 480
        ? {
            serpapi_pagination: {
              next: `https://serpapi.com/search.json?engine=google_maps&start=${start + 20}&ll=%4030.2672%2C-97.7431%2C13z&api_key=SHOULD_NOT_PERSIST`,
            },
          }
        : {}),
    });
  });
  assert.equal(seen.length, 25);
  assert.equal(state.stats.saved, 25);
  assert.equal(state.reason, "sources_exhausted");
  assert.equal(JSON.stringify(state).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(JSON.stringify(state).includes("PRIVATE_TEST_KEY"), false);
});
test("Maps pagination can infer full-page offsets and rejects non-advancing or untrusted provider links", () => {
  const task = mapsSearches(profile)[0];
  assert.equal(nextMapsTask(task, {}, 20)?.params.start, "20");
  assert.equal(nextMapsTask(task, {}, 7), null);
  for (const next of [
    "https://evil.example/search?start=20",
    "https://serpapi.com/search?engine=google_maps_reviews&start=20",
    "https://serpapi.com/search?start=0",
    "https://serpapi.com/search?start=-20",
    "https://serpapi.com/search?start=abc",
    "http://serpapi.com/search?start=20",
    "https://user:password@serpapi.com/search?start=20",
  ])
    assert.equal(
      nextMapsTask(task, { serpapi_pagination: { next } }, 20),
      null,
    );
});
test("Maps preserves separate branches and only returns leads with email or phone", async () => {
  const { state, changed } = await finish(mapsState(), async () =>
    response({
      local_results: [
        {
          title: "Same brand",
          place_id: "branch-1",
          address: "One Street",
          phone: "+1 512 555 0111",
        },
        {
          title: "Same brand",
          place_id: "branch-2",
          address: "Two Street",
          phone: "+1 512 555 0222",
        },
        { title: "No contacts", place_id: "empty" },
        {
          title: "Email business",
          place_id: "email",
          email: "hello@practice.example",
        },
      ],
    }),
  );
  assert.equal(state.stats.saved, 3);
  assert.equal(changed.length, 3);
  assert.ok(changed.every(hasProspectContact));
  assert.equal(changed.filter((p) => p.company === "Same brand").length, 2);
  assert.ok(
    changed.every((p) =>
      p.source_url.startsWith("https://www.google.com/maps/"),
    ),
  );
});
test("Maps continues result pagination after the save cap and stops repeated pages", async () => {
  let calls = 0;
  const { state } = await finish(mapsState({ target: 1 }), async () => {
    calls++;
    return response({
      local_results: [
        { title: "Clinic", place_id: "same-place", phone: "+1 512 555 0111" },
        {
          title: "Other Clinic",
          place_id: "other-place",
          phone: "+1 512 555 0222",
        },
      ].sort((a, b) =>
        calls % 2
          ? a.place_id.localeCompare(b.place_id)
          : b.place_id.localeCompare(a.place_id),
      ),
      serpapi_pagination: {
        next: `https://serpapi.com/search?engine=google_maps&start=${calls * 20}`,
      },
    });
  });
  assert.equal(calls, 2);
  assert.equal(state.stats.saved, 1);
  assert.match(state.warnings.join(" "), /repeated result page/);
});
test("Maps enforces request limits and never changes engine on provider failures", async () => {
  let calls = 0;
  const { state } = await finish(
    mapsState({ searchBudget: 2 }),
    async (input) => {
      calls++;
      assert.equal(
        new URL(String(input)).searchParams.get("engine"),
        "google_maps",
      );
      return response({
        local_results: [
          {
            title: `Clinic ${calls}`,
            place_id: `place-${calls}`,
            phone: "+1 512 555 0123",
          },
        ],
        serpapi_pagination: {
          next: `https://serpapi.com/search?engine=google_maps&start=${calls * 20}`,
        },
      });
    },
  );
  assert.equal(calls, 2);
  assert.equal(state.reason, "search_budget_reached");
  const limited = await finish(mapsState(), async () =>
    response({ error: "Your account has run out of searches." }),
  );
  assert.equal(limited.state.reason, "provider_limit");
});
test("website and contact-page emails enrich their Maps business without creating companies named Contact Us", async () => {
  const { state, changed } = await finish(
    mapsState({ readPages: true, sourceBudget: 20 }),
    async (input) => {
      const u = new URL(String(input));
      if (u.hostname === "serpapi.com")
        return response({
          local_results: [
            {
              title: "Actual Clinic",
              place_id: "place-1",
              website: "https://clinic.example/",
            },
          ],
        });
      if (u.pathname === "/robots.txt")
        return new Response("User-agent: *\nAllow: /");
      if (u.pathname === "/")
        return new Response(
          '<html><title>Home</title><body>Our dental practice welcomes you.<a href="/contact">Contact</a></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      if (u.pathname === "/contact")
        return new Response(
          '<html><title>Contact Us</title><body><a href="mailto:office@clinic.example">Write to us</a></body></html>',
          { headers: { "content-type": "text/html" } },
        );
      throw new Error("Unexpected " + u.href);
    },
  );
  assert.equal(state.stats.saved, 1);
  assert.ok(state.stats.source_pages >= 2);
  assert.equal(changed.at(-1).company, "Actual Clinic");
  assert.equal(changed.at(-1).email, "office@clinic.example");
  assert.match(changed.at(-1).source_url, /google\.com\/maps/);
  assert.equal(state.records.length, 1);
});
test("single-place responses and phone-only businesses without websites remain eligible", async () => {
  const p = mapsProspect(
    {
      title: "Phone Only Clinic",
      phone: "+1 512 555 0123",
      data_id: "0x1:0x2",
    },
    profile,
  )!;
  assert.equal(p.website, "");
  assert.equal(hasProspectContact(p), true);
  assert.equal(p.maps_place_id, "0x1:0x2");
  const { state, changed } = await finish(mapsState(), async () =>
    response({
      place_results: {
        title: p.company,
        phone: p.phone,
        data_id: p.maps_place_id,
      },
    }),
  );
  assert.equal(state.stats.saved, 1);
  assert.equal(changed[0].company, "Phone Only Clinic");
});
