import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatWithProject, runAgentTool } from "@/lib/agent";
import { grokComplete } from "@/lib/planner";
import { fastForwardClock, projectSnapshot } from "@/lib/service";
import { applyOverdue } from "@/lib/overdue";
import { markPhaseStatus } from "@/lib/schedule";
import type { Phase, Project } from "@/lib/types";

vi.mock("@/lib/planner", () => ({
  grokComplete: vi.fn(),
  generatePlan: vi.fn(),
}));

const QUESTION = "What's overdue, and what did that do to the schedule?";

interface SnapshotPhase {
  name: string;
  status: string;
  start: string;
  end: string;
  baselineStart: string;
  baselineFinish: string;
  overdueShiftDays: number;
}

interface Snapshot {
  phases: SnapshotPhase[];
}

function phase(partial: Partial<Phase> & Pick<Phase, "id" | "name">): Phase {
  return {
    description: partial.name,
    startDate: "2026-11-01",
    endDate: "2026-11-05",
    durationDays: 5,
    amount: 1000,
    paymentStatus: "draft",
    dueDate: "2026-11-05",
    slipDaysApplied: 0,
    blocked: false,
    dependencies: [],
    ...partial,
  };
}

function invoicedPlan(): Project {
  return {
    id: "proj_chat",
    name: "Harbor & Pine",
    summary: "Four milestones.",
    scope: "Scope long enough to plan the work.",
    clientEmail: "billing@example.com",
    clientName: "Jordan",
    budget: 4000,
    pyusdNote: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    clockDate: "2026-11-01",
    drafts: [],
    messages: [],
    phases: [
      phase({
        id: "a",
        name: "Discovery",
        paymentStatus: "invoiced",
        dueDate: "2026-11-05",
        invoiceDate: "2026-10-29",
        paypalInvoiceId: "INV2-DEMO-A",
        startDate: "2026-11-01",
        endDate: "2026-11-05",
      }),
      phase({
        id: "b",
        name: "Design",
        dependencies: ["a"],
        startDate: "2026-11-06",
        endDate: "2026-11-13",
        dueDate: "2026-11-13",
        blocked: true,
      }),
      phase({
        id: "c",
        name: "Build",
        dependencies: ["b"],
        startDate: "2026-11-14",
        endDate: "2026-11-25",
        dueDate: "2026-11-25",
        blocked: true,
      }),
      phase({
        id: "d",
        name: "Launch",
        dependencies: ["c"],
        startDate: "2026-11-26",
        endDate: "2026-11-30",
        dueDate: "2026-11-30",
        blocked: true,
      }),
      phase({
        id: "e",
        name: "Support",
        dependencies: ["a"],
        paymentStatus: "paid",
        paidAt: "2026-11-02",
        startDate: "2026-11-06",
        endDate: "2026-11-08",
        dueDate: "2026-11-08",
        blocked: false,
      }),
    ],
  };
}

function parseSnapshot(text: string): Snapshot {
  const start = text.indexOf("{");
  return JSON.parse(text.slice(start)) as Snapshot;
}

function phaseByName(snapshot: Snapshot, name: string): SnapshotPhase {
  const found = snapshot.phases.find((item) => item.name === name);
  if (!found) throw new Error(`Missing phase ${name}`);
  return found;
}

