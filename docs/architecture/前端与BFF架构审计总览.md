# 前端与 BFF 架构审计总览

> 创建：2026-09-10 深夜（原名《传输链路与频率总览》，第五轮起更名）。本文是**前端 / Next.js BFF 架构审计的单一真源**：传输链路与频率（§一~§五）、架构遗漏（§六）、参数速查（§七）、数据形态（§八）、端点全景（§九）、Bug 优先修复清单（§十一）。全部为代码级 + 线上实测口径。
> 最近复核：2026-09-11 第五轮（登录鉴权 / Dockview 窗口生命周期 / 跨窗联动 / 06 数据合流四路深挖）——新增 P0×5 / P1×16 / P2×21 + §六 #26-#29。逐轮记录见文末附录。
> **修复状态（2026-09-11）：§十一 P0 全部 11 项已修复**（备份 `_backup/2026-09-11_0201_p0-fixes/`）；**P1 24 项已修复 22 项**（备份 `_backup/2026-09-11_0242_p1-fixes/`，P1-8 因 undici 不可解析跳过、P1-22 因 Go 无注销端点待供应商，逐条记录见附录）；**local-demo 残骸已全部清除**（备份 `_backup/2026-09-11_1349_local-demo-purge/`，含死代码 `useOptionsIntraday`、`go-options-adapter.ts` 删除）；**legacy 双模式已收敛为直连 Go 唯一模式**（备份 `_backup/2026-09-11_1405_legacy-purge/`，`OPTIONS_API_MODE`/`options-live-model.ts`/`eod-freshness.ts` 删除，记录见附录），正文涉及历史现状的描述保留作审计档案，以本条为准。
> 决策依据：架构完整性与频率机制决定后续所有修复与优化的方向。
> 配套：接口细节见 [`../interface/Go后端接口清单.md`](../interface/Go后端接口清单.md)；
> 待供应商确认项见 [`../backend/WS与增量协议待确认清单.md`](../backend/WS与增量协议待确认清单.md)。

## 一、三层结构 + 三条数据通道（拓扑）

```
┌─ 浏览器 ──────────────────────────────────────────────┐
│  查询群（8 类 hook）· 版本比对器（30s）· WS 客户端（1Hz 渲染） │
└──────────┬──────────────────────────┬────────────────┘
           │① 版本轮询 30s · 0.6KB     │② REST 范围查询
           ▼                          ▼
┌─ Next.js BFF（127.0.0.1:4173，只代理不产数据）──────────┐
│  代理与清洗 · 响应缓存 10s · 超时分级 10~35s · 版本聚合     │
└──────────┬──────────────────────────┬────────────────┘
           │① → /options/status       │② → /options/*
           ▼                          ▼            └→ /options/underlying-bars（K线）
┌─ Go 服务器（mws.marsoon.cn:443，唯一数据源）────────────┐
│  Databento 拉取 → ClickHouse → Black-76 计算 → 快照输出   │
└──────────────────────────────────────────────────────┘

③ WS 实时通道：浏览器 ⇄ Go 直连，绕过 BFF（BFF 仅换票一次）
   wss://…/ws?token= · stream:4 · 1min K线 · 推送频率待确认
   重连 1s→30s 指数退避 · 看门狗 150s 静默（+120s 冷却 / 30s 巡检）
```

Go 快照生产节奏（实测）：0DTE **60 秒** · 30D/90D **300 秒** · 收盘 **每日一次**（Chicago 16:00 后）。

## 二、通道参数（三条数据通道 + 一条辅助通道）

| # | 通道 | 协议与路径 | 发起方 | 频率 | 单次体积 | 超时/重连 |
|---|---|---|---|---|---|---|
| ① | 版本轮询（脏检查） | HTTP `GET /api/options/version` → Go `/options/status` | 前端定时器（BoardView 全局挂载一次，窗口数不放大） | 30s，**仅标签页可见时**（后台暂停，回前台聚焦立即补拉；`staleTime` 10s，同 key 去重） | ~0.6KB | BFF 10s |
| ② | REST 范围查询 | HTTP `GET /api/options/*` → Go `/options/*` | 五个驱动见 §四·B | 见 §四 | 1.8KB~3.4MB | BFF 10~35s（错配见 §十一） |
| ③ | WS 实时 | `wss://mws.marsoon.cn/ws?token=`（浏览器直连 Go） | 服务端推送 | 待确认（≥1 条/60s） | 每条 1min bar | 重连 1s→30s，看门狗见 §六 #3；**每个 06 窗口一条连接**（§十一 P0-3） |
| ④ | 活动上报（非行情） | HTTP `POST /api/auth/activity`（BFF 取 HttpOnly Cookie 后代理 Go，浏览器只发 event_id） | AppShell 全局 Reporter | 每次页面加载（AppShell 挂载）强制一次 + 回前台（距上次 ≥30min）+ 网络恢复补发；隐藏态不上报；上报前先取 `/api/auth/session` 刷新临期 token；多标签页有重复上报竞争（§十一 P1-6） | <0.3KB | 失败 30s 后重试，pending event_id 幂等（localStorage） |

WS 消息形态：JSON 信封 `{stream, data(base64), request_id}`，载荷 `{pair.symbol, timeframe, values[]}`；
前端硬校验 `stream===4`、`timeframe===60`、symbol 匹配，**带 `request_id` 的帧一律显式丢弃**（getrange 历史回补不消费）。

## 三、Go 快照生产节奏（实测）

Main 消费口径只有 4 档：`close` / `0dte` / `d30` / `d90`。`nearest`、`all` 是 Go 侧为 Rust 终端与旧 API 保留的兼容条目，**Main 不查询、不展示**，但 `latestStatusUnix` 与合约回填会读取 `nearest`（`go-options.ts:97-116`、`intraday-candles.ts:84`）。

| scope | 更新周期 | 实测体积 | TTFB |
|---|---|---|---|
| `0dte`（Go 侧含 `nearest`） | 60s | dashboard 185KB | 2~6s |
| `d30` / `d90`（Go 侧含 `all`） | 300s | dashboard d90 882KB | 2~6s |
| `close` | 每日（Chicago 16:00 后） | 905KB | ~50s（原 > BFF 25s 超时必超时；**已修复：close 不打上游恒空态，§十一 P0-2**） |
| levels **线上窗口 1h @300s** | 随请求现算 | 见 §四 | 0.8~30s |
| levels 排查期 24h（非线上） | 随请求现算 | 3.4MB | 1.5s~107s |
| chain / intraday | 随快照/请求 | 281KB / 359KB | — |

## 四、前端请求源 × 频率（代码级）

| 请求源 | 端点 | 频率 | 参与版本失效 |
|---|---|---|---|
| version 轮询 | `/api/options/version` | 30s 固定 | 基准（自身不失效） |
| dashboard | `/api/options/dashboard` | 版本失效触发 | 是 |
| levels | `/api/options/levels`（1h @300s） | 版本失效触发 | 是 |
| chain | `/api/options/chain` | 版本失效触发 | 是 |
| term | `/api/options/term` | 版本失效触发（Multi 版 `refetchInterval:false`） | 是 |
| volume-profile | `/api/options/volume-profile` | 60s 固定 + 版本失效 + **key 每分钟漂移**（三重驱动，§十一 P1-5） | 是 |
| **iv-term** | `/api/options/iv-term` | 60s 固定（当前日期）；历史日期 `staleTime:Infinity`——只挡聚焦/重连重取，**挡不住版本失效 invalidate**（invalidate 无视 staleTime，历史对比曲线同样随版本被重拉） | 是 |
| K线整窗 | `intraday?bars_only` | 稳态仅首次（`staleTime:Infinity`，聚焦/网络恢复重取天然无效）；缺口 >30min 的 WS 重连/看门狗补拉会**重打整窗**（142KB / ~17s，HTTP 路径结果只增不减；跨交易日例外见 §五；空响应抹历史缺陷 **已修复 P0-1**） | 否（已退出） |
| K线尾部 | `bars_only` 尾 30min | 60s（3.3KB / <1s）；**已修复 P0-8：休市与历史回看（offsetDays>0）停轮询**（修复前休市时 BFF 回退 7 天历史分支返回上一交易日全天 ~1379 根） | 否 |
| 水位明细 | `intraday?options_only` | 300s（`useOptionsIntradayMulti`） | 否 |
| WS K线 | `wss` 直连 | 后端推送 → 1Hz 渲染合并 | — |

死代码清理（2026-09-11 已执行一部分）：前端 `useOptionsIntraday`（60s 单 scope 轮询版）与 BFF `src/server/go-options-adapter.ts`（102 行）已随 local-demo 清除一并删除；剩余待清理：`useOptionsTerm`（单 scope 版）全仓零调用点、前端 `src/features/options/OptionsDashboard.tsx` + `components/dashboard-panels.tsx` 整链无路由（含第二个 `useSnapshotSync` 挂载点，见 §六 #16）。
注（2026-09-11 已清除）：dashboard/levels/chain/term 单 scope 版原有的"仅 `source==="local-demo"` 才 60s 定时"兜底分支已全部删除——local-demo 造数机制 2026-09-10 移除后该分支恒不命中（纯死代码），刷新现纯靠版本失效驱动 + 调度器节奏，本地零定时器。

### 四·B 五个失效驱动

一次 HTTP 拉取可能由以下任一驱动触发，排查"为什么又在请求"时必须五个都查：

| 驱动 | 触发条件 | 覆盖范围 | 代码 |
|---|---|---|---|
| ① 版本失效 | `version.v` 变化 | 全部查询，**排除** version 自身与 `options-intraday` 族；失效标记 active+inactive，实际重拉仅 active（挂载中）查询 | `data-freshness.ts:99-103` |
| ② 固定节奏 | 各 hook 的 `refetchInterval` | 仅该 hook（VP 60s、iv-term 60s、尾部 60s、水位 300s）；除 iv-term 外均显式 `refetchIntervalInBackground:false`（iv-term 未显式设置，v5 默认同为 false，行为等价），后台全部暂停 | 各 hook |
| ③ **窗口聚焦重取** | 切回标签页/窗口 | 全局默认，`staleTime`(30s) 已过的查询全部重取 | `providers.tsx:13` |
| ④ 失败保险丝 | 存在 `status==="error"` 的查询 | 每次版本轮询（30s）重试**这些**查询（含 `options-intraday` 族，仅排除 version 自身），非全量；**对返回 200 空态的哑火端点无效（§十一 P1-1）** | `data-freshness.ts:83-89,105-107` |
| ⑤ 网络恢复重取 | 断网恢复在线 | v5 默认 `refetchOnReconnect:true`，`staleTime` 已过的查询重取（含 version 自身） | react-query v5 默认（providers 未关） |

