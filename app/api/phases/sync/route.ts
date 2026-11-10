import { z } from "zod";
import { errorResponse, mutateProject } from "@/lib/http";
import { syncProject } from "@/lib/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ phase: z.string().trim().min(1).optional() });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return await mutateProject((project) => syncProject(project, body.phase));
  } catch (error) {
    return errorResponse(error);
  }
}
