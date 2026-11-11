import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { applyOverdue } from "@/lib/overdue";
import { buildPhasesFromPlan, findPhase, markPhaseStatus, shiftPhaseAndDependents } from "@/lib/schedule";
import type { Phase, Project } from "@/lib/types";

function phase(partial: Partial<Phase> & Pick<Phase, "id" | "name" | "dependencies">): Phase {
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

function project(phases: Phase[]): Project {
  return {
    id: "proj_test",
    name: "Harbor & Pine",
    summary: "Test plan",
    scope: "Test scope long enough for the planner.",
    clientEmail: "billing@example.com",
    budget: 3000,
    pyusdNote: false,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    phases,
    drafts: [],
    messages: [],
  };
}

describe("rescheduling", () => {
  const phases = [
    phase({ id: "a", name: "Discovery", startDate: "2026-11-01", endDate: "2026-11-05", dueDate: "2026-11-05", paymentStatus: "invoiced" }),
    phase({
      id: "b",
      name: "Design",
      dependencies: ["a"],
      startDate: "2026-11-06",
      endDate: "2026-11-10",
      dueDate: "2026-11-10",
    }),
    phase({
      id: "c",
      name: "Build",
      dependencies: ["b"],
      startDate: "2026-11-11",
      endDate: "2026-11-15",
      dueDate: "2026-11-15",
      paymentStatus: "paid",
      paidAt: "2026-11-01",
    }),
    phase({
      id: "d",
      name: "Launch",
      dependencies: ["c"],
      startDate: "2026-11-16",
      endDate: "2026-11-18",
      dueDate: "2026-11-18",
    }),
  ];

  it("shifts unpaid dependents when an invoice is overdue and does not move paid work", () => {
    const result = applyOverdue(project(phases), "2026-11-08", (id) => `draft_${id}`);
    const next = result.project.phases;
    expect(next.find((item) => item.id === "a")?.paymentStatus).toBe("overdue");
    expect(next.find((item) => item.id === "a")?.startDate).toBe("2026-11-01");
    expect(next.find((item) => item.id === "b")?.startDate).toBe("2026-11-09");
    expect(next.find((item) => item.id === "b")?.endDate).toBe("2026-11-13");
    expect(next.find((item) => item.id === "c")?.startDate).toBe("2026-11-11");
    expect(next.find((item) => item.id === "d")?.startDate).toBe("2026-11-19");
    expect(next.find((item) => item.id === "a")?.slipDaysApplied).toBe(3);
    expect(result.project.drafts).toHaveLength(1);
    expect(result.project.drafts[0].status).toBe("pending_approval");
    expect(result.project.drafts[0].body).toContain("has not been sent");
  });

  it("does not shift again when the overdue check runs twice the same day", () => {
    const once = applyOverdue(project(phases), "2026-11-08", (id) => `draft_${id}`);
    const twice = applyOverdue(once.project, "2026-11-08", (id) => `draft_${id}`);
    expect(twice.project.phases.find((item) => item.id === "b")?.startDate).toBe("2026-11-09");
    expect(twice.project.drafts).toHaveLength(1);
    expect(twice.changed).toBe(false);
  });

  it("applies only the additional slip on a later day", () => {
    const once = applyOverdue(project(phases), "2026-11-08", (id) => `draft_${id}`);
    const later = applyOverdue(once.project, "2026-11-10", (id) => `draft_${id}`);
    expect(later.project.phases.find((item) => item.id === "b")?.startDate).toBe("2026-11-11");
    expect(later.project.phases.find((item) => item.id === "a")?.slipDaysApplied).toBe(5);
    expect(later.project.drafts).toHaveLength(1);
  });

  it("pushes a named phase and its unpaid dependents by a week", () => {
    const plan = project(phases);
    const design = findPhase(plan, "design");
    expect(design?.id).toBe("b");
    const moved = shiftPhaseAndDependents(plan.phases, "b", 7);
    expect(moved.find((item) => item.id === "b")?.startDate).toBe("2026-11-13");
    expect(moved.find((item) => item.id === "d")?.startDate).toBe(addDays("2026-11-16", 7));
    expect(moved.find((item) => item.id === "c")?.startDate).toBe("2026-11-11");
    expect(moved.find((item) => item.id === "a")?.startDate).toBe("2026-11-01");
  });

  it("unlocks dependents only after the predecessor is paid", () => {
    const blocked = markPhaseStatus(phases, "a", "invoiced", "2026-11-02");
    expect(blocked.find((item) => item.id === "b")?.blocked).toBe(true);
    const paid = markPhaseStatus(blocked, "a", "paid", "2026-11-03");
    expect(paid.find((item) => item.id === "a")?.paymentStatus).toBe("paid");
    expect(paid.find((item) => item.id === "b")?.blocked).toBe(false);
  });

  it("rejects cyclic dependencies", () => {
    expect(() =>
      buildPhasesFromPlan(
        {
          projectName: "Loop",
          summary: "Invalid cycle.",
          phases: [
            {
              name: "One",
              description: "First loop.",
              durationDays: 2,
              amount: 10,
              dependsOn: ["Two"],
            },
            {
              name: "Two",
              description: "Second loop.",
              durationDays: 2,
              amount: 10,
              dependsOn: ["One"],
            },
          ],
        },
        { startDate: "2026-11-01", budget: 100 },
      ),
    ).toThrow(/cycle/i);
  });
});
