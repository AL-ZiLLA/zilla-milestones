import { describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";
import {
  applyInvoiceEvent,
  processWebhook,
  verifyPayPalWebhookSignature,
  type WebhookHeaders,
} from "@/lib/webhook";

const headers: WebhookHeaders = {
  transmissionId: "tx-1",
  transmissionTime: "2026-11-09T12:00:00Z",
  transmissionSig: "sig",
  certUrl: "https://api.sandbox.paypal.com/cert.pem",
  authAlgo: "SHA256withRSA",
};

function project(): Project {
  return {
    id: "proj_test",
    name: "Harbor & Pine",
    summary: "Test plan",
    scope: "Test scope long enough for the planner.",
    clientEmail: "billing@example.com",
    budget: 2000,
    pyusdNote: true,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    drafts: [],
    messages: [],
    phases: [
      {
        id: "a",
        name: "Discovery",
        description: "Confirm scope",
        startDate: "2026-11-01",
        endDate: "2026-11-05",
        durationDays: 5,
        amount: 500,
        dependencies: [],
        paymentStatus: "invoiced",
        dueDate: "2026-11-05",
        paypalInvoiceId: "INV2-DEMO-DISCOVERY",
        slipDaysApplied: 0,
        blocked: false,
        invoicedAt: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "b",
        name: "Design",
        description: "Design screens",
        startDate: "2026-11-06",
        endDate: "2026-11-12",
        durationDays: 7,
        amount: 1500,
        dependencies: ["a"],
        paymentStatus: "draft",
        dueDate: "2026-11-12",
        slipDaysApplied: 0,
        blocked: true,
      },
    ],
  };
}

describe("PayPal webhook handler", () => {
  it("rejects an event when signature verification fails and leaves phases unchanged", async () => {
    const current = project();
    const verify = vi.fn(async () => false);
    const result = await processWebhook({
      event: {
        event_type: "INVOICING.INVOICE.PAID",
        resource: { id: "INV2-DEMO-DISCOVERY", status: "PAID" },
      },
      headers,
      verify,
      project: current,
      asOf: "2026-11-09",
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(result.status).toBe(401);
    expect(result.project).toBe(current);
    expect(result.project?.phases[0].paymentStatus).toBe("invoiced");
    expect(result.project?.phases[1].blocked).toBe(true);
  });

  it("marks the matching phase paid and unblocks dependents after a verified PAID event", async () => {
    const result = await processWebhook({
      event: {
        event_type: "INVOICING.INVOICE.PAID",
        resource: { id: "INV2-DEMO-DISCOVERY", status: "PAID" },
      },
      headers,
      verify: async () => true,
      project: project(),
      asOf: "2026-11-09",
    });
    expect(result.status).toBe(200);
    expect(result.body.updated).toBe(true);
    expect(result.project?.phases[0].paymentStatus).toBe("paid");
    expect(result.project?.phases[0].paidAt).toBe("2026-11-09");
    expect(result.project?.phases[1].blocked).toBe(false);
  });

  it("marks a phase cancelled from INVOICING.INVOICE.CANCELLED", () => {
    const next = applyInvoiceEvent(
      project(),
      {
        event_type: "INVOICING.INVOICE.CANCELLED",
        resource: { id: "INV2-DEMO-DISCOVERY", status: "CANCELLED" },
      },
      "2026-11-09",
    );
    expect(next.phases[0].paymentStatus).toBe("cancelled");
    expect(next.phases[1].blocked).toBe(true);
  });

  it("verifies the PayPal signature against the sandbox endpoint", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ verification_status: "SUCCESS" }), { status: 200 }),
    );
    const event = { event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-1" } };
    const ok = await verifyPayPalWebhookSignature({
      event,
      headers,
      webhookId: "WH-123",
      accessToken: "token",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
    });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    const body = JSON.parse(String(init.body));
    expect(body.webhook_id).toBe("WH-123");
    expect(body.transmission_id).toBe("tx-1");
    expect(body.webhook_event).toEqual(event);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("returns false for a FAILURE status and for missing signature headers", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ verification_status: "FAILURE" }), { status: 200 }),
    );
    const failed = await verifyPayPalWebhookSignature({
      event: { event_type: "INVOICING.INVOICE.PAID" },
      headers,
      webhookId: "WH-123",
      accessToken: "token",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
    });
    expect(failed).toBe(false);
    const missing = await verifyPayPalWebhookSignature({
      event: {},
      headers: { transmissionId: "only-one" },
      webhookId: "WH-123",
      accessToken: "token",
      baseUrl: "https://api-m.sandbox.paypal.com",
      fetchImpl,
    });
    expect(missing).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