另：全局默认 `retry: 1`（`providers.tsx:12`），单次失败会自动再打一次，等于最坏 2 倍请求量。
后台标签页内 ①②⑤ 均暂停/不触发（v5 默认 `refetchIntervalInBackground=false`）；后台唯一持续活跃的是 WS 连接本身（§六 #5）。
③ 与 ① 存在确定性双波叠加（回前台先聚焦全量重取、版本比对后再 invalidate 全量重取一遍），见 §十一 P1-4。
**注意**：② 对 Dockview 非活动 tab 窗口同样生效——隐藏窗的轮询与 WS 全部照跑（§十一 P1-9）。

## 五、运行原理：两条链路的每一分钟

**链路 A — 结构数据（负载大头）**：
Go 0DTE 快照（60s）→ `version.v` 变化 → 前端 ≤30s 轮询发现 → **广播 invalidate（K线族除外）**
→ dashboard/levels/chain/term/VP/iv-term 六类查询并发重拉（惊群，无闸门）→ Go 重新序列化 185KB~3.4MB × 窗口数。
d30/d90 每 300s 走同一条链；多品种 × 多窗口叠加时全环节按乘数放大。

**链路 B — K线（已解耦）**：
WS 推 1min bar（频率待确认）→ 缓冲合并 1Hz → `series.update` 增量画最新 bar
→ HTTP 兜底：尾部 30min 窗口每 60s（3.3KB）；整窗 142KB 稳态仅首次（`staleTime:Infinity`），断线缺口 >30min 时重连/看门狗补拉会回退整窗。
**跨交易日例外**：`historyDays===1` 且新旧 bar 间隔 >6h 时，WS 合并清空全部旧历史重来（`candle-stream.ts:68` `resetClosedDay`）——"结果只增不减"仅限同一交易日内成立。
**历史缺陷（已全部修复）**：整窗补拉"空响应不抹历史"守卫写反（P0-1，已修）；换月/参考合约场景整窗永不重拉卡死错误合约（P0-7，已修：符号漂移触发整窗重锚）；休市期间尾部+看门狗双轮询不停摆（P0-8，已修：`isCmeSessionOpen` 门控）。

## 六、架构遗漏点清单（按修复杠杆排序）

| # | 遗漏点 | 现状 | 影响 | 修复方向 | 归属 |
|---|---|---|---|---|---|
| 1 | 版本失效是全局广播 | v 一变失效除 K线族外全部，不区分 product/scope | NQ 出快照重拉 GC 全部查询；多品种多窗 = 负载平方级；冻结窗也被 0dte 的 60s bump 重拉 | 按 entries 的 (product,scope) 精确失效 | 纯前端 |
| 2 | 双驱动冲突 | volume-profile 60s 定时 + 版本失效并存（第四轮发现第三驱动：key 每分钟漂移，§十一 P1-5） | 同一数据三套触发 | 三合一，key 归一化后只留版本失效 | 纯前端 |
| 3 | WS 无心跳无对账 | 无 ping/pong、无序列号 | 半开连接靠 150s 静默才发现；**最坏滞后 ≈180s**（150s 静默 + 30s 巡检，另叠加 120s 冷却） | 供应商确认心跳；缺口 ≤5min 只拉尾部 | 后端 |
| 4 | 版本变化瞬间惊群 | 8+ 查询同时发出，BFF 无并发闸门；另有开机挂载惊群（§十一 P1-10） | 后端被打满，K线被排队 | 失效后错峰 200ms 或 BFF 闸门 | 前端/BFF |
| 5 | 页面隐藏时 WS 仍连 | 只停了 HTTP 失效 | 后台标签页白耗流量 | 可接受，暂不动 | — |
| 6 | BFF 缓存几乎只做去重 | 10s 共享 promise；**任何 >10s 间隔的轮询必然 miss 直穿 Go**（30s/60s/300s 全部中招），失败立即删条目，>64 淘汰最旧；**在飞去重对慢请求也失效（§十一 P1-2）** | 缓存对降负载贡献≈0，只剩惊群合流 | key 归一化到分钟粒度；按接口分级 TTL；until 从完成后起算 | BFF |
| 7 | 传输编码全链裸奔 | Go 无压缩无 ETag；BFF→浏览器也不压 | 142KB~3.4MB 原样传（1~39KB/s） | 供应商 P0 gzip；BFF 可自加 compression | 后端优先 |
| 8 | 交易日边界机制薄 | `cmeTradingDayKey` 覆盖 CME 17:00 CT 换日与周末，分钟级轮询 | 换日瞬间靠 60~300s 节奏自然覆盖，无显式事件 | 可接受，暂不动 | — |
| 9 | 后台期版本号被吞 | `document.hidden` 时仍写 `lastVersion` 后 return；但后台轮询本就暂停（v5 默认），v 在后台被吞只剩"网络恢复触发 version 补拉"窄路径 | 常规"挂后台→回前台"由 ③聚焦重取补拉比对（staleTime 10s 已过），不漏失效；残余影响小 | 可接受；根治可回前台比对一次本地快照 | 纯前端 |
| 10 | **`SCOPE_REFRESH_SEC` 死代码** | 全仓零引用，且仍含已废除的 `all/nearest` key | 误导后续维护者以为存在按 scope 的节奏控制 | 删除，或改为 Go status 实测值的只读注释 | 纯前端 |
| 11 | **`heatmap` 超时项（订单流足迹图专用，保留）** | `go-options.ts` `UPSTREAM_TIMEOUT_MS` 有 `/options/heatmap` 25s；BFF 无该路由（legacy dashboard 合成路径 2026-09-11 已删，现无任何代码可达）——**为跳转到订单流足迹图页面专用保留，后续不再改动** | 无（不参与线上链路，纯配置保留） | 维持现状，专用保留 | — |
| 12 | 全局 `retry:1` 无差别 | 失败自动重打一次 | 上游抖动时请求量翻倍，与 #4 惊群叠加 | 慢接口（levels/intraday）改 `retry:0` 或加退避 | 纯前端 |
| 13 | **status 前置依赖** | `fixedOptionUnderlying` 恒空 → `resolvedUnderlying` 必打 `/options/status`（status 无 symbol 时的 levels 兜底已于 2026-09-11 随 legacy 删除），除 version 外几乎每个请求隐含 +1 次（10s 共享缓存去重） | status 实测 0.7~5.6s，串行在主请求之前；status 慢时全链路等它 | **已缓解（2026-09-11）**：`resolvedUnderlying` 已加 5min 会话缓存（成功才缓存） | BFF |
| 14 | **BFF 内嵌 dashboard** | intraday（**非 bars_only 且非 close 的全部请求**，`go-options.ts:248`）、volume-profile、iv-term 每次请求在 BFF 内部再打一次完整 `/options/dashboard`；非 bars_only 且 bars 为空时还会二次扇出（snap±窗口 重打 intraday + 重跑 K线扇出，见 §九） | VP 60s、水位 300s、iv-term 60s 都周期性连带 185KB 级 dashboard 重算重传（10s 缓存内共享），与 #1 惊群叠加 | `latestSnapshot` 改用 status 便宜锚点，或内嵌 dashboard 加 30~60s 二级缓存 | BFF |
| 15 | **`go-options-adapter.ts` 死代码** | 整文件 102 行（adaptDashboard/adaptLevels/adaptIntraday 等）全仓零引用 | 与线上链路无关，易被误读为适配层仍在生效 | **已删除（2026-09-11 local-demo 清除波）** | BFF |
| 16 | **死代码含第二挂载点**（第四轮） | `src/features/options/OptionsDashboard.tsx` + `components/dashboard-panels.tsx` 整链无路由，内含第二个 `useSnapshotSync` 挂载点 | 若路由复活：v5 下双计时器轮询 + 双份 invalidate 广播 + 双份保险丝扫描 | 删除整链（与 #10/#15 同类） | 纯前端 |
| 17 | **dashboard key 按 `days` 碎片化**（第四轮） | 05 用 `days:1/90`、01/06/07/08 用 `days:20`，同 (product,scope) 最多 3 份缓存/3 次拉取，互不去重 | 每次版本 bump 重复拉 185KB 级快照，多品种线性放大 | 05 front 由 days=20 响应前端截取，统一 key | 纯前端 |
| 18 | **K线 structuralSharing 浪费 + 缓存无护栏**（第四轮） | WS 1Hz `setQueryData` 对 1400~10000 根 bar 全树 diff ×窗口数；gcTime 默认 5min，dashboard 各 days 变体峰值驻留估算 10~18MB | CPU 浪费、内存无上限 | bars key 设 `structuralSharing:false`；dashboard `gcTime` 降 60~120s | 纯前端 |
| 19 | **07 窗 chain 兜底并行双流量**（第四轮） | chain 查询 error → dashboard 兜底并行；保险丝 30s 重试 chain 与兜底拉取双份流量，且掩盖 missing_reason（`panel-wrappers.tsx:222-228`） | outage 期间流量翻倍、用户看不到真实失败原因 | 兜底加冷却或与 chain 错误状态互斥 | 纯前端 |
| 20 | **status 路由黑名单式清洗**（第四轮） | `sanitizePublicData` 只处理 5 个 MESSAGE_KEYS；`sourceStatus` 原样透传 Go status 全部字段（`data-messages.ts:26-27`、`go-options.ts:483-484`） | Go 新增诊断字段（last_error/host 等）即原样泄露给浏览器，违反公开文案边界 | status 路由改白名单字段映射 | BFF |
| 21 | **sanitize 全量深拷贝放大**（第四轮） | `sanitizePublicData` 每次响应 O(n) 重建对象；10s 缓存共享的是上游对象而非清洗结果，惊群时 N 个并发请求各自深拷贝同一 882KB~3.4MB | CPU 尖峰与 #4 惊群叠加 | 清洗结果随缓存共享，或改为就地掩码 + 结构性复用 | BFF |
| 22 | **candles-ws 明文 token 入 URL**（第四轮） | access token 直接拼进 wss query（`candles-ws/route.ts:21-23`），无一次性、无短时效；长连接期间 token 过期无校验 | token 出现在代理/服务端日志；安全契约缺陷；logout 无法撤销（§十一 P1-22 叠加） | 供应商改一次性 ticket 制（列入待确认清单） | 供应商 |
| 23 | **legacy 判定不对称 + 覆盖不一致**（第四轮，低） | `unifiedAPI() = mode !== "legacy"`，值写错即静默走错分支；dataVersion/term/chain 无 legacy 分支 | 回退 legacy 时全 404 空态无报警 | **已关闭（2026-09-11 legacy 模式整体删除，`unifiedAPI()` 不复存在）** | BFF |
| 24 | **`params()` 缺省静默兜底**（第四轮，低） | 无 product/scope 参数静默按 NQ/0dte 处理（`go-options.ts:85`）而非 400 | 调用方配置错误无感知 | 缺参返回 400 | BFF |
| 25 | **`asof` 前端死参数**（第四轮，低） | `getOptionDashboard` 的 asof 在前端 hook 链路从未被传入、也未进 key | 误导维护者以为前端支持历史点查询 | 标注或删除 | 纯前端 |
| 26 | **`cme-session.ts` 助手死代码 + 双实现**（第五轮，低） | `isCmeSessionOpen`/`candleHistoryRange`/`structureSnapshotAsof` 全仓零引用（`src/lib/cme-session.ts:67,93,101-108`）；`cmeTradingDayKey` 存在两份逐字相同实现（`cme-session.ts:21` vs `trading-day-refresh.ts:15`） | P0-8（休市轮询）的修复件已存在却没人接线；双实现有漂移风险 | 修复 P0-8 时启用 `isCmeSessionOpen`；`historyRange` 改调 `candleHistoryRange`；删一份 `cmeTradingDayKey` | 纯前端 |
| 27 | **`intraday-frame.ts` 死代码**（第五轮，低） | `layoutIntradayFrame`/`frameOk` 全仓零引用——06 已迁 Lightweight Charts，四栏几何真源废弃 | 与线上渲染无关，易被误读 | 删除（与 #15 同类） | 纯前端 |
| 28 | **teaching-content 静态文件未保护**（第五轮，信息项） | `public/teaching-content/*.html` 不在 proxy matcher（`proxy.ts:23-33`）；`/teaching` 壳受保护、iframe 内容裸露 | 教学内容若定位公开则无问题 | 确认意图，需保护则加 matcher | 待确认 |
| 29 | **文档口径漂移登记**（第五轮） | AGENTS.md「🔗解耦 chip / 总控多选（至少 1 个）/ 窗内自治上限 3」与代码现状（chip 无 UI 入口、总控周期 UI 整体消失、`WINDOW_SCOPES_MAX=4`）漂移；`docs/interface/登录与会话.md:9`「每 4 分钟检查会话」无任何实现 | 按文档改代码会改错方向 | 修 P1-13/P1-14 时同步 AGENTS.md 与 `docs/frontend/周期架构迭代开发文档.md`；补实现或删文档承诺 | 文档 |

