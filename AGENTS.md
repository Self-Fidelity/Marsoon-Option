# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

---

# 项目速览（Marsoon-Option）

CME 期货期权看板（ES/NQ/GC）。**数据源唯一：Go 期权服务**（`OPTIONS_API_BASE_URL`，唯一模式直连 unified 接口；旧 `OPTIONS_API_MODE`/legacy 本地组合层已于 2026-09-11 删除）。Next.js BFF（`src/server/go-options.ts`）是浏览器与 Go 之间的唯一通道；希腊字母、GEX、墙位/翻转位全部由后端预计算下发，**本仓零计算、零本地数据源、零降级造数**：拿不到数据即空态 + `missing_reason`。数据新鲜度由 Go 派生的轻量版本端点 `GET /api/options/version`（`(product, scope, unix)` 三元组）驱动失效，实现见 `src/features/options/data-freshness.ts`。

> 🚨 **【最高优先 · 服务器端同事必读】** 本仓是前端 + BFF，大量性能与数据问题**只能**由 Go 服务端解决，前端侧能做的已全部落地。任何服务端开发/排障开始前，**必须先读 `docs/backend/服务端优化与更新策略.md`**（需求单 + 实测证据 + 优先级 + 验收基准），并配套阅读 `docs/architecture/K线与期权数据周期管理与防堵塞设计.md` §六（WS 审查清单）与 `docs/interface/Go后端接口清单.md`。**不读需求单就动服务端 = 大概率返工。** 速览见下文「服务器侧（Go）待办」。
>
> ⚠️ **【郑重提示 · 致所有 AI 助手（GPT/Codex/Claude/Kimi 等）】`docs/backend/服务端优化与更新策略.md` 是本项目最重要的文档，没有之一。** 凡涉及数据为空、指标不显示、加载慢、口径异常（墙位/GEX/OI/Flip）、GC 多合约月份、超时 502 等一切数据问题的排查，**第一步必须是通读该需求单**——其中 §8（0DTE 墙位倒挂）、§9（GC 期权层空白实测）等都是已花大量实测定位完毕、只等后端落地的结论。请勿在前端重复排查已定位的根因、请勿提出已在文档中解答的方案、请勿改动前端口径去"修"服务端数据问题（红线：零计算、零修饰）。

