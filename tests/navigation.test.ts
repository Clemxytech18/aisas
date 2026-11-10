import { test } from "node:test";
import assert from "node:assert/strict";
import { entryIntent, viewUrl } from "../src/navigation";
test("web visitors enter the landing page and can deep-link to signup", () => {
  assert.deepEqual(entryIntent("web", "https://aisas.example/"), {
    view: "landing",
  });
  assert.deepEqual(entryIntent("web", "https://aisas.example/?signup=1"), {
    view: "landing",
    auth: "signup",
  });
  assert.deepEqual(
    entryIntent("web", "https://aisas.example/?view=workspace"),
    { view: "workspace" },
  );
});
test("native apps and auth/mailbox callbacks retain workspace routing", () => {
  assert.equal(entryIntent("ios").view, "workspace");
  assert.equal(entryIntent("android").view, "workspace");
  for (const suffix of [
    "?code=example",
    "?mailbox_connected=1",
    "?mailbox_error=connection_failed",
    "#access_token=example",
  ])
    assert.equal(
      entryIntent("web", "https://aisas.example/" + suffix).view,
      "workspace",
    );
});
test("switching views removes signup intent and supports browser navigation without reload", () => {
  assert.equal(
    viewUrl("https://aisas.example/?signup=1", "workspace"),
    "/?view=workspace",
  );
  assert.equal(
    viewUrl("https://aisas.example/?view=workspace", "landing"),
    "/",
  );
  assert.equal(viewUrl("https://aisas.example/app", "landing"), "/");
});
