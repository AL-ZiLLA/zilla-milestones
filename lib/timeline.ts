import { addDays } from "@/lib/dates";

export interface TimelineHeader {
  id: string;
  base: "weekAndMonth";
  headers: Array<{ unit: "month" | "week"; dateFormat: string }>;
}

export function timelineColumns(spanDays: number): number {
  // One extra week covers the axis snapping to week boundaries on either side.
  return Math.max(1, Math.ceil(Math.max(1, spanDays) / 7) + 1);
}

export function timelineRange(start: string, end: string): { startDate: string; endDate: string } {
  const paddedStart = addDays(start, -7);
  const paddedEnd = addDays(end, 7);
  const startDate = paddedStart.slice(0, 7) === start.slice(0, 7) ? paddedStart : `${start.slice(0, 7)}-01`;
  let endDate = paddedEnd;
  if (paddedEnd.slice(0, 7) !== end.slice(0, 7)) {
    const [year, month] = end.split("-").map(Number);
    endDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  if (endDate < end) endDate = end;
  return { startDate: startDate > start ? start : startDate, endDate };
}

export function timelineTickSize(timelinePx: number, spanDays: number): number {
  const columns = timelineColumns(spanDays);
  const raw = Math.floor(Math.max(0, timelinePx) / columns);
  if (raw < 1) return 1;
  return Math.min(120, raw);
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
