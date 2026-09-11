# Go 期权后端接口清单（实测版）

> 整理日期：2026-09-10。本文以**线上实测响应**为依据，不是设计稿。
> 服务地址：`.env.local` 的 `OPTIONS_API_BASE_URL`（当前 = `https://mws.marsoon.cn`）。
> 上游数据源：后端响应 `source` 字段原值 = **`databento-go`**，模型版本 `model_version = black76-oi-flow-v4`。
> 浏览器永不直连本服务：Next.js 的 `/api/options/*`、`/api/auth/*` 是唯一出口，令牌只存在于服务端环境变量与 HttpOnly Cookie。

相关文档：`正式HTTP接入.md`（接入现状）、`../architecture/数据开发.md`（口径红线与面板映射）、`../backend/Go期权API对接与改进方案.md`（设计源头，部分已实施）、`登录与会话.md`（鉴权链路）。

---

## 0. 一页速览

| 域 | 接口 | 方法 | 实测 | 前端入口 |
|---|---|---|---|---|
| 鉴权 | `/auth/otp` | POST | 未实测（会发邮件） | `/api/auth/otp` |
| 鉴权 | `/auth/verify` | POST | 未实测 | `/api/auth/verify` |
| 鉴权 | `/auth/refresh` | POST | 未实测 | `/api/auth/session` |
| 鉴权 | `/auth/session` | GET | `401`（无 token，符合预期） | `/api/auth/session` |
| 留存 | `/client/activity` | POST | 未实测 | `/api/auth/activity` |
| 行情 | **`/options/status`** | GET | ✅ 200 · 31KB | `/api/options/status`、BFF 解析 underlying |
| 行情 | **`/options/dashboard`** | GET | ✅ 200 · 0DTE 185KB / d90 882KB / close 905KB | `/api/options/dashboard`、`/api/options/iv-term` |
| 行情 | **`/options/levels`** | GET | ✅ 200 · **3.4MB**（24h@300s） | `/api/options/levels` |
| 行情 | `/options/heatmap` | GET | ✅ 200 · 168KB，**`cells` 恒空** | 仅 legacy 回退路径 |
| 行情 | **`/options/intraday`** | GET | ✅ 200 · 359KB | `/api/options/intraday` |
| 行情 | **`/options/underlying-bars`** | GET | ✅ 200 · 146KB（24h@60s） | `/api/options/intraday?bars_only=true` |
| 行情 | **`/options/chain`** | GET | ✅ 200 · 281KB | `/api/options/chain` |
| 行情 | **`/options/term`** | GET | ✅ 200 · 1.8KB | `/api/options/term` |
| 行情 | **`/options/0dte-volume-profile`** | GET | ✅ 200 · 2h 区间 228KB | `/api/options/volume-profile` |
| 实时 | **`/ws`** | WS | 未实测（需 access token） | `/api/auth/candles-ws` 换票后直连 |

⚠️ 全部 200，但**响应时间极不稳定**（同一接口 0.8s ~ 107s），见 §9。

---

## 1. 通用约定

### 1.1 服务端配置（`src/server/go-options.ts`）

| 环境变量 | 作用 | 当前值 |
|---|---|---|
| `OPTIONS_API_BASE_URL` | 后端地址 | `https://mws.marsoon.cn` |
| `OPTIONS_API_TOKEN` | 可选，存在时加 `Authorization: Bearer` | 未设置 |
| `AUTH_SESSION_SECRET` | 会话 Cookie 的 HMAC 密钥 | 已设置 |

BFF 行为（写死在 `upstream()`）：

- **超时 12s**（`AbortSignal.timeout(12000)`）→ 超时即抛 `Go 期权服务无法连接或请求超时`。
- **进程内缓存 10s**，key = 完整 URL，LRU 上限 64 条。
- 非 JSON 响应 → 报错；HTTP 404 → 视为"接口尚未提供"，`unavailableEndpoint` 静默返回空态。
- 响应经 `sanitizePublicData` 清洗后才给浏览器：**`source` 会被重写为 `market-data`**（正则命中 `databento`/`go` 等内部词），UI 上看不到真实源名。这是刻意的公开文案边界。

