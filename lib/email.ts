import { formatMoney } from "@/lib/money";
import type { EmailDraft, Phase, Project } from "@/lib/types";

export function buildOverdueDraft(
  project: Pick<Project, "name" | "clientEmail">,
  phase: Phase,
  shifted: Pick<Phase, "name" | "startDate">[],
  createdAt: string,
  id: string,
): EmailDraft {
  const moved =
    shifted.length > 0
      ? shifted.map((item) => `• ${item.name} now starts ${item.startDate}`).join("\n")
      : "No later milestone is queued behind this one, so those dates stay put.";

  const body = [
    "Hello,",
    "",
    `A short update on ${project.name}.`,
    "",
    `The milestone "${phase.name}" (${formatMoney(phase.amount)}) was due on ${phase.dueDate} and is still unpaid. I moved the downstream work so the schedule matches the payment:`,
    "",
    moved,
    "",
    "Those milestones stay locked until this invoice is paid. I can send a revised timeline whenever useful.",
    "",
    "Thank you,",
    "Zilla Labs",
    "",
    `Prepared for ${project.clientEmail}. This draft is waiting for a person to approve it. It has not been sent.`,
  ].join("\n");

  return {
    id,
    phaseId: phase.id,
    subject: `Schedule update for ${project.name}: ${phase.name}`,
    body,
    createdAt,
    status: "pending_approval",
  };
}

export function upsertPendingDraft(drafts: EmailDraft[], draft: EmailDraft): EmailDraft[] {
  const index = drafts.findIndex(
    (item) => item.phaseId === draft.phaseId && item.status === "pending_approval",
  );
  if (index < 0) return [...drafts, draft];
  const next = drafts.slice();
  next[index] = {
    ...next[index],
    subject: draft.subject,
    body: draft.body,
  };
  return next;
}
