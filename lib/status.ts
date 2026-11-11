import type { PaymentStatus } from "@/lib/types";

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  draft: "Draft",
  invoiced: "Invoiced",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function paymentProgress(status: PaymentStatus): number {
  switch (status) {
    case "paid":
      return 100;
    case "overdue":
      return 85;
    case "invoiced":
      return 55;
    case "cancelled":
      return 0;
    default:
      return 12;
  }
}

export const PYUSD_NOTE =
  "PYUSD: the payer may settle this milestone in PayPal USD (PYUSD) where their PayPal wallet supports it.";
