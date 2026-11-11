import { merchantToday } from "@/lib/dates";
import { cannedPlan, HVAC_SCOPE } from "@/lib/demo-plan";
import { nid } from "@/lib/service";
import { buildPhasesFromPlan } from "@/lib/schedule";
import type { Project } from "@/lib/types";

export const SEED_BUDGET = 18000;
export const SEED_EMAIL = "billing@example.com";
export const SEED_CLIENT_NAME = "Jordan";

export function buildSeedProject(now = new Date()): Project {
  const plan = cannedPlan(HVAC_SCOPE);
  const startDate = merchantToday(now);
  const phases = buildPhasesFromPlan(plan, {
    startDate,
    budget: SEED_BUDGET,
    createId: () => nid("ph"),
  });
  const createdAt = now.toISOString();
  return {
    id: nid("proj"),
    name: plan.projectName,
    summary: plan.summary,
    scope: HVAC_SCOPE,
    clientEmail: SEED_EMAIL,
    clientName: SEED_CLIENT_NAME,
    budget: SEED_BUDGET,
    pyusdNote: true,
    createdAt,
    updatedAt: createdAt,
    phases,
    drafts: [],
    messages: [
      {
        role: "assistant",
        content: `Sample project loaded: ${phases.length} milestones for the HVAC booking portal. Phase 1 can be invoiced. Later phases stay locked until the previous invoice is paid.`,
        at: createdAt,
      },
    ],
    clockDate: null,
    actions: [],
    events: [],
  };
}
