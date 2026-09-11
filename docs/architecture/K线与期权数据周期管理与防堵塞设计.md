# K 线与期权数据周期管理与防堵塞设计

> 2026-09-11 立项。触发事件：/board 首屏 122 请求 / Finish 5.4min，浏览器 "Initial connection 1 min"（实为排队）；WS 半开静默导致 K 线冻结 4 分钟无感知。
> 本文是数据链路的**权威设计**：周期节奏、点击加载顺序、防堵塞机制以本文为准；实施进度见文末清单。
> 关联文档：`docs/architecture/前端与BFF架构审计总览.md`（问题清单与修复记录）、`docs/frontend/周期架构迭代开发文档.md`（scope 语义）。

---

## 一、数据链全景清单

### 1.1 K 线族（期货 OHLCV，与期权档位无关）

| 链路 | 消费者 | Hook / 入口 | BFF → Go | 当前节奏 | 实测 |
|---|---|---|---|---|---|
| 整窗历史 | 06 日内（每窗） | `useOptionsIntradayBars` | `GET /api/options/intraday?bars_only=true` → `/options/underlying-bars` | 每 (product, days, offsetDays) 只拉 1 次，只增不减合并 | 142KB / 5~17s |
| 尾部小窗 | 06（每窗） | `useOptionsCandleTail` | 同上（30 分钟窗） | 60s；休市/历史回看窗停轮 | 3.3KB / 0.2~1s（健康时） |
| WS 增量 | 06（每窗） | `useOptionsCandleStream` → `candle-stream-manager` 单例池 | `/api/auth/candles-ws` 取票 → Go WS | 推送制，flush 节流 ≤1Hz | 见 §六 |
| WS 看门狗 | 同上 | 150s 无批次 → HTTP 补拉尾部 | 同尾部链路 | 巡检 30s | — |
| 换月 resync | 同上 | tail/WS 符号错配 → 整窗重锚 | 同整窗链路 | 冷却 120s | — |

### 1.2 期权族（Go 预计算，本仓零计算）

| 链路 | 消费者 | Hook | BFF → Go | 当前节奏 | 实测（2026-09-11） |
|---|---|---|---|---|---|
| dashboard 主档 | 01/05/06VP/08 | `useOptionsDashboard` | `/options/dashboard`（超时 25s） | 版本失效驱动，无自轮询 | 2~28s，185~882KB，大量 25.0s 超时 502 |
| dashboard 多档 | 06 水位层 / 07 兜底 / 05 共振 | `useOptionsDashboardMulti` | 同上 ×N scope | 同上 | 同上 ×N |
| 期权水位明细 | 06 水位层 | `useOptionsIntradayMulti`（options_only） | `/options/intraday`（超时 35s） | 300s（offsetDays>0 不轮询） | **58~60s 常态 → 504，全站最贵** |
| K 线+水位整窗 | 06 首挂 | `getOptionIntraday` | 同上（非 options_only） | 版本失效驱动 | 9~38s |
| 期权链 | 09 窗 + 07 主路径 | `useOptionsChain` / `useOptionsChainMulti` | `/options/chain`（超时 25s） | 版本失效驱动 | 6~20s，间或 25s 502 |
| 成交量分布 | 06 成交量分布层 | `useOptionVolumeProfile` | `/options/0dte-volume-profile`（35s） | 60s 固定轮询 | 12~37s |
| IV 期限/PCR | 10 | `useOptionsTermMulti` | `/options/term`（15s） | 版本失效驱动 | — |
| 水位轨迹 levels | （仅 BFF 内部组合用） | `useOptionsLevels` | `/options/levels`（35s） | 版本失效驱动 | 0.8~107s |
| **version 心跳** | 全站 | `dataVersionQueryOptions` | `/api/options/version` | 30s | 5ms~8.4s，偶发 10s 502 |

### 1.3 BFF 公共机制（`src/server/go-options.ts`）

