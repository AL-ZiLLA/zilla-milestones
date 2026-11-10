import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ActionError } from "@/lib/errors";
import { runtimeMode } from "@/lib/mode";
import { updateProject } from "@/lib/store";
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

export async function mutateProject(
  fn: (project: Project) => Promise<{ project: Project; message: string }> | { project: Project; message: string },
): Promise<NextResponse> {
  let message = "";
  const project = await updateProject(async (current) => {
    const result = await fn(current);
    message = result.message;
    return result.project;
  });
  return projectResponse(project, message);
}
