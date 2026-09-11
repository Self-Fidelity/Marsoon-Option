/**
 * 请求车道（2026-09-11《K线与期权数据周期管理与防堵塞设计》§3.4）：
 *
 * - 期权重端点（dashboard/chain/水位/VP/levels/term）共用全局信号量（MAX_CONCURRENT），
 *   排队等位；K线/version 等快车道不经过这里，6 条浏览器连接恒有富余。
 * - 队列按优先级出队：2=用户显性操作（如 09 下钻）> 1=0DTE 档 > 0=其余档。
 *   数据优先级铁律：K线（快车道）> 0DTE > 其他周期。
 * - 滚动记录各端点耗时/成败样本，仅作 F12 诊断，不参与任何降频决策。
 *
 * 诊断只进 console.debug（[ms-data] 前缀，F12 过滤可见），不向 UI 暴露任何排队信息。
 */

interface QueueItem {
  resolve: () => void;
  priority: number;
  label: string;
  seq: number;
}

const MAX_CONCURRENT = 2;
let inFlight = 0;
let seq = 0;
const queue: QueueItem[] = [];

interface Sample {
  ok: boolean;
  ms: number;
}
const MAX_SAMPLES = 20;
const samples: Sample[] = [];

function recordSample(label: string, ms: number, ok: boolean) {
  samples.push({ ok, ms });
  if (samples.length > MAX_SAMPLES) samples.shift();
  if (!ok || ms > 15_000) {
    console.debug(`[ms-data] ${label} ${ok ? "慢" : "失败"} ${ms}ms`);
  }
}

/** 重车道入口：信号量限流 + 优先级排队 + 计时统计。 */
export async function heavyLane<T>(label: string, task: () => Promise<T>, priority = 0): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    const enqueuedAt = Date.now();
    console.debug(`[ms-data] 排队 ${label}（前方 ${queue.length} 项）`);
    await new Promise<void>((resolve) => {
      const item: QueueItem = { resolve, priority, label, seq: seq++ };
      // 优先级高者靠前；同级 FIFO
      const idx = queue.findIndex((q) => q.priority < priority);
      if (idx === -1) queue.push(item);
      else queue.splice(idx, 0, item);
    });
    console.debug(`[ms-data] 出队 ${label}，排队 ${Date.now() - enqueuedAt}ms`);
  }
  inFlight++;
  const start = Date.now();
  try {
    const value = await task();
    recordSample(label, Date.now() - start, true);
    return value;
  } catch (error) {
    recordSample(label, Date.now() - start, false);
    throw error;
  } finally {
    inFlight--;
    const next = queue.shift();
    if (next) next.resolve();
  }
}

/** 快车道计时（不占信号量）：仅记录耗时供 F12 诊断。 */
export async function timedLane<T>(label: string, task: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await task();
  } finally {
    const ms = Date.now() - start;
    if (ms > 3_000) console.debug(`[ms-data] 快车道 ${label} ${ms}ms`);
  }
}