- 上游超时分级（2026-09-11 重对齐）：status 15s / term 30s / heatmap 25s（专用保留）/ dashboard·chain·levels·intraday·underlying-bars·volume-profile 55s / 默认 30s（`UPSTREAM_TIMEOUT_MS`）；配套路由总预算 115s、前端默认 120s——Go 重聚合实测常态 25~60s，旧分级（25/35s）系统性把"慢但有数据"掐成 502/504。
- 路由总预算 60s → 504（`route()` L92-104）。
- 同 URL 10s in-flight 去重缓存（L58）：并发相同请求共享一次上游调用。
- **隐性串行依赖**：`resolvedUnderlying`（L107）几乎被所有路由调用，unified 模式下先打 `/options/status`（10s 超时）。Go 抖动时 status 先死 → 包括 bars_only 在内的所有路由陪葬（实测 bars_only 大量恰好 10.0s 的 502 即此）。

---

## 二、堵塞机制（为什么慢，按因果排序）

1. **Go 上游慢且不稳**（根因，不在本仓）：options_only 常态 58~60s；dashboard 2~28s；chain 6~20s。BFF 自身开销仅 2~30ms。
2. **浏览器 6 连接池队头阻塞**：同源 HTTP/1.1 仅 6 并发。10+ 条 25~60s 的重请求占满后，K 线尾部（本身 <1s）、version、WS 取票全部排队——DevTools 的 "Initial connection 1 min" 实为排队。
3. **失败重试风暴**：`useSnapshotSync` 保险丝每 30s 版本轮询无退避重试全部 error 查询 + React Query 自身重试 → 失败越多请求越多，连接池永不释放（自我恶性循环）。
4. **三类惊群**：
   - **启动惊群**：首屏 dashboard×4 key（0dte/d30/d90×days=20 + 0dte×days=1）+ options_only×3 + chain + volume-profile + bars×2 同时发出；
   - **版本惊群**：全局单一 `v` 字符串失效——0dte 每 60s 出新快照，d30/d90 的 882KB 大快照被拖着每分钟重拉；
   - **点击惊群**：总控多选 chips / 品种切换 / 06 图层多选 / 09 下钻，一次点击让多个面板同时换 key 同时发请求。
5. **WS 无投递保证**：TCP 活着、应用层死（静默丢订阅）时前端零感知；看门狗补拉又走被堵死的 HTTP 池——2026-09-11 K 线冻结 4 分钟即此组合。

---

## 三、目标架构：周期管理

### 3.1 原则

- K 线与期权**解耦**：K 线走固定节奏自刷新，不参与版本失效（现状已对，保持）。
- 期权内部按 scope **分频**：版本失效从全局 `v` 改为按 `(product, scope)` 粒度（version 端点本返回 `entries[{product, scope, unix}]`，前端一直没用它）。
- **错位更新**：分频之外加相位偏移 + 每拍限流 + 抖动，消灭整除撞车与同步阻塞。
- **显式失败**：REST 失败要可见（面板注因），不允许 WS 式静默冻结。

### 3.2 分档节奏表（拍板值）

| 档 | 间隔 | 相位 | 范围 |
|---|---|---|---|
| K 线整窗 | 一次 | 立即（最高优先） | bars_only 大窗 |
| K 线尾部 | 60s，**对齐整分钟 +4s** | :04 | bars_only 小窗 |
| 0DTE 期权 | 60s | :05 | dashboard/水位/chain/VP（09 单到期归此档） |
| 30DTE | 3600s | 每小时 :07 分 | dashboard/水位/term |
| 90DTE | 3600s | 每小时 :23 分 | 同上 |
| RTH(all) | 300s | :41 | 后端 300s 产快照，前端同频消费 |
| EOD/close | unix 驱动 + 每交易日最多一次（§3.7） | 16:05 CT 后 | 现恒空态，先立规矩 |

### 3.7 EOD（close 档）单拉策略（2026-09-11 定稿）

