import { z } from "zod";

export const planSchema = z.object({
  projectName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(2000),
  phases: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().min(1).max(500),
        durationDays: z.number().int().min(1).max(180),
        amount: z.number().positive().max(10_000_000),
        dependsOn: z.array(z.string().trim().min(1)).max(8).default([]),
      }),
    )
    .min(1)
    .max(12),
});

export type Plan = z.infer<typeof planSchema>;

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Model output did not contain a JSON object");
  }
  return JSON.parse(body.slice(start, end + 1));
}

export function parsePlan(input: unknown): Plan {
  return planSchema.parse(input);
}
