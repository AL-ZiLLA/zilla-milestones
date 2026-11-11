import { addDays } from "@/lib/dates";
import { scaleAmounts } from "@/lib/money";
import type { Plan } from "@/lib/schema";
import type { PaymentStatus, Phase, Project } from "@/lib/types";

export function recomputeBlocks(phases: Phase[]): Phase[] {
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  return phases.map((phase) => ({
    ...phase,
    blocked: phase.dependencies.some((dependencyId) => {
      const predecessor = byId.get(dependencyId);
      return !predecessor || predecessor.paymentStatus !== "paid";
    }),
  }));
}

export function dependentIds(phases: Phase[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const phase of phases) {
    for (const dependencyId of phase.dependencies) {
      const list = children.get(dependencyId) ?? [];
      list.push(phase.id);
      children.set(dependencyId, list);
    }
  }
  const result = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || result.has(id)) continue;
    result.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return result;
}

export function overdueGateShiftDays(phases: Phase[], phase: Phase): number {
  if (phase.paymentStatus === "paid" || phase.paymentStatus === "cancelled") return 0;
  const byId = new Map(phases.map((item) => [item.id, item]));
  let total = 0;
  const seen = new Set<string>();
  const stack = [...phase.dependencies];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ancestor = byId.get(id);
    if (!ancestor) continue;
    total += ancestor.slipDaysApplied;
    stack.push(...ancestor.dependencies);
  }
  return total;
}

export function phaseBaseline(
  phases: Phase[],
  phase: Phase,
): { baselineStart: string; baselineFinish: string; overdueShiftDays: number } {
  const overdueShiftDays = overdueGateShiftDays(phases, phase);
  return {
    baselineStart: addDays(phase.startDate, -overdueShiftDays),
    baselineFinish: addDays(phase.endDate, -overdueShiftDays),
    overdueShiftDays,
  };
}

function topoOrder(phases: Phase[]): string[] {
  const indegree = new Map(phases.map((phase) => [phase.id, phase.dependencies.length]));
  const outgoing = new Map<string, string[]>();
  for (const phase of phases) {
    for (const dependencyId of phase.dependencies) {
      const list = outgoing.get(dependencyId) ?? [];
      list.push(phase.id);
      outgoing.set(dependencyId, list);
    }
  }
  const queue = phases.filter((phase) => indegree.get(phase.id) === 0).map((phase) => phase.id);
  const ordered: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) break;
    ordered.push(id);
    for (const child of outgoing.get(id) ?? []) {
      const next = (indegree.get(child) ?? 1) - 1;
      indegree.set(child, next);
      if (next === 0) queue.push(child);
    }
  }
  if (ordered.length !== phases.length) {
    throw new Error("Phase dependencies contain a cycle");
  }
  return ordered;
}

export function buildPhasesFromPlan(
  plan: Plan,
  options: {
    startDate: string;
    budget: number;
    createId?: (index: number, name: string) => string;
  },
): Phase[] {
  const names = new Map<string, string>();
  plan.phases.forEach((phase, index) => {
    const key = phase.name.trim().toLowerCase();
    if (names.has(key)) {
      throw new Error(`Duplicate phase name: ${phase.name}`);
    }
    names.set(key, options.createId?.(index, phase.name) ?? `ph_${index + 1}`);
  });

  const amounts = scaleAmounts(
    plan.phases.map((phase) => phase.amount),
    options.budget,
  );

  const unresolved: Phase[] = plan.phases.map((phase, index) => {
    const dependencies = phase.dependsOn.map((name) => {
      const id = names.get(name.trim().toLowerCase());
      if (!id) {
        throw new Error(`Phase "${phase.name}" depends on unknown phase "${name}"`);
      }
      return id;
    });
    return {
      id: names.get(phase.name.trim().toLowerCase()) ?? `ph_${index + 1}`,
      name: phase.name.trim(),
      description: phase.description.trim(),
      startDate: options.startDate,
      endDate: options.startDate,
      durationDays: phase.durationDays,
      amount: amounts[index],
      dependencies,
      paymentStatus: "draft",
      dueDate: options.startDate,
      slipDaysApplied: 0,
      blocked: false,
    };
  });

  const order = topoOrder(unresolved);
  const byId = new Map(unresolved.map((phase) => [phase.id, phase]));
  const endOf = new Map<string, string>();
  for (const id of order) {
    const phase = byId.get(id);
    if (!phase) continue;
    let start = options.startDate;
    for (const dependencyId of phase.dependencies) {
      const dependencyEnd = endOf.get(dependencyId);
      if (!dependencyEnd) {
        throw new Error(`Missing schedule for dependency ${dependencyId}`);
      }
      const nextStart = addDays(dependencyEnd, 1);
      if (nextStart > start) start = nextStart;
    }
    const end = addDays(start, phase.durationDays - 1);
    phase.startDate = start;
    phase.endDate = end;
    phase.dueDate = end;
    endOf.set(id, end);
  }

  return recomputeBlocks(unresolved);
}

export function markPhaseStatus(
  phases: Phase[],
  phaseId: string,
  status: PaymentStatus,
  at: string,
): Phase[] {
  const next = phases.map((phase) => {
    if (phase.id !== phaseId) return phase;
    if (status === "paid") {
      return { ...phase, paymentStatus: status, paidAt: phase.paidAt ?? at, blocked: false };
    }
    if (status === "cancelled") {
      return { ...phase, paymentStatus: status };
    }
    if (status === "invoiced" || status === "overdue" || status === "draft") {
      return { ...phase, paymentStatus: status };
    }
    return phase;
  });
  return recomputeBlocks(next);
}

export function shiftPhaseAndDependents(phases: Phase[], phaseId: string, days: number): Phase[] {
  if (!Number.isInteger(days) || days === 0) {
    throw new Error("Shift must be a non-zero whole number of days");
  }
  const root = phases.find((phase) => phase.id === phaseId);
  if (!root) throw new Error("Milestone not found");
  if (root.paymentStatus === "paid") {
    throw new Error(`${root.name} is paid and stays on its dates`);
  }
  const move = new Set([phaseId, ...dependentIds(phases, phaseId)]);
  return phases.map((phase) => {
    if (!move.has(phase.id)) return phase;
    if (phase.paymentStatus === "paid" || phase.paymentStatus === "cancelled") return phase;
    const startDate = addDays(phase.startDate, days);
    const endDate = addDays(phase.endDate, days);
    const dueDate =
      phase.paymentStatus === "draft" ? addDays(phase.dueDate || endDate, days) : phase.dueDate;
    return { ...phase, startDate, endDate, dueDate };
  });
}

export function findPhase(project: Project, ref: string): Phase | undefined {
  const trimmed = ref.trim().toLowerCase().replace(/^phase\s+/, "");
  if (!trimmed) return undefined;
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= project.phases.length) {
    return project.phases[asNumber - 1];
  }
  return (
    project.phases.find((phase) => phase.id === ref) ??
    project.phases.find((phase) => phase.name.toLowerCase() === trimmed) ??
    project.phases.find((phase) => phase.name.toLowerCase().includes(trimmed))
  );
}