## 七、BFF 层参数速查

| 参数 | 值 | 位置 |
|---|---|---|
| 上游超时（完整） | status 10s / term 15s / dashboard·chain 25s / levels·intraday·underlying-bars·0dte-volume-profile 35s / **其余默认 20s**；**错配与串行时延复利见 §十一** | `go-options.ts:36-47` |
| 专用保留项 | `/options/heatmap` 25s（订单流足迹图页面跳转专用，后续不再改动） | `go-options.ts:41` |
| 整体覆盖 | `OPTIONS_UPSTREAM_TIMEOUT_MS`（options 链路）；auth 链路 16s 硬编码无配置项（§十一 P2-4） | 环境变量 / `auth-bff.ts:45` |
| 响应缓存 | 10s 共享 promise，key = 完整 URL（含时间戳的请求永不命中）；失败即删；>64 淘汰最旧；TTL 从发起时计，慢请求在飞 11s 后去重失效（§十一 P1-2）；缓存对象存在原地改写（§十一 P1-3） | `go-options.ts:49-82` |
| levels 窗口约束 | `to - from ≤ 93 天`、timeframe 为 60 的倍数且 ≥60 | `go-options.ts:184` |
| version 聚合 | 同一 (product,scope) 只保留最新 unix | `go-options.ts:498-512` |
| version 轮询 | `refetchInterval` 30s / `staleTime` 10s | `data-freshness.ts:49-50` |
| K线整窗 | `staleTime: Infinity`（聚焦/网络恢复重取对其天然无效，"稳态仅首次"的另一半机制；也是 P0-7 卡死的帮凶） | `use-options-intraday.ts:73` |
| 全局重试 / 聚焦 / 恢复 | `retry: 1` / `refetchOnWindowFocus: true` / `refetchOnReconnect: true`（v5 默认未关）；各 hook `refetchIntervalInBackground: false` | `providers.tsx:12-13` |
| Abort 传递 | 前端→BFF 全量 queryFn 透传 signal（OK）；**BFF→Go 断链，request.signal 全仓零接线**（§十一 P0-4） | `go-options.ts:61` |
| WS 换票 | `/api/auth/candles-ws`：会话 Cookie → access token → 拼 wss URL；每次（重）连前先串行取 `/api/auth/session` 再换票（`use-options-intraday.ts:165-167`）；明文 token 入 URL（§六 #22） | `candles-ws/route.ts` |
| 交易日 key | CME 17:00 CT 换日，周末归到周五，分钟级本地轮询；**存在两份实现**（§六 #26） | `trading-day-refresh.ts` |

## 八、数据形态（消费侧视角）

| 域 | 形态 | 说明 |
|---|---|---|
| K线（HTTP） | 1min OHLCV，单根 `{unix,o,h,l,c,v,final}` ≈109B | 无 tick 字段，间隔严格 60s；24h ≈1379 根 |
| K线（WS） | 同 1min bar + 主/被动量拆分（vbuy/vsell/vunknown，前端求和为 volume） | 源头可能逐笔聚合，下发已是聚合 bar |
| 水位 levels | 逐分钟/5 分钟快照序列 | 前端 `intraday.levels[]` 现无消费方（只用 current） |
| dashboard | 整快照（支持 asof 取历史点；**asof 前端为死参数，§六 #25**） | 185KB~905KB 整包 |
| iv-term | 按到期日的 ATM IV 点集（可叠加历史日期曲线） | 历史曲线 `staleTime:Infinity`，但仍随版本失效被 invalidate 重拉（见 §四） |

## 九、BFF→Go 端点全景与扇出

| BFF 路由 | Go 上游 | 备注 |
|---|---|---|
| `/api/options/version` | `/options/status` | 过滤 `allowedStatusEntry`（fixed 恒空 → 恒直通），按 (product,scope) 取最大 unix |
| `/api/options/dashboard` | `/options/dashboard`（+ 回退 `/options/status`） | 0DTE 空时**只回退同 scope**，不用 `nearest` 覆盖；close 有 `isCurrentPreviousEod` 守卫且异常吞成 200 空态（§十一 P0-2/P1-1） |
| `/api/options/levels` | `/options/levels` | 默认 1h@300s；窗口上限 93 天 |
| `/api/options/chain` | `/options/chain`（空则回退 dashboard 合成；合成失败吞成 200 空，§十一 P1-1） | close 直接返回空态，不打上游 |
| `/api/options/term` | `/options/term`（无 IV 则回退 dashboard expiries，0DTE 可升级到 d90） | close 直接返回空态，不打上游 |
| `/api/options/intraday` | `/options/intraday`（+ `/options/underlying-bars`；非 bars_only 且非 close 时内嵌一次 dashboard） | `bars_only` 跳过期权计算，只走 status + underlying-bars；非 bars_only 且 bars 为空时二次扇出：snap±窗口 重打 `/options/intraday` + 重跑 K线扇出（`go-options.ts:277-283`），全量 intraday 最坏 2× intraday + 2× K线扇出；多条失败路径吞成 200 空（§十一 P1-1） |
| `/api/options/volume-profile` | `/options/0dte-volume-profile`（+ 内嵌 dashboard） | 三级回退：原窗 → 快照窗 `snap-24h ~ +1h` → 逐日回退最多 7 天（offset 0..7，共试 8 个 session 窗）；**窗口已钳制 ≤2h（P0-5 已修复**，修复前全天窗常态超 35s 超时），钳制时响应带 `window_clamped:true`；首读失败吞成 200 空且无 missing_reason（§十一 P1-1） |
| `/api/options/iv-term` | 本地 `iv-term-model`（GET 内部直调 `dashboard()`，URL 一致时与结构面板共享 10s 缓存——带 `?days=`/`?asof=` 的请求 URL 不同不共享） | 非纯代理，BFF 侧建模；客户端 20s < 内嵌 25s 错配（§十一 P0-4 连带项） |
| `/api/options/status` | `/options/status` | 诊断用；黑名单式清洗，`sourceStatus` 全字段透传（§六 #20） |
| —（无路由） | `/options/heatmap` | **订单流足迹图页面跳转专用，保留不再改动**；legacy 合成路径 2026-09-11 已删，现无任何代码可达（仅 `UPSTREAM_TIMEOUT_MS` 一条配置保留） |

**隐含上游依赖**：上表"1 次前端请求 = 1 次主上游调用"之外还有三类常量附加——
① **status 前置 +1**：dashboard/levels/chain/intraday（含 bars_only）都先经 `resolvedUnderlying` 打一次 `/options/status`（fixed 恒空 → 永不短路；仅 unified 模式；同 URL 10s 共享缓存去重）；status 无 symbol 时再 +1 次 `/options/levels`（0dte 1h 窗兜底，`go-options.ts:102`）；
② **dashboard 内嵌**：intraday（非 bars_only 且非 close）、volume-profile、iv-term 每次在 BFF 内部再打一次完整 `/options/dashboard`（185KB 级；10s 缓存内可与结构面板共享）；
③ **session 前置**：WS 每次（重）连前、活动上报每次发送前，各先串行取一次 `/api/auth/session`。