> 2026-09-07（06 图表恢复）：GitHub 目录副本按 Codex 历史提交恢复 Lightweight Charts K线、期权成交量剖面和 0DTE 净 GEX/DEX/CHEX Stats。当前短窗口无 K线时只读回退最近 7 天中的最后一个真实 CME 交易日，并明确显示回退提示；不补空 bar、不造指标。Stats 使用后端固定 Expected Move 窗口字段，缺分钟不前填。
> 2026-09-07（05 热力图恢复）：dashboard 当前 0DTE 为空时，历史回退必须优先读取最后一个真实 `scope=0dte` 状态，禁止用时间更新但语义不同的 `nearest` 状态覆盖回退锚点。热力图继续消费 `dashboard.heatmap.cells/levels` 的同分钟快照，不跨分钟累计。
> 2026-09-07（06 窄高恢复）：OHLCV 读数不再占独立 flex 行，改为主图右上角悬浮；图宽小于 360px 时隐藏读数，优先保证 Lightweight Charts 价格绘图区高度。数据和指标计算不变。
> 2026-09-07（06 黑屏修复）：Lightweight Charts 实例绑定实际 chart host 节点；Dockview 移动/最大化/HMR 替换宿主时销毁旧实例并在新节点重建，随后按 `chartApi` 重新灌 K线、成交量、GEX/期权成交量 primitive、水位和历史线，避免只有 OHLC/价签而无 Canvas。
> 2026-09-07（06 K线优先）：`GET /api/options/intraday?bars_only=true` 只读 status + underlying-bars，不等待 dashboard/期权计算；前端 `useOptionsIntradayBars` 与各 scope intraday/dashboard 并行，请求返回后先画 K线，期权水位、GEX、期权成交量和 Stats 后到后叠加。
> 2026-09-07（默认入口/布局）：登录无显式 next 以及根路径 `/` 均进入 `/board`。自动布局键升级为 `marsoon-board-layout-v4`；用户主动保存的默认模板仍优先。（出厂布局 2026-09-11 起改为仅日内单窗，见上方"面板收敛"条。）
> 2026-09-07（06 OHLC Legend）：OHLCV 悬浮读数固定在主图左上角，所有 indicator legend 从其下方开始纵向排列；小于 360px 时继续隐藏 OHLCV，indicator legend 回到 top-2。
> 2026-09-07（06 OI/成交量 Profile）：原内嵌 GEX 剖面改为“期权 OI 分布”，实际画 Call/Put OI；原“期权成交量”改名“期权成交量分布”。两者每个 bin 的高度统一为一个真实 tick 经当前价格轴映射后的像素高度，最小 1px，缩放时自动变化。
> 2026-09-07（公开文案边界）：错误、加载、等待和无数据状态不得暴露 Go/Databento、内部域名或路径、HTTP 诊断、ticker/symbol/underlying/series id。`sanitizePublicData` 统一清洗 `/api/options/*` 浏览器响应；正常有数据视图仍可显示用户需要的品种与合约名称。
> 2026-09-09（06 期权统计移除）：日内图不再提供期权 Stats 指标；前端入口、副图、模型、请求 Hook、同源 `/api/options/stats` 路由及窗口配置均已删除。后端原始接口未改动。
> 2026-09-08（教学看板集成）：`/teaching` 为 Next.js/React 导航壳，默认首页，`?lesson=05`～`10` 切换对应课程；7 个自包含 React HTML 维护在 `public/teaching-content/`。旧 `public/teaching.html` 占位文件已删除。
> 2026-09-09（用户留存）：全局 `ClientActivityReporter` 只在登录后/冷启动恢复和后台超过 30 分钟再前台时上报；pending UUID+user 写 localStorage 幂等重试。浏览器只发 event_id，Next `/api/auth/activity` 从 HttpOnly Cookie 取 Token 后代理 Go `/client/activity`，禁止客户端提交 user/date/time/token/邮箱或设备原始标识。
> 2026-09-10（数据源单一化）：免费网页源采集链路已从本仓**彻底移除**——采集脚本、快照内存仓、本地 Greeks/分析模块、采集推送与状态路由、状态徽标组件与旧状态轮询 hook 全部删除，代码与文档中不再保留任何相关引用。失效驱动改为 Go 派生的 `GET /api/options/version`（仅 `(product, scope, unix)`），并带"存在 error 查询则每次版本轮询重试"的兜底，避免首屏失败后永久空态。**此后本仓数据只能来自 Go 服务。**
> 2026-09-11（调度器+双车道）：版本失效改为**按 (product, scope) 粒度调度**（分档 0dte 60s / all 300s / d30·d90 3600s + 相位错位 + 每拍≤2 + 失败指数退避 1→2→4→5min，休市重车道全停；节奏恒定不做降频），取代上一条的全局 v 失效与"每 30s 无差别重试 error 查询"。期权重端点（dashboard/chain/水位/VP/levels/term/iv-term）经 `src/lib/request-lanes.ts` 重车道信号量 ≤2 排队，优先级 **K线（快车道）> 09 下钻 > 0DTE > 其他周期**；K 线尾部墙钟对齐整分+4s；options_only 休市停轮、按档分频；close（EOD）档 unix 驱动 + 每交易日最多拉一次（收盘界定复用 `cme-session.ts` 的 16:00 CT 结算口径），BFF 已放行 close 直连 Go（五路由 close 短路与 legacy 双模式当日下午整体删除）；BFF `resolvedUnderlying` 5min 会话缓存（修 bars_only 的 10s 陪葬 502）。诊断一律 `console.debug("[ms-data]")`，**UI 不出现排队/降频/卡顿提示**。权威设计：`docs/architecture/K线与期权数据周期管理与防堵塞设计.md`。
> 2026-09-11（超时链对齐+整窗恢复）：Go 重聚合实测常态 25~60s，超时链重对齐为上游 55s / 路由预算 115s / 前端 120s（heatmap 25s 专用保留不动）；intraday/VP 锚点改 status 接口（去掉每请求串行一整次 dashboard），current 兜底懒触发 20s 软上限；K线整窗按覆盖度自动补拉（最早 bar 缺口 >2h 或整窗 error，冷却 180s）。
> 2026-09-11（面板收敛：01/08 删除、05 跳足迹图、06 新增 Exposure 副图）：**01 总览与 08 GEX 拆分两个面板整体删除**（注册表条目、wrapper、组件、模型、出厂布局、相关测试脚本全删；`TableDashWindow` 骨架随之删除）。原 01 的 Exposure 剖面图（OI/GEX/DEX/CHEX 模式切换）挪为 **06 底部独立副图指标「Exposure 剖面」**（`ExposureProfilePane.tsx` + `exposure-profile-model.ts` + `strike-viewport.ts`（原 overview-viewport 改名，07/10 IvTermPanel 仍在用）），窗口配置 `exposureProfileEnabled/Visible/Scope`，**默认未添加，仅从「+ 指标」按需开启；未添加或眼睛关闭时不发 dashboard 请求**（`enabled: visible && enabled && visible` 门控，与 vpQuery 同 key 时自动去重）。**05 热力图点击（列头/行头/格子）改为新标签页打开订单流足迹图外链 `https://subapp.marsoon.cn/`（不带参数）**，原 05→09/08 下钻联动全链路删除（`board-focus-store.ts` 整删，09 的 flashExpiry 消费移除；09 面板本身保留）。老布局存档/模板含 `gex`/`overview` 面板时走既有"未知面板整档作废"回退出厂布局；出厂布局改为仅日内单窗。

