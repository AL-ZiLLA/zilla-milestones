import { describe, expect, it } from "vitest";
import { merchantToday, todayUtc } from "@/lib/dates";
import { buildInvoiceRequest } from "@/lib/invoice-payload";
import { applyInvoiceDueDate } from "@/lib/paypal";
import { invoicePhase } from "@/lib/service";
import type { Project } from "@/lib/types";

const evening = new Date("2026-11-11T06:30:00.000Z");

function project(): Project {
  return {
    id: "proj_invoice",
    name: "HVAC booking portal",
    summary: "Payment-gated phases.",
    scope: "HVAC booking portal with design, build, and launch.",
    clientEmail: "billing@example.com",
    budget: 18000,
    pyusdNote: false,
    createdAt: "2026-11-10T00:00:00.000Z",
    updatedAt: "2026-11-10T00:00:00.000Z",
    drafts: [],
    messages: [],
    phases: [
      {
        id: "ph_discovery",
        name: "Discovery",
        description: "Workshop the scope.",
        startDate: "2026-11-21",
        endDate: "2026-11-25",
        durationDays: 5,
        amount: 3600,
        dependencies: [],
        paymentStatus: "draft",
        dueDate: "2026-11-25",
        slipDaysApplied: 0,
        blocked: false,
      },
    ],
  };
}

describe("invoice payload", () => {
  it("dates the invoice on the merchant-local day and sets Net 7", () => {
    const built = buildInvoiceRequest(project(), project().phases[0], evening);
    expect(built.invoiceDate).toBe("2026-11-10");
    expect(built.invoiceDate).not.toBe(todayUtc(evening));
    expect(merchantToday(evening)).toBe(built.invoiceDate);
    expect(built.dueDate).toBe("2026-11-17");
    expect(built.args.invoice_date).toBe("2026-11-10");
    expect(built.args).not.toHaveProperty("due_date");
    expect(String(built.args.note)).toContain("Net 7");
    expect(String(built.args.note)).toContain("2026-11-17");
    expect(built.paypalBody.detail.payment_term).toEqual({
      term_type: "DUE_ON_DATE_SPECIFIED",
      due_date: "2026-11-17",
    });
  });

  it("puts the Net 7 due date on the draft invoice before send", async () => {
    const built = buildInvoiceRequest(project(), project().phases[0], evening);
    const calls: Array<{ url: string; method?: string; body?: string; auth?: string }> = [];
    const result = await applyInvoiceDueDate("INV2-DEMO-DISCOVERY", built.paypalBody, {
      token: "test-token",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl: async (url, init) => {
        const headers = init?.headers as Record<string, string>;
        calls.push({
          url: String(url),
          method: init?.method,
          body: typeof init?.body === "string" ? init.body : undefined,
          auth: headers.Authorization,
        });
        return new Response("{}", { status: 200 });
      },
    });
    expect(result.ok).toBe(true);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-DEMO-DISCOVERY");
    expect(calls[0]?.auth).toBe("Bearer test-token");
    expect(JSON.parse(calls[0]?.body || "{}").detail.payment_term.due_date).toBe("2026-11-17");
  });

  it("stores the Net 7 due date and a payer link on the phase", async () => {
    const result = await invoicePhase(project(), "Discovery", { now: evening });
    const phase = result.project.phases[0];
    expect(phase.paymentStatus).toBe("invoiced");
    expect(phase.invoiceDate).toBe("2026-11-10");
    expect(phase.dueDate).toBe("2026-11-17");
    expect(phase.paypalPayerUrl).toMatch(/sandbox\.paypal\.com\/invoice\//);
    expect(result.project.actions?.map((action) => action.tool)).toEqual([
      "create_invoice",
      "set_invoice_due_date",
      "send_invoice",
      "get_invoice",
    ]);
    expect(result.project.actions?.every((action) => action.status === "ok")).toBe(true);
    expect(result.project.actions?.[0].paypalApi).toBe("POST /v2/invoicing/invoices");
  });
});
