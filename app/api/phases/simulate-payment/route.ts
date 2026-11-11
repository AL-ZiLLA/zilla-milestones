import { z } from "zod";
import { errorResponse, mutateProject } from "@/lib/http";
import { simulatePayment } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ phase: z.string().trim().min(1) });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    return await mutateProject((project) => simulatePayment(project, body.phase));
  } catch (error) {
    return errorResponse(error);
  }
}
