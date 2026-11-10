export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
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
