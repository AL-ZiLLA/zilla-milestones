import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, projectResponse, readSessionProject } from "@/lib/http";
import { createProject } from "@/lib/service";
import { runtimeMode } from "@/lib/mode";
import { ensureSession } from "@/lib/session";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const createSchema = z.object({
  scope: z.string().trim().min(20, "Add a bit more scope so the plan has something to split."),
  clientEmail: z.string().trim().email("Enter a valid billing email."),
  budget: z.number().positive().max(10_000_000),
  pyusdNote: z.boolean().optional().default(false),
});

export async function GET() {
  try {
    const project = await readSessionProject();
    return NextResponse.json({ project, mode: runtimeMode() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const project = await createProject(body);
    const sessionId = await ensureSession();
    await getStore().write(sessionId, project);
    return projectResponse(project, "Milestone plan is on the Gantt.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  const sessionId = await ensureSession();
  await getStore().write(sessionId, null);
  return NextResponse.json({ project: null, mode: runtimeMode() });
}
