import { NextResponse } from "next/server";
import { appendEvent, webhookVerifiedMessage } from "@/lib/actions";
import { asOfDate } from "@/lib/dates";
import { errorResponse } from "@/lib/http";
import { mockPaypalEnabled, paypalBaseUrl } from "@/lib/mode";
import { applyOverdue } from "@/lib/overdue";
import { composeOverdueDrafts } from "@/lib/compose";
import { getPaypalAccessToken } from "@/lib/paypal";
import { nid } from "@/lib/service";
import { getStore } from "@/lib/store";
import {
  invoiceIdFromEvent,
  processWebhook,
  verifyPayPalWebhookSignature,
  type InvoiceWebhookEvent,
  type WebhookHeaders,
} from "@/lib/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function headersFrom(request: Request): WebhookHeaders {
  return {
    transmissionId: request.headers.get("paypal-transmission-id") ?? undefined,
    transmissionTime: request.headers.get("paypal-transmission-time") ?? undefined,
    transmissionSig: request.headers.get("paypal-transmission-sig") ?? undefined,
    certUrl: request.headers.get("paypal-cert-url") ?? undefined,
    authAlgo: request.headers.get("paypal-auth-algo") ?? undefined,
    demoSignature: request.headers.get("x-zilla-demo-signature") ?? undefined,
  };
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let event: unknown;
    try {
      event = JSON.parse(raw) as unknown;
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }
    const headers = headersFrom(request);
    const invoiceId =
      event && typeof event === "object" ? invoiceIdFromEvent(event as InvoiceWebhookEvent) : undefined;
    const located = invoiceId ? await getStore().findByInvoice(invoiceId) : null;
    const result = await processWebhook({
      event,
      headers,
      project: located?.project ?? null,
      asOf: located ? asOfDate(located.project) : asOfDate({}),
      verify: async (webhookHeaders, webhookEvent) => {
        if (mockPaypalEnabled()) return webhookHeaders.demoSignature === "demo";
        const accessToken = await getPaypalAccessToken();
        return verifyPayPalWebhookSignature({
          event: webhookEvent,
          headers: webhookHeaders,
          webhookId: process.env.PAYPAL_WEBHOOK_ID || "",
          accessToken,
          baseUrl: paypalBaseUrl(),
        });
      },
    });
    if (result.project && result.body.updated && located) {
      let next = result.project;
      const toast = webhookVerifiedMessage(event);
      if (toast) next = appendEvent(next, toast);
      const checked = applyOverdue(next, asOfDate(next), () => nid("draft"));
      const finalProject = checked.changed ? await composeOverdueDrafts(checked.project) : next;
      await getStore().write(located.sessionId, finalProject);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
