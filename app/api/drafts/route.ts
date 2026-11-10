import { z } from "zod";
import { errorResponse, mutateProject } from "@/lib/http";
import { resolveDraft } from "@/lib/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  draftId: z.string().min(1),
  action: z.enum(["approved", "discarded"]),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return await mutateProject((project) => resolveDraft(project, body.draftId, body.action));
  } catch (error) {
    return errorResponse(error);
  }
}
