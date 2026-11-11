import { cannedPlan } from "@/lib/demo-plan";
import { assertAiConfigured, cannedAiEnabled } from "@/lib/mode";
import { extractJson, parsePlan, type Plan } from "@/lib/schema";

const PLAN_SYSTEM = `You plan client project work into payment milestones for Zilla Milestones.
Return only JSON with this shape:
{
  "projectName": string,
  "summary": string,
  "phases": [
    {
      "name": string,
      "description": string,
      "durationDays": number,
      "amount": number,
      "dependsOn": string[]
    }
  ]
}
Rules:
- 3 to 6 phases
- dependsOn uses earlier phase names exactly, with no cycles
- durationDays is a whole number of calendar days from 1 to 90
- amount is a positive USD number
- descriptions are one sentence
- order phases so downstream work depends on upstream work`;

interface GrokMessage {
  role?: string;
  content?: string | null;
  tool_calls?: unknown;
}

export async function grokComplete(
  messages: Array<Record<string, unknown>>,
  tools?: unknown[],
): Promise<GrokMessage> {
  assertAiConfigured();
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error("XAI_API_KEY is not set");
  const base = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");
  const model = process.env.XAI_MODEL || "grok-4";
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    }),
  });
  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: GrokMessage }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Grok request failed (${response.status})`);
  }
  const message = payload.choices?.[0]?.message;
  if (!message) throw new Error("Grok returned no message");
  return message;
}

export async function generatePlan(scope: string): Promise<Plan> {
  if (cannedAiEnabled()) {
    assertAiConfigured();
    return cannedPlan(scope);
  }
  let feedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await grokComplete([
      { role: "system", content: PLAN_SYSTEM },
      {
        role: "user",
        content: feedback
          ? `${scope}\n\nThe previous JSON failed validation: ${feedback}\nReturn corrected JSON only.`
          : scope,
      },
    ]);
    const text = typeof message.content === "string" ? message.content : "";
    try {
      return parsePlan(extractJson(text));
    } catch (error) {
      feedback = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`The plan did not match the milestone schema: ${feedback}`);
}
