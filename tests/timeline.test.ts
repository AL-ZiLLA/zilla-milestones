import { describe, expect, it } from "vitest";
import { formatGanttDate, formatShortDate } from "@/lib/dates";
import { timelineColumns, timelineHeader, timelineRange, timelineTickSize } from "@/lib/timeline";

describe("gantt timeline labels", () => {
  it("uses a day number instead of a week label when a tick is under 64px", () => {
    const wide = timelineHeader(64);
    const compact = timelineHeader(63);
    expect(wide.headers[1]).toEqual({ unit: "week", dateFormat: "DD MMM" });
    expect(compact.headers.map((header) => header.dateFormat)).toEqual(["MMM", "D"]);
    expect(compact.headers[1]?.dateFormat).not.toContain("MMM");
  });

  it("keeps a 16-week plan under the overlap threshold", () => {
    const tick = timelineTickSize(700, 16 * 7);
    expect(tick).toBeLessThan(64);
    expect(timelineHeader(tick).headers[1]?.dateFormat).toBe("D");
  });

  it("keeps the padded span inside the months that contain the work", () => {
    expect(timelineRange("2026-11-10", "2027-01-20")).toEqual({ startDate: "2026-11-03", endDate: "2027-01-27" });
    expect(timelineRange("2026-11-02", "2027-01-28").startDate).toBe("2026-11-01");
    expect(timelineRange("2026-11-02", "2027-01-28").endDate.startsWith("2027-01")).toBe(true);
  });

  it("fits the whole span inside the timeline at laptop widths", () => {
    for (const [px, days] of [
      [280, 100],
      [380, 140],
      [700, 16 * 7],
    ] as const) {
      expect(timelineTickSize(px, days) * timelineColumns(days)).toBeLessThanOrEqual(px);
    }
  });

  it("formats start and finish as a short date", () => {
    expect(formatShortDate("2027-02-17")).toBe("Feb 17, 2027");
    expect(formatGanttDate("2026-11-10", 2026)).toBe("Nov 10");
    expect(formatGanttDate("2027-03-22", 2026)).toBe("Mar 22 '27");
    expect(formatShortDate("2027-03-22")).toBe("Mar 22, 2027");
  });
});