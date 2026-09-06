import type { NextRequest } from "next/server";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  readBarchartStatus,
  writeBarchartSnapshot,
  type BarchartStoreSnapshot,
} from "@/server/barchart-store";
import { fanoutAnalysis } from "@/server/barchart-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 快照落盘：每轮追加一行 JSON 到 data/snapshots/YYYY-MM-DD.jsonl。
 * 进程重启后可回放，为 levels 历史与关键价位迁移图打底。落盘失败不影响 ingest。
 */
function persistSnapshot(body: BarchartStoreSnapshot) {
  try {
    const dir = join(process.cwd(), "data", "snapshots");
    mkdirSync(dir, { recursive: true });
    const day = new Date(body.capturedAt).toISOString().slice(0, 10);
    appendFileSync(join(dir, `${day}.jsonl`), JSON.stringify(body) + "\n");
  } catch (err) {
    console.error("[ingest] 快照落盘失败:", err);
  }
}

/**
 * POST /api/ingest/barchart — 采集器推送清洗后的快照（见 scripts/barchart-poller.mjs）
 * GET  /api/ingest/barchart — 抓取状态（前端倒计时徽标轮询此端点）
 */
export async function POST(request: NextRequest) {
  let body: BarchartStoreSnapshot;
  try {
    body = (await request.json()) as BarchartStoreSnapshot;
  } catch {
    return Response.json({ error: "JSON 解析失败" }, { status: 400 });
  }

  if (body?.source !== "barchart-webbridge" || !body.products || !body.capturedAt) {
    return Response.json({ error: "快照契约不符" }, { status: 422 });
  }

  const accepted: string[] = [];
  for (const [product, snap] of Object.entries(body.products)) {
    if (
      snap &&
      Array.isArray(snap.series) &&
      snap.series.some((s) => Array.isArray(s.chain) && s.chain.length > 0)
    ) {
      accepted.push(product);
    }
  }
  if (accepted.length === 0) {
    return Response.json({ error: "快照内无有效产品链" }, { status: 422 });
  }

  writeBarchartSnapshot(body);
  persistSnapshot(body);

  // R1：入库即触发分析扇出（后台串行跑 3 品种全链计算，覆盖 0dte/d30/d90/all 共 12 个
  // 计算 key），POST 立即返回，避免采集器超时。路由只读缓存，miss 走后台补算。
  fanoutAnalysis(body.capturedAt);

  return Response.json(
    { ok: true, accepted, fanout: "scheduled", serverTime: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  return Response.json(readBarchartStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
