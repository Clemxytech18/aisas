export const DEFAULT_DAILY_SEND_LIMIT = 50;
export function deviceSendingTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
export function dailyCampaignSettings(value: {
  daily_send_limit?: number | null;
  send_timezone?: string;
}): { daily_send_limit: number | null; send_timezone: string } {
  const limit = value.daily_send_limit ?? null;
  if (
    limit !== null &&
    (!Number.isInteger(limit) || limit < 1 || limit > 10000)
  )
    throw new Error(
      "Set a daily email limit from 1 to 10,000, or turn the limit off.",
    );
  const zone = value.send_timezone === undefined ? "UTC" : value.send_timezone;
  if (typeof zone !== "string" || !zone || zone.length > 80)
    throw new Error("Choose a valid daily reset timezone.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date());
  } catch {
    throw new Error("Choose a valid daily reset timezone.");
  }
  return { daily_send_limit: limit, send_timezone: zone };
}
export function eligibleEmailCount(
  leads: {
    email?: string;
    email_verification_status?: string;
    status?: string;
  }[],
): number {
  return new Set(
    leads
      .filter(
        (l) =>
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((l.email || "").trim()) &&
          l.email_verification_status !== "invalid" &&
          !["unsubscribed", "replied", "bounced"].includes(l.status || ""),
      )
      .map((l) => l.email!.trim().toLowerCase()),
  ).size;
}
export function minimumSendingDays(
  recipients: number,
  limit: number | null,
  steps = 4,
): number | null {
  return limit && limit > 0
    ? Math.ceil((Math.max(0, recipients) * steps) / limit)
    : null;
}
export function formatDailyReset(value: string, zone = "UTC"): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: zone,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return "the next daily reset";
  }
}
export function dailySendingStatus(a: {
  daily_send_limit?: number | null;
  daily_sent?: number;
  daily_reserved?: number;
  daily_remaining?: number | null;
  daily_resume_at?: string | null;
  send_timezone?: string;
  status?: string;
  pending: number;
  processing: number;
}): string {
  if (
    !a.daily_send_limit ||
    !(a.pending || a.processing) ||
    (a.status && !["running", "scheduled"].includes(a.status))
  )
    return "";
  if ((a.daily_reserved || 0) >= a.daily_send_limit)
    return "Waiting for unconfirmed sends to be resolved before more emails can be sent.";
  if ((a.daily_sent || 0) >= a.daily_send_limit)
    return a.daily_resume_at
      ? `Daily limit reached. Remaining emails resume after ${formatDailyReset(a.daily_resume_at, a.send_timezone)}.`
      : "Daily limit reached. Remaining emails continue after the next daily reset.";
  if (a.daily_remaining === 0 && (a.daily_reserved || 0) > 0)
    return "Today’s remaining capacity is reserved for sends awaiting confirmation.";
  return "";
}