> 2026-09-11（首屏提速：本地持久化 + 口径错位修复）：大快照（dashboard/intraday/levels/term/chain/VP）成功响应持久化到 IndexedDB（`src/features/options/query-persistence.ts`，24h 寿命，bars-tail 不入库），`providers.tsx` 启动门控先灌缓存再挂载业务树；调度器 `scopeStates` 持久化到 localStorage（`marsoon-scope-states-v1`）+ 首见基线修正（缓存取数时间早于 version unix 则首拍强制补拉）——**快照 unix 没变时重开页面零重请求、EOD/K线秒开**；`refetchOnWindowFocus` 全站关闭，各 hook staleTime 与调度消费节奏对齐（`scopeStaleTimeMs`）。P1 修复：dashboard 前端不再恒传 days=20（由 BFF `defaultDashboardDays` 按 scope 给口径 1/30/90/45）；close 档 levels 不再用 now-1h 错位窗口（BFF 锚定 close 快照 unix 取窗）；BFF term 0dte 扇出改并发（最坏 140s→85s，不再顶爆 115s 路由预算）。设计细节：`docs/architecture/K线与期权数据周期管理与防堵塞设计.md` §九。
> 2026-09-12（GC 期权层空白修复）：用户实测 06 面板「期权OI分布·前日EOD / 期权成交量分布·0DTE / 期权水位·0DTE」**黄金全空白但 K 线正常**。定位：非前端逻辑错（真实 payload 回放编译件，三层对 GC 全部应渲染），是三个层共用重车道而 K 线走快车道——GC 响应在 1~3KB/s 无压缩链路上传不完 55s 上游预算（GC close 772KB / 旧 intraday 170KB / VP 2h 208KB），系统性 502。前端治标：BFF intraday 裁剪 `levels[]`（全仓确认无消费方，GC 170KB→约 2KB）+ `mergeDashboardCurrent` 改新鲜度优先（修 dashboard 旧快照回盖新 current 的水位回跳）。OI 分布·close 仍受 GC close 裸传制约，根治靠服务端 S1（实测证据录服务端需求单 §9）；另记录 GC close 不传 underlying 时 argMax 选到 GCZ7 远月、GC status 多合约月份 entries 两个后端口径问题。
> 2026-09-11（06 美东时间轴 + 默认 EOD 总控）：06 面板 X 轴/读数/十字光标一律美东时间（America/New_York，后缀 ET；10 IvTermPanel 到期标签仍 CT 不动）；06 默认视野 = 当前交易日开盘到收盘整段（`fitSession`，历史回看窗仍整窗 fitContent）；K线 reset 重灌后按时间域锚定恢复视野，不再 fitContent 跳视野。**总控出厂默认周期改为 `close`（EOD）单选**（`board-window-store.ts`：master/perProductScope 默认 + 旧 0dte 出厂档 hydrate 一次性迁移，localStorage 标记 `marsoon-scope-default-v2`，用户自主保存过的周期不动）。

