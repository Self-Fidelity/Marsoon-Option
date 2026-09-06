/** Presentation only: API symbols, query keys and saved identifiers remain unchanged. */
const PRODUCTS: Record<string, string> = { NQ: "纳指", ES: "标普", GC: "黄金" };
const MONTHS = "FGHJKMNQUVXZ";

export function productName(product: string): string {
  return PRODUCTS[product.toUpperCase()] ?? "未知品种";
}

export function instrumentName(symbol: string | undefined, referenceUnix?: number): string {
  if (!symbol) return "—";
  const match = /^(NQ|ES|GC)(?:([FGHJKMNQUVXZ])(\d{1,4}))?$/i.exec(symbol);
  if (!match) return "未识别合约";
  const name = productName(match[1]!);
  if (!match[2] || !match[3]) return name;
  const month = MONTHS.indexOf(match[2].toUpperCase()) + 1;
  const rawYear = match[3], refYear = new Date(referenceUnix ? referenceUnix * 1000 : Date.now()).getUTCFullYear();
  const year = rawYear.length === 1 ? Math.round((refYear - Number(rawYear)) / 10) * 10 + Number(rawYear)
    : rawYear.length === 2 ? Math.floor(refYear / 100) * 100 + Number(rawYear) : Number(rawYear);
  return `${name}·${year}年${month}月`;
}

/** Translate instrument tokens in server explanations without touching metrics such as GEX/DEX. */
export function localizeInstrumentText(text: string | null | undefined): string {
  return (text ?? "").replace(/\b(?:NQ|ES|GC)(?:[FGHJKMNQUVXZ]\d{1,4})?\b/gi, (token) => instrumentName(token));
}

export function optionSeriesName(series: { futures: string; expiration: number; kind?: string }, product: string): string {
  const label = series.futures ? instrumentName(series.futures, series.expiration) : productName(product);
  const expiry = new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "2-digit", day: "2-digit" }).format(new Date(series.expiration * 1000));
  const kind = series.kind === "monthly" ? "月度" : series.kind === "eom" ? "月末" : series.kind === "weekly" ? "周度" : "期权";
  return `${label} · ${expiry}到期 · ${kind}`;
}
