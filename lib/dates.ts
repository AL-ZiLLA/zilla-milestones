const DAY = 86_400_000;

export const MERCHANT_TIME_ZONE = "America/Los_Angeles";
export const NET_TERMS_DAYS = 7;

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function merchantToday(now = new Date(), timeZone = MERCHANT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Could not format the merchant date");
  }
  return `${year}-${month}-${day}`;
}

export function invoiceDueDate(invoiceDate: string, termsDays = NET_TERMS_DAYS): string {
  return addDays(invoiceDate, termsDays);
}

export function asOfDate(project: { clockDate?: string | null }, now = new Date()): string {
  if (project.clockDate && /^\d{4}-\d{2}-\d{2}$/.test(project.clockDate)) return project.clockDate;
  return merchantToday(now);
}

export function addDays(isoDate: string, days: number): string {
  const next = new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(earlier: string, later: string): number {
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  return Math.round((end - start) / DAY);
}

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatShortDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return SHORT_DATE.format(date);
}
