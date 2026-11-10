import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scheduleToISO,
  scheduleDraft,
  monthDays,
  localDateKey,
  formatCampaignStart,
} from "../src/campaign-schedule";
function inTimezone(zone: string, work: () => void) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    work();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}
test("a local calendar selection is stored as the correct instant and restores to the same time", () =>
  inTimezone("Africa/Lagos", () => {
    const now = new Date("2026-11-10T08:00:00Z");
    const input = {
      date: "2026-11-11",
      hour: "10",
      minute: "30",
      period: "AM" as const,
    };
    assert.equal(scheduleToISO(input, now), "2026-11-11T09:30:00.000Z");
    assert.deepEqual(scheduleDraft("2026-11-11T09:30:00.000Z", now), input);
    assert.match(formatCampaignStart("2026-11-11T09:30:00Z"), /2026/);
  }));
test("midnight and noon are distinct and clearing a schedule defaults to tomorrow morning", () =>
  inTimezone("Africa/Lagos", () => {
    const now = new Date("2026-11-10T08:00:00Z");
    assert.equal(
      scheduleToISO(
        { date: "2026-11-11", hour: "12", minute: "00", period: "AM" },
        now,
      ),
      "2026-11-10T23:00:00.000Z",
    );
    assert.equal(
      scheduleToISO(
        { date: "2026-11-11", hour: "12", minute: "00", period: "PM" },
        now,
      ),
      "2026-11-11T11:00:00.000Z",
    );
    assert.deepEqual(scheduleDraft("", now), {
      date: "2026-11-11",
      hour: "10",
      minute: "00",
      period: "AM",
    });
  }));
test("past schedules, invalid calendar days, and malformed times cannot be applied", () =>
  inTimezone("Africa/Lagos", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    for (const input of [
      { date: "2025-12-31", hour: "10", minute: "00", period: "AM" as const },
      { date: "2026-02-30", hour: "10", minute: "00", period: "AM" as const },
      { date: "2026-02-02", hour: "13", minute: "00", period: "AM" as const },
      { date: "2026-02-02", hour: "10", minute: "60", period: "AM" as const },
    ])
      assert.throws(() => scheduleToISO(input, now));
  }));
test("unavailable daylight-saving times are rejected instead of silently moving the scheduled time", () =>
  inTimezone("America/New_York", () => {
    assert.throws(
      () =>
        scheduleToISO(
          { date: "2026-03-08", hour: "2", minute: "30", period: "AM" },
          new Date("2026-03-01T12:00:00Z"),
        ),
      /unavailable/,
    );
    assert.equal(
      scheduleToISO(
        { date: "2026-03-08", hour: "3", minute: "30", period: "AM" },
        new Date("2026-03-01T12:00:00Z"),
      ),
      "2026-03-08T07:30:00.000Z",
    );
  }));
test("calendar grids start on Monday and include leap-year days", () => {
  assert.equal(monthDays(2024, 1).filter((x) => x !== null).length, 29);
  assert.deepEqual(monthDays(2026, 10).slice(0, 7), [
    null,
    null,
    null,
    null,
    null,
    null,
    1,
  ]);
  assert.equal(monthDays(2026, 10).length % 7, 0);
});
