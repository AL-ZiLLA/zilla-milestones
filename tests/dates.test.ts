import { describe, expect, it } from "vitest";
import { invoiceDueDate, merchantToday, NET_TERMS_DAYS, todayUtc } from "@/lib/dates";

describe("merchant invoice dates", () => {
  it("uses the America/Los_Angeles calendar date instead of UTC today", () => {
    const evening = new Date("2026-11-11T06:30:00.000Z");
    expect(todayUtc(evening)).toBe("2026-11-11");
    expect(merchantToday(evening)).toBe("2026-11-10");
    expect(merchantToday(evening)).not.toBe(todayUtc(evening));
  });

  it("sets the due date to the invoice date plus Net 7", () => {
    expect(NET_TERMS_DAYS).toBe(7);
    expect(invoiceDueDate("2026-11-10")).toBe("2026-11-17");
    expect(invoiceDueDate("2026-11-28")).toBe("2026-12-05");
  });
});
