import { dependentIds } from "@/lib/schedule";
import {
  buildOverdueDraft,
  chooseClientUpdate,
  clientFirstName,
  usableClientName,
} from "@/lib/email";
import { formatMoney } from "@/lib/money";
import { cannedAiEnabled } from "@/lib/mode";
import { grokComplete } from "@/lib/planner";
import type { Phase, Project } from "@/lib/types";

export function clientUpdateTone(slipDays: number): string {
  if (slipDays >= 14) return "firm, calm, and respectful";
  if (slipDays >= 7) return "direct, polite, and specific";
  return "warm, clear, and polite";
}

function shiftedDependents(project: Project, phase: Phase): Phase[] {
  const ids = dependentIds(project.phases, phase.id);
  return project.phases.filter(
    (item) =>
      ids.has(item.id) && item.paymentStatus !== "paid" && item.paymentStatus !== "cancelled",
  );
}

export function clientUpdatePrompt(project: Project, phase: Phase, shifted: Phase[]): string {
  const impact =
    shifted.length > 0
      ? shifted.map((item) => `${item.name} now starts ${item.startDate}`).join("; ")
      : "No later milestone moved.";
  return [
    "Write a client update email about a late milestone payment.",
    `Tone: ${clientUpdateTone(phase.slipDaysApplied)}.`,
    "Be specific. Cite the dollar amount, the due date, and the schedule impact using the facts below.",
    "Do not say the message has already been sent.",
    "Do not mention the billing email address. It is not the client's name.",
    clientFirstName(project.clientName)
      ? `Start with "Hello ${clientFirstName(project.clientName)},".`
      : 'Start with "Hello,".',
    'Return only JSON: {"subject":"...","body":"..."}',
    `Project: ${project.name}`,
    `Client name: ${usableClientName(project.clientName) ?? "the client"}`,
    `Milestone: ${phase.name}`,
    `Amount: ${formatMoney(phase.amount)}`,
    `Due date: ${phase.dueDate}`,
    `Terms: Net 7`,
    `Schedule impact: ${impact}`,
  ].join("\n");
}

export async function writeClientUpdate(
  project: Project,
  phase: Phase,
  shifted = shiftedDependents(project, phase),
): Promise<{ subject: string; body: string }> {
  const template = buildOverdueDraft(
    project,
    phase,
    shifted,
    new Date().toISOString(),
    `draft_${phase.id}`,
  );
  if (cannedAiEnabled()) {
    return { subject: template.subject, body: template.body };
  }
  const facts = {
    amountLabel: formatMoney(phase.amount),
    dueDate: phase.dueDate,
    shiftedNames: shifted.map((item) => item.name),
    clientName: project.clientName,
  };
  try {
    const message = await grokComplete([
      {
        role: "system",
        content:
          "You draft client emails for Zilla Labs. Return JSON only. Never claim a message was sent. Never greet the client by an email address.",
      },
      { role: "user", content: clientUpdatePrompt(project, phase, shifted) },
    ]);
    const text = typeof message.content === "string" ? message.content : "";
    return chooseClientUpdate(text, template, facts);
  } catch {
    return { subject: template.subject, body: template.body };
  }
}

export async function composeOverdueDrafts(project: Project): Promise<Project> {
  const pending = project.drafts.filter((draft) => draft.status === "pending_approval");
  if (pending.length === 0 || cannedAiEnabled()) return project;
  let drafts = project.drafts;
  for (const draft of pending) {
    const phase = project.phases.find((item) => item.id === draft.phaseId);
    if (!phase) continue;
    const written = await writeClientUpdate(project, phase);
    drafts = drafts.map((item) =>
      item.id === draft.id ? { ...item, subject: written.subject, body: written.body } : item,
    );
  }
  return { ...project, drafts };
}