### 1.2 公共参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `product` | `NQ` / `ES` / `GC` | 前端 `params()` 强校验，大写 |
| `scope` | `close` / `0dte` / `d30` / `d90` | 前端四档。后端另有 `all` / `nearest` 供 Rust/旧客户端使用，**Main 不用** |
| `underlying` | 如 `NQU6` | 具体期货合约。不传时 BFF 先用 `/options/status` 解析出最新 `underlying_symbol` 再回带 |
| `from` / `to` | Unix **秒** | 语义 `[from, to)` |
| `timeframe` | 秒，60 的倍数 | levels 前端校验 `tf >= 60 && tf % 60 === 0` |
| `window_pct` | 如 `0.12` | dashboard/heatmap 的 strike 窗口（±12%） |

### 1.3 共享响应元数据

每个行情响应顶部都带（实测字段）：

```
source          string   "databento-go"（浏览器侧被改成 "market-data"）
has_data        bool     是否有数据
data_notice     string   口径提示（中文），如"当前数据为已采集范围…"
schema_version  number   当前恒为 1
product / scope / asof / snapshot_unix / horizon_days / window_pct
model_version   string   "black76-oi-flow-v4"
quality_flags   number   位掩码，见 §8
```

`close_reference`（仅 `scope=close` 与 `/options/status` 有）：

```
{ sessions: [{ underlying, opened_at, closed_at, source }],
  trade_date, reference_unix, valuation_unix, known_at,
  calendar: "CME-ES-NQ-GC-2026", state: "ready" | "partial", missing_reason }
```

---

## 2. `GET /options/status` — 全站数据状态

**参数**：无（BFF 每次都全量拉，再按 product 过滤）。

**响应**

```jsonc
{
  "checked_at": 1789042740,
  "source": "databento-go",
  "poll_interval_sec": 60,
  "close_references": {
    "NQ": { "trade_date": "2026-09-09", "reference_unix": …, "valuation_unix": …,
            "known_at": …, "calendar": "CME-ES-NQ-GC-2026",
            "state": "partial", "missing_reason": "目标结算日仅部分输入可用，请结合覆盖率和质量标记" }
    // ES、GC 同构
  },
  "entries": [ /* 75 条 */ ]
}
```

`entries[i]`（**状态行 = 快照索引**，前端靠它定位"最新快照时间戳"）：

```
unix, product, underlying_symbol, expiration, scope, underlying_price,
net_gex, gross_gex, net_delta_notional, gross_delta_notional,
net_charm_notional, gross_charm_notional,
quote_coverage, regime, source_unix, quality_flags, model_version
```

**要点**

- `entries` 混有多个 scope：`0dte` / `d30` / `d90` / `all` / `nearest` / `close`，还有**按合约逐条**的（如 `NQU6|NQZ6|NQH7|NQM7` 各自一行，expiration=0）。前端 `allowedStatusEntry` 会过滤。
- BFF 的两处用法：① `resolvedUnderlying()` 取最新 `underlying_symbol`；② `latestStatusUnix()` 取某 scope 的最新快照 unix，用作 dashboard 回退锚点。
- 实测 `close_references` 三品种均为 `state: "partial"`，即**收盘档尚未完整就绪**。

---

## 3. `GET /options/dashboard` — 单快照总览（最核心）

**参数**：`product` `scope` `days` `window_pct` `current=true` `underlying` `asof?`

- `days`：0DTE 默认 1、d30 默认 30、d90 默认 90、`close`/其它 45。
- `asof`：历史快照时间戳（Unix 秒）。**`/api/options/iv-term?date=` 就是靠它做历史回放**（取芝加哥当日 16:00）。

**响应（实测 4 层）**

