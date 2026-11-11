import { appendAction } from "@/lib/actions";
import { ActionError } from "@/lib/errors";
import { cannedAiEnabled } from "@/lib/mode";
import { isPaypalTool, paypalToolDefinitions, callPaypalTool, paymentWasRecorded, mapPaypalInvoiceStatus } from "@/lib/paypal";
import { grokComplete } from "@/lib/planner";
import { findPhase, markPhaseStatus } from "@/lib/schedule";
import {
  fastForwardClock,
  invoicePhase,
  projectSnapshot,
  runOverdueCheck,
  shiftNamedPhase,
  simulatePayment,
  syncProject,
  unpaidSummary,
} from "@/lib/service";
import { merchantToday } from "@/lib/dates";
import type { Project } from "@/lib/types";

interface ToolCall {
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

const DOMAIN_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_project_state",
      description: "Read milestone names, dates, amounts, payment status, blocks, and PayPal invoice ids.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "invoice_phase",
      description:
        "Create and send a PayPal invoice for one milestone by calling the PayPal Agent Toolkit create_invoice and send_invoice tools, then mark that Gantt task Invoiced. Use this when the user asks to invoice a phase.",
      parameters: {
        type: "object",
        properties: {
          phase: { type: "string", description: "1-based phase number or milestone name." },
        },
        required: ["phase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "link_paypal_invoice",
      description:
        "Attach a PayPal invoice id from create_invoice to a milestone after you called the toolkit yourself.",
      parameters: {
        type: "object",
        properties: {
          phase: { type: "string" },
          invoice_id: { type: "string" },
        },
        required: ["phase", "invoice_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sync_invoices",
      description: "Poll PayPal invoice status with get_invoice and update the Gantt.",
      parameters: {
        type: "object",
        properties: { phase: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_sandbox_payment",
      description:
        "Record a sandbox payment for an invoiced milestone via the PayPal record_payment_for_invoice tool (POST /v2/invoicing/invoices/{id}/payments).",
      parameters: {
        type: "object",
        properties: { phase: { type: "string" } },
        required: ["phase"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shift_phase",
      description: "Push an unpaid milestone and its unpaid dependents later by a number of calendar days.",
      parameters: {
        type: "object",
        properties: {
          phase: { type: "string" },
          days: { type: "integer" },
        },
        required: ["phase", "days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_overdue",
      description:
        "If an invoiced milestone is past its due date, mark it Overdue, shift dependents, and draft a client email for approval.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_client_update",
      description:
        "Fast-forward the demo clock to 7 days after the milestone Net-7 due date, shift dependents, and draft a client update for the approval card. Never send the reminder or the email.",
      parameters: {
        type: "object",
        properties: { phase: { type: "string" } },
        required: ["phase"],
      },
    },
  },
];

function systemPrompt(project: Project): string {
  return `You are the Zilla Milestones agent for Zilla Labs.
You schedule project phases and collect them as PayPal invoices.
The PayPal Agent Toolkit tools create_invoice, send_invoice, list_invoices, get_invoice, and record_payment_for_invoice are available for live sandbox calls.
Do not call send_invoice_reminder. A reminder is sent only when a person clicks Approve on the approval card.
When the user asks to invoice a phase, call invoice_phase. That tool calls create_invoice and send_invoice for you and updates the Gantt.
Invoice dates use the merchant calendar in America/Los_Angeles. Due dates are Net 7 from that invoice date.
You may also call the toolkit tools yourself and then link_paypal_invoice.
Never claim an invoice was sent, a payment landed, or an email went out unless a tool result says so.
Client updates and PayPal reminders stay drafts until a person approves them. Never send them yourself.
Phase numbers are 1-based in the current plan order.
Current project:
${projectSnapshot(project)}`;
}

function pushMessage(project: Project, role: "user" | "assistant", content: string): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    messages: [...project.messages, { role, content, at: new Date().toISOString() }].slice(-40),
  };
}

function argumentRecord(call: ToolCall): Record<string, unknown> {
  const raw = call.function?.arguments;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  return JSON.parse(raw) as Record<string, unknown>;
}

async function linkInvoice(project: Project, phaseRef: string, invoiceId: string): Promise<Project> {
  const phase = findPhase(project, phaseRef);
  if (!phase) throw new ActionError(`No milestone matches "${phaseRef}".`);
  const payload = await callPaypalTool("get_invoice", { invoice_id: invoiceId }, project);
  const remote = mapPaypalInvoiceStatus(payload) ?? "invoiced";
  const phases = project.phases.map((item) =>
    item.id === phase.id ? { ...item, paypalInvoiceId: invoiceId } : item,
  );
  return {
    ...project,
    phases: markPhaseStatus(phases, phase.id, remote === "draft" ? "invoiced" : remote, merchantToday()),
    updatedAt: new Date().toISOString(),
  };
}

export async function runAgentTool(
  project: Project,
  name: string,
  args: Record<string, unknown>,
): Promise<{ project: Project; output: string }> {
  try {
    if (name === "get_project_state") {
      return { project, output: unpaidSummary(project) + "\n" + projectSnapshot(project) };
    }
    if (name === "invoice_phase") {
      const result = await invoicePhase(project, String(args.phase ?? ""));
      return { project: result.project, output: result.message };
    }
    if (name === "link_paypal_invoice") {
      const next = await linkInvoice(project, String(args.phase ?? ""), String(args.invoice_id ?? ""));
      return { project: next, output: `Linked ${args.invoice_id} to the milestone.` };
    }
    if (name === "sync_invoices") {
      const result = await syncProject(project, args.phase ? String(args.phase) : undefined);
      return { project: result.project, output: result.message };
    }
    if (name === "record_sandbox_payment") {
      const result = await simulatePayment(project, String(args.phase ?? ""));
      return { project: result.project, output: result.message };
    }
    if (name === "shift_phase") {
      const result = shiftNamedPhase(project, String(args.phase ?? ""), Number(args.days));
      return { project: result.project, output: result.message };
    }
    if (name === "check_overdue") {
      const result = await runOverdueCheck(project);
      return { project: result.project, output: result.message };
    }
    if (name === "draft_client_update") {
      const result = await fastForwardClock(project, String(args.phase ?? ""));
      return { project: result.project, output: result.message };
    }
    if (isPaypalTool(name)) {
      if (name === "send_invoice_reminder") {
        return {
          project,
          output:
            "A human has to approve the reminder on the approval card before it is sent. Nothing was sent.",
        };
      }
      const started = Date.now();
      const payload = await callPaypalTool(name, args, project);
      let next = appendAction(project, {
        tool: name,
        status: "ok",
        latencyMs: Date.now() - started,
      });
      if (name === "record_payment_for_invoice" && paymentWasRecorded(payload)) {
        const invoiceId = String(args.invoice_id ?? "");
        const phase = project.phases.find((item) => item.paypalInvoiceId === invoiceId);
        if (phase) {
          next = {
            ...next,
            phases: markPhaseStatus(next.phases, phase.id, "paid", merchantToday()),
            updatedAt: new Date().toISOString(),
          };
        }
      }
      if (name === "get_invoice") {
        const invoiceId = String(args.invoice_id ?? "");
        const remote = mapPaypalInvoiceStatus(payload);
        const phase = project.phases.find((item) => item.paypalInvoiceId === invoiceId);
        if (phase && remote) {
          const status = remote === "invoiced" && phase.paymentStatus === "overdue" ? "overdue" : remote;
          next = {
            ...next,
            phases: markPhaseStatus(next.phases, phase.id, status, merchantToday()),
            updatedAt: new Date().toISOString(),
          };
        }
      }
      return { project: next, output: JSON.stringify(payload) };
    }
    return { project, output: `Unknown tool ${name}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { project, output: JSON.stringify({ error: message }) };
  }
}

function shiftDaysFrom(text: string): { phase: string; days: number } | null {
  const match = text.match(
    /(?:push|move|shift)\s+(.+?)\s+back\s+(a|an|\d+)\s*(week|weeks|day|days)/i,
  );
  if (!match) return null;
  const count = match[2] === "a" || match[2] === "an" ? 1 : Number(match[2]);
  const days = match[3].toLowerCase().startsWith("week") ? count * 7 : count;
  return { phase: match[1].trim(), days };
}

async function demoChat(project: Project, text: string): Promise<{ project: Project; reply: string }> {
  const lower = text.toLowerCase();
  if (/unpaid|outstanding|what(?:'s| is) open|owe/.test(lower)) {
    return { project, reply: unpaidSummary(project) };
  }
  const shift = shiftDaysFrom(text);
  if (shift) {
    const result = shiftNamedPhase(project, shift.phase, shift.days);
    return { project: result.project, reply: result.message };
  }
  if (/sync/.test(lower)) {
    const result = await syncProject(project);
    return { project: result.project, reply: result.message };
  }
  if (/overdue/.test(lower)) {
    const phaseMatch = text.match(/phase\s+(\d+|[a-z][\w -]*)/i);
    if (phaseMatch) {
      const result = await fastForwardClock(project, phaseMatch[1]);
      return { project: result.project, reply: result.message };
    }
    const result = await runOverdueCheck(project);
    return { project: result.project, reply: result.message };
  }
  if (/simulate payment|record payment|mark .+ paid/.test(lower)) {
    const phaseMatch = text.match(/phase\s+(\d+|[a-z][\w -]*)/i);
    const result = await simulatePayment(project, phaseMatch?.[1] ?? "1");
    return { project: result.project, reply: result.message };
  }
  if (/remind/.test(lower)) {
    const waiting = project.drafts.some((draft) => draft.status === "pending_approval");
    return {
      project,
      reply: waiting
        ? "A reminder is on the approval card. I will not send it until you click Approve."
        : "Nothing is waiting for approval. Invoice a phase, then fast-forward the demo clock if you want a reminder drafted.",
    };
  }
  if (/invoice/.test(lower)) {
    const phaseMatch = text.match(/phase\s+(\d+|[a-z][\w -]*)/i) ?? text.match(/invoice\s+([a-z0-9][\w -]*)/i);
    if (!phaseMatch) {
      return { project, reply: "Tell me which phase to invoice, for example: invoice phase 1." };
    }
    const result = await invoicePhase(project, phaseMatch[1]);
    return { project: result.project, reply: result.message };
  }
  return {
    project,
    reply:
      "I can invoice a phase, list what is unpaid, push a milestone back, sync PayPal status, record a sandbox payment, or draft an overdue client update for approval.",
  };
}

async function grokChatLoop(project: Project): Promise<{ project: Project; reply: string }> {
  const tools = [...DOMAIN_TOOLS, ...(await paypalToolDefinitions())];
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt(project) },
    ...project.messages.map((message) => ({ role: message.role, content: message.content })),
  ];
  let working = project;
  for (let step = 0; step < 6; step += 1) {
    const message = await grokComplete(messages, tools);
    const toolCalls = (message.tool_calls as ToolCall[] | undefined) ?? [];
    messages.push({
      role: "assistant",
      content: message.content ?? null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
    if (toolCalls.length === 0) {
      const reply = typeof message.content === "string" && message.content.trim()
        ? message.content.trim()
        : "Done.";
      return { project: working, reply };
    }
    for (const call of toolCalls) {
      const name = call.function?.name || "unknown";
      let args: Record<string, unknown> = {};
      try {
        args = argumentRecord(call);
      } catch {
        args = {};
      }
      const result = await runAgentTool(working, name, args);
      working = result.project;
      messages.push({
        role: "tool",
        tool_call_id: call.id ?? name,
        content: result.output,
      });
    }
  }
  return { project: working, reply: "I stopped after several tool calls. Ask me to continue if something is still open." };
}

export async function chatWithProject(
  project: Project,
  text: string,
): Promise<{ project: Project; reply: string }> {
  const trimmed = text.trim();
  if (!trimmed) throw new ActionError("Enter a message for the agent.");
  const withUser = pushMessage(project, "user", trimmed);
  const result = cannedAiEnabled() ? await demoChat(withUser, trimmed) : await grokChatLoop(withUser);
  return {
    reply: result.reply,
    project: pushMessage(result.project, "assistant", result.reply),
  };
}