**K线扇出**：一次 `bars_only` 请求在 `attachAvailableCandles` 内最坏可打 **8 次 `/options/underlying-bars` + 1 次 `/options/status`**：
自身合约 1 次 → 空则读 `/options/status` 取最多 3 个候选合约各试 1 次 → 仍空且窗口 ≤2 天时，7 天历史窗再试自身 1 次 + 3 个候选各 1 次（`intraday-candles.ts:96-118`）。
bars_only 默认 1 天窗必然进入历史分支，周末/假日收盘后最坏路径是常态而非例外。此外 bars_only 入口 `resolvedUnderlying` 还有 1 次 status（`go-options.ts:237`，与扇出内 status 同 URL，靠 10s 共享缓存去重）。因此"整窗只拉一次"指的是**前端请求次数**；上游调用数最坏 9，缓存全未命中时可达 10。
**串行时延**：以上全部串行 await，handler 无总时限——bars_only 最坏 status 10s + 8×35s ≈ 290s；全量 intraday 叠加二次扇出可超 400s（§十一 P1-7）。
**休市放大（已修复 P0-8）**：修复前休市时尾部 60s 与看门狗 ~150s 双轮询不停摆，每次都触发 7 天历史分支（响应为上一交易日全天 ~1379 根而非空包）+ 上述扇出——周末单标签页 ≈3.3 万次上游调用/600MB 下行；现尾部轮询与看门狗补拉均由 `isCmeSessionOpen` 门控，休市停发。

## 十、复现与验证

- 接口级 curl 复现命令：`../interface/Go后端接口清单.md` §8（含 `underlying-bars` 与 status）。
- 前端频率核对：本文件 §四 + §四·B 五个驱动，逐项对照 hook 的 `refetchInterval` / `staleTime` / 全局默认。
- 修改本文任一口径时，必须同步 `AGENTS.md` 项目速览与 `../interface/Go后端接口清单.md` 的对应行，避免三处漂移；第五轮新登记的漂移项见 §六 #29。
- 第三轮（2026-09-11）起，内嵌 dashboard 范围（全部非 bars_only 非 close 的 intraday 请求）、VP 第三级回退窗口数（offset 0..7 共 8 个）、iv-term 历史曲线仍随版本失效重拉，以本轮修正后口径为准；已核对 `AGENTS.md` 项目速览与接口清单（接口清单 §levels 93 天上限、§volume-profile 回退 7 天的表述与本文一致），无对应行需要同步。

## 十一、Bug 优先修复清单（第四轮新增，第五轮扩充）

全部为本仓（前端 / Next.js BFF）可修，**Go 服务端无需改动**。按严重度排序，P0 建议按序立即修复。

### P0 — 高严重度

> **状态：11 项全部已于 2026-09-11 修复**（备份 `_backup/2026-09-11_0201_p0-fixes/`；顺带修复 P2-15/P2-24；逐条修复记录见附录）。下表保留原始发现作审计档案。

| # | Bug | 证据 | 影响 | 修复方向 | 归属 |
|---|---|---|---|---|---|
| P0-1 ✅ | **K线"空响应不抹历史"守卫写反一半** | `use-options-intraday.ts:64-70`：`if (!previousBars?.length \|\| !payload.bars?.length) return payload;`——previous 有数据而 payload 为空时直接整包替换缓存 | 看门狗整窗补拉恰逢上游瞬时降级 → 图表历史被清空（正是 2026-09-10 声称已修 bug 的残留路径） | 先判 `if (!payload.bars?.length) return previous ?? payload;` | 前端 |
| P0-2 ✅ | **close dashboard 必超时 + 吞成 200 空态** | 实测 TTFB ~50s > dashboard 超时 25s（`go-options.ts:39`）；close 异常被 catch 返回 200 `emptyDashboard`（`go-options.ts:150-160`） | 每个 close 请求等满 25s 后返回 200 "尚未就绪"（文案错误，实为超时）；前端不进 error，保险丝哑火；close 版本号每日才变，空态锁死约一天 | close 档不打上游直接空态（与"close 恒空态"口径一致）或超时放宽 ≥60s；catch 区分"未就绪"与"上游失败" | BFF |
| P0-3 ✅ | **WS 每窗口一条连接，无共享池** | `useOptionsCandleStream` 是普通 effect hook，每个 06 窗口挂载即 `new WebSocket`（`use-options-intraday.ts:172`），同品种 N 窗口 = N 条 wss、相同 subscribe 帧、重复推送、双份 1Hz merge 写同一 key；每次（重）连各自串行 session+换票（`:165-167`） | N 窗口重连 = 2N 次串行 HTTP + N 条退避各自为政；服务端重启后连接风暴 | 按 symbol 做模块级连接单例 + 引用计数（最后窗口卸载才 close），订阅去重，recover 补拉仍写各窗口自己的 key | 前端 |
| P0-4 ✅ | **BFF→Go abort 断链** | 全仓 `request.signal` 零接线；`upstream()` 只挂 `AbortSignal.timeout`（`go-options.ts:61`） | 浏览器取消/卸载/iv-term 20s 放弃后，BFF 继续从 Go 拉完 185KB~3.4MB 至超时（串行路径数分钟）；占 undici 连接与缓存槽；客户端重试在 10s TTL 外再打一遍，同一数据 Go 算两遍。**一修同时解 iv-term 20s<25s 错配** | route handler 把 `request.signal` 透传进 `upstream()`，与超时 `AbortSignal.any` 合并 | BFF |
| P0-5 ✅ | **VP 线上全天窗常态超 35s 超时** | 上游 24h 实测 >110s 未完成（接口清单 §volume-profile）；BFF 超时 35s（`go-options.ts:45`）；线上 from/to 取自 K线首末根，全天窗≈24h 是常态（`panel-wrappers.tsx:357-358`） | 常规窗口常态打满 35s 后失败，且失败被吞成 200 空（P1-1） | BFF 侧窗口切片/限制 ≤2h（2h 实测 32s 贴边），或前端只传近 2h 窗 | BFF/前端 |
| P0-6 ✅ | **session 刷新并发无单飞，可误登出** | 临期（<300s）走 `/auth/refresh`（`session/route.ts:9-20`）；多 WS 客户端 + ActivityReporter 可同时触发，同一 refresh_token 并发刷新 | 若 Go 旋转 refresh token，后到者 401 → `clearAuthCookies`（`:39-41`）→ 用户被误登出 | BFF 侧 refresh 加单飞（in-flight promise 复用） | BFF |
| P0-7 ✅ | **换月/参考合约后 K线永久卡死错误合约**（第五轮） | 符号守卫静默丢批（`candle-stream.ts:62-63`）+ WS 合并无条件清参考标记（`:82`）+ 整窗 `staleTime:Infinity` 永不重拉（`use-options-intraday.ts:73`）+ WS 订阅锚定缓存符号（`panel-wrappers.tsx:309-314`） | 整窗回落参考合约后，本合约恢复交易也并不回来（尾部丢批、WS 还在订 REF、整窗不重拉）；图上画着参考合约价格却不显示"参考合约"提示；本会话内永久卡死，只能重挂载 | 守卫改为"符号不同且本合约有新 bar 时触发整窗 refetch 换锚"；WS 合并不清 `candle_is_reference`；符号变化纳入整窗失效条件 | 前端 |
| P0-8 ✅ | **休市期间 K线双轮询不停摆**（第五轮） | 尾部 60s 与看门狗 ~150s 无休市门控（`use-options-intraday.ts:86-95,206-214`）；休市时 BFF 落 7 天历史分支返回上一交易日全天 ~1379 根（`intraday-candles.ts:96-106`）+ 8+1 扇出；`isCmeSessionOpen` 已存在但零调用（§六 #26） | 周五 16:00 → 周日 17:00 CT 的 49h 内：尾部 ~2940 次 + recover ~1176 次 ≈ **3.3 万次上游调用 / 600MB 下行每标签页**，N 客户端线性放大；每日 16:00-17:00 CT 间歇也有 ~12 次整窗重打 | 尾部轮询与看门狗 recover 用 `isCmeSessionOpen` 门控（休市停发、开盘恢复）；recover 对"缺口源于休市"不补拉 | 前端 |
| P0-9 ✅ | **布局自动存档自触发无限循环**（第五轮，两路审计独立发现） | `BoardDock.tsx:103` 裸订阅 store → `saveLayout` → `capturePayload` 内 `store.prune()`（`board-dock-layout.ts:85`）→ prune **无条件 `set({windows})`** 恒新对象（`board-window-store.ts:559-567`）→ 再触发订阅 → 300ms 后循环 | 每次打开 /board 起，主线程每 300ms 一次 `api.toJSON()` 全树序列化 + `JSON.stringify` + 同步 `localStorage.setItem`（10~50KB），**整个会话永不停止**；防抖名存实亡；多标签页叠加成持续互写 | prune 前比较存活 id 集合无变化不 set；或订阅改 `subscribeWithSelector`；capturePayload 去副作用（prune 移到关窗事件） | 前端 |
| P0-10 ✅ | **proxy 只验签不续期：access 过期即看板永久 401**（第五轮） | `proxy.ts:8-16` session cookie 过期即 401/重定向，不看 refresh cookie；前端对 401 零特判（`api/options.ts:423-432`）；`登录与会话.md:9` 承诺的"每 4 分钟检查会话"无实现（§六 #29） | session cookie 过期后所有 `/api/options/*` 被 proxy 提前 401，到不了能 refresh 的 session 路由；查询进 error、保险丝重试仍 401；挂机不切后台、WS 不断线时**没有任何链路触发 refresh**，看板永久错误态 | proxy 在 session 失效但 refresh cookie 存在时尝试 refresh；或前端 fetch 层遇 401 先调 `/api/auth/session` 再重试一次；补回周期 session 检查 | BFF/前端 |
| P0-11 ✅ | **Go 宕机/超时 → 全站误登出且销毁 refresh token**（第五轮） | `session/route.ts:14-42`：refresh 失败（**任何原因**）→ access 校验同样失败 → `401 + clearAuthCookies`；`auth-bff.ts:46-48` 把网络异常/超时一律包成 502，路由不区分"凭证无效"与"上游不可达" | Go 一次临时抖动/重启，所有临期 session 调用的用户被清掉全部 cookie **包括仍有效的 refresh token**，无法自愈必须重新 OTP 登录；与 P0-6 机制不同可独立触发 | 仅 refresh/access 校验返回 401/400 时才清 cookie；5xx/网络错误返回 503 保留 cookie 让客户端重试 | BFF |