**收盘时间界定**：美盘收盘 = CME 交易日 **16:00 CT 结算**（Globex 周日 17:00 CT 开市 → 周五 16:00 CT 收市，交易日 17:00 CT 滚动换日）。已有实现：`cmeTradingDayKey` / `lastCompletedEodAsof` / `structureSnapshotAsof`（`src/lib/cme-session.ts`，周末与夏令时经 `Intl` America/Chicago 正确处理），EOD 口径一律复用，不另造时钟。拉取窗口 = 16:05 CT 之后（给 Go 5 分钟入库缓冲，由 Go 发布节奏天然保证）。

**三层保险，一次拉完不反复拉**：

1. **unix 驱动**：close 档只在 version entries 中 close 的 unix 变化（Go 真出了新 EOD）时才放行，无定时轮询；
2. **每交易日最多一次**：调度器记录当交易日已消费标记（`ScopeState.fetchedDay`，按 `cmeTradingDayKey` 判定），当日内 unix 再变（结算修正/重发）也不重复拉；失败重试走退避机制，不占用"已消费"标记；
3. **查询层冻结**：close 查询 `staleTime: Infinity`、无 `refetchInterval`——拉到即永久有效至下一交易日。

**BFF 放行（2026-09-11 修正）**：原实现 BFF 在 dashboard/levels/intraday/chain/term 五个路由对 close **无条件短路空态**（从不问 Go），与"契约由 Go 裁决、BFF 不替后端判断"的口径矛盾。已改为仅 legacy 模式空态、unified 模式直连 Go——有 EOD 给数据，没有则由 Go 回 `missing_reason` 空态，本仓不造数。

- 相位作用：60 | 3600 整除关系下，d30/d90 与 0dte 永不同时到期；开机时各档 `nextDueAt` 按相位初始化，启动惊群从机制上消失。
- version 心跳保持 30s（几 KB，是调度器的输入，不是负担）。

### 3.3 调度器（改造 `useSnapshotSync`）

每 30s 一拍：

1. 比对 `entries` 中每个 `(product, scope)` 的 unix 与本地记录；
2. 某 scope `unix 变了 && now ≥ nextDueAt` → 进入"到期集"；
3. **每拍最多放行 2 个 scope**（其余保持到期态等下一拍），只失效该 scope 的查询（query key 含 scope，精确匹配）；
4. due 时间附加 ±10% 抖动；失败按 key 指数退避 `nextDueAt = now + min(5min, 2^n × 30s)`，成功清零；
5. 后台标签页（`document.hidden`）整拍跳过（现状已对，保持）。

### 3.4 双车道（防"慢市场堵死快市场"）

| 车道 | 内容 | 策略 |
|---|---|---|
| 快车道 | version、K 线整窗/尾部、WS 取票 | 不受限、永远优先——K 线绝不排在期权后面 |
| 重车道 | dashboard / chain / volume-profile / options_only / levels / term | 全局信号量 **≤2**，排队等位；**用户显性点击触发的请求插队队首** |

实现：重车道为一个客户端信号量模块，各期权 queryFn 入口处 acquire；快车道不经过它。React Query 缓存命中（同 key 已拉过）不发请求、不占车道。

### 3.5 休市总闸

`isCmeSessionOpen() === false` 时：重车道全停（含 options_only——现状只门控了 K 线尾部，水位休市照轮是漏洞）；快车道只留 version 降为 5 分钟一探；开市后首拍正常调度补拉。EOD 档在收盘后单独唤醒一次。

### 3.6 车道之外的剩余竞争与三层解法（2026-09-11 增补）

车道方案解决的是**浏览器侧**抢连接（信号量 ≤2 → 6 连接中恒给快车道预留 4 条，K 线永不排队）。剩余竞争在 **Go 侧算力**：K 线尾部与 0dte dashboard 同时到达 Go 时互相拖累（bars_only 的 10s 陪葬 502 即此）。这一层无法靠排序根治，三层解法按治本程度：

