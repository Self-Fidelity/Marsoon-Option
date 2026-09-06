#!/usr/bin/env node
/**
 * Barchart 浏览器态采集器 v3（延迟数据，个人研究用途）
 *
 * v3 升级：
 *  - serie 到期日以 serie 页面 "N Days to expiration on MM/DD/YY" 文本为真值
 *    （refreshSerieList 时逐 serie navigate 抓取）；星期几/月字母启发式退役为兜底
 *  - 链死档过滤：OI/成交量/双边报价/last 全空的档位直接丢弃，推送体量大幅下降
 *  - bars1m 失败打日志并当轮重试一次（GC 间歇性空返回），不再静默吞错
 *  - 默认采集周期 15 分钟（源数据延迟 10-20 分钟，更高频无收益）
 *
 * v2 能力保留：
 *  - 多 serie 抓取：从期权页 Options Type 下拉动态读取 serie 清单
 *    （月度 / EOM / 周一~周五周期权），合约滚动自适应
 *  - 附带 1min K线（06 面板备用）
 *
 * serie 清单缓存到 scripts/.serie-cache.json（version 2，含真值），每天首轮刷新
 * （navigate 慢，不宜每轮都做）；链返回空时判定 serie 过期并立即刷新。
 *
 * 用法：node scripts/barchart-poller.mjs
 * 环境变量：WEBBRIDGE_URL / WB_SESSION / TARGET_URL / INTERVAL_SEC(>=60)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEBBRIDGE_URL = process.env.WEBBRIDGE_URL ?? "http://127.0.0.1:10086/command";
const WB_SESSION = process.env.WB_SESSION ?? "barchart-probe";
const TARGET_URL = process.env.TARGET_URL ?? "http://127.0.0.1:4173/api/ingest/barchart";
const INTERVAL_SEC = Math.max(60, Number(process.env.INTERVAL_SEC ?? 900));

const HERE = dirname(fileURLToPath(import.meta.url));
const SERIE_CACHE = join(HERE, ".serie-cache.json");

/** 产品 → Barchart 主力期货合约（合约滚动时改这里） */
const PRODUCTS = {
  ES: "ESU26",
  NQ: "NQU26",
  GC: "GCZ26",
};

const WEEKDAY_NAME = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const EVAL_FETCH_SERIE_LIST = `(function(){
  var re=new RegExp('/futures/quotes/([A-Z0-9*]+)/options(?:/([A-Za-z0-9-]+))?');
  var sels=[].slice.call(document.querySelectorAll('select'));
  var s=null;
  for(var i=0;i<sels.length;i++){
    var os=sels[i].querySelectorAll('option');
    for(var j=0;j<os.length;j++){
      if(/monthly options/i.test(os[j].textContent||'')){s=sels[i];break;}
    }
    if(s)break;
  }
  if(!s)return {error:'dropdown not found'};
  var opts=[];s.querySelectorAll('option').forEach(function(o){
    var m=re.exec(o.value||'');
    if(m)opts.push({label:o.textContent.trim(),futures:m[1],seg:m[2]||'',path:o.value});
  });
  return {opts:opts};
})()`;

/** serie 页真值：页面顶部 "N Days to expiration on MM/DD/YY" 文本（到期日唯一可靠来源） */
const EVAL_FETCH_SERIE_TRUTH = `(function(){
  var t=document.body.innerText||'';
  var m=/(\\d+)\\s*Days?\\s*to\\s*expirat\\w*\\s*on\\s*(\\d{2}\\/\\d{2}\\/\\d{2})/i.exec(t);
  if(!m)return {error:'truth text not found'};
  return {dte:Number(m[1]),date:m[2]};
})()`;

/** 单产品 1min K线（bars 间歇性失败时当轮重试用） */
const EVAL_FETCH_BARS = `(async function(){
  try{
    var b=await fetch('/proxies/timeseries/queryminutes.ashx?symbol=__FUT__&interval=1',{credentials:'same-origin'});
    if(!b.ok)return {error:'HTTP '+b.status};
    return {text:await b.text()};
  }catch(e){return {error:String(e&&e.message||e)};}
})()`;

