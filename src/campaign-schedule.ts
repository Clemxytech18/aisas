export type ScheduleDraft = {
  date: string;
  hour: string;
  minute: string;
  period: "AM" | "PM";
};
const pad = (n: number) => String(n).padStart(2, "0");
export const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function scheduleDraft(value: string, now = new Date()): ScheduleDraft {
  let date = new Date(value);
  if (
    !value ||
    !Number.isFinite(date.getTime()) ||
    date.getTime() <= now.getTime()
  ) {
    date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(10, 0, 0, 0);
  }
  return {
    date: localDateKey(date),
    hour: String(date.getHours() % 12 || 12),
    minute: pad(date.getMinutes()),
    period: date.getHours() >= 12 ? "PM" : "AM",
  };
}
export function scheduleToISO(draft: ScheduleDraft, now = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.date);
  if (
    !match ||
    !/^\d{1,2}$/.test(draft.hour) ||
    !/^\d{1,2}$/.test(draft.minute) ||
    !["AM", "PM"].includes(draft.period)
  )
    throw new Error("Choose a date and enter a valid time.");
  const [, y, m, d] = match,
    year = Number(y),
    month = Number(m) - 1,
    day = Number(d),
    hour = Number(draft.hour),
    minute = Number(draft.minute);
  if (year < 1970 || year > 2100 || hour < 1 || hour > 12 || minute > 59)
    throw new Error("Enter an hour from 1 to 12 and minutes from 00 to 59.");
  const hours = (hour % 12) + (draft.period === "PM" ? 12 : 0);
  const date = new Date(year, month, day, hours, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minute
  )
    throw new Error(
      "That date or local time is unavailable. Please choose another.",
    );
  if (date.getTime() <= now.getTime())
    throw new Error("Choose a future date and time.");
  return date.toISOString();
}
export function monthDays(year: number, month: number): (number | null)[] {
  const first = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(first).fill(null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function formatCampaignStart(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Choose a start date";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
export function scheduleTimezone(date = new Date()): string {
  try {
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    const offset = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "shortOffset",
    })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value;
    return zone && offset && zone !== offset
      ? `${zone} (${offset})`
      : zone || offset || "Your local time";
  } catch {
    return "Your local time";
  }
}