1. **治本 · 期权快照推送化（服务端方向，与 §六 WS 审查合并交接）**：Go 出新快照时主动推（WS/SSE），前端仅留 version 心跳兜底。没有请求就没有竞争，0dte 延迟从轮询粒度变为"出了就收"。终局形态：一条 WS 同时推 K 线增量 + 快照版本通知，重车道请求量降约 80%。
2. **~~前端 · Go 健康度自适应降频~~ 不采用（2026-09-11 用户定稿）**：定时拉取节奏恒定即合理，不做降频；拥堵改由**重车道优先级**消化——数据优先级铁律：**K线（快车道）> 0DTE（重车道优先级 1）> 其他周期（0）> ，用户显性操作（如 09 下钻，优先级 2）永远队首**。
3. **诊断 · 排队与耗时只进 F12（2026-09-11 定稿口径）**：每端点滚动记录最近 N 次实际耗时，排队/出队/慢请求/降频状态切换全部 `console.debug("[ms-data] …")`——**UI 不出现任何"卡顿/排队/降频"提示**（用户决策：诊断归 F12 与后台日志，界面保持干净）。

另注：6 连接限制是 HTTP/1.1 产物，生产部署开启 HTTP/2 后同源多路复用，该限制直接消失（dev 环境无需处理，记入部署清单）。


---

## 四、前后端职责分工与协作框架

### 4.1 分工总表与第一原则

| 层 | 职责 | 原则 |
|---|---|---|
| 浏览器前端 | **何时取、取多少、怎么显示**：调度器 / 双车道 / 退避熔断 / 休市门控 / 排队预期 / 延迟提示 | 零计算、零造数 |
| BFF（Next.js，本仓） | 认证代理、超时分级、in-flight 去重、响应消毒；增强项：短 TTL 响应缓存、重端点串行保护 | 薄代理，不做业务计算 |
| Go 服务器 | 采集、预计算、快照缓存、产出节奏、推送通道、健康信号 | **请求路径零重算**：所有读都是 O(1) 快照读取 |

第一原则：**计算全部沉到 Go 的产出侧，请求路径上不允许有任何重算**。options_only 常态 58s 的本质就是"请求触发了计算"——快照应当后台算好摆着，请求只是读。前端节奏管理做得再好，也只是不在病人身上踩脚；让请求变便宜才是根治。

### 4.2 本仓自做（不依赖 Go 改动）

即 §八 实施清单阶段 A~C 的全部内容：调度器（分档/相位/每拍限流）、双车道信号量、失败退避 + 健康度熔断、休市总闸、点击排队与顺序、排队预期 UI、K 线定频对齐、key 归一、resolvedUnderlying 会话缓存、失败显式化。这些把"取数行为"做到最优，**但不改变 Go 的响应速度**。

### 4.3 需 Go 配合（交接清单，按收益排序）

| # | 事项 | 消除的堵塞 | 预期收益 |
|---|---|---|---|
| 1 | 期权快照推送（WS/SSE，与 candle WS 同通道） | 轮询竞争 + 轮询粒度延迟 | 重车道请求量约 -80%；0dte "出了就收" |
| 2 | 请求路径零重算：预计算 + 快照缓存，读请求只读缓存 | options_only 58s、dashboard 2~28s、chain 6~20s | 全部端点压到 <1s，超时/502 消失 |
| 3 | 版本化响应：请求带 `if-snapshot-unix`，快照没变返回 304 | 882KB 快照每分钟重传 | 带宽约 -90%，Go 序列化开销消失 |
| 4 | `/options/status` 轻量化，或把 underlying 绑定并入 version 响应 | bars_only 的 10s 陪葬 502（resolvedUnderlying 串行依赖） | K 线链独立成活，不再被期权计算拖累 |
| 5 | 背压语义：过载时 429 + `Retry-After` | 前端退避/熔断靠猜 | 降频幅度有据可依 |
| 6 | WS 应用层心跳/ack + 断线订阅恢复 | K 线半开静默冻结（2026-09-11 实测 4 分钟无感知） | 冻结可观测、可自动恢复 |
| 7 | `healthz` 暴露队列深度/计算耗时 | 熔断器只能靠延迟推断 | 降频更准、更早 |

### 4.4 协作协议（契约）

