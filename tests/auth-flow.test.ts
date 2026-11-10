import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_RESET_REDIRECT,
  requestPasswordReset,
  updateRecoveredPassword,
  recoveryMarker,
  recoveryUser,
  authLinkError,
  unhandledAuthCodeError,
  cleanAuthCallbackUrl,
} from "../src/auth-flow";
import { entryIntent, viewUrl } from "../src/navigation";
test("reset requests use the configured root URL and give the same success message for unknown accounts", async () => {
  let captured: any;
  const message = await requestPasswordReset(
    {
      async resetPasswordForEmail(email, options) {
        captured = { email, options };
        return { error: null };
      },
    },
    " person@example.com ",
  );
  assert.deepEqual(captured, {
    email: "person@example.com",
    options: { redirectTo: "https://aisas.clemxytech.com/" },
  });
  assert.equal(new URL(PASSWORD_RESET_REDIRECT).search, "");
  const unknown = await requestPasswordReset(
    {
      async resetPasswordForEmail() {
        return { error: { code: "user_not_found" } };
      },
    },
    "missing@example.com",
  );
  assert.equal(unknown, message);
});
test("reset request failures never claim an email was sent", async () => {
  await assert.rejects(
    requestPasswordReset(
      {
        async resetPasswordForEmail() {
          return { error: { status: 429 } };
        },
      },
      "person@example.com",
    ),
    /wait a minute/,
  );
  await assert.rejects(
    requestPasswordReset(
      {
        async resetPasswordForEmail() {
          return { error: { status: 503 } };
        },
      },
      "person@example.com",
    ),
    /could not be requested/,
  );
  let called = false;
  await assert.rejects(
    requestPasswordReset(
      {
        async resetPasswordForEmail() {
          called = true;
          return { error: null };
        },
      },
      "bad address",
    ),
    /valid email/,
  );
  assert.equal(called, false);
});
test("password changes require a recovery user and matching confirmation before contacting auth", async () => {
  const client = {
    async getUser() {
      throw new Error("Must not be called");
    },
    async updateUser() {
      throw new Error("Must not be called");
    },
  };
  await assert.rejects(
    updateRecoveredPassword(client, null, "new password", "new password"),
    /invalid or expired/,
  );
  await assert.rejects(
    updateRecoveredPassword(client, "a", "short", "short"),
    /8 characters/,
  );
  await assert.rejects(
    updateRecoveredPassword(client, "a", "new password", "different password"),
    /do not match/,
  );
});
test("an expired session or a different signed-in user cannot receive the password update", async () => {
  let updated = false;
  for (const response of [
    { data: { user: null }, error: new Error("expired") },
    { data: { user: { id: "other" } }, error: null },
  ]) {
    await assert.rejects(
      updateRecoveredPassword(
        {
          async getUser() {
            return response;
          },
          async updateUser() {
            updated = true;
            return { error: null };
          },
        },
        "recovery-user",
        "new password",
        "new password",
      ),
      /expired/,
    );
  }
  assert.equal(updated, false);
});
test("validated recovery updates the intended user without trimming the chosen password", async () => {
  let chosen = "";
  await updateRecoveredPassword(
    {
      async getUser() {
        return { data: { user: { id: "recovery-user" } }, error: null };
      },
      async updateUser(input) {
        chosen = input.password;
        return { error: null };
      },
    },
    "recovery-user",
    " a new password ",
    " a new password ",
  );
  assert.equal(chosen, " a new password ");
  await assert.rejects(
    updateRecoveredPassword(
      {
        async getUser() {
          return { data: { user: { id: "a" } }, error: null };
        },
        async updateUser() {
          return { error: { code: "weak_password" } };
        },
      },
      "a",
      "12345678",
      "12345678",
    ),
    /stronger password/,
  );
});
test("recovery form resume markers expire and cannot switch identities", () => {
  const marker = recoveryMarker("a", 1000);
  assert.equal(recoveryUser(JSON.stringify(marker), "a", 1100), "a");
  assert.equal(recoveryUser(marker, "b", 1100), null);
  assert.equal(recoveryUser(marker, "a", marker.expiresAt), null);
  assert.equal(recoveryUser("bad json", "a", 1100), null);
  assert.equal(
    recoveryUser({ userId: "a", expiresAt: 999999999 }, "a", 1100),
    null,
  );
});
test("recovery and forgot-password routing cannot be mistaken for normal workspace callbacks", () => {
  assert.deepEqual(entryIntent("web", "https://aisas.example/?forgot=1"), {
    view: "landing",
    auth: "forgot",
  });
  assert.deepEqual(
    entryIntent(
      "web",
      "https://aisas.example/#access_token=example&type=recovery",
    ),
    { view: "landing", auth: "reset" },
  );
  assert.deepEqual(entryIntent("web", "https://aisas.example/?code=example"), {
    view: "workspace",
  });
  assert.equal(
    viewUrl("https://aisas.example/?forgot=1", "workspace"),
    "/?view=workspace",
  );
  assert.deepEqual(
    entryIntent(
      "web",
      "https://aisas.example/#error=access_denied&error_code=otp_expired",
    ),
    { view: "landing", auth: "signin" },
  );
  assert.match(
    authLinkError(
      "https://aisas.example/#error=access_denied&error_description=DO_NOT_ECHO",
    )!,
    /expired/,
  );
  assert.equal(
    authLinkError("https://aisas.example/#error=DO_NOT_ECHO")?.includes(
      "DO_NOT_ECHO",
    ),
    false,
  );
});

test("unconsumed callback codes offer recovery and callback cleanup retains unrelated URL parameters", () => {
  assert.match(
    unhandledAuthCodeError("https://aisas.example/?code=expired")!,
    /could not be completed/,
  );
  assert.equal(unhandledAuthCodeError("https://aisas.example/"), null);
  assert.equal(
    cleanAuthCallbackUrl(
      "https://aisas.example/?code=expired&utm_source=email#error=access_denied",
    ),
    "/?utm_source=email",
  );
});
