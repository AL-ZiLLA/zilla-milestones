import { NextResponse } from "next/server";
import { z } from "zod";
import { todayUtc } from "@/lib/dates";
import { errorResponse, projectResponse } from "@/lib/http";
import { applyOverdue } from "@/lib/overdue";
import { createProject, nid } from "@/lib/service";
import { runtimeMode } from "@/lib/mode";
import { readProject, saveProject } from "@/lib/store";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  scope: z.string().trim().min(20, "Add a bit more scope so the plan has something to split."),
  clientEmail: z.string().trim().email("Enter a valid billing email."),
  budget: z.number().positive().max(10_000_000),
  pyusdNote: z.boolean().optional().default(false),
});

export async function GET() {
  try {
    let project = readProject();
    if (project) {
      const checked = applyOverdue(project, todayUtc(), () => nid("draft"));
      if (checked.changed) project = saveProject(checked.project);
    }
    return NextResponse.json({ project, mode: runtimeMode() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const project = await createProject(body);
    return projectResponse(project, "Milestone plan is on the Gantt.");
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  saveProject(null);
  return NextResponse.json({ project: null, mode: runtimeMode() });
}
