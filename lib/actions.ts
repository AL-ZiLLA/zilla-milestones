import { randomBytes } from "crypto";
import type { ActivityEvent, AgentAction, Project } from "@/lib/types";

export const PAYPAL_API_BY_TOOL: Record<string, string> = {
  create_invoice: "POST /v2/invoicing/invoices",
  send_invoice: "POST /v2/invoicing/invoices/{id}/send",
  get_invoice: "GET /v2/invoicing/invoices/{id}",
  list_invoices: "GET /v2/invoicing/invoices",
  record_payment_for_invoice: "POST /v2/invoicing/invoices/{id}/payments",
  send_invoice_reminder: "POST /v2/invoicing/invoices/{id}/remind",
  set_invoice_due_date: "PUT /v2/invoicing/invoices/{id}",
};

export const WEBHOOK_PAID_TOAST = "PayPal webhook verified: INVOICING.INVOICE.PAID";

function nid(prefix: string): string {
  return `${prefix}_${randomBytes(3).toString("hex")}`;
}

export function appendAction(
  project: Project,
  input: { tool: string; status: "ok" | "error"; latencyMs: number; detail?: string },
): Project {
  const action: AgentAction = {
    id: nid("act"),
    tool: input.tool,
    paypalApi: PAYPAL_API_BY_TOOL[input.tool] ?? null,
    status: input.status,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    detail: input.detail,
    at: new Date().toISOString(),
  };
  return {
    ...project,
    actions: [...(project.actions ?? []), action].slice(-60),
  };
}

export function appendEvent(project: Project, message: string): Project {
  const event: ActivityEvent = {
    id: nid("evt"),
    message,
    at: new Date().toISOString(),
  };
  return {
    ...project,
    events: [...(project.events ?? []), event].slice(-30),
    updatedAt: new Date().toISOString(),
  };
}

export function webhookVerifiedMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const type = String((event as { event_type?: string }).event_type || "").toUpperCase();
  if (type === "INVOICING.INVOICE.PAID") return WEBHOOK_PAID_TOAST;
  return null;
}
