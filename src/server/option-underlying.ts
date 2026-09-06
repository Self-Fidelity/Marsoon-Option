/** Optional explicit contract pin. Empty = use the live 0DTE/nearest symbol from /options/status. */
export function fixedOptionUnderlying(_product: unknown): string | undefined {
  return undefined;
}
export function bindOptionQuery(_path: string, query: Record<string, string | number | undefined>) {
  return query;
}
export function allowedStatusEntry(entry: Record<string, unknown>): boolean {
  const fixed = fixedOptionUnderlying(entry.product);
  return !fixed || (typeof entry.underlying_symbol === "string" && entry.underlying_symbol.toUpperCase() === fixed);
}
/** Fail closed if an old endpoint ignores the contract filter. Never relabel another contract. */
export function checkBoundResponse(value: unknown, underlying: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) checkBoundResponse(item, underlying); return; }
  for (const [key, child] of Object.entries(value)) {
    if ((key === "underlying_symbol" || key === "futures") && typeof child === "string" && child && child.toUpperCase() !== underlying) {
      throw new Error(`请求 ${underlying}，后端返回了其他合约的数据，已停止显示`);
    }
    if (child && typeof child === "object") checkBoundResponse(child, underlying);
  }
}
