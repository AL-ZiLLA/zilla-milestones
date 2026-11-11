import { randomBytes } from "crypto";
import { appendAction } from "@/lib/actions";
import { composeOverdueDrafts } from "@/lib/compose";
import { addDays, asOfDate, merchantToday } from "@/lib/dates";
import { reminderNote } from "@/lib/email";
import { ActionError } from "@/lib/errors";
import { buildInvoiceRequest, findPayerUrl, payerViewUrl } from "@/lib/invoice-payload";
import { formatMoney } from "@/lib/money";
import { applyOverdue } from "@/lib/overdue";
import {
  applyInvoiceDueDate,
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

async function traced<T>(
  project: Project,
  tool: string,
  detail: string | undefined,
  task: () => Promise<T>,
): Promise<{ project: Project; value: T }> {
  const started = Date.now();
  try {
    const value = await task();
    return {
      value,
      project: appendAction(project, { tool, status: "ok", latencyMs: Date.now() - started, detail }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const next = appendAction(project, {
      tool,
      status: "error",
      latencyMs: Date.now() - started,
      detail: message,
    });
    const wrapped = new ActionError(message);
    (wrapped as ActionError & { project?: Project }).project = next;
    throw wrapped;
  }
}

export async function createProject(input: {
  scope: string;
  clientEmail: string;
  clientName?: string;
  budget: number;
  pyusdNote: boolean;
}): Promise<Project> {
  const plan = await generatePlan(input.scope);
  const phases = buildPhasesFromPlan(plan, {
    startDate: merchantToday(),
    budget: input.budget,
    createId: () => nid("ph"),
  });
  const now = new Date().toISOString();
  return {
    id: nid("proj"),
    name: plan.projectName,
    summary: plan.summary,
    scope: input.scope.trim(),
    clientEmail: input.clientEmail.trim(),
    clientName: input.clientName?.trim() || "Jordan",
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
    clockDate: null,
    actions: [],
    events: [],
  };
}

export async function invoicePhase(
  project: Project,
  phaseRef: string,
  options?: { now?: Date },
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

  const built = buildInvoiceRequest(project, phase, options?.now ?? new Date());
  let working = project;
  const created = await traced(working, "create_invoice", phase.name, () =>
    callPaypalTool("create_invoice", built.args, working),
  );
  working = created.project;
  const invoiceId = findInvoiceId(created.value);
  if (!invoiceId) {
    throw new ActionError("PayPal create_invoice did not return an invoice id.");
  }

  const termed = await traced(working, "set_invoice_due_date", `Due ${built.dueDate}`, async () => {
    const result = await applyInvoiceDueDate(invoiceId, built.paypalBody);
    if (!result.ok) throw new Error(result.detail || "PayPal did not accept the Net 7 due date");
    return result;
  }).catch((error: unknown) => {
    const withProject = error as ActionError & { project?: Project };
    return { project: withProject.project ?? working, value: null as null };
  });
  working = termed.project;

  let sent = true;
  let sendError = "";
  try {
    const send = await traced(working, "send_invoice", invoiceId, () =>
      callPaypalTool(
        "send_invoice",
        {
          invoice_id: invoiceId,
          send_to_recipient: true,
          note: `Milestone invoice for ${phase.name} from Zilla Labs. Net 7, due ${built.dueDate}.`,
        },
        working,
      ),
    );
    working = send.project;
  } catch (error) {
    sent = false;
    const withProject = error as ActionError & { project?: Project };
    working = withProject.project ?? working;
    sendError = error instanceof Error ? error.message : String(error);
  }

  let payerUrl = findPayerUrl(created.value) || payerViewUrl(invoiceId, process.env.PAYPAL_MODE === "live");
  if (sent) {
    try {
      const remote = await traced(working, "get_invoice", invoiceId, () =>
        callPaypalTool("get_invoice", { invoice_id: invoiceId }, working),
      );
      working = remote.project;
      payerUrl = findPayerUrl(remote.value) || payerUrl;
    } catch (error) {
      const withProject = error as ActionError & { project?: Project };
      working = withProject.project ?? working;
    }
  }

  const phases = working.phases.map((item) =>
    item.id === phase.id
      ? {
          ...item,
          paypalInvoiceId: invoiceId,
          paypalPayerUrl: payerUrl,
          invoiceDate: sent ? built.invoiceDate : item.invoiceDate,
          dueDate: sent ? built.dueDate : item.dueDate,
          paymentStatus: sent ? ("invoiced" as const) : item.paymentStatus,
          invoicedAt: sent ? new Date().toISOString() : item.invoicedAt,
        }
      : item,
  );
  const next = touch({ ...working, phases: recomputeBlocks(phases) });
  const message = sent
    ? `Sent PayPal invoice ${invoiceId} for ${phase.name} (${formatMoney(phase.amount)}). Due ${built.dueDate} (Net 7).`
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
  const paymentDate = merchantToday();
  const recorded = await traced(project, "record_payment_for_invoice", phase.paypalInvoiceId, () =>
    callPaypalTool(
      "record_payment_for_invoice",
      {
        invoice_id: phase.paypalInvoiceId,
        method: "OTHER",
        payment_date: paymentDate,
        amount: { currency_code: "USD", value: phase.amount.toFixed(2) },
        note: "Sandbox payment recorded from Zilla Milestones.",
      },
      project,
    ),
  );
  let working = recorded.project;
  let confirmed = paymentWasRecorded(recorded.value) || mapPaypalInvoiceStatus(recorded.value) === "paid";
  if (!confirmed) {
    const remote = await traced(working, "get_invoice", phase.paypalInvoiceId, () =>
      callPaypalTool("get_invoice", { invoice_id: phase.paypalInvoiceId }, working),
    );
    working = remote.project;
    confirmed = mapPaypalInvoiceStatus(remote.value) === "paid";
  }
  if (!confirmed) {
    throw new ActionError("PayPal did not confirm the payment.");
  }
  const next = touch({
    ...working,
    phases: markPhaseStatus(working.phases, phase.id, "paid", paymentDate),
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

  let working = project;
  let phases = project.phases;
  const lines: string[] = [];
  const asOf = asOfDate(project);
  for (const target of targets) {
    if (!target.paypalInvoiceId) continue;
    const current = phases.find((phase) => phase.id === target.id) ?? target;
    const remoteCall = await traced(working, "get_invoice", target.paypalInvoiceId, () =>
      callPaypalTool("get_invoice", { invoice_id: target.paypalInvoiceId }, { ...working, phases }),
    );
    working = remoteCall.project;
    const remote = mapPaypalInvoiceStatus(remoteCall.value);
    const payerUrl = findPayerUrl(remoteCall.value);
    if (!remote) {
      lines.push(`${current.name}: PayPal returned no status`);
      continue;
    }
    const status: PaymentStatus =
      remote === "invoiced" && current.paymentStatus === "overdue" ? "overdue" : remote;
    phases = markPhaseStatus(phases, current.id, status, asOf).map((phase) =>
      phase.id === current.id && payerUrl ? { ...phase, paypalPayerUrl: payerUrl } : phase,
    );
    lines.push(`${current.name}: ${status}`);
  }

  const overdue = applyOverdue(touch({ ...working, phases }), asOf, () => nid("draft"));
  const composed = overdue.changed ? await composeOverdueDrafts(overdue.project) : { ...working, phases };
  return {
    project: touch(composed),
    message: `Synced from PayPal. ${lines.join("; ")}.`,
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
  const next = appendAction(touch({ ...project, phases }), {
    tool: "shift_phase",
    status: "ok",
    latencyMs: 1,
    detail: moved.join(", "),
  });
  return {
    project: next,
    message: `Moved ${moved.join(", ")} by ${days} day${days === 1 ? "" : "s"}.`,
  };
}

export async function runOverdueCheck(project: Project): Promise<{ project: Project; message: string }> {
  const asOf = asOfDate(project);
  const result = applyOverdue(project, asOf, () => nid("draft"));
  if (!result.changed) {
    return { project, message: "No unpaid invoice is past its due date." };
  }
  const composed = await composeOverdueDrafts(result.project);
  const next = appendAction(composed, {
    tool: "check_overdue",
    status: "ok",
    latencyMs: 1,
    detail: asOf,
  });
  return {
    project: next,
    message: "Overdue invoices shifted dependent milestones and a client update is waiting for approval.",
  };
}

export async function fastForwardClock(
  project: Project,
  phaseRef?: string,
): Promise<{ project: Project; message: string }> {
  const phase = phaseRef ? requirePhase(project, phaseRef) : undefined;
  if (phase) {
    if (!phase.paypalInvoiceId || phase.paymentStatus === "draft" || phase.paymentStatus === "cancelled") {
      throw new ActionError(`Invoice ${phase.name} before moving the demo clock past its due date.`);
    }
    if (phase.paymentStatus === "paid") throw new ActionError(`${phase.name} is already paid.`);
  }
  const open = project.phases.filter(
    (item) => item.paymentStatus === "invoiced" || item.paymentStatus === "overdue",
  );
  if (open.length === 0) throw new ActionError("Invoice a phase before moving the demo clock.");
  const focus =
    phase ?? open.slice().sort((left, right) => left.dueDate.localeCompare(right.dueDate))[0];
  const current = project.clockDate && /^\d{4}-\d{2}-\d{2}$/.test(project.clockDate)
    ? project.clockDate
    : merchantToday();
  const pastDue = addDays(focus.dueDate, 7);
  const target = pastDue > current ? pastDue : addDays(current, 7);
  const started = Date.now();
  const stamped = touch({ ...project, clockDate: target });
  const applied = applyOverdue(stamped, target, () => nid("draft"));
  const composeStarted = Date.now();
  let next = await composeOverdueDrafts(applied.project);
  const before = new Map(project.phases.map((item) => [item.id, item.startDate]));
  const moved = next.phases.filter((item) => before.get(item.id) !== item.startDate).map((item) => item.name);
  next = appendAction(next, {
    tool: "fast_forward_clock",
    status: "ok",
    latencyMs: Date.now() - started,
    detail: `Demo clock ${target}`,
  });
  if (moved.length > 0) {
    next = appendAction(next, {
      tool: "shift_phase",
      status: "ok",
      latencyMs: 1,
      detail: moved.join(", "),
    });
  }
  next = appendAction(next, {
    tool: "draft_client_update",
    status: "ok",
    latencyMs: Date.now() - composeStarted,
    detail: "Awaiting approval",
  });
  return {
    project: touch(next),
    message: `Demo clock is ${target}, 7 days past the Net-7 due date for ${focus.name}. Downstream work moved, and a client update is waiting for approval. Nothing was sent.`,
  };
}

export function discardDraft(project: Project, draftId: string): { project: Project; message: string } {
  if (!project.drafts.some((draft) => draft.id === draftId && draft.status === "pending_approval")) {
    throw new ActionError("Draft not found.");
  }
  const drafts = project.drafts.map((draft) =>
    draft.id === draftId ? { ...draft, status: "discarded" as const } : draft,
  );
  return {
    project: touch({ ...project, drafts }),
    message: "Draft discarded. Nothing was sent.",
  };
}

export async function approveDraft(
  project: Project,
  draftId: string,
): Promise<{ project: Project; message: string }> {
  const draft = project.drafts.find((item) => item.id === draftId);
  if (!draft || draft.status !== "pending_approval") {
    throw new ActionError("Draft not found.");
  }
  const phase = project.phases.find((item) => item.id === draft.phaseId);
  if (!phase?.paypalInvoiceId) {
    throw new ActionError("This update has no PayPal invoice to remind. Nothing was sent.");
  }
  const sent = await traced(project, "send_invoice_reminder", phase.paypalInvoiceId, () =>
    callPaypalTool(
      "send_invoice_reminder",
      {
        invoice_id: phase.paypalInvoiceId,
        subject: draft.subject.slice(0, 200),
        note: reminderNote(draft.body),
      },
      project,
    ),
  );
  const drafts = sent.project.drafts.map((item) =>
    item.id === draftId ? { ...item, status: "approved" as const } : item,
  );
  return {
    project: touch({ ...sent.project, drafts }),
    message: `Approved. PayPal reminder sent for ${phase.name} (${phase.paypalInvoiceId}).`,
  };
}

export function unpaidSummary(project: Project): string {
  const open = project.phases.filter(
    (phase) => phase.paymentStatus !== "paid" && phase.paymentStatus !== "cancelled",
  );
  if (open.length === 0) return "Every milestone is paid.";
  const total = open.reduce((sum, phase) => sum + phase.amount, 0);
  const lines = open.map((phase) => {
    const gate = phase.blocked ? "blocked" : "unlocked";
    return `${phase.name} — ${formatMoney(phase.amount)} — ${phase.paymentStatus} — ${gate}`;
  });
  return [`**Unpaid milestones:** ${formatMoney(total)}`, ...lines.map((line) => `- ${line}`)].join("\n");
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
    invoiceDate: phase.invoiceDate ?? null,
    blocked: phase.blocked,
    invoiceId: phase.paypalInvoiceId ?? null,
    payerUrl: phase.paypalPayerUrl ?? null,
  }));
  return JSON.stringify(
    {
      name: project.name,
      clientName: project.clientName ?? null,
      clientEmail: project.clientEmail,
      budget: project.budget,
      pyusdNote: project.pyusdNote,
      clockDate: project.clockDate ?? null,
      phases,
    },
    null,
    2,
  );
}