const EVAL_FETCH_PRODUCT = `(async function(){
  async function g(p){try{var r=await fetch(p,{credentials:'same-origin'});return await r.json();}catch(e){return null;}}
  var F='strike,lastPrice,bidPrice,askPrice,volume,openInterest,optionType,symbol,tradeTime';
  var out={quotes:null,exp:null,chains:{},bars:null};
  out.quotes=await g('/proxies/core-api/v1/quotes/get?symbols='+__FUTS__+'&fields=symbol,lastPrice,priceChange,tradeTime&raw=1');
  out.exp=await g('/proxies/core-api/v1/options-expirations/get?baseSymbol=__FUT__&fields=expirationDate,expirationType,daysToExpiration,putCallVolumeRatio,putCallOpenInterestRatio,volatility&orderBy=expirationDate');
  __CHAINS__
  try{
    var b=await fetch('/proxies/timeseries/queryminutes.ashx?symbol=__FUT__&interval=1',{credentials:'same-origin'});
    if(b.ok){out.bars=await b.text();}else{out.barsError='HTTP '+b.status;}
  }catch(e){out.barsError=String(e&&e.message||e);}
  return out;
})()`;

function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,%s]/g, "").trim();
  if (!cleaned || cleaned === "N/A") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** MM/DD/YY → unix 秒（UTC 20:00，对齐 CME 到期日口径） */
function expiryToUnix(mddyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(mddyy ?? "");
  if (!m) return 0;
  return Math.floor(Date.UTC(2000 + Number(m[3]), Number(m[1]) - 1, Number(m[2]), 20, 0, 0) / 1000);
}

