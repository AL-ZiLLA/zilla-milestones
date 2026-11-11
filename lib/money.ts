export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function summarizeMoney(project: { budget: number; phases: Array<{ id: string; amount: number; paymentStatus: string; dependencies: string[] }> }): {
  contract: number;
  paid: number;
  invoiced: number;
  atRisk: number;
} {
  const byId = new Map(project.phases.map((phase) => [phase.id, phase]));
  const ancestorOverdue = (dependencyIds: string[], seen = new Set<string>()): boolean => {
    for (const id of dependencyIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const phase = byId.get(id);
      if (!phase || phase.paymentStatus === "paid" || phase.paymentStatus === "cancelled") continue;
      if (phase.paymentStatus === "overdue") return true;
      if (ancestorOverdue(phase.dependencies, seen)) return true;
    }
    return false;
  };
  let paid = 0;
  let invoiced = 0;
  let atRisk = 0;
  for (const phase of project.phases) {
    if (phase.paymentStatus === "paid") paid += phase.amount;
    if (phase.paymentStatus === "invoiced" || phase.paymentStatus === "overdue") invoiced += phase.amount;
    if (phase.paymentStatus === "paid" || phase.paymentStatus === "cancelled") continue;
    if (phase.paymentStatus === "overdue" || ancestorOverdue(phase.dependencies)) atRisk += phase.amount;
  }
  return {
    contract: project.budget,
    paid: roundCents(paid),
    invoiced: roundCents(invoiced),
    atRisk: roundCents(atRisk),
  };
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function scaleAmounts(amounts: number[], budget: number): number[] {
  if (amounts.length === 0) {
    throw new Error("At least one amount is required");
  }
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  if (!(sum > 0) || !(budget > 0)) {
    throw new Error("Amounts and budget must be positive");
  }
  const cents = amounts.map((amount) => Math.round((amount / sum) * budget * 100));
  const drift = Math.round(budget * 100) - cents.reduce((total, value) => total + value, 0);
  cents[cents.length - 1] += drift;
  if (cents.some((value) => value <= 0)) {
    throw new Error("Scaled milestone amounts must stay positive");
  }
  return cents.map((value) => value / 100);
}
