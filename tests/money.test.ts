import { describe, expect, it } from "vitest";
import { summarizeMoney } from "@/lib/money";

describe("money bar", () => {
  it("counts overdue invoices in Invoiced and still treats them as at risk", () => {
    const summary = summarizeMoney({
      budget: 18000,
      phases: [
        { id: "a", amount: 3600, paymentStatus: "paid", dependencies: [] },
        { id: "b", amount: 4320, paymentStatus: "overdue", dependencies: ["a"] },
        { id: "c", amount: 7200, paymentStatus: "draft", dependencies: ["b"] },
        { id: "d", amount: 2880, paymentStatus: "draft", dependencies: ["c"] },
      ],
    });
    expect(summary.paid).toBe(3600);
    expect(summary.invoiced).toBe(4320);
    expect(summary.atRisk).toBe(14400);
  });
});