- **节奏契约**：Go 承诺产出节奏（0dte 60s / d30·d90 300s / close 日结），前端按 §3.2 节奏表消费（消费可比产出慢，永不比产出快的档位无意义轮询）。
- **版本协议**：`(product, scope, unix)` 三元组是唯一的"有新数据"信号。当前经 version 轮询下发；推送化后同一三元组作为推送事件载荷——**前端消费逻辑零改动**，只是从"每 30s 问一次"变成"被推醒"。
- **降级协议**：Go 过载 → 429 + Retry-After → 前端按值退避；快照缺失 → `missing_reason` 空态（展示红线不变：不降级为 0、不造数）；推送断 → version 30s 心跳自动接管。
- **联动放宽**：Go 落地 #2 后重车道信号量可从 2 放宽到 3~4；落地 #1 后调度器退化为纯兜底，定时拉取只保留 K 线尾部与心跳。

### 4.5 终局数据流（无阻塞形态）

```
常态：Go 预计算出新快照 → 推送 (product,scope,unix) → 前端调度器按车道拉取对应 scope
      K 线：WS 增量直推；REST 尾部 60s 定频兜底
推送断：version 30s 心跳发现 unix 变化 → 走同一拉取路径
Go 病态：健康度熔断降频 + 排队预期可见 + Retry-After 退避
休市：  总闸全停，version 5 分钟一探，收盘后 EOD 档单独唤醒
```

任何一环失效都有下一环兜底，且每层失败都显式可见——不存在"静默冻结"这个状态。

---

## 五、点击触发的加载顺序策略

点击 = 用户显性意图，**优先级最高，但必须排队而不是并发轰炸**。统一规则：点击产生的所有新 key 请求进重车道；同一次点击产生多个请求时按下列组内顺序错峰（前一个完成或 ≥2s 后放下一个）。

| 点击场景 | 产生的请求 | 加载顺序策略 |
|---|---|---|
| 总控多选 chips 切换 | 所有联动面板换新 scope key（01/05/06/07/08/09/10 可能同时） | ① 06 K 线（快车道，与 scope 无关不动）→ ② 主周期 dashboard（01/08 表格类）→ ③ 06 水位/VP → ④ 07 chain → ⑤ 10 term；缓存已有的 key 直接显示不发请求 |
| 品种切换（窗内或主控） | 整窗全部 key 更换 | ① K 线整窗+尾部（快车道先行，图先出来）→ ② version → ③ 主 scope dashboard → ④ 其余档 |
| 06 期权水位多选 scope | `useOptionsIntradayMulti` + `useOptionsDashboardMulti` 每加一个 scope 多 2 条重请求 | 固定顺序 0dte → d30 → d90 逐个错峰，**不允许三档齐发**；options_only 单档已知 58s 病态，未归一前同时最多 1 档在飞 |
| 06 图层开关（OI 分布 / 成交量分布 / 水位显隐） | 开=新查询，关=enabled 门控停取数 | 图层**显隐只控渲染不取数**（现状已对，保持）；图层**开关**触发取数进重车道 |
| 09 期权链下钻（点到期日） | 单条 chain 新 key | 用户显性下钻 → 重车道**队首插队** |
| 05 热力图 front/全部切换 | dashboard days=1 ↔ days=90 换 key | 单请求，正常排队 |
| 06 历史回看窗（◀▶） | 整窗 bars + 水位（asof 固定，拉一次永久有效） | 快车道 bars 先行，水位随后；历史窗不轮询（现状已对） |
| 05/09 下钻联动（board-focus-store） | 08/09 被动切 key | 视同对应窗的点击规则 |

---

## 六、WS 的处置（本轮不删，待服务端同事审）