## 🚨 服务器侧（Go）待办（交接同事，本仓改不了的部分）——**必读**

> **⚠️ 服务器同事开工前必须直接看需求单：`docs/backend/服务端优化与更新策略.md`**（§5 清单 + §7「2026-09-11 补充需求与优先级刷新」，含实测证据、优先级与验收基准）；WS 审查清单另见 `docs/architecture/K线与期权数据周期管理与防堵塞设计.md` §六。下表仅为速览，**不能替代需求单**。

本仓侧能改的已全部落地（设计文档 §八 阶段 A~E + §九 首屏提速）；以下只能 Go 侧做，按收益排序。细节：`docs/architecture/K线与期权数据周期管理与防堵塞设计.md` §4.3 + `docs/architecture/前端与BFF架构审计总览.md` 总结论。

1. **请求路径零重算**（最高优先）：所有读请求改 O(1) 快照读取（预计算 + 快照缓存）。实测 options_only 常态 21~58s、dashboard 2~28s、chain 6~20s，且 intraday/chain 0dte 长尾偶超 55s 突破前端超时——请求触发全量重算在本仓视为 bug。
2. **gzip/br 压缩**：全链路无压缩（close 905KB / levels 24h 3.4MB 裸传），开压缩约省 8~10×（需求单 S1）。
3. **期权快照推送化**（WS/SSE）：以 `(product, scope, unix)` 三元组作推送事件（与 candle WS 同通道即可），前端消费逻辑零改动，重车道轮询量约 -80%。
4. **WS K线链路审查**（用户明确要求留给服务端）：① 有无应用层心跳/ack；② Go 侧重连后订阅是否自动恢复；③ 半开连接最大静默时长（实测 4 分钟无感知）；④ `final` 标记在 REST tail 是否同样下发；⑤ candles-ws ticket 明文 token（审计 §六 #22）。
5. **版本化响应**：请求带 `if-snapshot-unix` / ETag，快照未变回 304（882KB 级快照每分钟重传 → 带宽约 -90%）。
6. **背压与健康信号**：过载回 429 + `Retry-After`；`healthz` 暴露队列深度/计算耗时。
7. **logout 注销端点**（P1-22）：目前前端退出登录只能清本地 Cookie。
8. **口径确认**：① close（EOD）档数据范围（BFF 已放行直连，实测 `dashboard?scope=close` 有 200 返回）；② 各档产出节奏实测值（0dte 60s / d30·d90 300s / close 日结——本仓无法证实，审计唯一不可证项）。

## 周期 scope 架构（2026-09-02 起；2026-09-03 十一轮起五档）

看板全局五档：`收盘 | 0DTE | 30DTE | 90D | RTH`（`OptionScope = "close" | "0dte" | "d30" | "d90" | "all"`，定义于 `src/api/options.ts`；`all` 显示名 RTH，key 不动）。

- `close`：Databento EOD 数据，BFF 已放行 unified 直连 Go（2026-09-11；原五路由无条件空态短路已改仅 legacy 生效）——是否有数据由 Go 裁决，无数据仍走空态（各面板 `ClosePendingState`，红线：缺数据显示空态，不降级为 0、不造数）。
- `0dte`：当前为免费源 15min 样本，Databento 接入后升 1min。
- `d30`：DTE ≤ 30 聚合（含 0DTE）。
- `d90`：DTE ≤ 90 聚合（含 0DTE），已替代旧 `nearest`。
- `all`：全期限（盘中口径，显示名 RTH）。

