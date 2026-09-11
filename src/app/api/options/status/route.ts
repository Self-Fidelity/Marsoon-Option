import { route, sourceStatus } from "@/server/go-options";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return route(sourceStatus, request.signal);
}
