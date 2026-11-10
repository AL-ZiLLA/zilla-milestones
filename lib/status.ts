import type { PaymentStatus } from "@/lib/types";

export const STATUS_LABEL: Record<PaymentStatus, string> = {
  draft: "Draft",
  invoiced: "Invoiced",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const PYUSD_NOTE =
  "PYUSD: the payer may settle this milestone in PayPal USD (PYUSD) where their PayPal wallet supports it.";