> 2026-09-03 起：全局总控（/board 顶栏 收盘/0DTE/30DTE/90D/RTH）为**多选**（至少 1 个，固定优先级 `0dte > d30 > d90 > all > close`，[0] 为主周期）；表格类/单值消费取主周期，line 窗（06/07/10）联动开时跟随总控、联动关时窗内自治（上限 3）。详见 `docs/frontend/周期架构迭代开发文档.md` 第十/十一节。
> 2026-09-04 起（09 第七轮/看板级第三十一轮）：🔗解耦 chip 统一捆绑品种+周期两维度——联动=跟随总控（table 类 chips 置灰），解耦=冻结当时周期快照窗内自治；📌 scopePinned 语义废除。09 窗口不再有周期 chips，恒跟总控（解耦=冻结）。
> ⚠️ **给后续 AI 助手（GPT）的强制备注**：09 期权链的周期当前为联动跟随总控，但其**周期框架因免费源数据限制未与大框架统一**——09 按单到期链（chain API）逐档下钻，**非** d30/d90 聚合口径。**未来接入 Databento 数据后必须统一改造**（09 周期框架对齐大框架聚合口径），完成时同步删除本条备注及面板表内同名备注。
> 2026-09-04（看板级第三十二轮）：导航收敛为两项——拼装看板 /board + 教学看板 /teaching（整页 iframe 加载 `public/teaching.html`，换内容只覆盖该文件）；旧仪表盘页路由保留仅移出导航。01 总览接 useMeasureSize：价位轴 svg 实测整数宽（废除写死 viewBox 860 的缩放发虚），窄窗（<520px）文字降档（MetricCard 新增可选 `compact`，旧页面不传不受影响）。
> 2026-09-04（看板级第三十三轮）：看板布局多模板系统——本地模板库存于 `marsoon-board-templates-v1`（含默认模板），「模板」浮层在「+ 数据面板」旁（保存/应用/设默认/删除/复制分享链接）；分享入口为 URL `?layout=`（deflate+base64url，前缀 `v1.`，无 CompressionStream 回退 `v0.` 未压缩）。启动恢复优先级：分享链接 payload → 默认模板 → 自动存档 → 出厂布局，应用后照常落自动存档。
> 2026-09-04（05 第一轮/看板级第三十四轮）：05 到期热力图产品化——列级 CW/PW/FLIP 标记、TERM Σ 跟随 mode、截断"+N"提示、hover 读数卡+交叉高亮、点行/列头下钻联动（新 `board-focus-store.ts` 瞬态 store：05 产 → 09 切到期 tab / 08 高亮最近档，TTL 30s）、窄窗四档 LOD（full/mid/compact/barsOnly）、色阶全局归一化+图例条；详见 `docs/panels/05面板迭代开发文档.md`。
> 2026-09-04（看板级第三十六轮）：侧栏全站统一——废除 /board 特判与 NavDrawer 抽屉（组件已删），`Sidebar.tsx` 回归纯导航（宽度过渡 + 左滑动画），收起开关唯一化 `SidebarToggleButton`（图标随状态切换），只住页面功能栏（/board 顶栏 leading 位、/teaching 新增同款 h-16 功能栏：开关 + 标题，iframe 让位功能栏）；收起态存 `marsoon-sidebar-collapsed` 全站共享，仅 /board+/teaching 生效（`TOGGLE_PATHS` 白名单，其余页面恒展开避免死状态）。
> 2026-09-04（看板级第三十七轮）：05/08/09 新增「追踪 spot 居中」——共享 `use-spot-follow.ts`（向上解析 DockPanelBody 滚动容器、程序化/手动滚动 flag 区分、smooth 开启 + scrollend/超时复位、svg `<g>` 行用 rect 差值定位）+ 统一 `SpotFollowButton`（Crosshair 图标）；开启滚动到最近执行价行垂直居中，手动滚动立即退出追踪（TradingView 跟踪逻辑）；08 barsOnly 档可用，05 <280px 整行隐藏沿用旧口径。
> 2026-09-04（05 第二轮/看板级第三十八轮）：05 左轴多周期共振文字标签（替代第三十六轮未渲染的 glyph 方案）——每行每类型（CW/PW/FLIP/SPOT）合并一张 06 风格直角 chip（3px accent 竖条 + `badgeName` 周期前缀名 + `LEVEL_BADGE_EXPLAIN` hover），行轴宽 64→64+gutterW 动态加宽，每行最多 2 张按 CW>PW>FLIP>SPOT 取舍；05 拆出独立 `ExpirationWindow`（`useOptionsDashboardMulti` 取全部有效周期关键位，矩阵仍只消费主周期，08 骨架不动）；格子/墙框/锚点标记直角化（格子 hover 交叉高亮零改动）。详见 `docs/panels/05面板迭代开发文档.md`。
> 2026-09-04（05 第三轮/看板级第三十九轮）：SPOT 移出左轴 chip，改按 06 口径在 Y 轴实际价位放纯数字（与现货虚线同 y，撞车的行权价数字隐藏、点击下钻保留）；FLIP 改最近档吸附（修 1.5 tick 容差对连续价位几乎永不命中的 bug；墙保持精确容差）。
> 2026-09-04（06 第三十一轮/看板级第四十轮）：06 纯性能/交互手感优化（对齐 TradingView 流畅度，**零逻辑改动**——徽标/口径/布局/LOD 一律未动）——十字光标 mousemove、wheel 缩放（事件队列+rAF 本地 replay，复利推进数学等价）、拖拽平移全部 rAF 合帧（一帧最多一次渲染，getBoundingClientRect 降到每帧一次）；CandleLayer/VolumeLayer/VpStrip 拆 memo 组件（hover 帧跳过 2N 节点重建）；卸载兜底取消挂起 rAF。详见 `docs/panels/06面板迭代记录.md` 第三十一轮。
> 2026-09-04（06 第三十二轮/看板级第四十一轮）：06 新增「蜡烛 | 折线」切换（工具行分段 chip，默认蜡烛，不持久化、不重置视野）——折线=主周期收盘价连线（LineLayer memo 层，同一聚合数据与 x/y 映射）；折线变色规则：最后一根收盘价 ≥ 主周期 Gamma Flip 整条绿（--ms-chart-buy），跌破负区整条红（--ms-chart-sell），flip 缺失中性灰照常画；蜡烛逐根涨跌色不动。
> 2026-09-04（06 第三十三轮/看板级第四十二轮）：06 右轴悬浮化——K 线/折线/量柱吃满全宽（只让 VP），gutter 不再占布局宽（PAD_R/PAD_R_TOTAL/CANDLE_R_GAP 废除）；刻度数字、SPOT、十字光标价签加 --ms-plot-bg 直角衬底浮在 K 线上方（徽标 chip 本来就不透明底、零改动）；固定像素缝改为时间域右 margin（t1 右延 RIGHT_MARGIN_BARS=5 根 bar，随缩放走，纯渲染层不进 span/endIdx）；网格线贯通全宽。详见 `docs/panels/06面板迭代记录.md` 第三十三轮。
> 2026-09-04（06 第三十四轮/看板级第四十三轮）：拆开两种右侧重叠——放大后的「gutter」是 5 根 bar 时间域空区叠刻度/SPOT 衬底；缩小后的遮挡是固定像素宽的徽标牌。RIGHT_MARGIN_BARS 5→1；K 线 x 映射按 overlay 实测宽 + 4px 让位（CANDLE_MAP_RIGHT），网格/墙线仍贯通。不能靠再加 bar 数修缩小遮挡。详见 `docs/panels/06面板迭代记录.md` 第三十四轮。
> 2026-09-04（06 第三十五轮/看板级第四十四轮）：真轴列——第三十四轮裁 K 线但网格仍贯通，K 线像在徽标前消失，不合理。PLOT_RIGHT 为图区右缘（K 线/网格/量柱/hover 停此），轴列住刻度/徽标，1px 分隔，墙线再接到牌。详见 `docs/panels/06面板迭代记录.md` 第三十五轮。
> 2026-09-04（06 第三十六轮/看板级第四十五轮）：布局改为 [K 线+Y 轴数字][徽标列][VP]——刻度/SPOT 浮在图区右缘与 K 线一体，CW/PW/FLIP chip 夹在 Y 轴与 VP 之间。详见 `docs/panels/06面板迭代记录.md` 第三十六轮。
> 2026-09-04（06 第三十七轮/看板级第四十六轮）：四栏定死 [图区][Y 轴 56px][徽标列][VP]——数字退出图区，废除 bar 撑缝与刻度衬底。详见 `docs/panels/06面板迭代记录.md` 第三十七轮。
> 2026-09-04（06 第三十八轮/看板级第四十七轮）：外围框架抽 `intraday-frame.ts` 单一几何真源 + 三栏 clipPath，绘制/计算/徽标样式未改。详见 `docs/panels/06面板迭代记录.md` 第三十八轮。

