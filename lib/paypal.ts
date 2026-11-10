import { assertPaypalConfigured, mockPaypalEnabled } from "@/lib/mode";
import type { PaymentStatus, Project } from "@/lib/types";

export interface PaypalFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

type ToolCallResult = {
  content?: string;
};

type PaypalToolkit = {
  getTools: () => PaypalFunctionTool[];
  handleToolCall: (toolCall: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }) => Promise<ToolCallResult>;
  client: { getAccessToken: () => Promise<string> };
};

const PAYPAL_TOOL_NAMES = [
  "create_invoice",
  "send_invoice",
  "list_invoices",
  "get_invoice",
  "record_payment_for_invoice",
  "send_invoice_reminder",
] as const;

export function isPaypalTool(name: string): boolean {
  return (PAYPAL_TOOL_NAMES as readonly string[]).includes(name);
}

let toolkitPromise: Promise<PaypalToolkit> | null = null;

export async function getPaypalToolkit(): Promise<PaypalToolkit> {
  assertPaypalConfigured();
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
  }
  if (!toolkitPromise) {
    toolkitPromise = import("@paypal/agent-toolkit/openai").then((mod) => {
      const { PayPalAgentToolkit } = mod as unknown as {
        PayPalAgentToolkit: new (config: {
          clientId: string;
          clientSecret: string;
          configuration: {
            actions: { invoices: Record<string, boolean> };
            context: { sandbox: boolean };
          };
        }) => PaypalToolkit;
      };
      return new PayPalAgentToolkit({
        clientId: process.env.PAYPAL_CLIENT_ID as string,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET as string,
        configuration: {
          actions: {
            invoices: {
              create: true,
              list: true,
              get: true,
              send: true,
              recordPayment: true,
              sendReminder: true,
            },
          },
          context: { sandbox: process.env.PAYPAL_MODE !== "live" },
        },
      });
    });
  }
  return toolkitPromise;
}

export async function getPaypalAccessToken(): Promise<string> {
  const toolkit = await getPaypalToolkit();
  return toolkit.client.getAccessToken();
}

export async function paypalToolDefinitions(): Promise<PaypalFunctionTool[]> {
  if (mockPaypalEnabled()) return mockToolDefinitions();
  const toolkit = await getPaypalToolkit();
  const allowed = new Set<string>(PAYPAL_TOOL_NAMES);
  return toolkit.getTools().filter((tool) => allowed.has(tool.function.name));
}

function paypalStatus(status: PaymentStatus): string {
  switch (status) {
    case "paid":
      return "PAID";
    case "cancelled":
      return "CANCELLED";
    case "draft":
      return "DRAFT";
    case "invoiced":
    case "overdue":
      return "SENT";
    default:
      return "SENT";
  }
}

function mockPaypal(name: string, args: Record<string, unknown>, project?: Project): unknown {
  if (name === "create_invoice") {
    const reference = String(args.reference || "phase");
    const id = `INV2-DEMO-${reference}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
    return { id, status: "DRAFT" };
  }
  if (name === "send_invoice" || name === "send_invoice_reminder") {
    return { success: true, id: args.invoice_id, status: "SENT" };
  }
  if (name === "record_payment_for_invoice") {
    return { success: true, invoice_id: args.invoice_id, status: "PAID" };
  }
  if (name === "get_invoice") {
    const id = String(args.invoice_id || "");
    const phase = project?.phases.find((item) => item.paypalInvoiceId === id);
    return {
      id,
      status: phase ? paypalStatus(phase.paymentStatus) : "SENT",
      due_date: phase?.dueDate,
    };
  }
  if (name === "list_invoices") {
    const items = (project?.phases ?? [])
      .filter((phase) => phase.paypalInvoiceId)
      .map((phase) => ({
        id: phase.paypalInvoiceId,
        status: paypalStatus(phase.paymentStatus),
        detail: { reference: phase.id, invoice_number: phase.name },
      }));
    return { items };
  }
  throw new Error(`Unsupported PayPal tool: ${name}`);
}

export async function callPaypalTool(
  name: string,
  args: Record<string, unknown>,
  project?: Project,
): Promise<unknown> {
  if (mockPaypalEnabled()) return mockPaypal(name, args, project);
  const toolkit = await getPaypalToolkit();
  const result = await toolkit.handleToolCall({
    id: `zilla_${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  });
  if (!result.content) return { success: true };
  try {
    return JSON.parse(result.content) as unknown;
  } catch {
    return { raw: result.content };
  }
}

export function findInvoiceId(value: unknown, depth = 0): string | undefined {
  if (depth > 8 || value == null) return undefined;
  if (typeof value === "string") {
    const match = value.match(/\bINV2-[A-Za-z0-9-]{4,}\b/);
    return match?.[0];
  }
  if (typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && /INV2-/i.test(record.id)) return record.id;
  if (typeof record.invoice_id === "string" && record.invoice_id.length > 0) {
    return record.invoice_id;
  }
  for (const nested of Object.values(record)) {
    const found = findInvoiceId(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function mapPaypalInvoiceStatus(payload: unknown): PaymentStatus | null {
  const status = readStatus(payload);
  switch (status) {
    case "PAID":
    case "MARKED_AS_PAID":
      return "paid";
    case "CANCELLED":
    case "REFUNDED":
    case "MARKED_AS_REFUNDED":
      return "cancelled";
    case "DRAFT":
      return "draft";
    case "SENT":
    case "UNPAID":
    case "SCHEDULED":
    case "PARTIALLY_PAID":
    case "PAYMENT_PENDING":
      return "invoiced";
    default:
      return null;
  }
}

function readStatus(value: unknown, depth = 0): string {
  if (depth > 5 || !value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string" && record.status.toUpperCase() !== "SUCCESS") {
    return record.status.toUpperCase();
  }
  for (const key of ["invoice", "resource", "detail"]) {
    const nested = readStatus(record[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

export function paymentWasRecorded(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  if (record.success === true) return true;
  // PayPal often returns HTTP 200 with only a payment_id for POST .../payments.
  if (typeof record.payment_id === "string" && record.payment_id.length > 0) return true;
  const status = String(record.status || "").toUpperCase();
  return status === "PAID" || status === "MARKED_AS_PAID";
}

function mockToolDefinitions(): PaypalFunctionTool[] {
  return PAYPAL_TOOL_NAMES.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: `Mock PayPal invoicing tool ${name}. Used when DEMO_MODE or PayPal keys are absent.`,
      parameters: { type: "object", additionalProperties: true },
    },
  }));
}
