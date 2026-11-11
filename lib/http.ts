import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { asOfDate } from "@/lib/dates";
import { ActionError } from "@/lib/errors";
import { runtimeMode } from "@/lib/mode";
import { applyOverdue } from "@/lib/overdue";
import { composeOverdueDrafts } from "@/lib/compose";
import { ensureSession } from "@/lib/session";
import { buildSeedProject } from "@/lib/seed";
import { nid } from "@/lib/service";
import { getStore } from "@/lib/store";
import type { Project } from "@/lib/types";

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "Invalid request" }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  const status = error instanceof ActionError ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
}

export function projectResponse(project: Project | null, message?: string): NextResponse {
  return NextResponse.json({ project, mode: runtimeMode(), message });
}

export async function readSessionProject(): Promise<Project | null> {
  const sessionId = await ensureSession();
  const store = getStore();
  let project = await store.ensure(sessionId, () => buildSeedProject());
  if (!project) return null;
  const checked = applyOverdue(project, asOfDate(project), () => nid("draft"));
  if (!checked.changed) return project;
  project = await composeOverdueDrafts(checked.project);
  await store.write(sessionId, project);
  return project;
}

export async function mutateProject(
  fn: (project: Project) => Promise<{ project: Project; message: string }> | { project: Project; message: string },
): Promise<NextResponse> {
  const sessionId = await ensureSession();
  const store = getStore();
  let message = "";
  try {
    const project = await store.update(sessionId, async (current) => {
      const result = await fn(current);
      message = result.message;
      return result.project;
    });
    return projectResponse(project, message);
  } catch (error) {
    const withProject = error as { project?: Project };
    if (withProject.project) {
      await store.write(sessionId, withProject.project);
    }
    throw error;
  }
}
