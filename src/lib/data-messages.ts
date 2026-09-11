import { localizeInstrumentText } from "./instrument-labels";

const INTERNAL_DATA_DETAIL = /\b(go|golang|databento|clickhouse|postgres\w*|redis|nats|sql|http\w*|api|bff|endpoint|upstream|provider|vendor|ticker|symbol|underlying|exception|error|stack|database|table|column|timeout|fetch|undefined|null|ECONN\w*|ENOENT)\b|\b(?:NQ|ES|GC)(?:[FGHJKMNQUVXZ]\d{1,4})?\b|\/(?:api|options|auth)\b|https?:\/\/|(?:[a-z0-9-]+\.)+(?:com|cn|net|io)\b|[A-Z_]{3,}=|接口|服务端|后端|数据库|连接池|堆栈|迁移|数据源|供应商/i;

export function sanitizePublicMessage(message: string | null | undefined, fallback: string) {
  if (!message || INTERNAL_DATA_DETAIL.test(message)) return fallback;
  return localizeInstrumentText(message);
}

/** Preserve useful data availability explanations, never expose infrastructure diagnostics. */
export function dataAvailabilityMessage(message: string | null | undefined, fallback = "当前暂无可用数据，请稍后重试。") {
  return sanitizePublicMessage(message, fallback);
}

export function sanitizeDataCopy(message: string | null | undefined): string | undefined {
  if (!message) return undefined;
  return dataAvailabilityMessage(message);
}

export function dataLoadFailureMessage(status?: number) {
  if (status === 401) return "登录状态已过期，请重新登录。";
  if (status === 403) return "当前账号暂时无法查看此数据。";
  return "暂时无法加载数据，请稍后重试。";
}

const EMPTY_IDENTIFIER_KEYS = new Set(["ticker", "symbol", "underlying_symbol", "futures", "series_id", "raw_symbol"]);
const MESSAGE_KEYS = new Set(["error", "message", "missing_reason", "data_notice", "candle_notice"]);

/** Browser-facing option payload boundary. Cached upstream objects are never mutated. */
export function sanitizePublicData<T>(value: T): T {
  const visit = (node: unknown, emptyParent = false): unknown => {
    if (Array.isArray(node)) return node.map((item) => visit(item, emptyParent));
    if (!node || typeof node !== "object") return node;
    const input = node as Record<string, unknown>;
    const empty = emptyParent || input.has_data === false;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(input)) {
      if (empty && EMPTY_IDENTIFIER_KEYS.has(key)) continue;
      if (key === "source" && typeof child === "string" && INTERNAL_DATA_DETAIL.test(child)) {
        output[key] = "market-data";
        continue;
      }
      if (MESSAGE_KEYS.has(key) && typeof child === "string") {
        output[key] = sanitizePublicMessage(child, key === "error" || key === "message" ? "请求未完成，请稍后重试。" : "当前暂无可用数据，请稍后重试。");
        continue;
      }
      output[key] = visit(child, empty);
    }
    return output;
  };
  return visit(value) as T;
}
