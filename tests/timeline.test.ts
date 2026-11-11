import { describe, expect, it } from "vitest";
import { formatShortDate } from "@/lib/dates";
import { timelineHeader, timelineTickSize } from "@/lib/timeline";

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

  it("formats start and finish as a short date", () => {
    expect(formatShortDate("2027-02-17")).toBe("Feb 17, 2027");
  });
});