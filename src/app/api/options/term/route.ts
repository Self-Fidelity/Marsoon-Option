import { term, route } from "@/server/go-options";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return route((signal) => term(request, signal), request.signal);
}