## 面板状态（`/board`，注册于 `src/features/board/panel-registry.tsx`）

| 面板 | 状态 | 说明 |
|---|---|---|
| 05 到期热力图 | ✅ 实装 | 列级 CW/PW/FLIP 标记、TERM Σ 随 mode、截断提示、hover 读数卡、四档窄窗 LOD、全局归一化色阶（第三十四轮）；左轴多周期共振文字标签（06 风格直角 chip，SPOT 为轴上纯数字）+ 全直角化（第三十八/三十九轮）；点击列头/行头/格子新标签页打开订单流足迹图外链（2026-09-11，原 08/09 下钻联动已删）；文档 `docs/panels/05面板迭代开发文档.md` |
| 06 日内变化 Intraday | ✅ 实装 | 蜡烛图/折线切换 + 量柱 + 关键位；四栏 [图区][Y 轴][徽标列][VP]（第三十七轮）；底部独立副图指标「Exposure 剖面」（OI/GEX/DEX/CHEX 模式切换，窗口配置 `exposureProfile*`，未添加/隐藏时不发 dashboard 请求，2026-09-11 自 01 总览迁入）；文档 `docs/panels/06面板迭代记录.md` |
| 07 微笑偏斜 | ✅ 实装 | |
| 09 期权链 T 字面板 | ✅ 实装 | 10 列/侧 + 明细卡 15 字段；周期统一顶栏总控（窗内无 chips），列 LOD 自适应砍列；文档 `docs/panels/09面板迭代开发文档.md`。⚠️ 周期跟随总控但框架未统一（单到期链下钻 ≠ d30/d90 聚合），Databento 接入后必须改造 |
| 10 月间价差 · PCR | ✅ 实装 | IV 期限结构 + PCR 曲线；BCR 占位待付费源；文档 `docs/panels/10面板迭代开发文档.md` |

