#!/usr/bin/env node
/**
 * panel-shots.mjs — 经 WebBridge daemon 抓取 /panel-shot 导出页，产出 5 个
 * 单文件 HTML（CSS 全内联、脚本剔除、真实数据快照）到项目外定稿目录。
 * 用法：node scripts/panel-shots.mjs（需 dev 服务在 4173、daemon 在 10086）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DAEMON = "http://127.0.0.1:10086/command";
const BASE = "http://127.0.0.1:4173/panel-shot";
const SESSION = "panel-shot";
const OUT_DIR = "E:/Users/biycd/Desktop/Trade file/期权/01 初次定稿/panels";

const SHOTS = [
  ["expiration", "05-expiration.html"],
  ["intraday", "06-intraday.html"],
  ["volatility", "07-volatility.html"],
  ["chain", "09-chain.html"],
  ["spread", "10-spread.html"],
];

/** 序列化当前页：收集全部样式表 cssText → 内联 <style>，剔除 script 与外链样式表 */
const SERIALIZE = `(() => {
  let css = "";
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + "\\n";
    } catch (e) { /* 跨域样式表跳过 */ }
  }
  const doc = new DOMParser().parseFromString(document.documentElement.outerHTML, "text/html");
  doc.querySelectorAll("script").forEach((s) => s.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((l) => l.remove());
  const style = doc.createElement("style");
  style.setAttribute("data-panel-shot-inline", "1");
  style.textContent = css;
  doc.head.appendChild(style);
  return "<!doctype html>\\n" + doc.documentElement.outerHTML;
})()`;

async function command(action, args) {
  const res = await fetch(DAEMON, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, args, session: SESSION }),
  });
  if (!res.ok) throw new Error(`daemon ${action} HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`daemon ${action} failed: ${JSON.stringify(json)}`);
  return json.data;
}

async function waitReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await command("evaluate", {
      code: "document.body.dataset.shotReady === '1'",
    });
    if (data && data.value === true) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("等待 data-shot-ready 超时（30s）");
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, file] of SHOTS) {
    const url = `${BASE}?panel=${key}&product=NQ&scope=0dte`;
    await command("navigate", { url });
    await waitReady();
    // 数据落渲染后再停半秒，保险
    await new Promise((r) => setTimeout(r, 500));
    const data = await command("evaluate", { code: SERIALIZE });
    if (!data || typeof data.value !== "string" || data.value.length < 1000) {
      throw new Error(`${key}: 序列化结果异常（${data && typeof data.value}）`);
    }
    const out = path.join(OUT_DIR, file);
    writeFileSync(out, data.value, "utf8");
    console.log(`${file}: ${Buffer.byteLength(data.value, "utf8")} bytes`);
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