- **保留**：WS 链路（`candle-stream-manager` / `useOptionsCandleStream` / `/api/auth/candles-ws`）原样保留，交服务端同事审查"半开连接静默丢订阅"。
- **降级为非权威路径**：REST 定频尾部是 K 线新鲜度的**唯一保证**；WS 数据来了就合并（现状 merge 逻辑不变），不来不依赖。
- **看门狗补拉进快车道**：现状看门狗 recover 走普通队列会被堵死；改造后 recover 与 60s 尾部同车道，保证"WS 死了最多滞后一个尾部周期"。
- **服务端审查清单**（交接用）：① WS 有无应用层心跳/ack；② 订阅在 Go 侧重连后是否自动恢复；③ 半开连接的最大静默时长；④ `final` 标记在 REST tail 中是否同样下发（决定形成中 bar 的可见性）；⑤ **评估期权快照推送化**（§3.6-1）：一条 WS 同时推 K 线增量 + 快照版本通知，是消除 Go 侧竞争的治本方向。

---

## 七、配套修正（随调度器一起做）

1. **options_only 拆出 K 线族**：从 `useOptionsIntradayMulti` 独立为水位专用 hook，进重车道、受休市门控、按 §3.2 分档节奏（0dte 60s / d30·d90 3600s）。当前 300s 固定轮询 + 每 30s 失败重试的组合是烧连接主犯。
2. **dashboard key 归一**：0dte 同时存在 days=1（05 front）与 days=20 两份缓存（各 185KB+）；评估 05 front 能否消费统一 key，减少一路并发。
3. **resolvedUnderlying 会话级缓存**：status 10s 超时是 bars_only 502 的直接原因；按 `(product, 交易日)` 缓存解析结果，bars_only 不再每次先打 status。
4. **失败显式化（F12 口径）**：K 线尾部连续失败等异常不进 UI 角标，统一 `console.debug("[ms-data] …")`；面板 UI 只沿用既有空态注因红线（不降级为 0、不造数）。

## 八、实施清单与验收

| 阶段 | 内容 | 状态（2026-09-11） |
|---|---|---|
| A | 重车道信号量（`src/lib/request-lanes.ts`，≤2；优先级：09 下钻=2 队首 > 0DTE=1 > 其他=0）+ 调度器（`data-freshness.ts` 重写：按 (product,scope) 粒度、分档/相位/每拍 ≤2、失败指数退避 1→2→4→5min）；不做降频，节奏恒定 | ✅ 已实施 |
| B | K 线尾部对齐整分+4s（墙钟定时器替代 refetchInterval）；options_only 分档（0dte 60s / d30·d90 3600s）+ 休市门控 + 熔断降频；排队/慢请求诊断全部 console.debug（UI 零提示） | ✅ 已实施 |
| C | 点击路径：09 下钻经 chain priority 插队队首（其余点击场景由信号量统一排队承载）；resolvedUnderlying 会话级 5min 缓存（`go-options.ts`） | ✅ 已实施；05 dashboard days key 归一暂缓（front 模式语义不同，改 key 会改数据口径） |
| D | 文档回写（本节 + AGENTS.md 速览）；`npx tsc --noEmit` 绿 | ✅ 已实施 |
| E | 超时链对齐 Go 实测（上游 55s / 路由预算 115s / 前端默认 120s，旧 25/35/60s 系统性掐掉"慢但有数据"的响应）；intraday/VP 去串联——锚点改 status（latestSnapshot 整函数删除），current 兜底改并行 best-effort 20s 软上限；K线整窗覆盖恢复（最早 bar 距窗口起点 >2h 或整窗 error → 冷却 180s 补拉，治"K线只剩尾部 30 分钟"）；退避软化 1→2→4→5min | ✅ 已实施（2026-09-11 午后，备份 `_backup/2026-09-11_1444_timeout-recovery/`） |

**验收方法（4173 实测）**：F12 Network 观察并发与节奏、Console 过滤 `[ms-data]` 看排队/退避/降频诊断、dev 服务器日志看 BFF 耗时。详见交付时的验收清单。

**红线回顾**：无数据显示空态并注因，不降级为 0、不造数；本仓零计算，所有节奏调整只改"何时取、取多少"，不改数据语义。

---

## 九、首屏提速：本地快照持久化与口径错位修复（2026-09-11）

### 9.1 问题