async function wbEvaluate(code) {
  const res = await fetch(WEBBRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "evaluate", args: { code }, session: WB_SESSION }),
  });
  if (!res.ok) throw new Error(`WebBridge HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(`WebBridge: ${json.error?.message ?? "未知错误"}`);
  return json.data?.value;
}

/** 当前浏览器落点 URL（navigate 后防串页校验用） */
const EVAL_GET_LOCATION = `(function(){return {href:location.href};})()`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wbNavigate(url) {
  const res = await fetch(WEBBRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "navigate", args: { url, waitMs: 20000 }, session: WB_SESSION }),
  });
  const json = await res.json().catch(() => ({}));
  return json.ok === true;
}

/** serie 分类：label → kind + 周期权星期几 */
function classifySerie(label) {
  const l = label.toLowerCase();
  if (l.includes("monthly")) return { kind: "monthly" };
  if (l.includes("eom") || l.includes("end of month")) return { kind: "eom" };
  for (let d = 0; d < 7; d++) {
    if (l.includes(WEEKDAY_NAME[d])) return { kind: "weekly", weekday: d };
  }
  return { kind: "unknown" };
}

/**
 * serie 代码归属前缀（Barchart 用 CME clearing code，长前缀在前防 GC 匹配掉 MGC）。
 * 实测全集见 docs/周期架构迭代开发文档.md 串页故障记录；不归属即串页污染，立即抛错。
 */
const SERIE_CODE_PREFIXES = {
  ES: ["EW1", "EW2", "EW3", "EW4", "ES", "EW", "T8", "MI", "MV", "MW"],
  NQ: ["MNQ", "NQ", "MQ", "MC", "MM"],
  GC: ["MGC", "GC", "OG", "IG", "IY", "I0B", "I0G"],
};

/** 下拉项 path 允许的产品根（serie 页挂在对应月份合约上，如 ES 的 serie 可指 ESZ26） */
const SERIE_PATH_ROOTS = {
  ES: ["ES", "MES"],
  NQ: ["NQ", "MNQ"],
  GC: ["GC", "MGC"],
};

/** 从页面下拉读取产品 serie 清单（navigate 后校验落点 URL，不符/下拉空则重试，最多 3 次） */
async function fetchSerieList(product, futuresSymbol) {
  const url = `https://www.barchart.com/futures/quotes/${futuresSymbol}/options`;
  const expectPath = `/futures/quotes/${futuresSymbol}/options`;
  let lastErr = "未知";
  for (let attempt = 1; attempt <= 3; attempt++) {
    await wbNavigate(url);
    // 页面加载慢/失败时 evaluate 会打在残留页面上（串页污染），
    // 必须先校验 location.href 落点，并轮询等待下拉出现
    let res = null;
    let landed = false;
    for (let i = 0; i < 5; i++) {
      const loc = await wbEvaluate(EVAL_GET_LOCATION).catch(() => null);
      landed = Boolean(loc?.href?.includes(expectPath));
      if (landed) {
        res = await wbEvaluate(EVAL_FETCH_SERIE_LIST).catch((e) => ({ error: String(e?.message ?? e) }));
        if (res && !res.error && Array.isArray(res.opts) && res.opts.length > 0) break;
      }
      await sleep(2500);
    }
    if (landed && res && !res.error && Array.isArray(res.opts) && res.opts.length > 0) {
      const series = [];
      for (const opt of res.opts) {
        const cls = classifySerie(opt.label);
        series.push({
          code: opt.seg || opt.futures, // 月度无第三段，用期货 symbol 本身
          kind: cls.kind,
          weekday: cls.weekday ?? null,
          label: opt.label,
          futures: opt.futures,
          path: opt.path, // 下拉项自带的 serie 页路径，真值抓取直接 navigate 它
          truth: null, // 页面真值 {dte, date, unix}，由 scrapeSerieTruth 填充
        });
      }
      // 归属纵深防御：① 每个下拉项 path 的标的产品根须属于本产品
      // （周期权挂对应月份合约而非主力，如 ES 的 MI6V26 挂 ESZ26——故按产品根放行，
      //  跨产品残留页则根不同，可识别）；② 代码前缀须在本产品白名单。
      // 命中任一即串页污染，抛错且不写缓存。
      const pathRoots = SERIE_PATH_ROOTS[product] ?? [];
      const alienPath = series.find((s) => {
        const m = /^\/futures\/quotes\/([A-Z0-9]+)\d{2}\/options/.exec(s.path ?? "");
        return !m || !pathRoots.some((r) => m[1] === r || m[1].startsWith(r));
      });
      if (alienPath) {
        throw new Error(`${product} serie 清单 path 指向 ${alienPath.path}（疑似串页污染），拒绝写入缓存`);
      }
      const prefixes = SERIE_CODE_PREFIXES[product] ?? [];
      const alien = series.find((s) => !prefixes.some((p) => s.code.startsWith(p)));
      if (alien) {
        throw new Error(`${product} serie 清单出现不归属代码 ${alien.code}（疑似串页污染），拒绝写入缓存`);
      }
      return series;
    }
    lastErr = !landed ? `第${attempt}次落点不符` : `第${attempt}次下拉为空：${res?.error ?? "空"}`;
    if (attempt < 3) await sleep(2500);
  }
  throw new Error(`${product} 下拉读取失败（${lastErr}）`);
}

/** navigate serie 页面抓 "N Days to expiration on MM/DD/YY" 真值；失败返回 null（走启发式兜底） */
async function scrapeSerieTruth(serie) {
  const url = serie.path?.startsWith("http")
    ? serie.path
    : `https://www.barchart.com${serie.path ?? ""}`;
  if (!serie.path) return null;
  try {
    await wbNavigate(url);
    // 落点校验：加载失败时 evaluate 会打在残留页面上，抓到别的 serie 的到期真值
    const expectPath = serie.path.split("?")[0];
    const loc = await wbEvaluate(EVAL_GET_LOCATION);
    if (!loc?.href?.includes(expectPath)) return null;
    const res = await wbEvaluate(EVAL_FETCH_SERIE_TRUTH);
    if (!res || res.error || !res.date) return null;
    const unix = expiryToUnix(res.date);
    if (!unix || !Number.isFinite(res.dte)) return null;
    return { dte: res.dte, date: res.date, unix };
  } catch {
    return null;
  }
}

