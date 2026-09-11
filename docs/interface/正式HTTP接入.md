# 正式期权 HTTP 接入

> **2026-09-10 重写**：原版写于接入前，其中"`/options/intraday`、`/options/chain`、`/options/term` 当前 404"已不成立 —— 三者实测均返回 200。
> 接口细节、字段与实测数据以 **`Go后端接口清单.md`** 为准，本文只讲接入形态与状态。

服务地址由服务端环境变量 `OPTIONS_API_BASE_URL` 指定（当前 `https://mws.marsoon.cn`）。浏览器只访问本项目 `/api/options/*`，既不跨域也不接触服务端令牌。

## 1. 接入形态

```
浏览器 ──/api/options/*──> Next.js BFF ──/options/*──> Go 服务(Databento → ClickHouse)
   └──/api/auth/*────────>                 ──/auth/*、/client/activity、/ws──>
```

- BFF = `src/server/go-options.ts`（`upstream()`）：按接口分级超时、10s 进程内 LRU 缓存、统一错误清洗。
- 唯一模式直连 Go 只读接口（2026-09-11 起 `OPTIONS_API_MODE`/legacy 本地合成分支已删除，`options-live-model.ts` 一并移除；空态一律由 Go 的 `has_data`/`missing_reason` 裁决）。

## 2. 接口 × 面板 × 状态（2026-09-10 实测）

| 面板 / 用途 | 前端入口 | 后端接口 | 状态 |
|---|---|---|---|
| 01 总览 | `/api/options/dashboard` | `/options/dashboard` | ✅ 有数据 |
| 05 到期热力图 | 同上（读 `heatmap.cells`） | `/options/dashboard` | ✅ 0DTE 361 cells / d90 1894 |
| 06 日内变化 | `/api/options/intraday` | `/options/intraday` + `/options/underlying-bars` | ✅ K线 1380 根 + levels 1315 条 |
| 07 微笑偏斜 | `/api/options/dashboard`、`chain` | `/options/dashboard` | ✅ cells 带 `call_iv` / `put_iv` |
| 08 GEX 拆分 | `/api/options/dashboard` | `/options/dashboard` | ✅ |
| 09 期权链 | `/api/options/chain` | `/options/chain` | ✅ 376 档；`last`/`oi`/`volume` 多为 null |
| 10 月间价差 · PCR | `/api/options/term` | `/options/term` | ✅ 7 个到期点；`iv_official` 恒 null |
| IV 期限（历史） | `/api/options/iv-term?date=` | `/options/dashboard?asof=` | ✅ 走历史快照 |
| 关键位时序 | `/api/options/levels` | `/options/levels` | ✅ 但响应 3.4MB、耗时可达 107s |
| 0DTE 成交量分布 | `/api/options/volume-profile` | `/options/0dte-volume-profile` | ✅ 区间大时超时 |
| 全站数据状态 | `/api/options/status` | `/options/status` | ✅ |
| 实时 K 线 | `/api/auth/candles-ws` 换票 | `wss://…/ws?token=` | 未实测 |
| 收盘档（close） | 同 01 / 05 | `/options/dashboard?scope=close` | ⚠️ `state: partial`，多数空态 |

## 3. 周期（scope）映射

前端四档 `close / 0dte / d30 / d90`，后端 `backendOptionScope()` **原样透传、不做折叠**（d30/d90 不会被压成 all）—— 这正是旧版"d30/d90 显示成全期限"问题的修复点。

后端另有 `all` / `nearest`，仅供 Rust 终端与旧客户端；Main 不查询、不展示。旧本地布局里的 `all/RTH` 加载时迁移为 `d90`（`board-window-store.ts`）。

## 4. 仍然存在的缺口

| 缺口 | 表现 | 归属 |
|---|---|---|
| 收盘档不完整 | `close_references` 三品种均 `state: partial` | 后端 EOD 发布 |
| 官方 IV 无源 | `iv_official` 恒 null（Databento statistics 不发布结算 IV） | 无解，UI 应隐藏该线而非显示 0 |
| 链字段大量 null | `last` / `oi` / `volume` / `change` | 后端原始行情层待补 |
| 响应超时 | levels 24h 达 107s，撞 BFF 12s 硬超时 | 后端查询优化 + BFF 超时分级 |
| 状态灯误导 | 前端曾轮询已删除的旧采集状态端点 | ✅ 已改为 Go 派生的 `/api/options/version`（`features/options/data-freshness.ts`） |

## 5. 口径红线（沿用，未变）

- `put_gex` 已带负号：`net_gex = call_gex + put_gex`，任何一层不得重复反号。
- 热力图到期汇总只代表**返回价格窗口**内的量，不是全市场总量；总览 GEX 保留服务端 `market_state` 原值。
- 重复行取同合约、同到期日、同执行价下的**最新快照**，不跨快照累加 OI。
- `summary.visible_*` 是窗口内口径，`market_state` 是 scope 全量口径，二者不可混用。

## 6. 验证

```bash
pnpm lint                 # tsc --noEmit
pnpm dev                  # http://127.0.0.1:4173
node --test scripts/      # 各 test-*.mjs 契约测试
```

接口级复现命令见 `Go后端接口清单.md` §11。
