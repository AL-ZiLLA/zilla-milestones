import { describe, expect, it } from "vitest";
import { clientUpdatePrompt, clientUpdateTone } from "@/lib/compose";
import { chooseClientUpdate, scrubClientGreeting } from "@/lib/email";
import type { Phase, Project } from "@/lib/types";

const phase: Phase = {
  id: "b",
  name: "Design",
  description: "Design the screens.",
  startDate: "2026-11-16",
  endDate: "2026-11-23",
  durationDays: 8,
  amount: 4500,
  dependencies: ["a"],
  paymentStatus: "overdue",
  dueDate: "2026-11-18",
  slipDaysApplied: 7,
  blocked: false,
};

const project: Project = {
  id: "proj",
  name: "HVAC booking portal",
  summary: "Plan",
  scope: "Scope long enough.",
  clientEmail: "billing@example.com",
  clientName: "Jordan Lee",
  budget: 18000,
  pyusdNote: false,
  createdAt: "2026-11-11T00:00:00.000Z",
  updatedAt: "2026-11-11T00:00:00.000Z",
  phases: [phase],
  drafts: [],
  messages: [],
};

const template = {
  subject: "Schedule update",
  body: "The milestone is unpaid and this draft has not been sent.",
};

describe("client update composition", () => {
  it("picks a tone from how late the invoice is", () => {
    expect(clientUpdateTone(0)).toMatch(/warm/);
    expect(clientUpdateTone(7)).toMatch(/direct/);
    expect(clientUpdateTone(14)).toMatch(/firm/);
  });

  it("keeps a Grok draft only when it cites the amount, due date, and schedule", () => {
    const accepted = chooseClientUpdate(
      JSON.stringify({
        subject: "Design payment",
        body: "Design ($4,500.00) was due 2026-11-18. Build now starts 2026-11-27.",
      }),
      template,
      { amountLabel: "$4,500.00", dueDate: "2026-11-18", shiftedNames: ["Build"] },
    );
    expect(accepted.subject).toBe("Design payment");
    expect(accepted.body).toContain("has not been sent");
    expect(accepted.body).toContain("$4,500.00");

    const rejected = chooseClientUpdate(
      JSON.stringify({ subject: "Hello", body: "Please pay soon." }),
      template,
      { amountLabel: "$4,500.00", dueDate: "2026-11-18", shiftedNames: ["Build"] },
    );
    expect(rejected).toEqual(template);
  });

  it("asks Grok for the tone, amount, due date, and schedule impact", () => {
    const prompt = clientUpdatePrompt(project, phase, [
      { ...phase, id: "c", name: "Build", startDate: "2026-11-27" },
    ]);
    expect(prompt).toContain("direct, polite, and specific");
    expect(prompt).toContain("$4,500.00");
    expect(prompt).toContain("2026-11-18");
    expect(prompt).toContain("Build now starts 2026-11-27");
    expect(prompt).toContain("Hello Jordan,");
    expect(prompt).not.toContain("billing@example.com");
  });

  it("replaces an email greeting with the client name", () => {
    expect(scrubClientGreeting("Dear sb-buyer@personal.example.com,\n\nPlease pay.", "Jordan Lee")).toBe(
      "Hello Jordan,\n\nPlease pay.",
    );
    const accepted = chooseClientUpdate(
      JSON.stringify({
        subject: "Design payment",
        body: "Dear sb-buyer@personal.example.com,\n\nDesign ($4,500.00) was due 2026-11-18. Build moved.",
      }),
      template,
      { amountLabel: "$4,500.00", dueDate: "2026-11-18", shiftedNames: ["Build"], clientName: "Jordan Lee" },
    );
    expect(accepted.body.startsWith("Hello Jordan,")).toBe(true);
    expect(accepted.body).not.toContain("@");
  });
});