function loadSerieCache() {
  try {
    if (!existsSync(SERIE_CACHE)) return null;
    const raw = JSON.parse(readFileSync(SERIE_CACHE, "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    // version 2：serie 带页面真值（truth）与 serie 页路径（path），旧缓存作废
    if (raw.version !== 2 || raw.date !== today) return null; // 每天强制刷新一次
    return raw.seriesByProduct;
  } catch {
    return null;
  }
}

function saveSerieCache(seriesByProduct) {
  try {
    writeFileSync(
      SERIE_CACHE,
      JSON.stringify({ version: 2, date: new Date().toISOString().slice(0, 10), seriesByProduct }),
    );
  } catch {
    // 缓存失败不致命
  }
}

/**
 * serie 到期日启发式推断（兜底）：weekly 按星期几在 expirations 里匹配最近到期。
 * 已知会系统性出错（expirations API 的 type/日期覆盖不可靠），v3 起仅在
 * serie 页面真值抓取失败时使用。
 */
function resolveSerieExpiry(serie, expiries) {
  if (serie.kind === "weekly" && serie.weekday !== null) {
    const hit = expiries
      .filter((e) => {
        if (e.daysToExpiration < 0) return false;
        const d = new Date(e.expirationUnix * 1000);
        return d.getUTCDay() === serie.weekday;
      })
      .sort((a, b) => a.daysToExpiration - b.daysToExpiration)[0];
    if (hit) return hit;
  }
  // monthly / eom / unknown：按 serie 代码尾部的"月字母+年"推断
  // （代码=期权月：MQ6U26→U26→2026-09。注意不要用 serie.futures——
  //  那是标的期货月，期权月与标的月可能不同：NQ 9月EOM 的标的是 12月期货）
  const MONTH_CODES = { F: 1, G: 2, H: 3, J: 4, K: 5, M: 6, N: 7, Q: 8, U: 9, V: 10, X: 11, Z: 12 };
  const mm = /([FGHJKMNQUVXZ])(\d{2})$/i.exec(serie.code);
  if (mm) {
    const cMonth = MONTH_CODES[mm[1].toUpperCase()];
    const cYear = 2000 + Number(mm[2]);
    const inMonth = expiries
      .filter((e) => {
        const d = /^(\d{2})\/\d{2}\/(\d{2})$/.exec(e.expirationDate);
        return d && Number(d[1]) === cMonth && 2000 + Number(d[2]) === cYear;
      })
      .sort((a, b) => a.daysToExpiration - b.daysToExpiration);
    if (serie.kind === "eom") {
      // 月末期权：取合约月内日期最大者
      const lastDay = [...inMonth].sort((a, b) => {
        const da = Number(a.expirationDate.slice(3, 5));
        const db = Number(b.expirationDate.slice(3, 5));
        return db - da;
      })[0];
      if (lastDay) return lastDay;
    }
    if (inMonth.length) {
      const monthly = inMonth.filter((e) => e.expirationType === "monthly");
      return (monthly.length ? monthly : inMonth)[0];
    }
  }
  // 兜底：DTE 最小
  return [...expiries].sort((a, b) => a.daysToExpiration - b.daysToExpiration)[0] ?? null;
}

/**
 * 链清洗 + 范围过滤。保留：有 OI / 有成交量的档位（GEX、墙、flip 的全部数据来源），
 * 以及现货 ±10% 内有双边报价的档位（09 链面板近价区展示用）。
 * 丢弃：只剩结算价的死档（无 OI、无成交、无报价，对指标与展示都零贡献，
 * 实测占链体量 30~50%）与远价区纯报价档。返回 { rows, total } 供日志核对过滤比。
 */
function cleanChain(chainJson, refPrice) {
  const data = chainJson?.data ?? {};
  const rows = [];
  let total = 0;
  for (const type of ["Call", "Put"]) {
    for (const item of data[type] ?? []) {
      const r = item.raw ?? {};
      const strike = num(r.strike ?? item.strike);
      if (strike === null) continue;
      total += 1;
      const row = {
        strike,
        optionType: type,
        bid: num(r.bidPrice ?? item.bidPrice),
        ask: num(r.askPrice ?? item.askPrice),
        last: num(r.lastPrice ?? item.lastPrice),
        volume: num(r.volume ?? item.volume),
        oi: num(r.openInterest ?? item.openInterest),
        isSettlement: typeof item.lastPrice === "string" && item.lastPrice.endsWith("s"),
      };
      const hasPositioning =
        (row.oi !== null && row.oi > 0) || (row.volume !== null && row.volume > 0);
      const nearQuoted =
        refPrice > 0 &&
        Math.abs(strike - refPrice) / refPrice <= 0.1 &&
        row.bid !== null && row.bid > 0 && row.ask !== null && row.ask > 0;
      if (!hasPositioning && !nearQuoted) continue;
      rows.push(row);
    }
  }
  return { rows, total };
}

/** 1min K线 CSV → 数组（保留当日，最多 800 根） */
function cleanBars(csv) {
  if (!csv || typeof csv !== "string") return [];
  const out = [];
  for (const line of csv.split(/\r?\n/)) {
    const p = line.split(",");
    if (p.length < 7) continue;
    const t = Date.parse(p[0].replace(" ", "T") + ":00-05:00"); // CT ≈ UTC-5（夏令时；误差可接受）
    const o = Number(p[2]), h = Number(p[3]), l = Number(p[4]), c = Number(p[5]), v = Number(p[6]);
    if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
    out.push({ unix: Math.floor(t / 1000), o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  return out.slice(-800);
}

async function collectProduct(product, futuresSymbol, series) {
  const chainCalls = series
    .map(
      (s) =>
        `out.chains[${JSON.stringify(s.code)}]=await g('/proxies/core-api/v1/quotes/get?symbol=${s.code}&list=futures.options&fields='+F+'&groupBy=optionType&orderBy=strike&orderDir=asc&raw=1');`,
    )
    .join("\n  ");
  // 每个 serie 可能挂在不同标的期货上（如 GC 周期权→GCV26，主链→GCZ26），报价全拿
  const futSet = [...new Set([futuresSymbol, ...series.map((s) => s.futures ?? futuresSymbol)])];
  const code = EVAL_FETCH_PRODUCT.replaceAll("__FUT__", futuresSymbol)
    .replace("__FUTS__", JSON.stringify(futSet))
    .replace("__CHAINS__", chainCalls);
  const raw = await wbEvaluate(code);

  const quotes = {};
  for (const q of raw?.quotes?.data ?? []) {
    const lp = num(q?.raw?.lastPrice ?? q.lastPrice);
    if (lp && q.symbol) {
      quotes[q.symbol] = {
        lastPrice: lp,
        priceChange: num(q?.raw?.priceChange ?? q.priceChange),
        tradeTime: num(q?.raw?.tradeTime) ?? null,
      };
    }
  }
  const lastPrice = quotes[futuresSymbol]?.lastPrice;
  if (!lastPrice) throw new Error("报价缺失");

  const expiries = (raw?.exp?.data ?? [])
    .filter((e) => e.expirationDate && e.expirationDate !== "N/A")
    .map((e) => ({
      expirationDate: e.expirationDate,
      expirationUnix: expiryToUnix(e.expirationDate),
      expirationType: e.expirationType ?? "unknown",
      daysToExpiration: num(e.daysToExpiration) ?? 0,
      putCallVolumeRatio: num(e.putCallVolumeRatio),
      putCallOiRatio: num(e.putCallOpenInterestRatio),
      volatility: num(e.volatility) !== null ? num(e.volatility) / 100 : null,
    }));
  // 到期清单是 serie DTE 推断的根基，缺失会导致 serie 被误标成 0DTE，宁缺毋滥
  if (expiries.length === 0) throw new Error("到期清单缺失");

  const outSeries = [];
  const stats = [];
  for (const serie of series) {
    const chainJson = raw?.chains?.[serie.code];
    // 过滤基准价用 serie 自己的标的期货价（周期权可能挂非主合约）
    const refPrice = quotes[serie.futures ?? futuresSymbol]?.lastPrice ?? lastPrice;
    const { rows: chain, total } = cleanChain(chainJson, refPrice);
    if (chain.length === 0) {
      console.log(`  [${product}] serie ${serie.code} 链为空，跳过`);
      emptySeriesThisRound.push(`${product}:${serie.code}`);
      continue;
    }
    // 到期日优先用 serie 页面真值（refreshSerieList 时抓取），启发式仅作兜底（stats 里以 ~ 标记）
    const truth = serie.truth;
    const fallback = truth ? null : resolveSerieExpiry(serie, expiries);
    const daysToExpiration = truth?.dte ?? fallback?.daysToExpiration ?? 0;
    outSeries.push({
      code: serie.code,
      kind: serie.kind,
      weekday: serie.weekday,
      label: serie.label,
      futures: serie.futures ?? futuresSymbol,
      expirationUnix: truth?.unix ?? fallback?.expirationUnix ?? 0,
      expirationDate: truth?.date ?? fallback?.expirationDate ?? "",
      daysToExpiration,
      chain,
    });
    stats.push(`${serie.code}:dte${daysToExpiration}:${chain.length}/${total}档${truth ? "" : "~"}`);
  }
  if (outSeries.length === 0) throw new Error("全部 serie 链为空（serie 可能已滚动）");

  // bars 间歇性失败（GC 常见）：打日志并当轮重试一次，不再静默吞错
  let bars1m = cleanBars(raw?.bars);
  if (bars1m.length === 0) {
    console.warn(`  [${product}] bars1m 为空（${raw?.barsError ?? "无错误信息"}），重试一次…`);
    try {
      const retry = await wbEvaluate(EVAL_FETCH_BARS.replaceAll("__FUT__", futuresSymbol));
      if (retry?.text) bars1m = cleanBars(retry.text);
      if (bars1m.length === 0) {
        console.warn(`  [${product}] bars1m 重试仍为空（${retry?.error ?? "未知"}）`);
      }
    } catch (e) {
      console.warn(`  [${product}] bars1m 重试异常: ${e.message}`);
    }
  }

  return {
    symbol: futuresSymbol,
    quote: quotes[futuresSymbol],
    quotes,
    expiries,
    series: outSeries,
    bars1m,
    stats,
  };
}

async function collectOnce(seriesByProduct) {
  const products = {};
  const errors = [];
  for (const [product, futuresSymbol] of Object.entries(PRODUCTS)) {
    try {
      const series = seriesByProduct[product];
      if (!series) throw new Error("无 serie 清单");
      products[product] = await collectProduct(product, futuresSymbol, series);
      const p = products[product];
      console.log(
        `[${new Date().toISOString()}] ${product}: spot=${p.quote.lastPrice} serie=${p.series.length}条(${p.stats.join(" ")}) K线=${p.bars1m.length}根`,
      );
    } catch (err) {
      errors.push(`${product}: ${err.message}`);
      console.error(`[${new Date().toISOString()}] ${product} 抓取失败:`, err.message);
    }
  }
  if (Object.keys(products).length === 0) {
    throw new Error(`全部产品失败：${errors.join(" | ")}`);
  }

  const res = await fetch(TARGET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "barchart-webbridge",
      capturedAt: Date.now(),
      intervalSec: INTERVAL_SEC,
      products,
    }),
  });
  if (!res.ok) throw new Error(`ingest HTTP ${res.status}: ${await res.text()}`);
  const ack = await res.json();
  console.log(`[${new Date().toISOString()}] 已推送 accepted=${ack.accepted?.join(",")}`);
}

let serieCache = null;
let serieCacheDate = null; // 内存缓存的 UTC 日期（跨天必须重读下拉：周期权每日滚动）
let lastEmptyRefreshAt = 0; // 空链触发的清单刷新限频（最多 1 次/小时）
let emptySeriesThisRound = [];
let failStreak = 0;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function refreshSerieList() {
  console.log(`[${new Date().toISOString()}] 刷新 serie 清单（逐个产品读期权页下拉 + 逐 serie 页抓到期真值）…`);
  const map = {};
  for (const [product, futuresSymbol] of Object.entries(PRODUCTS)) {
    try {
      map[product] = await fetchSerieList(product, futuresSymbol);
      // 逐 serie navigate 抓 "N Days to expiration on MM/DD/YY" 真值。
      // 只在清单刷新时做（每天一轮），navigate 慢可接受；失败的 serie 走启发式兜底。
      for (const s of map[product]) {
        s.truth = await scrapeSerieTruth(s);
        if (!s.truth) console.warn(`  ${product} ${s.code} 真值抓取失败，本轮用启发式兜底`);
      }
      console.log(
        `  ${product}: ${map[product].map((s) => `${s.code}=${s.truth?.date ?? "?"}`).join(", ")}`,
      );
    } catch (err) {
      console.error(`  ${product} serie 清单失败:`, err.message);
    }
  }
  if (Object.keys(map).length === 0) throw new Error("serie 清单获取全部失败");
  serieCache = map;
  serieCacheDate = todayUtc();
  saveSerieCache(map);
}

async function tick() {
  try {
    if (!serieCache) {
      serieCache = loadSerieCache();
      serieCacheDate = serieCache ? todayUtc() : null;
    }
    // 内存缓存跨天失效：到期日滚动后旧周期权会下架，必须重读下拉
    if (!serieCache || serieCacheDate !== todayUtc()) await refreshSerieList();
    emptySeriesThisRound = [];
    try {
      await collectOnce(serieCache);
    } catch (err) {
      // 链全空 → serie 滚动，立即刷新清单重试一次
      if (/serie|链为空/.test(err.message)) {
        console.log("serie 疑似过期，刷新清单重试…");
        await refreshSerieList();
        emptySeriesThisRound = [];
        await collectOnce(serieCache);
      } else {
        throw err;
      }
    }
    // 个别 serie 链为空（多发生在到期滚动窗口）→ 限频刷新清单，下轮生效
    if (emptySeriesThisRound.length > 0 && Date.now() - lastEmptyRefreshAt > 3_600_000) {
      lastEmptyRefreshAt = Date.now();
      console.log(`空链 serie：${emptySeriesThisRound.join(", ")}，刷新 serie 清单以备下轮…`);
      try {
        await refreshSerieList();
      } catch (refreshErr) {
        console.error("serie 清单刷新失败：", refreshErr.message);
      }
    }
    failStreak = 0;
  } catch (err) {
    failStreak += 1;
    console.error(`[${new Date().toISOString()}] 本轮失败（连续 ${failStreak} 次）:`, err.message);
  } finally {
    const backoff = Math.min(INTERVAL_SEC, 60 * 2 ** failStreak);
    const wait = failStreak === 0 ? INTERVAL_SEC : backoff;
    console.log(`[${new Date().toISOString()}] 下次抓取 ${wait}s 后`);
    setTimeout(tick, wait * 1000);
  }
}

console.log(`Barchart 采集器 v3：周期 ${INTERVAL_SEC}s，目标 ${TARGET_URL}`);
void tick();
