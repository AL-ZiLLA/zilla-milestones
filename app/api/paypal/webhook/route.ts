import { NextResponse } from "next/server";
import { todayUtc } from "@/lib/dates";
import { errorResponse } from "@/lib/http";
import { mockPaypalEnabled, paypalBaseUrl } from "@/lib/mode";
import { applyOverdue } from "@/lib/overdue";
import { getPaypalAccessToken } from "@/lib/paypal";
import { nid } from "@/lib/service";
import { readProject, saveProject } from "@/lib/store";
import { processWebhook, verifyPayPalWebhookSignature, type WebhookHeaders } from "@/lib/webhook";

export const dynamic = "force-dynamic";

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
    const result = await processWebhook({
      event,
      headers,
      project: readProject(),
      asOf: todayUtc(),
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
    if (result.project && result.body.updated) {
      const checked = applyOverdue(result.project, todayUtc(), () => nid("draft"));
      saveProject(checked.project);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return errorResponse(error);
  }
}
