import { z } from "zod";
import { chatWithProject } from "@/lib/agent";
import { errorResponse, mutateProject } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return await mutateProject(async (project) => {
      const result = await chatWithProject(project, body.message);
      return { project: result.project, message: result.reply };
    });
  } catch (error) {
    return errorResponse(error);
  }
}
