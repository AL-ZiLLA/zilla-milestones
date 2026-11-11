import { describe, expect, it } from "vitest";
import { reminderNote } from "@/lib/email";
import { runAgentTool } from "@/lib/agent";
import { approveDraft, discardDraft } from "@/lib/service";
import type { Project } from "@/lib/types";

function project(): Project {
  return {
    id: "proj_approval",
    name: "HVAC booking portal",
    summary: "Approval test",
    scope: "Scope long enough to plan the work.",
    clientEmail: "billing@example.com",
    budget: 18000,
    pyusdNote: false,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    messages: [],
    phases: [
      {
        id: "a",
        name: "Design",
        description: "Design the booking screens.",
        startDate: "2026-11-16",
        endDate: "2026-11-23",
        durationDays: 8,
        amount: 4500,
        dependencies: [],
        paymentStatus: "overdue",
        dueDate: "2026-11-18",
        invoiceDate: "2026-11-11",
        paypalInvoiceId: "INV2-DEMO-DESIGN",
        slipDaysApplied: 7,
        blocked: false,
      },
    ],
    drafts: [
      {
        id: "draft_design",
        phaseId: "a",
        subject: "Schedule update for HVAC booking portal: Design",
        body: [
          "Hello,",
          "",
          "The milestone \"Design\" ($4,500.00) was due on 2026-11-18.",
          "",
          "This draft is waiting for a person to approve it. It has not been sent.",
        ].join("\n"),
        createdAt: "2026-11-25T00:00:00.000Z",
        status: "pending_approval",
      },
    ],
  };
}

describe("approval gate", () => {
  it("strips the unsent footer before the PayPal reminder note", () => {
    expect(reminderNote(project().drafts[0].body)).toBe(
      'Hello,\n\nThe milestone "Design" ($4,500.00) was due on 2026-11-18.',
    );
  });

  it("does not send a reminder until Approve is clicked", async () => {
    const current = project();
    const blocked = await runAgentTool(current, "send_invoice_reminder", {
      invoice_id: "INV2-DEMO-DESIGN",
    });
    expect(blocked.output).toMatch(/approv/i);
    expect(blocked.project.drafts[0].status).toBe("pending_approval");
    expect(
      blocked.project.actions?.some((action) => action.tool === "send_invoice_reminder" && action.status === "ok"),
    ).toBeFalsy();

    const discarded = discardDraft(current, "draft_design");
    expect(discarded.project.drafts[0].status).toBe("discarded");
    expect(discarded.project.actions?.some((action) => action.tool === "send_invoice_reminder")).toBeFalsy();

    const approved = await approveDraft(current, "draft_design");
    expect(approved.project.drafts[0].status).toBe("approved");
    const sent = approved.project.actions?.find((action) => action.tool === "send_invoice_reminder");
    expect(sent?.status).toBe("ok");
    expect(sent?.paypalApi).toBe("POST /v2/invoicing/invoices/{id}/remind");
    await expect(approveDraft(approved.project, "draft_design")).rejects.toThrow(/draft not found/i);
  });
});
