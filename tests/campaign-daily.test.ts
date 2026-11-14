import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dailyCampaignSettings,
  eligibleEmailCount,
  minimumSendingDays,
  dailySendingStatus,
  formatDailyReset,
  deviceSendingTimezone,
} from "../src/campaign-daily";
test("daily settings require whole positive limits and valid timezones while legacy records remain unlimited", () => {
  assert.deepEqual(dailyCampaignSettings({}), {
    daily_send_limit: null,
    send_timezone: "UTC",
  });
  assert.deepEqual(
    dailyCampaignSettings({
      daily_send_limit: 50,
      send_timezone: "Africa/Lagos",
    }),
    { daily_send_limit: 50, send_timezone: "Africa/Lagos" },
  );
  for (const limit of [0, -50, 1.5, 10001, NaN, Infinity])
    assert.throws(
      () => dailyCampaignSettings({ daily_send_limit: limit }),
      /daily email limit/,
    );
  assert.throws(
    () =>
      dailyCampaignSettings({
        daily_send_limit: 50,
        send_timezone: "not-a-timezone",
      }),
    /timezone/,
  );
  assert.ok(deviceSendingTimezone());
});
test("daily schedule estimates count all four messages and count a shared address once", () => {
  const leads = [
    { email: " team@example.com " },
    { email: "TEAM@example.com" },
    { email: "second@example.com" },
    { email: "bad" },
    { email: "" },
    { email: "invalid@example.com", email_verification_status: "invalid" },
    { email: "optout@example.com", status: "unsubscribed" },
  ];
  assert.equal(eligibleEmailCount(leads), 2);
  assert.equal(minimumSendingDays(200, 50, 1), 4);
  assert.equal(minimumSendingDays(200, 50), 16);
  assert.equal(minimumSendingDays(201, 50), 17);
  assert.equal(minimumSendingDays(200, null), null);
});
test("daily progress distinguishes confirmed cap exhaustion from capacity held for unknown outcomes", () => {
  const a = {
    status: "running",
    daily_send_limit: 50,
    daily_sent: 50,
    daily_reserved: 0,
    daily_remaining: 0,
    daily_resume_at: "2026-11-14T23:00:00Z",
    send_timezone: "Africa/Lagos",
    pending: 150,
    processing: 0,
  };
  assert.match(dailySendingStatus(a), /Daily limit reached/);
  assert.match(
    dailySendingStatus({ ...a, daily_sent: 49, daily_reserved: 1 }),
    /reserved/,
  );
  assert.match(
    dailySendingStatus({ ...a, daily_sent: 0, daily_reserved: 50 }),
    /unconfirmed/,
  );
  assert.equal(dailySendingStatus({ ...a, pending: 0 }), "");
  assert.equal(dailySendingStatus({ ...a, status: "paused" }), "");
  assert.equal(dailySendingStatus({ ...a, daily_send_limit: null }), "");
  assert.notEqual(
    formatDailyReset(a.daily_resume_at, "Africa/Lagos"),
    formatDailyReset(a.daily_resume_at, "UTC"),
  );
});
