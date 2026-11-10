import { describe, expect, it } from "vitest";
import { cannedPlan } from "@/lib/demo-plan";
import { extractJson, parsePlan, planSchema } from "@/lib/schema";
import { buildPhasesFromPlan } from "@/lib/schedule";

const validPlan = {
  projectName: "Harbor launch",
  summary: "Four milestones from discovery through launch.",
  phases: [
    {
      name: "Discovery",
      description: "Confirm the scope.",
      durationDays: 4,
      amount: 1000,
      dependsOn: [],
    },
    {
      name: "Build",
      description: "Ship the storefront.",
      durationDays: 10,
      amount: 3000,
    },
  ],
};

describe("plan schema", () => {
  it("accepts a plan and defaults dependsOn", () => {
    const plan = parsePlan(validPlan);
    expect(plan.phases[1].dependsOn).toEqual([]);
    expect(plan.projectName).toBe("Harbor launch");
  });

  it("strips fenced JSON before validation", () => {
    const raw = "```json\n" + JSON.stringify(validPlan) + "\n```";
    expect(planSchema.parse(extractJson(raw)).phases).toHaveLength(2);
  });

  it("rejects empty phases, zero duration, and negative amounts", () => {
    expect(() => parsePlan({ ...validPlan, phases: [] })).toThrow();
    expect(() =>
      parsePlan({
        ...validPlan,
        phases: [{ ...validPlan.phases[0], durationDays: 0 }],
      }),
    ).toThrow();
    expect(() =>
      parsePlan({
        ...validPlan,
        phases: [{ ...validPlan.phases[0], amount: -5 }],
      }),
    ).toThrow();
  });

  it("accepts the canned demo plan and scales it to the budget", () => {
    const plan = parsePlan(cannedPlan("Harbor & Pine launches a shop"));
    const phases = buildPhasesFromPlan(plan, { startDate: "2026-11-10", budget: 12000 });
    const total = phases.reduce((sum, phase) => sum + phase.amount, 0);
    expect(total).toBe(12000);
    expect(phases.map((phase) => phase.name)).toEqual(["Discovery", "Design", "Build", "Launch"]);
    expect(phases[0].blocked).toBe(false);
    expect(phases[1].blocked).toBe(true);
    expect(phases[1].startDate > phases[0].endDate).toBe(true);
  });
});
