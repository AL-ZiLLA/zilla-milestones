import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getStore, resetStoreQueueForTests, SupabaseMilestoneStore } from "@/lib/store";
import type { Project } from "@/lib/types";

function named(name: string, invoiceId?: string): Project {
  return {
    id: `proj_${name}`,
    name,
    summary: name,
    scope: "Scope long enough to store.",
    clientEmail: "billing@example.com",
    budget: 1000,
    pyusdNote: false,
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    drafts: [],
    messages: [],
    phases: [
      {
        id: "a",
        name: "Discovery",
        description: "Workshop",
        startDate: "2026-11-11",
        endDate: "2026-11-15",
        durationDays: 5,
        amount: 1000,
        dependencies: [],
        paymentStatus: invoiceId ? "invoiced" : "draft",
        dueDate: "2026-11-18",
        paypalInvoiceId: invoiceId,
        slipDaysApplied: 0,
        blocked: false,
      },
    ],
  };
}

const files: string[] = [];

afterEach(() => {
  for (const file of files.splice(0)) {
    fs.rmSync(file, { force: true });
  }
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ZILLA_STORE_PATH;
  resetStoreQueueForTests();
});

describe("session store", () => {
  it("keeps two visitor sessions from overwriting each other", async () => {
    const file = path.join(os.tmpdir(), `zilla-store-${Date.now()}-isolation.json`);
    files.push(file);
    process.env.ZILLA_STORE_PATH = file;
    const store = getStore();
    const alpha = await store.ensure("a".repeat(32), () => named("Alpha"));
    const beta = await store.ensure("b".repeat(32), () => named("Beta"));
    expect(alpha?.name).toBe("Alpha");
    expect(beta?.name).toBe("Beta");
    await store.update("a".repeat(32), (project) => ({ ...project, name: "Alpha 2" }));
    expect((await store.read("b".repeat(32)))?.name).toBe("Beta");
    expect((await store.read("a".repeat(32)))?.name).toBe("Alpha 2");
    await store.write("a".repeat(32), null);
    const again = await store.ensure("a".repeat(32), () => named("Reseed"));
    expect(again).toBeNull();
    const found = await store.findByInvoice("INV2-BETA");
    expect(found).toBeNull();
    await store.write("b".repeat(32), named("Beta", "INV2-BETA"));
    expect((await store.findByInvoice("INV2-BETA"))?.sessionId).toBe("b".repeat(32));
  });

  it("upserts one Supabase row per session id", async () => {
    const calls: Array<{ url: string; method?: string; body?: string; apikey?: string }> = [];
    const store = new SupabaseMilestoneStore("https://example.supabase.co", "service-role-test", async (url, init) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
        apikey: headers.apikey,
      });
      if ((init?.method || "GET") === "GET") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(null, { status: 201 });
    });
    await store.write("session-1", named("Solo"));
    expect(calls[0]?.url).toContain("https://example.supabase.co/rest/v1/zilla_sessions");
    expect(calls[0]?.url).toContain("on_conflict=id");
    expect(calls[0]?.apikey).toBe("service-role-test");
    expect(JSON.parse(calls[0]?.body || "{}").id).toBe("session-1");
    expect(await store.has("missing")).toBe(false);
  });
});
