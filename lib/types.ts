export const PAYMENT_STATUSES = [
  "draft",
  "invoiced",
  "paid",
  "overdue",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface Phase {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  amount: number;
  dependencies: string[];
  paymentStatus: PaymentStatus;
  dueDate: string;
  paypalInvoiceId?: string;
  paypalPayerUrl?: string;
  invoiceDate?: string;
  slipDaysApplied: number;
  blocked: boolean;
  paidAt?: string;
  invoicedAt?: string;
}

export interface EmailDraft {
  id: string;
  phaseId: string;
  subject: string;
  body: string;
  createdAt: string;
  status: "pending_approval" | "approved" | "discarded";
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface AgentAction {
  id: string;
  tool: string;
  paypalApi: string | null;
  status: "ok" | "error";
  latencyMs: number;
  detail?: string;
  at: string;
}

export interface ActivityEvent {
  id: string;
  message: string;
  at: string;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  scope: string;
  clientEmail: string;
  clientName?: string;
  budget: number;
  pyusdNote: boolean;
  createdAt: string;
  updatedAt: string;
  phases: Phase[];
  drafts: EmailDraft[];
  messages: ChatMessage[];
  clockDate?: string | null;
  actions?: AgentAction[];
  events?: ActivityEvent[];
}

export interface RuntimeMode {
  demoAi: boolean;
  demoPaypal: boolean;
  paypalMode: "sandbox" | "live";
  model: string;
}

export interface StoreData {
  project: Project | null;
}
