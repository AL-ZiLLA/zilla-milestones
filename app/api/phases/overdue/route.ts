import { z } from "zod";
import { ActionError } from "@/lib/errors";
import { errorResponse, mutateProject } from "@/lib/http";
import { fastForwardClock, runOverdueCheck } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  phase: z.string().trim().min(1).optional(),
  simulate: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json().catch(() => ({})));
    return await mutateProject((project) => {
      if (body.simulate) {
        if (!body.phase) throw new ActionError("Choose a milestone to move the demo clock past.");
        return fastForwardClock(project, body.phase);
      }
      return runOverdueCheck(project);
    });
  } catch (error) {
    return errorResponse(error);
  }
}