## 文档索引与迭代状态

| 文档 | 状态 | 备注 |
|---|---|---|
| `docs/panels/05面板迭代开发文档.md` | ✅ **已完成**（三轮记录） | 第三十四轮：列级墙/Flip、TERM Σ 随 mode、下钻联动 store、四档 LOD、全局色阶；第三十八轮：左轴共振文字标签 + 05 独立 wrapper + 直角化；第三十九轮：SPOT 改轴上纯数字、FLIP 最近档吸附；遗留：服务端 payload 裁剪未做（前端 model 层截断） |
| `docs/panels/09面板迭代开发文档.md` | ✅ **已完成**（八轮记录） | 第七轮：周期统一总控+解耦语义修复+列 LOD；遗留：涨跌幅真值待付费源（契约已留 `prev_close/change/change_pct` 恒 null） |
| `docs/panels/06面板迭代记录.md` | ✅ **已完成**（记录至第三十七轮） | 第三十七轮：四栏层次定死 [图区][Y 轴][徽标列][VP]；**红线：06 徽标不参与 LOD/缩放/压缩**；遗留：跨天回看未做 |
| `docs/panels/10面板迭代开发文档.md` | ✅ **已完成** | 遗留：BCR 待 P0-3；expiries 三产品同源疑似采集器问题待查；官方 IV=0 远端点未清洗 |
| `docs/frontend/周期架构迭代开发文档.md` | 🔄 **部分完成**（scope 五档+回放游标已实装） | 待办清单见该文档第六节（Databento EOD/1min、采集分频、05 对齐、06 收盘墙叠加、jsonl 归档） |
| `docs/frontend/看板架构演进.md` | ✅ **步一/步二已完成**（2026-09-03，Dockview + 品种下放 + 链接组 + 窗口配置 store + R1/R3） | 分窗化/链接组/三维联动模型已落地；步三（popout/BroadcastChannel/SSE）远期 |
| `docs/process/ITERATION.md` | ✅ 历史记录 | 第一轮迭代（数据正确性/采集器 v3） |
| `docs/architecture/业务逻辑.md` | 📋 设计意图参考 | 面板设计的原始依据 |
| `docs/architecture/数据开发.md` | 📋 参考，部分口径已过时 | scope/缺口判断以最新迭代文档为准 |
| `docs/process/ITERATION.md` | ✅ 已完成（2026-09-10 重写为 Go 时代迭代计划） | 待办以它和 `docs/backend/服务端优化与更新策略.md` 为准 |
| `docs/backend/供应商数据需求.md` | 📋 **付费源接入时的权威清单** | P0-2/P0-3/P2-1 等字段需求 |
| `docs/architecture/技术架构.md` / `docs/backend/后端规划.md` | 📋 参考 | |