```
market_state   → 单条 MarketState（见 §7.1），scope 级聚合
summary        → 同快照的窗口内汇总（含 expected_move_upper/lower、visible_* 系列）
levels[43]     → PriceLevel[]（见 §7.2），当前快照的关键位（rank 1/2/3…）
expiries[N]    → 按到期聚合：strike_count、call/put oi、put_call_oi_ratio、
                 call/put gex、net/gross gex、delta/charm notional、
                 atm_iv、expected_move_upper/lower、observed_min/max_unix、quality_flags
heatmap        → { observed_min_unix, observed_max_unix, cells[M], levels[K] }
```

- `heatmap.cells`：0DTE 361 条、d90 1894 条、`close` 1892 条。单条结构见 §7.3。
- `heatmap.levels`：逐到期的 PriceLevel（0DTE 88 条、d90 297 条）。
- `summary` 独有的 `visible_*` 前缀 = **窗口内口径**（受 `window_pct` 裁剪），与 `market_state` 的 scope 全量口径**不是一回事**，不能混用。`summary` 在 0DTE 还多一个 `zero_dte_gross_gex_share`。
- `scope=close` 时额外有 `close_reference`（见 §1.3），`data_notice` 变为"官方结算基准；估值时间为模型约定…"。

**BFF 的回退链**（`dashboard()`）：

1. 带 `asof` 直读；
2. 无 `asof` 且 `scope=close` → 若 `snapshot_unix` 不是"前一交易日 EOD"则返回空态"前一交易日收盘数据尚未就绪"；
3. 首次读空 → 用 `latestStatusUnix(product, scope, allowNearestFallback=false)` 拿同 scope 最新快照再读一次（**刻意不用 `nearest` 顶替 0DTE**）；
4. `legacy` 模式才落到 `/options/heatmap` + 本地 `composeDashboard`。

---

## 4. `GET /options/levels` — 关键位 / 状态时序

**参数**：`product` `scope` `from` `to` `timeframe` `underlying` `strict_underlying=true`

**响应**

```
{ from, to, timeframe, product, scope, underlying, close_reference: null,
  states[265],   // MarketState[] —— 每个时间桶一条
  levels[11369]  // PriceLevel[]  —— 每个桶 × 每个 metric × 每个 rank
}
```

**⚠️ 体积警告**：`from=now-24h, to=now, timeframe=300` 实测 **3,410,665 字节（3.4MB）**，且耗时曾达 **107s**。这是全站最大的响应。前端请求 `levels` 时把窗口收窄（≤6h）或提高 `timeframe`，否则必然撞 BFF 的 12s 超时。

**BFF 约束**（`levels()`）：`to - from ≤ 93 天`、`timeframe` 为 60 的倍数且 ≥60、`from > 0`、`to > from`。

---

## 5. `GET /options/intraday` / `/options/underlying-bars`

### 5.1 `/options/intraday`

**参数**：`product` `scope` `from` `to` `asof` `underlying`

**响应**

```
{ product, scope, source, day: "2026-09-10", has_data, snapshot_unix,
  underlying_symbol, missing_reason,
  bars[1380],   // Bar[]（见 §7.4）
  levels[1315], // PriceLevel[]
  current: { captured_at, spot, call_wall, put_wall, gamma_flip, atm_iv, expected_move }
}
```

BFF 组合逻辑（`intraday()`）：

- `bars_only=true` 时**跳过**本接口，只读 `/options/status` + `/options/underlying-bars`（06 面板先画 K 线的快路径）。
- 本接口没给 bars 时，自动用 `/options/underlying-bars` 补齐（`attachAvailableCandles`）。
- `current` 缺失时，用 `currentFromDashboard()` 从 dashboard 的 `market_state`/`summary`/`levels` 合成。
- 时间范围由快照时间反推：`from = snap-86400`、`to = snap+3600`。

### 5.2 `/options/underlying-bars`

**参数**：`product` `underlying` `from` `to` `timeframe`

**响应**

