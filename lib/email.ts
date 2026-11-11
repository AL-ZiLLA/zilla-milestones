import { formatMoney } from "@/lib/money";
import { extractJson } from "@/lib/schema";
import type { EmailDraft, Phase, Project } from "@/lib/types";

export function usableClientName(name?: string | null): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.includes("@")) return undefined;
  return trimmed;
}

export function clientFirstName(name?: string | null): string | undefined {
  return usableClientName(name)?.split(/\s+/)[0];
}

export function scrubClientGreeting(body: string, clientName?: string | null): string {
  const first = clientFirstName(clientName);
  const hello = first ? `Hello ${first},` : "Hello,";
  return body.replace(/^\s*(?:dear|hello|hi)\s+[^\n,]*@[^\n,]*,/i, hello);
}

export function buildOverdueDraft(
  project: Pick<Project, "name" | "clientName">,
  phase: Phase,
  shifted: Pick<Phase, "name" | "startDate">[],
  createdAt: string,
  id: string,
): EmailDraft {
  const moved =
    shifted.length > 0
      ? shifted.map((item) => `• ${item.name} now starts ${item.startDate}`).join("\n")
      : "No later milestone is queued behind this one, so those dates stay put.";

  const first = clientFirstName(project.clientName);
  const preparedFor = usableClientName(project.clientName) ?? "the client";
  const body = [
    first ? `Hello ${first},` : "Hello,",
    "",
    `A short update on ${project.name}.`,
    "",
    `The milestone "${phase.name}" (${formatMoney(phase.amount)}) was due on ${phase.dueDate} under Net 7 terms and is still unpaid. I moved the downstream work so the schedule matches the payment:`,
    "",
    moved,
    "",
    "Those milestones stay locked until this invoice is paid. I can send a revised timeline whenever useful.",
    "",
    "Thank you,",
    "Zilla Labs",
    "",
    `Prepared for ${preparedFor}. This draft is waiting for a person to approve it. It has not been sent.`,
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

const APPROVAL_LINE = "This draft is waiting for a person to approve it. It has not been sent.";

export function withApprovalFooter(body: string): string {
  if (/has not been sent/i.test(body)) return body.trim();
  return `${body.trim()}\n\n${APPROVAL_LINE}`;
}

export function reminderNote(body: string): string {
  return body
    .split("\n")
    .filter((line) => !/has not been sent|waiting for a person to approve|waiting for approval/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000);
}

export function chooseClientUpdate(
  modelText: string,
  template: Pick<EmailDraft, "subject" | "body">,
  facts: { amountLabel: string; dueDate: string; shiftedNames: string[]; clientName?: string },
): { subject: string; body: string } {
  const fallback = { subject: template.subject, body: template.body };
  try {
    const parsed = extractJson(modelText) as { subject?: unknown; body?: unknown };
    if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") return fallback;
    const subject = parsed.subject.trim();
    const body = parsed.body.trim();
    if (!subject || !body) return fallback;
    if (!body.includes(facts.amountLabel) || !body.includes(facts.dueDate)) return fallback;
    if (facts.shiftedNames.some((name) => !body.includes(name))) return fallback;
    return {
      subject: subject.slice(0, 200),
      body: withApprovalFooter(scrubClientGreeting(body, facts.clientName)),
    };
  } catch {
    return fallback;
  }
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
