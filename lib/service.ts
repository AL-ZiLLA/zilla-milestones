import { randomBytes } from "crypto";
import { addDays, todayUtc } from "@/lib/dates";
import { ActionError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { applyOverdue } from "@/lib/overdue";
import {
  callPaypalTool,
  findInvoiceId,
  mapPaypalInvoiceStatus,
  paymentWasRecorded,
} from "@/lib/paypal";
import { generatePlan } from "@/lib/planner";
import {
  buildPhasesFromPlan,
  findPhase,
  markPhaseStatus,
  recomputeBlocks,
  shiftPhaseAndDependents,
} from "@/lib/schedule";
import { PYUSD_NOTE } from "@/lib/status";
import { saveProject } from "@/lib/store";
import { mockPaypalEnabled } from "@/lib/mode";
import type { PaymentStatus, Phase, Project } from "@/lib/types";

export function nid(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

function touch(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

function requirePhase(project: Project, phaseRef: string): Phase {
  const phase = findPhase(project, phaseRef);
  if (!phase) {
    const names = project.phases.map((item, index) => `${index + 1}. ${item.name}`).join(", ");
    throw new ActionError(`No milestone matches "${phaseRef}". Phases: ${names}`);
  }
  return phase;
}

export async function createProject(input: {
  scope: string;
  clientEmail: string;
  budget: number;
  pyusdNote: boolean;
}): Promise<Project> {
  const plan = await generatePlan(input.scope);
  const phases = buildPhasesFromPlan(plan, {
    startDate: todayUtc(),
    budget: input.budget,
    createId: () => nid("ph"),
  });
  const now = new Date().toISOString();
  const project: Project = {
    id: nid("proj"),
    name: plan.projectName,
    summary: plan.summary,
    scope: input.scope.trim(),
    clientEmail: input.clientEmail.trim(),
    budget: input.budget,
    pyusdNote: input.pyusdNote,
    createdAt: now,
    updatedAt: now,
    phases,
    drafts: [],
    messages: [
      {
        role: "assistant",
        content: `Planned ${phases.length} milestones for ${formatMoney(input.budget)}. Phase 1 can be invoiced now. Later phases unlock when the previous invoice is paid.`,
        at: now,
      },
    ],
  };
  return saveProject(project) ?? project;
}

export async function invoicePhase(
  project: Project,
  phaseRef: string,
): Promise<{ project: Project; message: string }> {
  const phase = requirePhase(project, phaseRef);
  if (phase.blocked) {
    throw new ActionError(`${phase.name} stays locked until the previous milestone is paid.`);
  }
  if (phase.paymentStatus === "paid") {
    throw new ActionError(`${phase.name} is already paid.`);
  }
  if (phase.paymentStatus === "invoiced" || phase.paymentStatus === "overdue") {
    throw new ActionError(`${phase.name} already has PayPal invoice ${phase.paypalInvoiceId ?? ""}.`);
  }
  if (!mockPaypalEnabled() && !process.env.PAYPAL_MERCHANT_EMAIL) {
    throw new ActionError(
      "PAYPAL_MERCHANT_EMAIL is required. Use the sandbox business email that owns the REST app.",
    );
  }

  const note = [
    `Zilla Milestones · ${project.name}`,
    phase.description,
    project.pyusdNote ? PYUSD_NOTE : "",
  ]
    .filter(Boolean)
    .join("\n");

  const created = await callPaypalTool(
    "create_invoice",
    {
      currency_code: "USD",
      invoice_number: `ZILLA-${phase.id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 25),
      invoice_date: todayUtc(),
      reference: phase.id,
      note,
      invoicer_business_name: process.env.PAYPAL_MERCHANT_NAME || "Zilla Labs",
      ...(process.env.PAYPAL_MERCHANT_EMAIL
        ? { invoicer_email_address: process.env.PAYPAL_MERCHANT_EMAIL }
        : {}),
      primary_recipients: [{ billing_info: { email_address: project.clientEmail } }],
      items: [
        {
          name: phase.name,
          description: phase.description,
          quantity: "1",
          unit_amount: { currency_code: "USD", value: phase.amount.toFixed(2) },
        },
      ],
    },
    project,
  );
  const invoiceId = findInvoiceId(created);
  if (!invoiceId) {
    throw new ActionError("PayPal create_invoice did not return an invoice id.");
  }

  let sent = true;
  let sendError = "";
  try {
    await callPaypalTool(
      "send_invoice",
      {
        invoice_id: invoiceId,
        send_to_recipient: true,
        note: `Milestone invoice for ${phase.name} from Zilla Labs.`,
      },
      project,
    );
  } catch (error) {
    sent = false;
    sendError = error instanceof Error ? error.message : String(error);
  }

  const phases = project.phases.map((item) =>
    item.id === phase.id
      ? {
          ...item,
          paypalInvoiceId: invoiceId,
          paymentStatus: sent ? ("invoiced" as const) : item.paymentStatus,
          invoicedAt: sent ? new Date().toISOString() : item.invoicedAt,
        }
      : item,
  );
  const next = touch({ ...project, phases: recomputeBlocks(phases) });
  const message = sent
    ? `Sent PayPal invoice ${invoiceId} for ${phase.name} (${formatMoney(phase.amount)}) to ${project.clientEmail}.`
    : `Created PayPal invoice ${invoiceId} for ${phase.name}, but sending it failed: ${sendError}`;
  return { project: next, message };
}

export async function simulatePayment(
  project: Project,
  phaseRef: string,
): Promise<{ project: Project; message: string }> {
  const phase = requirePhase(project, phaseRef);
  if (!phase.paypalInvoiceId) {
    throw new ActionError(`Invoice ${phase.name} before recording a sandbox payment.`);
  }
  if (phase.paymentStatus === "paid") {
    throw new ActionError(`${phase.name} is already paid.`);
  }
  const payload = await callPaypalTool(
    "record_payment_for_invoice",
    {
      invoice_id: phase.paypalInvoiceId,
      method: "OTHER",
      payment_date: todayUtc(),
      amount: { currency_code: "USD", value: phase.amount.toFixed(2) },
      note: "Sandbox payment recorded from Zilla Milestones.",
    },
    project,
  );
  if (!paymentWasRecorded(payload) && mapPaypalInvoiceStatus(payload) !== "paid") {
    throw new ActionError("PayPal did not confirm the payment.");
  }
  const next = touch({
    ...project,
    phases: markPhaseStatus(project.phases, phase.id, "paid", todayUtc()),
  });
  return {
    project: next,
    message: `Recorded a sandbox payment on ${phase.paypalInvoiceId}. ${phase.name} is paid and dependent milestones are unlocked.`,
  };
}

export async function syncProject(
  project: Project,
  phaseRef?: string,
): Promise<{ project: Project; message: string }> {
  const targets = phaseRef
    ? [requirePhase(project, phaseRef)]
    : project.phases.filter((phase) => phase.paypalInvoiceId);
  if (targets.length === 0) throw new ActionError("There are no PayPal invoices to sync yet.");

  let phases = project.phases;
  const lines: string[] = [];
  for (const target of targets) {
    if (!target.paypalInvoiceId) continue;
    const current = phases.find((phase) => phase.id === target.id) ?? target;
    const payload = await callPaypalTool("get_invoice", { invoice_id: target.paypalInvoiceId }, {
      ...project,
      phases,
    });
    const remote = mapPaypalInvoiceStatus(payload);
    if (!remote) {
      lines.push(`${current.name}: PayPal returned no status`);
      continue;
    }
    const status: PaymentStatus =
      remote === "invoiced" && current.paymentStatus === "overdue" ? "overdue" : remote;
    phases = markPhaseStatus(phases, current.id, status, todayUtc());
    lines.push(`${current.name}: ${status}`);
  }

  const overdue = applyOverdue(touch({ ...project, phases }), todayUtc(), () => nid("draft"));
  return {
    project: overdue.project,
    message: `Synced invoice status. ${lines.join("; ")}.`,
  };
}

export function shiftNamedPhase(
  project: Project,
  phaseRef: string,
  days: number,
): { project: Project; message: string } {
  const phase = requirePhase(project, phaseRef);
  const before = new Map(project.phases.map((item) => [item.id, item.startDate]));
  const phases = recomputeBlocks(shiftPhaseAndDependents(project.phases, phase.id, days));
  const moved = phases.filter((item) => before.get(item.id) !== item.startDate).map((item) => item.name);
  if (moved.length === 0) {
    throw new ActionError("No unpaid milestone moved.");
  }
  return {
    project: touch({ ...project, phases }),
    message: `Moved ${moved.join(", ")} by ${days} day${days === 1 ? "" : "s"}.`,
  };
}

export function runOverdueCheck(project: Project, asOf = todayUtc()): { project: Project; message: string } {
  const result = applyOverdue(project, asOf, () => nid("draft"));
  return {
    project: result.changed ? result.project : project,
    message: result.changed
      ? "Overdue invoices shifted dependent milestones and a client update is waiting for approval."
      : "No unpaid invoice is past its due date.",
  };
}

export function simulateOverdue(
  project: Project,
  phaseRef: string,
): { project: Project; message: string } {
  const phase = requirePhase(project, phaseRef);
  if (!phase.paypalInvoiceId || phase.paymentStatus === "draft" || phase.paymentStatus === "cancelled") {
    throw new ActionError(`Invoice ${phase.name} before simulating an overdue payment.`);
  }
  if (phase.paymentStatus === "paid") throw new ActionError(`${phase.name} is already paid.`);
  const forcedDue = addDays(todayUtc(), -7);
  const phases = project.phases.map((item) =>
    item.id === phase.id
      ? {
          ...item,
          dueDate: forcedDue,
          paymentStatus: "invoiced" as const,
          slipDaysApplied: 0,
        }
      : item,
  );
  const result = applyOverdue(touch({ ...project, phases }), todayUtc(), () => nid("draft"));
  return {
    project: result.project,
    message: `Demo: set ${phase.name} due ${forcedDue} and ran the overdue rule. Dependents moved, and a client email is drafted for approval. Nothing was emailed.`,
  };
}

export function resolveDraft(
  project: Project,
  draftId: string,
  action: "approved" | "discarded",
): { project: Project; message: string } {
  if (!project.drafts.some((draft) => draft.id === draftId)) {
    throw new ActionError("Draft not found.");
  }
  const drafts = project.drafts.map((draft) =>
    draft.id === draftId ? { ...draft, status: action } : draft,
  );
  const message =
    action === "approved"
      ? "Draft approved. It stays in the app for you to copy. It was not emailed."
      : "Draft discarded. Nothing was emailed.";
  return { project: touch({ ...project, drafts }), message };
}

export function unpaidSummary(project: Project): string {
  const open = project.phases.filter(
    (phase) => phase.paymentStatus !== "paid" && phase.paymentStatus !== "cancelled",
  );
  if (open.length === 0) return "Every milestone is paid.";
  const total = open.reduce((sum, phase) => sum + phase.amount, 0);
  const lines = open.map((phase) => {
    const number = project.phases.findIndex((item) => item.id === phase.id) + 1;
    const gate = phase.blocked ? "blocked" : "unlocked";
    return `${number}. ${phase.name} — ${formatMoney(phase.amount)} — ${phase.paymentStatus} — ${gate} — due ${phase.dueDate}`;
  });
  return `Unpaid milestones (${formatMoney(total)}):\n${lines.join("\n")}`;
}

export function projectSnapshot(project: Project): string {
  const phases = project.phases.map((phase, index) => ({
    phase: index + 1,
    name: phase.name,
    status: phase.paymentStatus,
    amount: phase.amount,
    start: phase.startDate,
    end: phase.endDate,
    due: phase.dueDate,
    blocked: phase.blocked,
    invoiceId: phase.paypalInvoiceId ?? null,
  }));
  return JSON.stringify(
    {
      name: project.name,
      clientEmail: project.clientEmail,
      budget: project.budget,
      pyusdNote: project.pyusdNote,
      phases,
    },
    null,
    2,
  );
}