describe("chat project state after an overdue gate", () => {
  beforeEach(() => {
    vi.mocked(grokComplete).mockReset();
    vi.mocked(grokComplete).mockResolvedValue({ content: "ok" });
  });

  it("includes shifted dependents with day deltas", async () => {
    const forwarded = await fastForwardClock(invoicedPlan(), "Discovery");
    const discovery = forwarded.project.phases.find((item) => item.name === "Discovery");
    expect(discovery?.paymentStatus).toBe("overdue");
    expect(forwarded.project.clockDate).toBe("2026-11-12");

    const tool = await runAgentTool(forwarded.project, "get_project_state", {});
    for (const text of [projectSnapshot(forwarded.project), tool.output]) {
      const snapshot = parseSnapshot(text);
      const gate = phaseByName(snapshot, "Discovery");
      const design = phaseByName(snapshot, "Design");
      const build = phaseByName(snapshot, "Build");
      const launch = phaseByName(snapshot, "Launch");
      const support = phaseByName(snapshot, "Support");

      expect(gate.status).toBe("overdue");
      expect(gate.overdueShiftDays).toBe(0);
      expect(gate.baselineStart).toBe(gate.start);
      expect(gate.baselineFinish).toBe(gate.end);

      expect(design).toMatchObject({
        overdueShiftDays: 7,
        baselineStart: "2026-11-06",
        start: "2026-11-13",
        baselineFinish: "2026-11-13",
        end: "2026-11-20",
      });
      expect(build).toMatchObject({
        overdueShiftDays: 7,
        baselineStart: "2026-11-14",
        start: "2026-11-21",
        baselineFinish: "2026-11-25",
        end: "2026-12-02",
      });
      expect(launch).toMatchObject({
        overdueShiftDays: 7,
        baselineStart: "2026-11-26",
        start: "2026-12-03",
        baselineFinish: "2026-11-30",
        end: "2026-12-07",
      });
      expect(support.overdueShiftDays).toBe(0);
      expect(support.start).toBe("2026-11-06");
      expect(support.baselineStart).toBe(support.start);
      expect(support.baselineFinish).toBe(support.end);
    }
  });

  it("sends baseline dates and overdue shifts when asked what the overdue gate did", async () => {
    const forwarded = await fastForwardClock(invoicedPlan(), "Discovery");
    const previousDemo = process.env.DEMO_MODE;
    const previousKey = process.env.XAI_API_KEY;
    delete process.env.DEMO_MODE;
    process.env.XAI_API_KEY = "test-key";

    vi.mocked(grokComplete).mockImplementation(async (messages) => {
      const system = String(messages[0]?.content ?? "");
      expect(system).toContain("Never write a field name, JSON, or ISO dates");
      expect(system).toContain('"Design moved 7 days, now Nov 23 to Nov 30 (was Nov 16 to Nov 23)."');
      expect(system).not.toContain("state overdueShiftDays");
      const snapshot = parseSnapshot(system);
      expect(phaseByName(snapshot, "Discovery").status).toBe("overdue");
      expect(phaseByName(snapshot, "Build")).toMatchObject({
        overdueShiftDays: 7,
        baselineStart: "2026-11-14",
        start: "2026-11-21",
        baselineFinish: "2026-11-25",
        end: "2026-12-02",
      });
      expect(phaseByName(snapshot, "Launch")).toMatchObject({
        overdueShiftDays: 7,
        baselineStart: "2026-11-26",
        start: "2026-12-03",
        baselineFinish: "2026-11-30",
        end: "2026-12-07",
      });
      const asked = messages.some(
        (message) => typeof message.content === "string" && message.content === QUESTION,
      );
      expect(asked).toBe(true);
      return {
        content:
          "Discovery is overdue. Design, Build, and Launch each moved 7 days from their baseline dates.",
      };
    });

    try {
      const result = await chatWithProject(forwarded.project, QUESTION);
      expect(grokComplete).toHaveBeenCalledTimes(1);
      expect(result.reply).toContain("moved 7 days");
    } finally {
      if (previousDemo === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = previousDemo;
      if (previousKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = previousKey;
    }
  });

  it("keeps a moved phase's shift after it is paid, without double counting", async () => {
    const forwarded = await fastForwardClock(invoicedPlan(), "Discovery");
    const design = forwarded.project.phases.find((item) => item.name === "Design");
    expect(design?.overdueShiftDays).toBe(7);
    const paidDesign = { ...forwarded.project, phases: markPhaseStatus(forwarded.project.phases, design!.id, "paid") };
    const snapshot = parseSnapshot(projectSnapshot(paidDesign));
    expect(phaseByName(snapshot, "Design")).toMatchObject({
      status: "paid",
      overdueShiftDays: 7,
      baselineStart: "2026-11-06",
      start: "2026-11-13",
      baselineFinish: "2026-11-13",
      end: "2026-11-20",
    });
    expect(phaseByName(snapshot, "Build")).toMatchObject({ overdueShiftDays: 7, baselineStart: "2026-11-14" });
    expect(phaseByName(snapshot, "Launch")).toMatchObject({ overdueShiftDays: 7, baselineStart: "2026-11-26" });
    expect(phaseByName(snapshot, "Support")).toMatchObject({ overdueShiftDays: 0, start: "2026-11-06" });
  });

  it("sums two gates once each across a diamond and leaves paid and unrelated phases alone", () => {
    const base = invoicedPlan();
    const phases: Phase[] = [
      phase({ id: "a", name: "A", paymentStatus: "invoiced", paypalInvoiceId: "INV2-A", startDate: "2026-11-01", endDate: "2026-11-03", dueDate: "2026-11-03" }),
      phase({ id: "b", name: "B", dependencies: ["a"], paymentStatus: "invoiced", paypalInvoiceId: "INV2-B", startDate: "2026-11-04", endDate: "2026-11-06", dueDate: "2026-11-06" }),
      phase({ id: "c", name: "C", dependencies: ["a"], startDate: "2026-11-04", endDate: "2026-11-06", dueDate: "2026-11-06" }),
      phase({ id: "d", name: "D", dependencies: ["b", "c"], startDate: "2026-11-07", endDate: "2026-11-09", dueDate: "2026-11-09" }),
      phase({ id: "e", name: "E", dependencies: ["a"], paymentStatus: "paid", startDate: "2026-11-04", endDate: "2026-11-05", dueDate: "2026-11-05" }),
      phase({ id: "f", name: "F", startDate: "2026-11-01", endDate: "2026-11-02", dueDate: "2026-11-02" }),
    ];
    const original = new Map(phases.map((item) => [item.name, item.startDate]));
    const after = applyOverdue({ ...base, phases }, "2026-11-10", () => "draft_x").project;
    const snapshot = parseSnapshot(projectSnapshot(after));
    for (const item of snapshot.phases) {
      expect(item.baselineStart).toBe(original.get(item.name));
    }
    // A slips 7 days and moves B, C, D. B, moved to Nov 11, is past its Nov 6 due date by 4 days and moves D again.
    expect(phaseByName(snapshot, "B").overdueShiftDays).toBe(7);
    expect(phaseByName(snapshot, "C").overdueShiftDays).toBe(7);
    expect(phaseByName(snapshot, "D").overdueShiftDays).toBe(11);
    expect(phaseByName(snapshot, "E").overdueShiftDays).toBe(0);
    expect(phaseByName(snapshot, "F").overdueShiftDays).toBe(0);
  });

  it("falls back to the gate sum for phases saved before the shift was recorded", async () => {
    const forwarded = await fastForwardClock(invoicedPlan(), "Discovery");
    const legacy = {
      ...forwarded.project,
      phases: forwarded.project.phases.map((item) => {
        const copy = { ...item };
        delete copy.overdueShiftDays;
        return copy;
      }),
    };
    const snapshot = parseSnapshot(projectSnapshot(legacy));
    expect(phaseByName(snapshot, "Build")).toMatchObject({ overdueShiftDays: 7, baselineStart: "2026-11-14" });
    expect(phaseByName(snapshot, "Support").overdueShiftDays).toBe(0);
  });
});
