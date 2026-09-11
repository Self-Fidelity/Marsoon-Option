import { dataVersion, route } from "@/server/go-options";

export const dynamic = "force-dynamic";

/** 数据版本端点：仅回 (product, scope, unix)，供前端做脏更新，体积极小。 */
export async function GET(request: Request) {
  return route(dataVersion, request.signal);
}
