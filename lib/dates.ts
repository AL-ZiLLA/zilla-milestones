const DAY = 86_400_000;

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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