## 迭代惯例

## 面板自适应规范（2026-09-03 起，06 第十九轮首创、本轮推广至 01/05/07/10）

- 新面板必须用共享 hook `src/features/board/use-measure-size.ts`（`useMeasureSize<T>(): [ref, {width,height}]`，ResizeObserver + rAF 合并，SSR 安全，首帧 {0,0} 用兜底尺寸下一帧实测重渲染）。
- chrome 固定 px / 绘图区吸收弹性：字号、徽标、gutter、轴列宽、区间缝一律写死 px 不随窗口缩放；弹性全部让给绘图区（`PLOT = 实测 − 固定 chrome`）。
- 面板级 `overflow-hidden`，任何尺寸下面板自身不出滚动条；wrapper 用 flex 高度链撑满窗口（`flex h-full min-h-0 flex-col overflow-hidden` + 内容 `min-h-0 flex-1`）。
- 禁止写死 viewBox 尺寸：svg `viewBox = 0 0 实测宽 实测高`。实测尺寸由 hook 输出整数（Math.floor）；svg 须显式 `width/height` 属性 + `absolute left-0 top-0`（不用 `h-full w-full` 100%，避免容器小数尺寸把 svg 撑回亚像素缩放、文字发虚），父级 `overflow-hidden` 兜底（06 第二十三轮 1A）。内容滚动型面板用 `width={w}` + `h-auto`。
- 空态/加载态用 `h-full min-h-0` 填满父级弹性格，禁止写死 `min-h-[Npx]` 撑出滚动条。
- **例外（内容纵向滚动型面板）**：行数 × 固定行高、高度随内容增长的面板（05 到期热力图）保留纵向滚动，滚动由 `DockPanelBody`（`overflow-auto`）承载；此类面板 wrapper 不加 `overflow-hidden`，须在注释中注明例外口径。

- 每个面板/主题在 `docs/panels/`（或对应子目录）下维护文档：需求口径 → 数据基础 → 开发步骤 → 明确不做 → 风险 → 执行记录。**规格与逐轮记录分两份**（样例见 06 面板的「规格 + 迭代记录」）。完成后在本文档的状态表标注。
- 展示红线：无数据显示 `—`/空态并注明原因，不降级为 0，不展示模拟数据。
- 空态来源红线（2026-09-11）：任何 scope/端点的空态必须来自响应的 `has_data`/`missing_reason`（Go 裁决），**禁止代码路径级短路**——review 看到 `if (scope === "close") return empty` 这类形状直接打回（教训：BFF 五路由 close 短路 + `OptionsDashboard.tsx` closePending 压数据，均为"请求根本没发出/数据被前端压掉"的 bug）。
- 配色/字号只用 `--ms-*` 变量；图表手写 SVG（无图表库）；可读性标准以 09 面板第四轮记录为准。
- 契约字段用 snake_case；引擎输出原始口径（theta 每年、vega 每 1.00），换算只在展示层（单一真源）。
- 负荷原则：本仓零计算、零本地数据源；结果分层缓存与聚合由后端承担；任何请求触发全量重算都是 bug。
- 验证：`npx tsc --noEmit`（项目无单测，lint 即 tsc）；dev 服务常在 4173 端口热重载，可实测接口，但**禁止向任何写入型接口 POST 数据**。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