```
{ product, underlying_symbol, timeframe, from, to, has_data, source,
  bars[1380] }   // 24h@60s
```

`bars[0]` 实测：`{ unix, open, high, low, close, volume, final }`。

---

## 6. `GET /options/chain` / `/options/term` / `/options/0dte-volume-profile` / `/options/heatmap`

### 6.1 `/options/chain` — 期权链（09 面板）

**参数**：`product` `scope` `series_id?` `expiration?` `underlying`

**响应**

```
{ source, product, scope, has_data, snapshot_unix, selected_expiration, data_notice,
  series[1] → { code, series_id, label, kind, weekday, expiration,
                days_to_expiration, futures, underlying_price, strikes },
  chain → { 同上 + multiplier, atm_iv, call_wall, put_wall, gamma_flip,
            key_gamma_strike, max_pain, expected_move_upper/lower, rows[376] } }
```

`series_id` 格式为 `NQU6|<expiration>|Q2DU6`（标的|到期|系列代码），实测 `kind: "unknown"`、`weekday: null`。

`rows[i]` 实测（**C/P 分离、字段可空**）：

```jsonc
{ "strike": 20500,
  "call": { "raw_symbol": "Q2DU6 C20500", "bid": 8707, "ask": 8761, "last": null, "mid": 8734,
            "iv": 3.65, "delta": 0.9995, "gamma": 4.9e-7, "theta": -2535.4, "vega": 1.358,
            "gex": null, "oi": null, "volume": null,
            "prev_close": 8947.75, "change": null, "change_pct": null,
            "is_settlement": false, "iv_fallback": false,
            "quote_unix": 1789042620, "last_trade_unix": 0 },
  "put":  { …同构… } }
```

要点：`last`/`change`/`change_pct`/`oi`/`volume`/`gex` 大量为 `null`；`prev_close` 有值但 `change` 为 null → **涨跌幅需前端自算或显示 `--`**。`data_notice`："成交量为已采集分钟合计；历史覆盖需核实。涨跌幅基准为前交易日结算价。"

BFF：本接口空时，`composeChainFromDashboard()` 用 dashboard 数据组装降级链；`scope=close` 直接返回"暂无完整的收盘数据"。

### 6.2 `/options/term` — 期限结构 / PCR（10 面板）

**参数**：`product` `scope`

**响应（实测仅 1.8KB）**

```jsonc
{ source, product, scope, has_data, snapshot_unix, underlying_symbol, portfolio: false,
  bcr:        { buy_contracts, sell_contracts, unknown_contracts, ratio },
  iv_spread:  { front, back, spread, inverted },
  expiry_points[7]: { dte, expiration, iv_official: null, pcr_oi, pcr_vol },
  serie_points[7]:  { dte, expiration, atm_iv, label: "NQU6 09-10" },
  data_notice: "PCR/BCR使用已采集成交量，日内覆盖待核实；IV为Black-76自算。" }
```

**`iv_official` 恒为 `null`** —— 与 `../backend/Go期权API对接与改进方案.md` §5.2 的结论一致（Databento statistics 不发布结算 IV），ATM IV 全是 Black-76 自算。前端 `term()` 在 `iv_official` 与 `pcr_*` 全空时会退化到 dashboard 的 `expiries` 映射，并标注"IV / PCR 来自看板到期汇总"。

### 6.3 `/options/0dte-volume-profile` — 0DTE 逐档成交量

**参数**：`product` `from` `to` `underlying`

**响应**：`{ base_timeframe: 60, from, to, product, scope, rows[N] }`

`rows[i]`（**逐分钟 × 逐执行价**）：

```
unix, product, underlying_symbol, expiration, strike,
call_buy_contracts, call_sell_contracts, call_unknown_contracts,
put_buy_contracts,  put_sell_contracts,  put_unknown_contracts,
call_trades, put_trades, source_unix, model_version
```