### P1 — 中严重度

> **状态：24 项中 22 项已于 2026-09-11 修复**（备份 `_backup/2026-09-11_0242_p1-fixes/`；P1-8 跳过——undici 不可解析且未加依赖，由 P1-7 的 60s 总预算兜底；P1-22 待供应商——Go 无注销端点；顺带修复 P2-7/P2-15/P2-24/P2-27；逐条修复记录见附录）。下表保留原始发现作审计档案。

| # | Bug | 证据 | 影响 | 修复方向 | 归属 |
|---|---|---|---|---|---|
| P1-1 ✅ | **失败被吞成 200 空态的端点清单**（保险丝对这些端点永久哑火） | close dashboard 任意异常（`go-options.ts:150-160`）；VP 首读任意错误（`:318`，empty 对象**连 missing_reason 都没有**，`:305-308`）；bars_only `resolvedUnderlying` 失败（`:237-240`）、K线读取失败降级 `candle_notice`（`:243-245,274-276`）、`latestSnapshot`/`latestStatusUnix` 全吞（`:118-120,200-202`）；chain 合成回退失败（`:397-401`） | 上游故障表现为"无数据"而非"错误"；保险丝不重试、运维无感知；同端点 200 空态与 502 随机出现（VP 首读吞错而回退抛错，`:323,333` 未包 try） | 统一：上游失败 → 5xx；数据真空 → 200 + `has_data:false` + `missing_reason` | BFF |
| P1-2 ✅ | **缓存在飞去重对慢请求失效** | `go-options.ts:58` 只认 `until > Date.now()`，TTL 10s 从发起时计；慢请求 TTFB 25~35s | 飞到第 11s 起同 URL 新请求 miss 并发起第二个并发上游调用——"惊群合流"在最需要它的慢路径上不成立 | `until` 从完成后起算，或在飞期间不设 TTL 上限 | BFF |
| P1-3 ✅ | **缓存对象被原地改写** | `go-options.ts:288-294`（`underlying_symbol ??=`、`candle_notice =`）在缓存原对象上直接写字段；`attachAvailableCandles` 可原样返回入参（`intraday-candles.ts:68,72`）；与 `data-messages.ts:29` 注释承诺相反 | 并发消费者读到被其他请求改写的字段；不同 underlying 的并发 intraday 请求互相污染 | 返回前浅拷贝再写字段 | BFF |
| P1-4 ✅ | **聚焦 + 版本失效确定性双波** | 回前台：③聚焦重取先把全部 stale 查询拉一遍 → 版本查询（staleTime 10s）同刻重取发现 v 变 → invalidate **无视刚拉取的新鲜度**再全量拉一遍（`providers.tsx:13` + `data-freshness.ts:98-103`） | 后台期间只要有新快照，回前台 = 全量查询打两遍（默认布局 ~10 条，重度布局 30+ 条） | invalidate 跳过 `dataUpdatedAt` 距今 <10s 的查询；或 version 查询关 `refetchOnWindowFocus` 由轮询自然发现（滞后 ≤30s） | 前端 |
| P1-5 ✅ | **VP queryKey 每分钟漂移** | key 含 `from,to`（`use-option-volume-profile.ts:7`），`to` 由 K线末根推导（`panel-wrappers.tsx:356-359`），每合并一根新 bar key 就变 | 每分钟一个新查询：旧 key 驻留 5min（常态 ~5 份/窗口）、60s refetch 实为全新查询使 `staleTime` 形同虚设、版本失效去重语义失效、双 historyDays 窗口零去重 | key 归一化（只含 product，range 移到 queryFn 内部读取）；与 §六 #2 合并修 | 前端 |
| P1-6 ✅ | **多标签页活动上报竞争** | 每标签页各挂 Reporter，挂载即 `report(true)` 不看 30min 阈值（`ClientActivityReporter.tsx:66`）；pending event 的 localStorage 读-改-写无原子性（`client-activity-state.ts:16-27`） | 开 N 个标签 = N 次上报；两标签页并发各生成不同 UUID → 服务端按 event_id 幂等失效，同刻记多条活动；先完成方还会抹掉后写方的 pending | 挂载强制上报前重读 `lastReportedAt`，短窗口（60s）内已有他页上报则跳过；pending 用"写后重读校验 id"乐观锁 | 前端 |
| P1-7 ✅ | **handler 无总时限 + 客户端无超时** | 超时是单次上游调用粒度（`go-options.ts:61`），handler 内全串行：bars_only 最坏 ≈290s、VP 回退循环最坏 ≈370s、全量 intraday 可超 400s；`getOptionsApi` 无超时（`src/api/options.ts:401`，iv-term 除外） | 浏览器请求挂起数分钟且不进 error，保险丝不管、用户无反馈 | handler 级总预算（如 60s）超限提前返回空态 + `missing_reason`；前端加兜底超时 | BFF/前端 |
| P1-8 ⏭️跳过 | **连接池排队吃掉超时预算** | 裸用全局 fetch（undici 默认池，每 origin 连接数有上限，本仓未配置）；`AbortSignal.timeout` 从 fetch 调用即计时 | 惊群 8+ 并发时超限请求在池内排队，排队时间计入 35s 预算，慢时段超时率非线性上升 | 配置 dispatcher（提高 `connections` 或按接口分池） | BFF |
| P1-9 ✅ | **Dockview 非活动 tab 窗口保活，查询/WS 照跑**（第五轮） | dockview 8.2 默认 `onlyWhenVisible` 只拆 DOM，React portal 常驻保活（`BoardDock.tsx:114-120` 未覆盖）；各 hook 无可见性门控 | 10 窗布局切 tab 后，不可见窗的 60s/300s 轮询、WS 推送、1Hz flush 全部照跑，负载等于全开 | 经 `panel.api.onDidVisibilityChange` 下发窗内 visible 状态，查询 `enabled`/WS 随其门控 | 前端 |
| P1-10 ✅ | **开机恢复同一帧全量并发挂载**（第五轮） | `BoardDock.tsx:90-94` `fromJSON` 同步挂全部面板（含不可见 tab），各窗 hooks 挂载即发查询 | 挂载惊群：首屏缓存全空，全部请求直穿 BFF，与版本失效惊群（§六 #4）机制不同 | P1-9 的可见性门控天然收敛首波；或对非激活组延迟激活 | 前端 |
| P1-11 ✅ | **分享链接无大小/窗口数上限**（第五轮） | `board-share-codec.ts:55-77` 解码无输入长度/解压后大小上限；`isValidPayload`（`:40-53`）不限制 panels 数量 | 解压炸弹 / 恶意链接挂载数百窗，每窗查询齐发打 BFF | body ≤64KB、解压后 ≤1MB、panels ≤20 硬上限 | 前端 |
| P1-12 ✅ | **05 热力图每次数据刷新强制回中 spot**（第五轮） | `ExpirationHeatmapPanel.tsx:89-91` effect 依赖 `strikes` 引用——每次 dashboard 版本刷新 model 重建新数组 → `centerSpot("auto")` 每分钟触发 | 用户滚动位置每分钟被拉回 spot 行；与 08/09"手动滚动退出追踪"设计自相矛盾（05 无追踪开关却强制追踪） | 只在 strikeRange 切换/首挂时回中（比对内容而非引用），或仅由「回到现价」按钮触发 | 前端 |
| P1-13 ✅ | **🔗解耦 chip 无 UI 入口，点一次周期 chip 即永久冻结**（第五轮） | `toggleProductLinked` 全仓零 UI 调用（`board-window-store.ts:341-362`）；`setWindowScope`/`toggleLineScope(Multi)` 均顺带 `productLinked:false`（`:369,380,397`）且随布局存档持久化；`WindowToolbar.tsx` 无 `productLinked` 任何引用 | 用户在任何窗口点一次周期 chip（哪怕点的当前生效周期），该窗永久脱离总控、无任何途径恢复、跨会话存续；旧存档 `productLinked:false` 的 09 窗永久冻结且零指示。与 AGENTS.md 口径漂移（§六 #29） | 恢复 chip 双向切换；或"总控变更时重置全部窗为联动" | 前端+文档 |
| P1-14 ✅ | **总控周期 UI 整体消失，多选名存实亡**（第五轮） | `DashboardToolbar` 只渲染品种 select（`dashboard-ui.tsx:29-54`）；`toggleMasterScope` 零调用；`sanitizeScopeArray` 一律 `.slice(0,1)`（`board-window-store.ts:109`），深链多值被静默截断并回写 URL 覆盖 | 主控周期只能由 URL 深链/存档决定（默认恒 0dte），页面无任何控件可改；联动窗跟随用户看不见也改不了的总控。与 AGENTS.md「总控多选」整体漂移（§六 #29） | 顶栏恢复周期 chips（接 `toggleMasterScope`），或改文档为"总控单选仅深链可改"的现行口径 | 前端+文档 |
| P1-15 ✅ | **board-focus 无品种维度，跨品种误联动**（第五轮） | `BoardFocus` 只有 `strike/expiry/at`（`board-focus-store.ts:12-18`）；08/09 消费方不做品种校验（`GexBreakdownPanel.tsx:69-83`、`OptionsChainPanel.tsx:400-432`） | 多品种布局下 ES 05 点行 → NQ 08 闪"最近档"（实为边缘档）高亮；季度到期 unix 相同 → NQ 09 真的切 tab，纯误导 | `BoardFocus` 加 `product`（必要时加 `scope`），消费方品种不符即忽略 | 前端 |
| P1-16 ✅ | **focus 先标记已处理、后判断可用性：下钻被静默丢弃**（第五轮） | 09：先写 `focusHandledAtRef` 再 `find(series)`，`!serie` 即 return（`OptionsChainPanel.tsx:423-427`）；08 同构（`GexBreakdownPanel.tsx:74-76`）；数据就绪后 effect 重跑但 at 相同直接 return | 05 下钻瞬间目标窗数据未就绪（刚打开/版本刷新间隙）→ 下钻无声失败、永不重试——"05→09 切 tab 偶发不灵"的机制 | 仅在成功应用（切 tab/画高亮）后才写 handledAt | 前端 |
| P1-17 ✅ | **09 下钻后 auto chain 查询空转，每版本 bump 白拉 281KB**（第五轮） | ChainWindow 恒挂 `useOptionsChain(product, undefined, scope)`（`panel-wrappers.tsx:427`）；下钻后再挂带 expiration 的查询（`OptionsChainPanel.tsx:416`），auto 数据不再被消费但仍 active 随版本失效重拉 | 每个下钻过的 09 窗每次版本 bump（0dte 60s）打两份 chain，一份纯浪费；多窗线性放大 | `chainExpiration` 非空时 auto 查询 `enabled:false`；或唯一 chain 查询提升到 ChainWindow | 前端 |
| P1-18 ✅ | **历史回看叠加"当前"水位线 + 白拉历史 asof**（第五轮） | `mergeDashboardCurrent` 让实时 dashboard 墙位覆盖历史 asof 值（`intraday-data.ts:72-74`）；SPOT 却用历史末根收盘（`lightweight-model.ts:40-45`）；历史 detail 仍每 300s 按 asof 重拉（`use-options-intraday.ts:238-247`） | 切"前移 N 日"时 CW/PW/FLIP 是**今天**的墙画在昨天的图上（SPOT 又是昨天的），语义矛盾无提示；历史 asof detail（全站最贵接口）取回后被合并逻辑丢弃纯浪费 | offsetDays>0 时跳过 `mergeDashboardCurrent` 或水位层整层禁用并提示；历史 detail 改 `staleTime:Infinity` | 前端 |
| P1-19 ✅ | **图表 reset key 用 UTC 日期，盘中强制重置视野**（第五轮） | key 含 `source?.day`（BFF 响应的 UTC 日期，`IntradayPanel.tsx:200`）；key 变 → `setAutoScale(true)+fitContent()`（`:218-222`） | 每天 UTC 00:00（CT 18:00/19:00，正在晚盘交易）detail 300s 轮询拿到新 day → 用户缩放/平移/十字光标被吹掉；与 CME 17:00 CT 换日差 1-2h，换日本身反而不触发 | key 换用 `cmeTradingDayKey` 或去掉 day 维度；reset 保留逻辑区间 | 前端 |
| P1-20 ✅ | **unionBars/mergeCandlePayload 无合约符号守卫**（第五轮） | `intraday-data.ts:6-13,26-42` 与整窗合并（`use-options-intraday.ts:69`）只按 unix 去重，无 symbol 检查（WS/尾部路径有守卫，整窗路径没有） | 参考合约 bar 与本合约 bar 按 unix 拼成"连续"K线，跨合约价差画成真实跳空（P0-7 的姊妹路径） | `unionBars` 加可选 symbol 参数，不一致时整体替换而非并集 | 前端 |
| P1-21 ✅ | **safeNext 开放重定向：反斜杠绕过**（第五轮） | `LoginForm.tsx:8-10` 只挡 `//`，`/\evil.com` 被 WHATWG URL 解析为 `https://evil.com`；`location.replace`（`:79`）实际跳出站点 | 钓鱼链接 `/login?next=/\evil.com`，登录成功后送到攻击者站点 | `new URL(value, location.origin)` 解析后校验同源，或拒绝含 `\` 的值 | 前端 |
| P1-22 ⏳待供应商 | **logout 不注销 Go 侧会话**（第五轮） | `logout/route.ts:7-10` 只清本地 cookie 不调 Go | refresh token 在 Go 侧继续有效至 30 天；token 若泄露（叠加 §六 #22 明文 token）logout 无法撤销 | logout 携带 token 代理 Go 注销端点（需供应商确认），失败也继续清本地 cookie | BFF+供应商 |
| P1-23 ✅ | **多标签登出后其他标签无感知**（第五轮） | 前端无 401 处理（`api/options.ts:423-432`）；Reporter 对 session 401 静默 return（`ClientActivityReporter.tsx:39-42`）；无跨标签登出信号 | 标签 A 登出后标签 B 继续展示缓存数据，后续查询全 401 但不跳转，用户误以为 B 已登出 | fetch 层 401 → 跳 /login；或 BroadcastChannel/storage 事件广播登出 | 前端 |
| P1-24 ✅ | **多标签页布局/模板 localStorage 竞争**（第五轮） | `saveLayout` 盲写（`board-dock-layout.ts:96-102`）；模板库读-改-写无原子性（`:169-189`）；全仓无 `storage` 事件监听 | 两标签页各自排列布局互相覆盖，最后写入者赢；与 P0-9 循环叠加成持续互写 | 先修 P0-9（写次数骤降）；再按需加 storage 事件或时间戳仲裁 | 前端 |

### P2 — 低严重度

| # | Bug | 证据 | 影响 | 修复方向 | 归属 |
|---|---|---|---|---|---|
| P2-1 | 登录过期后 WS 无限重连不跳登录 | `use-options-intraday.ts:166-168` 对 session/ticket 401 一律 `scheduleReconnect()`；refresh 失败后形成对 Go `/auth/refresh` 的永久无效轮询 | 登出后后台标签页持续无效请求 | 区分 401 与网络错误，401 跳登录页/停止重连 | 前端 |
| P2-2 | 09 下钻失败静默回退旧数据 | `OptionsChainPanel.tsx:417` `displayData = query.data ?? model.data` | 下钻查询失败时显示旧到期数据，无错误提示 | 回退时显示提示条 | 前端 |
| P2-3 | VP 错误形态不一致 | 首读吞错（`go-options.ts:318`）而回退抛错（`:323,333`） | 同端点 200 空态与 502 随机出现，排查困难 | 随 P1-1 统一 | BFF |
| P2-4 | auth 上游 16s 硬编码 | `auth-bff.ts:45`，与 `OPTIONS_UPSTREAM_TIMEOUT_MS` 覆盖机制不一致 | 无法统一调参 | 接入同一环境变量 | BFF |
| P2-5 | levels 35s 超时余量仅 5s | TTFB 0.8~30s（§三）vs 超时 35s（`go-options.ts:42`） | p99 尾部随机超时（观察项，可不动） | 必要时放宽到 45s | BFF |
| P2-6 | 30s 轮询或超对端 keep-alive 空闲期 | version 轮询每 30s 一次，Go 侧 Keep-Alive 空闲超时未知 | 每次轮询可能重建 TCP+TLS 握手，0.6KB 响应付全握手 RTT（观察项） | 确认 undici `keepAliveTimeout` 配置；供应商确认 Go 侧值 | BFF/供应商 |
| P2-7 ✅顺带 | `next` 允许 `/api/...` 路径 | `LoginForm.tsx:9` 不限制 API 路径 | 登录后浏览器停在裸 JSON 响应页 | next 白名单限制为已知页面前缀 | 前端 |
| P2-8 | 登出失败静默 + 可能死循环 | `LogoutButton.tsx:11` `finally` 无条件跳 /login；若 cookie 未清，LoginForm 挂载检查又跳回 /board | 用户永远退不出且无错误提示 | logout 失败时提示并重试，或跳转前确认 cookie 已清 | 前端 |
| P2-9 | refresh 成功响应 user 与 cookie sub 不一致 | `session/route.ts:19` `user: auth.user ?? null` vs `auth-bff.ts:63` 合成 id；Go refresh 缺 user 时 Reporter 静默跳过上报 | 活动上报静默丢失 | refresh 分支沿用旧 session 的 sub/email 回填 | BFF |
| P2-10 | restore 分支非 JWT token 兜底 +3600s | `session/route.ts:31`；candles-ws 只查本地 cookie 不验 token | Go 真实 access 寿命 <1h 时 cookie 有效而 token 已死，WS 建连即断进重连循环（叠加 P2-1） | restore 对齐真实过期时间；或 candles-ws 临期先 refresh | BFF |
| P2-11 | 标签 B 停 /login 不随 A 登录跳转 | session 检查只在挂载时执行一次（`LoginForm.tsx:38-49`） | 体验瑕疵 | storage 事件触发复查 | 前端 |
| P2-12 | activity POST 失败（含 4xx）无限 30s 重试 | `ClientActivityReporter.tsx:54,57-58`；`client-activity-state.ts:8` 无上限无退避 | session ok 但 activity 持续失败时永久重试 | 4xx 不重试；5xx/网络错误重试加次数上限 | 前端 |
| P2-13 | /panel-shot 截图页也挂 Reporter | `AppShell.tsx:38` `enabled={pathname !== "/login"}` | 每次截图运行产生一次真实活动上报 + session 调用，污染留存数据 | enabled 排除 `/panel-shot` | 前端 |
| P2-14 | 已在 /board 时第二分享链接静默无效 | `BoardView.tsx:101-119` `shareResolved` 不回 false；payload 只在 onReady 消费一次 | 解码照做、URL 参数被剥掉，但布局永不应用，用户无反馈 | payload 变化且 dockApi 就绪时确认后直接 `applyPayload` | 前端 |
| P2-15 ✅顺带 | WS `ticket.json()` 后无 stopped 检查 | `use-options-intraday.ts:169-172` 两个 fetch 后都有 stopped 检查，`json()` resolve 到 `new WebSocket` 之间没有 | 组件恰在此间隙卸载 → 僵尸连接常开占服务端资源 | `json()` 后加 `if (stopped) return;` | 前端 |
| P2-16 | 窗口数量无上限 + 配额静默失败 | `BoardAddMenu.tsx:53-67` 可无限添加；`saveLayout` catch 吞 QuotaExceededError | 几十窗内存/BFF 负载无护栏；超配额后布局静默不持久 | 窗口总数软上限（如 12）；配额失败一次性提示 | 前端 |
| P2-17 | 恢复失败/版本不符时旧存档被覆盖无备份 | `BoardDock.tsx:94-95` restoreLayout false → 默认布局 → 紧跟 saveLayout 覆盖原 key | 未来 STORAGE_VERSION bump 时用户布局直接消失 | 覆盖前原 raw 备份到 `.bak` 键 | 前端 |
| P2-18 | 作废旧布局键不清理 | `board-dock-layout.ts:17-20` 注释承认 v1/v2 键作废但不删除 | 残留数据永久占位 | 启动时 `removeItem` 旧键 | 前端 |
| P2-19 | chainExpiration 跨周期切换不清空 | 周期变更动作均不清（`board-window-store.ts:316-397`），仅品种变更清（`:311,338`） | 切周期后 09 仍按上一周期选中的到期发 chain 请求，tab 无匹配、内容取决于后端对未知 expiration 的行为 | 周期变更动作一并清；或校验 `expiration ∈ series` 不符即清 | 前端 |
| P2-20 | URL↔store 双向同步双重应用 | store → URL 回写（`BoardView.tsx:81-90`）→ searchParams 变 → sync effect 再调一次 setMaster；`setMasterProduct` 同品种无早退重写全部 windows | 每次切品种全部窗口 config 重建两次（两轮全窗重渲染 + 多触发一次保存链） | 同品种早退；sync/回写共用同一 sig 源 | 前端 |
| P2-21 | `useOptionsTermMulti` pcr/iv key 后缀死参数 | 唯一调用点恒传 `true`（`panel-wrappers.tsx:458`），queryFn 与后缀无关（`use-options-term.ts:37-39`） | 将来有人传 false 时同一 URL 两 key 各缓存各拉一份 | 删除第三参，或让 queryFn 行为与后缀一致 | 前端 |
| P2-22 | hydrate 时 master.scopes 与 perProductScope 可背离 | `board-window-store.ts:523-556` 两字段独立清洗不强制一致 | 存档异常时 01 总览与联动窗显示不同周期，且页面无总控 UI 可纠正（叠加 P1-14） | hydrate 末尾强制 `perProductScope[master.product] = master.scopes` | 前端 |
| P2-23 | priceLines/primitive 随每根 WS bar 全量拆建 | `positions` 依赖 `latestPrice`（`IntradayPanel.tsx:95-98`）→ priceLines effect 每秒移除重建全部价格线（`:246-254`）；mode effect 同拍 detach/attach | 每秒全量拆建 + 轴标签重绘，多窗口恒定 CPU 底噪；只有 SPOT 一个值在变 | SPOT 与墙位拆两个 effect；墙位深比较 memo；SPOT 单条 `applyOptions({price})` | 前端 |
| P2-24 ✅顺带 | 历史窗尾部 60s 轮询不可变数据 | `use-options-intraday.ts:91-94` offsetDays>0 时 tailRange 全在过去且不可变，仍 60s 轮询 | 白请求 | `refetchInterval: offsetDays ? false : 60_000` | 前端 |
| P2-25 | 切品种/换窗后陈旧 OHLCV 读数 | `barsEverRendered` 一旦 true 永不按 symbol/day 复位（`IntradayPanel.tsx:82-83,353`）；`setHovered(null)` 只在 reset 且有数据时执行 | reset 且新数据为空时 readout 继续显示**旧品种** OHLCV | key 变化时复位 `barsEverRendered`；reset 无条件清 hovered | 前端 |
| P2-26 | 进行中 bar 被尾部/整窗回写瞬时回退 | HTTP 快照滞后 WS 最多 ~60s，重合分钟被回写成更旧部分量（`use-options-intraday.ts:64-70`、`candle-stream.ts:70-71`），下一拍 WS ≤1s 修正 | 最后一根 bar 每分钟闪回一次，无持久错误 | 重合分钟保留成交量较大者，或 final:true 只覆盖已收盘分钟 | 前端 |
| P2-27 ✅顺带 | mergeCandlePayload 符号字段无条件覆盖 | `intraday-data.ts:38-40` `candles.candle_underlying_symbol` 为 undefined 时抹掉 detail 的有效值 | 下游靠 `underlying_symbol` 兜底碰巧正确但脆弱 | `?? data.candle_underlying_symbol` | 前端 |

## 附录：五轮审计总结

- **第一轮（2026-09-11，代码级复核，逐文件对照）**：初版 12 处与代码不符全部修正（levels 线上窗口、scope 口径、iv-term 漏记、窗口聚焦驱动、死代码 hook、超时表缺项、看门狗滞后、K线扇出、BFF 缓存语义等），另补 4 处结构缺口（后台版本号被吞、`SCOPE_REFRESH_SEC` 死代码、BFF→Go 端点全景、复现指路）。
- **第二轮（2026-09-11 凌晨，全文逐条复核）**：第一轮 16 项断言复核全部成立、无漂移；新修 2 处数字偏差（K线扇出上限 5→8+1、整窗重传条件）、细化 1 处影响面（后台轮询实为暂停而非继续）、补 4 处结构缺口（status 前置依赖、BFF 内嵌 dashboard、活动上报通道、VP 回退窗口）。
- **第三轮（2026-09-11，双路代码级复核：BFF 侧 + 前端侧）**：前两轮 23 项断言全部成立、无行号漂移；新修 2 处口径偏差（内嵌 dashboard 实际覆盖**全部**非 bars_only 非 close 的 intraday 请求，不止 options_only；VP 第三级回退共试 8 个 session 窗而非 7 个）、解消 1 处自相矛盾（iv-term 历史曲线 `staleTime:Infinity` 挡不住版本失效 invalidate，"只拉一次"不成立）、补 8 处遗漏（status→levels 兜底、intraday 全量路径二次扇出、K线入口 status 计数、跨交易日 WS 清空例外、K线整窗 `staleTime:Infinity`、失败保险丝覆盖 intraday 族、session 前置请求、`go-options-adapter.ts` 死代码）。
- **第四轮（2026-09-11，前端/BFF 消费层 bug 深挖，Go 服务端除外）**：在 §六 15 项之外新发现 **20 项可修 bug**（新增 §十一：P0×6 / P1×8 / P2×6）+ **10 项架构遗漏**（§六 #16-#25）。最严重六项：K线空响应抹历史（守卫写反）、close dashboard 必超时且吞错锁死空态、WS 每窗口一条连接无共享池、BFF→Go abort 断链、VP 全天窗常态超时、session 并发刷新误登出。核查无问题的方向：版本轮询挂载点（BoardView 全局一次）、前端→BFF abort 透传（全部 queryFn 已接线）、K线内存增长有界（cutoff 裁剪）、Next 路由缓存（全部 force-dynamic + no-store）、iv-term-model（纯函数）、activity 路由实现。
- **第五轮（2026-09-11，四路深挖：登录鉴权 / Dockview 窗口生命周期 / 跨窗联动 / 06 数据合流；本轮起更名《前端与BFF架构审计总览》）**：新发现 **42 项可修 bug**（P0×5 / P1×16 / P2×21，其中"布局保存死循环"被两路审计独立发现，去重后计一项）+ **4 项架构遗漏**（§六 #26-#29）。新增 P0：换月/参考合约 K线永久卡死错误合约（P0-7）、休市双轮询风暴周末 600MB/标签页（P0-8）、布局自动存档每 300ms 无限自触发循环（P0-9）、proxy 只验签不续期看板永久 401（P0-10）、Go 宕机反毁 refresh token 全站误登出（P0-11）。核查无问题的方向：proxy matcher 覆盖与 API 401 语义、登录 Cookie 属性/CSRF/HMAC fail-closed、面板移动不重挂且 cleanup 完整、popout 用户不可达、冻结窗 query key 稳定、主周期切换原子、focus TTL 与 last-write-wins、WS 去重/排序/final 语义、offsetDays 切回无永久空洞、primitive 与主图同轴、缺分钟不前填、DST 边界、06 黑屏修复灌注完整。

- **P0 修复记录（2026-09-11，备份 `_backup/2026-09-11_0201_p0-fixes/`，`npx tsc --noEmit` 全绿）**：11 项 P0 全部修复——
  P0-1 整窗合并守卫顺序修正（payload 空保留 previous，`use-options-intraday.ts:70-71`）；
  P0-2 close 档 dashboard/intraday/chain/levels 不打上游直接空态，吞错路径与 `isCurrentPreviousEod` 分支移除（`go-options.ts:128-129` 等）；
  P0-3 WS 改模块级按 symbol 单例 + 引用计数连接池（新文件 `src/features/options/candle-stream-manager.ts`），各窗口保留独立 1Hz 合并/看门狗/补拉；
  P0-4 入站 `request.signal` 全链路透传进 `upstream()`，`AbortSignal.any` 与超时合并（9 个路由全部接线）；
  P0-5 VP 窗口钳制 ≤2h（`VOLUME_PROFILE_MAX_WINDOW_SEC = 7200`），钳制时响应带 `window_clamped:true`（`OptionVolumeProfileResponse` 同步加可选字段）；
  P0-6 refresh 模块级单飞（key = refresh token，settle 即删，`auth-bff.ts:58-75`）；
  P0-7 符号漂移不再静默丢批，触发整窗 refetch 重锚（120s 冷却），`candle_is_reference` 按订阅符号推导（`candle-stream.ts:55-59,81-88`）；
  P0-8 尾部轮询与看门狗补拉接 `isCmeSessionOpen` 门控（顺带修 P2-24：历史回看尾部停轮询）；
  P0-9 `prune` 存活 id 集合无变化时不 set，切断自动存档自触发循环（`board-window-store.ts:559-567`）；
  P0-10 前端 401 → 单飞 `GET /api/auth/session` → 原样重试一次（`api/options.ts:396-443`）；
  P0-11 session 路由区分凭证无效（401/400 才清 cookie）与上游不可达（503 保留 cookie）（`session/route.ts:14-47`）。
  顺带修复：P2-15（WS `ticket.json()` 后补 disposed 检查）。环境修正：`tsconfig.json` exclude 增加 `_backup`（备份副本不再进 tsc）。
  修复后新产生的死代码（待清理）：`src/server/eod-freshness.ts`（P0-2 移除其唯一使用方后零引用）。

- **P1 修复记录（2026-09-11，备份 `_backup/2026-09-11_0242_p1-fixes/`，`npx tsc --noEmit` 全绿）**：24 项中 22 项已修复——
  P1-1 BFF 统一错误语义（上游失败→5xx、数据真空→200+missing_reason；VP 首读失败续走回退链全败才抛、empty 补 missing_reason；bars_only/chain 合成吞错路径移除）；
  P1-2 缓存条目改 `{value, settledAt}`，pending 期间无限共享、settle 后保留 10s；
  P1-3 缓存对象写字段前浅拷贝（go-options 3 处 + intraday-candles 2 处）；
  P1-4 invalidate predicate 跳过 `dataUpdatedAt` 距今 <10s 的查询，聚焦双波消除；
  P1-5 VP key 归一化 `["option-volume-profile", product, cmeTradingDayKey(from)]`；
  P1-6 挂载强制上报前 60s grace 重读 `lastReportedAt` + pending event 写后重读乐观锁（`test-client-activity.mjs` 2/2 通过）；
  P1-7 BFF handler 60s 总预算（超时 504）+ 前端 getOptionsApi 60s 默认超时；
  P1-9/P1-10 新 `use-panel-visible.ts`（useSyncExternalStore 订 dockview `onDidVisibilityChange`），全部查询 hook 加 `enabled` 门控 + WS 按可见性 acquire/release——非活动 tab 停轮停 WS，开机首波收敛到可见窗；
  P1-11 分享链接 64KB body / 1MB 解压流式上限 / 20 面板硬上限；
  P1-12 05 回中改 strikeRange 内容指纹，数据刷新不再劫持滚动；
  P1-13 🔗 chip 恢复（WindowToolbar 全 kind，重新联动时品种/周期同步回总控、清 chainExpiration；联动 chips 置灰；setMasterProduct 只更新联动窗、窗内切品种=自动解耦）；
  P1-14 顶栏恢复周期多选 chips（toggleMasterScope 多选至少 1 个、按固定优先级排序；sanitizeScopeArray 不再 slice(0,1)；WINDOW_SCOPES_MAX 4→3 对齐 AGENTS；注：AGENTS 写五档含 RTH，但 OPTION_SCOPES 已无 `all`，实渲染 4 档，恢复 RTH 属契约层改动）；
  P1-15 BoardFocus 加 `product` 必填字段，05 产出带品种、08/09 品种不符即忽略；
  P1-16 focus handledAt 改为成功应用后才写（08/09 同构），下钻可重试；
  P1-17 ChainWindow auto chain 在下钻后 `enabled:false`；
  P1-18 历史回看跳过 `mergeDashboardCurrent`（显示历史 asof 原值）+ 历史 detail `staleTime:Infinity`；
  P1-19 reset key 的 day 维度改 `cmeTradingDayKey()`，只在 CME 17:00 CT 换日触发；
  P1-20 unionBars 加可选 symbol 守卫（不一致整体替换），整窗合并与 mergeCandlePayload 双路径接入（`test-intraday-data.mjs` 4/4 通过）；
  P1-21 safeNext 拒绝 `\` 与 `/api` 前缀（顺带 P2-7）；
  P1-23 getOptionsApi 在"refresh 失败且最终 401"时 `location.assign("/login")`（Go 宕机不误跳）；
  P1-24 布局/模板写入带 savedAt 时间戳仲裁，他页较新则跳过写入。
  未修 2 项：P1-8（undici 不可解析，未加依赖，P1-7 总预算兜底）；P1-22（Go 无注销端点，待供应商，logout 保持仅清本地 Cookie）。顺带修复：P2-7、P2-15（P0 波）、P2-24（P0 波）、P2-27。
  修复后新产生的死代码（待清理）：`src/server/eod-freshness.ts`（P0-2 后零引用）。

- **local-demo 残骸清除（2026-09-11 午后，备份 `_backup/2026-09-11_1349_local-demo-purge/`，`npx tsc --noEmit` 全绿）**：定性——local-demo **造数机制** 2026-09-10 已删净，本轮清的是**死残骸**（均不产 bug、不阻塞请求，属死代码）：① 5 处 hook 的 `source==="local-demo"` 60s 兜底轮询分支（dashboard 单/多版、chain、levels、term——恒不命中，删除后行为不变）；② 3 处响应类型字面量 `source?: "local-demo" | string` → `source?: string`（`src/api/options.ts`）；③ 死 hook `useOptionsIntraday`（60s 轮询版，零调用点）删除；④ 死文件 `src/server/go-options-adapter.ts`（102 行，零引用）删除。清除后 src 全仓 `local-demo` 零匹配。顺带（同日上午排查 close 短路时）修复：`OptionsDashboard.tsx:54` `closePending` 原 `scope==="close"` 无条件压数据（路径级短路），改以 `has_data===false` 为准。legacy 模式分支同日下午一并删除（见下条）；`useOptionsTerm` 单 scope 版零调用待删。

- **legacy 模式删除（2026-09-11 午后，备份 `_backup/2026-09-11_1405_legacy-purge/`，`npx tsc --noEmit` 全绿）**：BFF 双模式（`OPTIONS_API_MODE` unified/legacy）收敛为**唯一模式直连 Go**——`unifiedAPI()` 及全部 legacy 分支删除，五路由的 close 短路从"模式判断"变为彻底不存在；`resolveUnderlyingUncached` 的 levels 回退、`sourceStatus` 本地合成、`readLevels` 助手删除；`options-live-model.ts`（composeDashboard/unsupportedScope/latestState，59 行）、`eod-freshness.ts`（零引用）、`scripts/test-eod-freshness.mjs`（测已删代码）整文件删除，`emptyDashboard` 内联回 `go-options.ts`；`.env.example` 移除 `OPTIONS_API_MODE`。**行为变化（已知）**：dashboard 在 Go 返回空时不再回退"本地 compose（levels+heatmap 组装）"，直接空态 + Go 的 `missing_reason`——符合"空态由 Go 裁决、BFF 不替后端下结论"红线（该红线已写入 AGENTS.md 迭代惯例区）；`/options/heatmap` 超时配置保留但无任何路由可达（订单流足迹图专用标记维持，§六 #11）。§六 #15（adapter 死代码）、#23（legacy 判定不对称）随之关闭。

- **超时链对齐 + K线整窗覆盖恢复（2026-09-11 午后，备份 `_backup/2026-09-11_1444_timeout-recovery/`，`npx tsc --noEmit` 全绿）**：诱因=用户实测"数据拉不全"（K线只剩尾部 30 分钟、07 微笑长时间加载、徽标缺失）。日志定性：Go 重聚合常态 25~60s，而 BFF/前端超时链（上游 25/35s、路由预算 60s、前端 60s）系统性把"慢但有数据"掐成 502/504（dashboard/chain 大量恰好 25.0s、整窗 bars 恰好 35.0s、options_only 恰好 60s）。修复：① 上游超时放宽（status 15s、term 30s、其余重端点 55s，heatmap 25s 专用保留不动）+ 路由预算 115s + 前端默认 120s（`go-options.ts`/`api/options.ts`）；② intraday/VP 去串联——锚点从 latestSnapshot（内含一整次串行 dashboard）改 `latestStatusUnix`+5min 合约缓存，`latestSnapshot` 整函数删除，current 兜底改"仅在 Go intraday 没回 current 时懒触发一次 dashboard，20s 软上限"；③ **K线整窗覆盖恢复**（`use-options-intraday.ts`）：整窗首拉失败后旧看门狗只看"最后一根 bar 新旧"（尾部刷新让它永远新鲜→永不补拉），改为按覆盖度判定（整窗 error / 无 bars / 最早 bar 晚于窗口起点 2h）冷却 180s 补拉；④ 调度器失败退避软化 1→2→4→5min（原 2→4→8→10min，`data-freshness.ts`）。修复后实测：dashboard d90 24.7s、close 20.1s、options_only close 2.2s/d90 5.4s 均落 200，504 消失；残留=Go /options/intraday·chain 0dte 长尾偶超 55s（Go 侧问题，列入供应商待办）。

**总结论**：五轮后，本文全部可代码核验的断言均有 file:line 支撑。唯一不可证项是 Go 侧快照生产节奏（0DTE 60s / d30·d90 300s / close 每日一次）——属线上实测声明，本仓无 Go 代码，列入供应商待确认。第四轮结论：**前端/BFF 消费层的基础问题集中在四类——错误被吞成 200 空态导致保险丝哑火（P0-2/P1-1）、超时与实际耗时系统性错配（P0-2/P0-5/P1-7）、资源无复用无护栏（P0-3/P0-4/P1-2/P1-3）、前端节奏自我打架（P1-4/P1-5）**；第五轮把问题面扩到第五、六类——**生命周期失控（P0-7 永不重拉卡死、P0-8 无休市门控、P0-9 自触发循环、P1-9 保活无门控）与鉴权脆弱（P0-6/P0-10/P0-11 三条独立误登出/锁死路径）**。**P0 全部 11 项、P1 其中 22 项已于 2026-09-11 修复**，下一步按 §十一 P2 顺序推进（P2-7/P2-15/P2-24/P2-27 已顺带修复）。需供应商配合项：candles-ws 明文 token（§六 #22）、logout 注销端点（P1-22）、WS 心跳（§六 #3）、undici 连接池（P1-8，需先加依赖）。需同步文档项：§六 #29（AGENTS.md 周期架构口径——P1-13/P1-14 已按 AGENTS 恢复 UI，剩余漂移为 RTH 档位 + 登录与会话.md 4 分钟检查承诺）。遗留待清理项：§四死代码（`useOptionsTerm` 单 scope 版；`useOptionsIntraday` 已随 local-demo 清除删除）+ §六 #10 / #16 / #26 / #27（#15 已随 local-demo 清除删除、#23 已随 legacy 删除关闭、`eod-freshness.ts` 已删）；§六 #11（heatmap）已确认为订单流足迹图页面跳转专用保留项，后续不再改动。