1. **刷新即全丢**：React Query 纯内存缓存（`providers.tsx`），调度器状态（`scopeStates`）也是内存态，BFF 响应一律 `Cache-Control: no-store`——每次刷新/重开页面，close 档快照（~905KB）、K线整窗（~142KB）全部重拉，Go 重聚合常态 25~60s，用户干等。
2. **`refetchOnWindowFocus: true`**：切回标签页触发所有 stale 查询重拉，900KB 级大快照反复触发 Go 重聚合。
3. **三处口径/扇出错位**：
   - 前端 `getOptionDashboard` 恒传 `days=20`，顶掉 BFF 按 scope 的默认口径（0dte=1 / d30=30 / d90=90 / close=45）——0dte 白传 20 天、close 被砍成 20 天；
   - `getOptionLevels` 对 close 档恒用 `now-1h` 窗口，与 EOD 快照时间错位，恒为空打；
   - BFF `term` 在 `/options/term` 无 IV 时串行扇出 dashboard（0dte 不够再 d90），最坏 30+55+55=140s 顶爆 115s 路由预算恒 504。

### 9.2 方案（已全部落地）

**P0 本地持久化（新增 `src/features/options/query-persistence.ts`）**

- 白名单查询族（dashboard / intraday / levels / term / chain / volume-profile，排除 bars-tail 小窗）成功响应防抖 1s 落 IndexedDB（`marsoon-query-cache`），标签页隐藏时立即落盘；查询被移除时同步删库；记录寿命 24h，过期恢复时丢弃并清库。
- `providers.tsx` 启动门控：先把 IDB 快照灌回 QueryClient（`setQueryData` 保留原 `dataUpdatedAt`，不覆盖更新数据），再挂载业务树——EOD/K线首屏直接命中本地缓存秒开。
- **`refetchOnWindowFocus` 全站关闭**：新鲜度统一由 version 轮询 + 调度器失效驱动。
- 各 hook `staleTime` 与调度消费节奏对齐（新导出 `scopeStaleTimeMs(scope)`：0dte 60s / all 300s / d30·d90 3600s / close 24h），挂载/恢复不比后端产出更勤地重拉。

**调度器配套（`data-freshness.ts`）**

- `scopeStates` 持久化到 localStorage（`marsoon-scope-states-v1`，只存 unix + fetchedDay）；恢复时 `nextDueAt` 归零：首拍立即拿 version unix 比对——**没变就一次重拉都不发，变了马上补拉**。
- 首见基线修正：旧逻辑"初见只记基线 unix"在持久化场景会把旧快照永久挂住；现在比对缓存取数时间与 version 快照 unix，缓存早于快照则首拍强制补拉。

**P1 口径/扇出修复**

- `getOptionDashboard` 缺省不再传 `days`（key 里记 `auto`），由 BFF `defaultDashboardDays` 按 scope 给口径；05 热力图 front/wider 的显式 days 不受影响。
- close 档 levels 不再传 `now-1h` 窗口；BFF `levels()` 对 close 缺省窗口锚定 status 里 close 快照的 unix（snap-3600 ~ snap+tf）。
- BFF `term()` 的 0dte 扇出改并发（dashboard 0dte 与 d90 同时发），最坏 140s→85s，不再顶爆路由预算；`upstream()` 的 10s 在途去重吸收与面板自身 dashboard 查询的重复算力。

### 9.3 行为约定

- unix 没变：重开页面零重请求，本地快照直接渲染（EOD/K线秒开）。
- unix 变了：调度器失效 → 后台重拉，页面始终先有旧画面，不闪空态。
- 本地持久化是纯增强：IDB 不可用时静默降级为原行为。
- 红线不变：数据仍只来自 Go；本地缓存的只是 Go 的响应，不做任何本地计算/修补。

### 9.4 服务端根治项（本仓改不了）

详见 `docs/backend/服务端优化与更新策略.md` §5 清单与 2026-09-11 补充节：请求路径零重算（预计算+快照缓存）、gzip/br、ETag/304、快照推送化、背压与健康信号、logout 端点、口径确认。
