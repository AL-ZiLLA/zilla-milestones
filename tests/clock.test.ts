import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { fastForwardClock } from "@/lib/service";
import type { Phase, Project } from "@/lib/types";

function phase(partial: Partial<Phase> & Pick<Phase, "id" | "name">): Phase {
  return {
    description: partial.name,
    startDate: "2026-11-01",
    endDate: "2026-11-05",
    durationDays: 5,
    amount: 1000,
    paymentStatus: "draft",
    dueDate: "2026-11-05",
    slipDaysApplied: 0,
    blocked: false,
    dependencies: [],
    ...partial,
  };
}

function project(): Project {
  return {
    id: "proj_clock",
    name: "HVAC booking portal",
    summary: "Clock test",
    scope: "Scope long enough to plan the work.",
    clientEmail: "billing@example.com",
    budget: 2000,
    pyusdNote: false,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    clockDate: "2026-11-11",
    drafts: [],
    messages: [],
    phases: [
      phase({
        id: "a",
        name: "Discovery",
        paymentStatus: "invoiced",
        dueDate: "2026-11-18",
        invoiceDate: "2026-11-11",
        paypalInvoiceId: "INV2-DEMO-A",
        startDate: "2026-11-11",
        endDate: "2026-11-15",
      }),
      phase({
        id: "b",
        name: "Design",
        dependencies: ["a"],
        startDate: "2026-11-16",
        endDate: "2026-11-20",
        dueDate: "2026-11-20",
        blocked: true,
      }),
    ],
  };
}

describe("demo clock", () => {
  it("fast-forwards past the Net-7 due date without backdating it", async () => {
    const current = project();
    const result = await fastForwardClock(current, "Discovery");
    const discovery = result.project.phases.find((item) => item.id === "a");
    const design = result.project.phases.find((item) => item.id === "b");
    expect(discovery?.dueDate).toBe("2026-11-18");
    expect(discovery?.invoiceDate).toBe("2026-11-11");
    expect(result.project.clockDate).toBe(addDays("2026-11-18", 7));
    expect(discovery?.paymentStatus).toBe("overdue");
    expect(design?.startDate).toBe(addDays("2026-11-16", 7));
    expect(result.project.drafts).toHaveLength(1);
    expect(result.project.drafts[0].status).toBe("pending_approval");
    expect(result.project.drafts[0].body).toContain("has not been sent");
    expect(result.project.actions?.some((action) => action.tool === "send_invoice_reminder")).toBe(false);
  });
});
