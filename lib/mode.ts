import type { RuntimeMode } from "@/lib/types";

export function cannedAiEnabled(): boolean {
  if (process.env.DEMO_MODE === "true") return true;
  if (process.env.DEMO_MODE === "false") return false;
  return !process.env.XAI_API_KEY;
}

export function mockPaypalEnabled(): boolean {
  if (process.env.DEMO_MODE === "true") return true;
  if (process.env.DEMO_MODE === "false") return false;
  return !process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET;
}

export function paypalBaseUrl(): string {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function runtimeMode(): RuntimeMode {
  return {
    demoAi: cannedAiEnabled(),
    demoPaypal: mockPaypalEnabled(),
    paypalMode: process.env.PAYPAL_MODE === "live" ? "live" : "sandbox",
    model: process.env.XAI_MODEL || "grok-4",
  };
}

export function assertAiConfigured(): void {
  if (process.env.DEMO_MODE === "false" && !process.env.XAI_API_KEY) {
    throw new Error("XAI_API_KEY is required when DEMO_MODE=false");
  }
}

export function assertPaypalConfigured(): void {
  if (process.env.DEMO_MODE === "false") {
    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
      throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required when DEMO_MODE=false");
    }
  }
}
