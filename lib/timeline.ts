export interface TimelineHeader {
  id: string;
  base: "weekAndMonth";
  headers: Array<{ unit: "month" | "week"; dateFormat: string }>;
}

export function timelineTickSize(timelinePx: number, spanDays: number): number {
  const weeks = Math.max(1, Math.ceil(Math.max(1, spanDays) / 7));
  return Math.max(28, Math.min(120, Math.floor(Math.max(0, timelinePx) / weeks)));
}

export function timelineHeader(tickPx: number): TimelineHeader {
  if (tickPx < 64) {
    return {
      id: "zilla-month-day",
      base: "weekAndMonth",
      headers: [
        { unit: "month", dateFormat: "MMM" },
        { unit: "week", dateFormat: "D" },
      ],
    };
  }
  return {
    id: "zilla-week-label",
    base: "weekAndMonth",
    headers: [
      { unit: "month", dateFormat: "MMM YYYY" },
      { unit: "week", dateFormat: "DD MMM" },
    ],
  };
}
