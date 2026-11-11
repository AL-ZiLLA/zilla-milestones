import { markPhaseStatus } from "@/lib/schedule";
import type { PaymentStatus, Project } from "@/lib/types";

export interface WebhookHeaders {
  transmissionId?: string;
  transmissionTime?: string;
  transmissionSig?: string;
  certUrl?: string;
  authAlgo?: string;
  demoSignature?: string;
}

export interface InvoiceWebhookEvent {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    status?: string;
    invoice?: { id?: string; status?: string };
  };
}

export function invoiceIdFromEvent(event: InvoiceWebhookEvent): string | undefined {
  return event.resource?.id || event.resource?.invoice?.id;
}

export function statusFromInvoiceEvent(event: InvoiceWebhookEvent): PaymentStatus | null {
  const type = (event.event_type || "").toUpperCase();
  const resourceStatus = (
    event.resource?.status ||
    event.resource?.invoice?.status ||
    ""
  ).toUpperCase();

  if (!type.includes("INVOICE") && !resourceStatus) return null;
  if (type.endsWith(".PAID") || resourceStatus === "PAID" || resourceStatus === "MARKED_AS_PAID") {
    return "paid";
  }
  if (
    type.endsWith(".CANCELLED") ||
    type.endsWith(".REFUNDED") ||
    resourceStatus === "CANCELLED" ||
    resourceStatus === "REFUNDED" ||
    resourceStatus === "MARKED_AS_REFUNDED"
  ) {
    return "cancelled";
  }
  if (
    resourceStatus === "SENT" ||
    resourceStatus === "UNPAID" ||
    resourceStatus === "SCHEDULED" ||
    resourceStatus === "PARTIALLY_PAID" ||
    resourceStatus === "PAYMENT_PENDING"
  ) {
    return "invoiced";
  }
  return null;
}

export function applyInvoiceEvent(project: Project, event: InvoiceWebhookEvent, asOf: string): Project {
  const invoiceId = invoiceIdFromEvent(event);
  const status = statusFromInvoiceEvent(event);
  if (!invoiceId || !status) return project;
  const phase = project.phases.find((item) => item.paypalInvoiceId === invoiceId);
  if (!phase) return project;
  if (status === "invoiced" && (phase.paymentStatus === "overdue" || phase.paymentStatus === "paid")) {
    return project;
  }
  return {
    ...project,
    phases: markPhaseStatus(project.phases, phase.id, status, asOf),
    updatedAt: new Date().toISOString(),
  };
}

export async function verifyPayPalWebhookSignature(args: {
  event: unknown;
  headers: WebhookHeaders;
  webhookId: string;
  accessToken: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { headers } = args;
  if (
    !args.webhookId ||
    !headers.transmissionId ||
    !headers.transmissionTime ||
    !headers.transmissionSig ||
    !headers.certUrl ||
    !headers.authAlgo
  ) {
    return false;
  }
  const fetchImpl = args.fetchImpl ?? fetch;
  const response = await fetchImpl(`${args.baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_id: args.webhookId,
      webhook_event: args.event,
    }),
  });
  if (!response.ok) return false;
  const payload = (await response.json()) as { verification_status?: string };
  return payload.verification_status === "SUCCESS";
}

export async function processWebhook(input: {
  event: unknown;
  headers: WebhookHeaders;
  verify: (headers: WebhookHeaders, event: unknown) => Promise<boolean>;
  project: Project | null;
  asOf: string;
}): Promise<{
  status: number;
  body: { ok: boolean; error?: string; invoiceId?: string; updated?: boolean };
  project: Project | null;
}> {
  const valid = await input.verify(input.headers, input.event);
  if (!valid) {
    return {
      status: 401,
      body: { ok: false, error: "Invalid webhook signature" },
      project: input.project,
    };
  }
  if (!input.event || typeof input.event !== "object") {
    return {
      status: 400,
      body: { ok: false, error: "Invalid webhook event" },
      project: input.project,
    };
  }
  const event = input.event as InvoiceWebhookEvent;
  const invoiceId = invoiceIdFromEvent(event);
  if (!input.project || !invoiceId) {
    return { status: 200, body: { ok: true, updated: false, invoiceId }, project: input.project };
  }
  const project = applyInvoiceEvent(input.project, event, input.asOf);
  const updated = project !== input.project;
  return { status: 200, body: { ok: true, updated, invoiceId }, project };
}