**⚠️ 体积随区间线性膨胀**：2 小时 = 673 行 / 228KB / 32s；24 小时直接超过 110s 未完成。BFF `optionVolumeProfile()` 会做两级回退（快照窗口 → 逐日往前找 7 天），并把行按 strike 聚合成 `call_volume`/`put_volume`。

### 6.4 `/options/heatmap`（legacy 专用）

**参数**：`product` `days` `window_pct` `underlying`

实测返回 `{ asof, product, window_pct, horizon_days, close_reference: null, cells: [], levels[593] }` —— **`cells` 恒为空数组**。只有 `levels` 有值。

即：**该接口的 cells 能力事实上已废弃**，热力图 cells 一律走 `dashboard.heatmap.cells`。前端/BFF 已无任何调用方（legacy 回退分支 2026-09-11 已删除），仅 BFF 保留一条超时配置作订单流足迹图页面跳转专用标记。

---

## 7. 共享数据结构

### 7.1 MarketState（状态行，`market_state` / `levels.states` / `status.entries` 同构）

```
unix, product, underlying_symbol, expiration, scope, underlying_price,
call_oi, put_oi, atm_iv, expected_move, reference_expiration,
net_gex, gross_gex, net_delta_notional, gross_delta_notional,
net_charm_notional, gross_charm_notional,
call_wall, put_wall, key_gamma_strike, key_delta_strike, gamma_flip,
quote_coverage, regime, source_unix, quality_flags, model_version
```

`regime` 枚举实测：`negative_gamma` / `positive_gamma` / `balanced_gamma`。

### 7.2 PriceLevel（`levels[]` / `dashboard.levels[]` / `heatmap.levels[]` 同构）

```
unix, product, underlying_symbol, expiration, scope,
metric, rank, level, value, underlying_price,
source_unix, quality_flags, model_version
```

**⚠️ `level` 是价位，`value` 是指标强度**，二者不可互换（历史 bug 点，`../backend/Go期权API对接与改进方案.md` §3.3）。

`metric` 实测取值：`call_oi_wall`、`put_oi_wall`、`call_gex_wall`、`put_gex_wall`、`positive_gex_wall`、`negative_gex_wall`、`gamma_flip`、`zero_gamma`、`call_wall`、`put_wall` 等；`rank` 从 1 起。

### 7.3 heatmap.cells[]

```
unix, product, underlying_symbol, expiration, strike, underlying_price,
call_iv, put_iv, call_oi, put_oi,
call_gex, put_gex, net_gex, gross_gex,
net_delta_notional, gross_delta_notional,
net_charm_notional, gross_charm_notional, quality_flags
```

注意：**没有 `volume` 字段**。任何把成交量画进热力图的需求都取不到数（需另接 volume-profile）。

### 7.4 Bar（`intraday.bars[]` / `underlying-bars.bars[]`）

```
unix, open, high, low, close, volume, final
```

---

## 8. `quality_flags`（位掩码）

前端目前只消费一位：`QUALITY_MISSING_OI = 1 << 2`（`features/board/expiration-heatmap-model.ts:54`），用途是"OI 为 0 且该位置位时按缺失处理，不画 0"。

实测出现过的数值：`0`、`2`、`16`、`1280`、`1792`。**后端尚未提供权威位定义文档**，这是当前最大的契约空白 —— 建议向后端索取 `quality_schema` 位表并补进本文。

已知的口径红线（沿用 `../architecture/数据开发.md` §3）：`quality_flags` 是位掩码不是枚举，**不可跨引擎混用位值**。

---

