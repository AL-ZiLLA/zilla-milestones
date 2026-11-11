import { describe, expect, it } from "vitest";
import { mapPaypalInvoiceStatus, paymentWasRecorded } from "@/lib/paypal";

describe("paymentWasRecorded", () => {
  it("accepts toolkit 204 success payload", () => {
    expect(paymentWasRecorded({ success: true, invoice_id: "INV2-ABC" })).toBe(true);
  });

  it("accepts PayPal 200 payment_id body", () => {
    expect(paymentWasRecorded({ payment_id: "PAY-1234567890" })).toBe(true);
  });

  it("accepts PAID and MARKED_AS_PAID status", () => {
    expect(paymentWasRecorded({ status: "PAID" })).toBe(true);
    expect(paymentWasRecorded({ status: "MARKED_AS_PAID" })).toBe(true);
  });

  it("rejects error payloads", () => {
    expect(
      paymentWasRecorded({
        ok: false,
        status: 422,
        message: "Current invoice state does not support payment processing.",
      }),
    ).toBe(false);
  });
});

describe("mapPaypalInvoiceStatus", () => {
  it("maps MARKED_AS_PAID to paid", () => {
    expect(mapPaypalInvoiceStatus({ status: "MARKED_AS_PAID" })).toBe("paid");
  });
});
