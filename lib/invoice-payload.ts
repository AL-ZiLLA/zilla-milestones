import { invoiceDueDate, merchantToday, NET_TERMS_DAYS } from "@/lib/dates";
import { PYUSD_NOTE } from "@/lib/status";
import type { Phase, Project } from "@/lib/types";

export interface PaypalInvoiceBody {
  detail: {
    reference?: string;
    invoice_number?: string;
    invoice_date: string;
    currency_code: "USD";
    note?: string;
    payment_term: {
      term_type: "DUE_ON_DATE_SPECIFIED";
      due_date: string;
    };
  };
  invoicer: {
    business_name?: string;
    email_address?: string;
  };
  primary_recipients: Array<{ billing_info: { email_address: string } }>;
  items: Array<{
    name: string;
    description: string;
    quantity: string;
    unit_amount: { currency_code: "USD"; value: string };
  }>;
}

export function payerViewUrl(invoiceId: string, live = false): string {
  const host = live ? "https://www.paypal.com" : "https://www.sandbox.paypal.com";
  return `${host}/invoice/p/#${invoiceId}`;
}

export function findPayerUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === "string") {
    if (/paypal\.com\/invoice\//i.test(value)) return value;
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPayerUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rel = String(record.rel || "").toLowerCase();
  if ((rel === "payer-view" || rel === "payerview") && typeof record.href === "string") {
    return record.href;
  }
  for (const nested of Object.values(record)) {
    const found = findPayerUrl(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function buildInvoiceRequest(
  project: Pick<Project, "name" | "clientEmail" | "pyusdNote">,
  phase: Pick<Phase, "id" | "name" | "description" | "amount">,
  now = new Date(),
): {
  invoiceDate: string;
  dueDate: string;
  args: Record<string, unknown>;
  paypalBody: PaypalInvoiceBody;
} {
  const invoiceDate = merchantToday(now);
  const dueDate = invoiceDueDate(invoiceDate, NET_TERMS_DAYS);
  const note = [
    `Zilla Milestones · ${project.name}`,
    phase.description,
    `Payment terms: Net ${NET_TERMS_DAYS}. Due ${dueDate}.`,
    project.pyusdNote ? PYUSD_NOTE : "",
  ]
    .filter(Boolean)
    .join("\n");
  const invoiceNumber = `ZILLA-${phase.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 25);
  const items = [
    {
      name: phase.name,
      description: phase.description,
      quantity: "1",
      unit_amount: { currency_code: "USD" as const, value: phase.amount.toFixed(2) },
    },
  ];
  const recipients = [{ billing_info: { email_address: project.clientEmail } }];
  const invoicerEmail = process.env.PAYPAL_MERCHANT_EMAIL;
  const businessName = process.env.PAYPAL_MERCHANT_NAME || "Zilla Labs";
  const args: Record<string, unknown> = {
    currency_code: "USD",
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    reference: phase.id,
    note,
    invoicer_business_name: businessName,
    ...(invoicerEmail ? { invoicer_email_address: invoicerEmail } : {}),
    primary_recipients: recipients,
    items,
  };
  const paypalBody: PaypalInvoiceBody = {
    detail: {
      reference: phase.id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      currency_code: "USD",
      note,
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: dueDate,
      },
    },
    invoicer: {
      business_name: businessName,
      ...(invoicerEmail ? { email_address: invoicerEmail } : {}),
    },
    primary_recipients: recipients,
    items,
  };
  return { invoiceDate, dueDate, args, paypalBody };
}