## 9. 已知问题与风险（按严重度）

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| 1 | **响应耗时极不稳定** | 同一 `/options/levels` 请求：curl 三次得 1.5s / 0.8s / 11.9s，另一次 107s；`/options/dashboard?scope=close` 50s | BFF 硬超时 12s → 前端随机 502 空态 | 后端加查询索引/物化；BFF 超时按接口分级（levels 放宽到 60s） |
| 2 | **`/options/levels` 响应 3.4MB** | 24h×300s 实测 | 超 `../architecture/技术架构.md` §3.4 的 100KB 预算 34 倍 | 前端缩小窗口；后端支持分页或按 metric 过滤 |
| 3 | **Node `fetch` 比 curl 更容易挂死** | 同一 URL：curl 1.5s 成功；Node 连续 4 次 25s 超时 | 本地 dev 与线上 BFF 都可能卡死 | 排查 undici 与后端（Caddy/Go）的连接复用；BFF 侧加单次重试 |
| 4 | `/options/heatmap` 的 `cells` 恒空 | 实测 `cells: []` | legacy 回退分支拿不到热力图 | 清理 legacy 分支，或让后端补 cells |
| 5 | `iv_official` 恒 null | term 实测 | 10 面板"官方 IV"线画不出来 | 已确认 Databento 无源，UI 应隐藏该线而非显示 0 |
| 6 | `chain.rows` 的 `last`/`change`/`oi`/`volume` 大量 null | 实测 | 09 面板多列空白 | 后端补原始行情层；前端保持 `--` 不降级为 0 |
| 7 | `close` 档仅 `state: partial` | status 实测三品种皆 partial | 收盘档面板多数空态 | 等后端 EOD 完整发布 |
| 8 | `source` 被前端改写为 `market-data` | `sanitizePublicData` | 排障时看不到真实源 | 内部调试用直连 curl，不要只看浏览器 |
| 9 | ~~全站状态灯误导~~ | 前端曾轮询一个已无数据的本地采集状态端点 | 状态灯长期灰 | ✅ 已修（2026-09-10）：该端点与徽标组件整体删除，失效驱动改为 `/api/options/version` |
| 10 | ~~本仓残留非 Go 数据链路~~ | 采集器/内存仓/本地 Greeks 模块与 ingest 路由可被误用 | 误导后来者 | ✅ 已修（2026-09-10）：相关代码与文档已全部删除 |

---

## 10. 数据来源单一化（2026-09-10 完成）

本仓**只保留 Go 期权服务一个数据来源**。此前存在的本地采集链路（采集脚本、快照内存仓、
本地 Greeks/分析模块、采集推送与状态路由、状态徽标组件）已于 2026-09-10 全部删除，
代码与文档中零残留；数据新鲜度改由 Go 派生的 `GET /api/options/version` 驱动。
2026-09-11 起 `OPTIONS_API_MODE` 与 legacy 本地合成分支（`options-live-model.ts` 等）亦已删除，BFF 唯一模式 = 直连 Go。

> 任何新增数据源都必须先与本节的"单一来源"原则对齐。

---

## 11. 复现命令

```bash
B=https://mws.marsoon.cn
NOW=$(date +%s); FROM=$((NOW-86400))

curl -s "$B/options/status"
curl -s "$B/options/dashboard?product=NQ&scope=0dte&days=1&window_pct=0.12&current=true&underlying=NQU6"
curl -s "$B/options/levels?product=NQ&scope=0dte&from=$FROM&to=$NOW&timeframe=300&underlying=NQU6&strict_underlying=true"
curl -s "$B/options/underlying-bars?product=NQ&underlying=NQU6&from=$FROM&to=$NOW&timeframe=60"
curl -s "$B/options/chain?product=NQ&scope=0dte&underlying=NQU6"
curl -s "$B/options/term?product=NQ&scope=d30"
curl -s "$B/options/0dte-volume-profile?product=NQ&from=$((NOW-7200))&to=$NOW&underlying=NQU6"
```

`underlying` 不传也可以，但传了更快（少一次 status 往返 + 避免跨合约串数据）。当前各品种主力合约从 `/options/status` 的 `scope=0dte` 行读取。

需要登录后才能从浏览器侧验证时，可用 `AUTH_SESSION_SECRET` 自签 `marsoon_session` cookie 直接打本地 `/api/options/*`（HMAC-SHA256，`payload.sig`），省去邮箱验证码。
