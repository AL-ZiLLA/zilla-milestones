import { z } from "zod";
import { errorResponse, mutateProject } from "@/lib/http";
import { approveDraft, discardDraft } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  draftId: z.string().min(1),
  action: z.enum(["approved", "discarded"]),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return await mutateProject((project) =>
      body.action === "approved" ? approveDraft(project, body.draftId) : discardDraft(project, body.draftId),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
