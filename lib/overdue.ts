import { addDays, daysBetween } from "@/lib/dates";
import { buildOverdueDraft, upsertPendingDraft } from "@/lib/email";
import { dependentIds, overdueGateShiftDays, recomputeBlocks } from "@/lib/schedule";
import type { Phase, Project } from "@/lib/types";

function withOverdueShift(phases: Phase[], rootId: string, slip: number, delta: number): Phase[] {
  const ids = dependentIds(phases, rootId);
  return phases.map((phase) => {
    if (phase.id === rootId) {
      return { ...phase, paymentStatus: "overdue", slipDaysApplied: slip };
    }
    if (!ids.has(phase.id)) return phase;
    if (phase.paymentStatus === "paid" || phase.paymentStatus === "cancelled") return phase;
    const startDate = addDays(phase.startDate, delta);
    const endDate = addDays(phase.endDate, delta);
    const dueDate = phase.paymentStatus === "draft" ? endDate : phase.dueDate;
    // Record the shift on the phase so it survives a later payment. Phases saved
    // before this field existed fall back to the ancestor-gate sum once.
    const priorShift = phase.overdueShiftDays ?? overdueGateShiftDays(phases, phase);
    return { ...phase, startDate, endDate, dueDate, overdueShiftDays: priorShift + delta };
  });
}

export function applyOverdue(
  project: Project,
  asOf: string,
  createDraftId: (phaseId: string) => string = (phaseId) => `draft_${phaseId}_${asOf}`,
): { project: Project; changed: boolean } {
  let phases = project.phases.map((phase) => ({ ...phase }));
  let drafts = project.drafts.map((draft) => ({ ...draft }));
  let changed = false;

  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    const waiting = phase.paymentStatus === "invoiced" || phase.paymentStatus === "overdue";
    if (!waiting || !phase.dueDate) continue;

    if (phase.dueDate >= asOf) {
      if (phase.paymentStatus === "overdue") {
        phases = phases.map((item) =>
          item.id === phase.id ? { ...item, paymentStatus: "invoiced" } : item,
        );
        changed = true;
      }
      continue;
    }

    const slip = daysBetween(phase.dueDate, asOf);
    const delta = slip - phase.slipDaysApplied;
    if (phase.paymentStatus !== "overdue" && delta <= 0) {
      phases = phases.map((item) =>
        item.id === phase.id ? { ...item, paymentStatus: "overdue" } : item,
      );
      changed = true;
      continue;
    }
    if (delta <= 0) continue;

    phases = withOverdueShift(phases, phase.id, slip, delta);
    changed = true;
    const moved = dependentIds(phases, phase.id);
    const shifted = phases.filter(
      (item) =>
        moved.has(item.id) && item.paymentStatus !== "paid" && item.paymentStatus !== "cancelled",
    );
    const source = phases.find((item) => item.id === phase.id) ?? phase;
    drafts = upsertPendingDraft(
      drafts,
      buildOverdueDraft(project, source, shifted, new Date().toISOString(), createDraftId(phase.id)),
    );
  }

  return {
    changed,
    project: {
      ...project,
      phases: recomputeBlocks(phases),
      drafts,
      updatedAt: new Date().toISOString(),
    },
  };
}
