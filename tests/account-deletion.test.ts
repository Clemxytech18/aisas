import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deleteOwnAccount,
  validateDeletionRequest,
  type DeleteDependencies,
} from "../src/account-deletion";
function fixture(fail?: string, authenticated = true) {
  const calls: string[] = [];
  const action = (name: string) => async () => {
    calls.push(name);
    if (name === fail) throw new Error("private provider details");
  };
  const deps: DeleteDependencies = {
    reauthenticate: async () => {
      calls.push("reauthenticate");
      return authenticated;
    },
    revokeSessions: action("revokeSessions"),
    freeze: action("freeze"),
    unfreeze: action("unfreeze"),
    pauseAndGetGrants: async () => {
      calls.push("pause");
      return ["exclusive-grant"];
    },
    removeImages: action("images"),
    revokeGrant: async (grant) => {
      assert.equal(grant, "exclusive-grant");
      await action("disconnect")();
    },
    purgeEvents: action("events"),
    deleteUser: action("deleteUser"),
  };
  return { calls, deps };
}
test("deletion requires exact explicit confirmation and password; arbitrary target IDs are ignored", () => {
  for (const body of [
    null,
    {},
    { confirmation: "delete", password: "password" },
    { confirmation: "DELETE" },
    { confirmation: "DELETE", password: "" },
  ])
    assert.throws(() => validateDeletionRequest(body));
  assert.deepEqual(
    validateDeletionRequest({
      confirmation: "DELETE",
      password: "password",
      user_id: "another-user",
    }),
    { password: "password" },
  );
});
test("incorrect password makes no changes to account, files, sessions, or campaigns", async () => {
  const { calls, deps } = fixture(undefined, false);
  await assert.rejects(
    deleteOwnAccount({ confirmation: "DELETE", password: "wrong" }, deps),
    /incorrect/,
  );
  assert.deepEqual(calls, ["reauthenticate"]);
});
test("confirmed deletion revokes sessions, freezes writes, pauses sends, removes images and grants before auth deletion", async () => {
  const { calls, deps } = fixture();
  await deleteOwnAccount({ confirmation: "DELETE", password: "current" }, deps);
  assert.deepEqual(calls, [
    "reauthenticate",
    "revokeSessions",
    "freeze",
    "pause",
    "images",
    "disconnect",
    "events",
    "deleteUser",
  ]);
});
test("cleanup failures preserve auth account, restore access and report an incomplete deletion", async () => {
  for (const fail of ["images", "disconnect", "events", "deleteUser"]) {
    const { calls, deps } = fixture(fail);
    await assert.rejects(
      deleteOwnAccount({ confirmation: "DELETE", password: "current" }, deps),
      /did not complete/,
    );
    assert.equal(calls.at(-1), "unfreeze");
    if (fail !== "deleteUser")
      assert.equal(calls.includes("deleteUser"), false);
  }
});
