# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

---

# 项目速览（Marsoon-Option）

CME 期货期权看板（ES/NQ/GC）。数据源：Barchart 免费源经本机 WebBridge 采集（`scripts/barchart-poller.mjs`，默认 15min/轮），快照落盘 `data/snapshots/YYYY-MM-DD.jsonl`（append-only，单日可达 ~70MB，**读它必须流式逐行，禁止整文件 parse**）。希腊字母为本地 Black-76 计算（`src/server/barchart-greeks.ts`），共享分析层 `src/server/barchart-analysis.ts` 按快照 `capturedAt` 记忆化——**所有路由必须消费它，禁止各自重算**。

> 2026-09-07（06 图表恢复）：GitHub 目录副本按 Codex 历史提交恢复 Lightweight Charts K线、期权成交量剖面和 0DTE 净 GEX/DEX/CHEX Stats。当前短窗口无 K线时只读回退最近 7 天中的最后一个真实 CME 交易日，并明确显示回退提示；不补空 bar、不造指标。Stats 使用后端固定 Expected Move 窗口字段，缺分钟不前填。
> 2026-09-07（05 热力图恢复）：dashboard 当前 0DTE 为空时，历史回退必须优先读取最后一个真实 `scope=0dte` 状态，禁止用时间更新但语义不同的 `nearest` 状态覆盖回退锚点。热力图继续消费 `dashboard.heatmap.cells/levels` 的同分钟快照，不跨分钟累计。
> 2026-09-07（06 窄高恢复）：OHLCV 读数不再占独立 flex 行，改为主图右上角悬浮；图宽小于 360px 时隐藏读数，优先保证 Lightweight Charts 价格绘图区高度。数据和指标计算不变。
> 2026-09-07（06 黑屏修复）：Lightweight Charts 实例绑定实际 chart host 节点；Dockview 移动/最大化/HMR 替换宿主时销毁旧实例并在新节点重建，随后按 `chartApi` 重新灌 K线、成交量、GEX/期权成交量 primitive、水位和历史线，避免只有 OHLC/价签而无 Canvas。
> 2026-09-07（06 K线优先）：`GET /api/options/intraday?bars_only=true` 只读 status + underlying-bars，不等待 dashboard/期权计算；前端 `useOptionsIntradayBars` 与各 scope intraday/dashboard 并行，请求返回后先画 K线，期权水位、GEX、期权成交量和 Stats 后到后叠加。
> 2026-09-07（默认入口/布局）：登录无显式 next 以及根路径 `/` 均进入 `/board`。自动布局键升级为 `marsoon-board-layout-v4`，新出厂布局只含左侧日内、右侧 GEX 拆分；用户主动保存的默认模板仍优先。
> 2026-09-07（06 OHLC Legend）：OHLCV 悬浮读数固定在主图左上角，所有 indicator legend 从其下方开始纵向排列；小于 360px 时继续隐藏 OHLCV，indicator legend 回到 top-2。
> 2026-09-07（06 OI/成交量 Profile）：原内嵌 GEX 剖面改为“期权 OI 分布”，实际画 Call/Put OI；原“期权成交量”改名“期权成交量分布”。两者每个 bin 的高度统一为一个真实 tick 经当前价格轴映射后的像素高度，最小 1px，缩放时自动变化。
> 2026-09-07（公开文案边界）：错误、加载、等待和无数据状态不得暴露 Go/Databento/Barchart、内部域名或路径、HTTP 诊断、ticker/symbol/underlying/series id。`sanitizePublicData` 统一清洗 `/api/options/*` 浏览器响应；正常有数据视图仍可显示用户需要的品种与合约名称。

## 周期 scope 架构（2026-09-02 起；2026-09-03 十一轮起五档）

看板全局五档：`收盘 | 0DTE | 30DTE | 90D | RTH`（`OptionScope = "close" | "0dte" | "d30" | "d90" | "all"`，定义于 `src/api/options.ts`；`all` 显示名 RTH，key 不动）。

- `close`：Databento EOD 数据，**未接入，恒空态**（各面板 `ClosePendingState`，红线：缺数据显示空态，不降级为 0、不造数）。
- `0dte`：当前为免费源 15min 样本，Databento 接入后升 1min。
- `d30`：DTE ≤ 30 聚合（含 0DTE）。
- `d90`：DTE ≤ 90 聚合（含 0DTE），已替代旧 `nearest`。
- `all`：全期限（盘中口径，显示名 RTH）。

> 2026-09-03 起：全局总控（/board 顶栏 收盘/0DTE/30DTE/90D/RTH）为**多选**（至少 1 个，固定优先级 `0dte > d30 > d90 > all > close`，[0] 为主周期）；表格类/单值消费取主周期，line 窗（06/07/10）联动开时跟随总控、联动关时窗内自治（上限 3）。详见 `docs/周期架构迭代开发文档.md` 第十/十一节。
> 2026-09-04 起（09 第七轮/看板级第三十一轮）：🔗解耦 chip 统一捆绑品种+周期两维度——联动=跟随总控（table 类 chips 置灰），解耦=冻结当时周期快照窗内自治；📌 scopePinned 语义废除。09 窗口不再有周期 chips，恒跟总控（解耦=冻结）。
> ⚠️ **给后续 AI 助手（GPT）的强制备注**：08 GEX 拆分 / 09 期权链的周期当前为联动跟随总控，但其**周期框架因免费源数据限制未与大框架统一**——08 消费与 MarketState 匹配到期日的单到期快照、09 按单到期链（chain API）逐档下钻，二者均**非** d30/d90 聚合口径。**未来接入 Databento 数据后必须统一改造**（08/09 周期框架对齐大框架聚合口径），完成时同步删除本条备注及面板表内同名备注。
> 2026-09-04（看板级第三十二轮）：导航收敛为两项——拼装看板 /board + 教学看板 /teaching（整页 iframe 加载 `public/teaching.html`，换内容只覆盖该文件）；旧仪表盘页路由保留仅移出导航。01 总览接 useMeasureSize：价位轴 svg 实测整数宽（废除写死 viewBox 860 的缩放发虚），窄窗（<520px）文字降档（MetricCard 新增可选 `compact`，旧页面不传不受影响）。
> 2026-09-04（看板级第三十三轮）：看板布局多模板系统——本地模板库存于 `marsoon-board-templates-v1`（含默认模板），「模板」浮层在「+ 数据面板」旁（保存/应用/设默认/删除/复制分享链接）；分享入口为 URL `?layout=`（deflate+base64url，前缀 `v1.`，无 CompressionStream 回退 `v0.` 未压缩）。启动恢复优先级：分享链接 payload → 默认模板 → 自动存档 → 出厂布局，应用后照常落自动存档。
> 2026-09-04（05 第一轮/看板级第三十四轮）：05 到期热力图产品化——列级 CW/PW/FLIP 标记、TERM Σ 跟随 mode、截断"+N"提示、hover 读数卡+交叉高亮、点行/列头下钻联动（新 `board-focus-store.ts` 瞬态 store：05 产 → 09 切到期 tab / 08 高亮最近档，TTL 30s）、窄窗四档 LOD（full/mid/compact/barsOnly）、色阶全局归一化+图例条；详见 `docs/05面板迭代开发文档.md`。
> 2026-09-04（看板级第三十六轮）：侧栏全站统一——废除 /board 特判与 NavDrawer 抽屉（组件已删），`Sidebar.tsx` 回归纯导航（宽度过渡 + 左滑动画），收起开关唯一化 `SidebarToggleButton`（图标随状态切换），只住页面功能栏（/board 顶栏 leading 位、/teaching 新增同款 h-16 功能栏：开关 + 标题，iframe 让位功能栏）；收起态存 `marsoon-sidebar-collapsed` 全站共享，仅 /board+/teaching 生效（`TOGGLE_PATHS` 白名单，其余页面恒展开避免死状态）。
> 2026-09-04（看板级第三十七轮）：05/08/09 新增「追踪 spot 居中」——共享 `use-spot-follow.ts`（向上解析 DockPanelBody 滚动容器、程序化/手动滚动 flag 区分、smooth 开启 + scrollend/超时复位、svg `<g>` 行用 rect 差值定位）+ 统一 `SpotFollowButton`（Crosshair 图标）；开启滚动到最近执行价行垂直居中，手动滚动立即退出追踪（TradingView 跟踪逻辑）；08 barsOnly 档可用，05 <280px 整行隐藏沿用旧口径。
> 2026-09-04（05 第二轮/看板级第三十八轮）：05 左轴多周期共振文字标签（替代第三十六轮未渲染的 glyph 方案）——每行每类型（CW/PW/FLIP/SPOT）合并一张 06 风格直角 chip（3px accent 竖条 + `badgeName` 周期前缀名 + `LEVEL_BADGE_EXPLAIN` hover），行轴宽 64→64+gutterW 动态加宽，每行最多 2 张按 CW>PW>FLIP>SPOT 取舍；05 拆出独立 `ExpirationWindow`（`useOptionsDashboardMulti` 取全部有效周期关键位，矩阵仍只消费主周期，08 骨架不动）；格子/墙框/锚点标记直角化（格子 hover 交叉高亮零改动）。详见 `docs/05面板迭代开发文档.md`。
> 2026-09-04（05 第三轮/看板级第三十九轮）：SPOT 移出左轴 chip，改按 06 口径在 Y 轴实际价位放纯数字（与现货虚线同 y，撞车的行权价数字隐藏、点击下钻保留）；FLIP 改最近档吸附（修 1.5 tick 容差对连续价位几乎永不命中的 bug；墙保持精确容差）。
> 2026-09-04（06 第三十一轮/看板级第四十轮）：06 纯性能/交互手感优化（对齐 TradingView 流畅度，**零逻辑改动**——徽标/口径/布局/LOD 一律未动）——十字光标 mousemove、wheel 缩放（事件队列+rAF 本地 replay，复利推进数学等价）、拖拽平移全部 rAF 合帧（一帧最多一次渲染，getBoundingClientRect 降到每帧一次）；CandleLayer/VolumeLayer/VpStrip 拆 memo 组件（hover 帧跳过 2N 节点重建）；卸载兜底取消挂起 rAF。详见 `docs/06面板迭代开发文档.md` 第三十一轮。
> 2026-09-04（06 第三十二轮/看板级第四十一轮）：06 新增「蜡烛 | 折线」切换（工具行分段 chip，默认蜡烛，不持久化、不重置视野）——折线=主周期收盘价连线（LineLayer memo 层，同一聚合数据与 x/y 映射）；折线变色规则：最后一根收盘价 ≥ 主周期 Gamma Flip 整条绿（--ms-chart-buy），跌破负区整条红（--ms-chart-sell），flip 缺失中性灰照常画；蜡烛逐根涨跌色不动。
> 2026-09-04（06 第三十三轮/看板级第四十二轮）：06 右轴悬浮化——K 线/折线/量柱吃满全宽（只让 VP），gutter 不再占布局宽（PAD_R/PAD_R_TOTAL/CANDLE_R_GAP 废除）；刻度数字、SPOT、十字光标价签加 --ms-plot-bg 直角衬底浮在 K 线上方（徽标 chip 本来就不透明底、零改动）；固定像素缝改为时间域右 margin（t1 右延 RIGHT_MARGIN_BARS=5 根 bar，随缩放走，纯渲染层不进 span/endIdx）；网格线贯通全宽。详见 `docs/06面板迭代开发文档.md` 第三十三轮。
> 2026-09-04（06 第三十四轮/看板级第四十三轮）：拆开两种右侧重叠——放大后的「gutter」是 5 根 bar 时间域空区叠刻度/SPOT 衬底；缩小后的遮挡是固定像素宽的徽标牌。RIGHT_MARGIN_BARS 5→1；K 线 x 映射按 overlay 实测宽 + 4px 让位（CANDLE_MAP_RIGHT），网格/墙线仍贯通。不能靠再加 bar 数修缩小遮挡。详见 `docs/06面板迭代开发文档.md` 第三十四轮。
> 2026-09-04（06 第三十五轮/看板级第四十四轮）：真轴列——第三十四轮裁 K 线但网格仍贯通，K 线像在徽标前消失，不合理。PLOT_RIGHT 为图区右缘（K 线/网格/量柱/hover 停此），轴列住刻度/徽标，1px 分隔，墙线再接到牌。详见 `docs/06面板迭代开发文档.md` 第三十五轮。
> 2026-09-04（06 第三十六轮/看板级第四十五轮）：布局改为 [K 线+Y 轴数字][徽标列][VP]——刻度/SPOT 浮在图区右缘与 K 线一体，CW/PW/FLIP chip 夹在 Y 轴与 VP 之间。详见 `docs/06面板迭代开发文档.md` 第三十六轮。
> 2026-09-04（06 第三十七轮/看板级第四十六轮）：四栏定死 [图区][Y 轴 56px][徽标列][VP]——数字退出图区，废除 bar 撑缝与刻度衬底。详见 `docs/06面板迭代开发文档.md` 第三十七轮。
> 2026-09-04（06 第三十八轮/看板级第四十七轮）：外围框架抽 `intraday-frame.ts` 单一几何真源 + 三栏 clipPath，绘制/计算/徽标样式未改。详见 `docs/06面板迭代开发文档.md` 第三十八轮。

## 面板状态（`/board`，注册于 `src/features/board/panel-registry.tsx`）

| 面板 | 状态 | 说明 |
|---|---|---|
| 01 总览 Overview | ✅ 实装 | 实测宽自适应：价位轴整数宽不发虚，<520px 文字降档（第三十二轮） |
| 05 到期热力图 | ✅ 实装 | 列级 CW/PW/FLIP 标记、TERM Σ 随 mode、截断提示、hover 读数卡、下钻联动 08/09（board-focus-store）、四档窄窗 LOD、全局归一化色阶（第三十四轮）；左轴多周期共振文字标签（06 风格直角 chip，SPOT 为轴上纯数字）+ 全直角化（第三十八/三十九轮）；文档 `docs/05面板迭代开发文档.md` |
| 06 日内变化 Intraday | ✅ 实装 | 蜡烛图/折线切换 + 量柱 + 关键位；四栏 [图区][Y 轴][徽标列][VP]（第三十七轮）；文档 `docs/06面板迭代开发文档.md` |
| 07 微笑偏斜 | ✅ 实装 | |
| 08 GEX 拆分 | ✅ 实装 | 纯独立完整模式（原 06↔08 跨窗 VP 联动已废弃，06文档第二十六节）；LOD：实测宽 <560 进 barsOnly（只画填充条+spot/wall/flip 线，隐藏全部文字），标记线竖向拥挤时只画线不画标签。⚠️ 周期跟随总控但框架未统一（单到期快照 ≠ d30/d90 聚合），Databento 接入后必须改造 |
| 09 期权链 T 字面板 | ✅ 实装 | 10 列/侧 + 明细卡 15 字段；周期统一顶栏总控（窗内无 chips），列 LOD 自适应砍列；文档 `docs/09面板迭代开发文档.md`。⚠️ 周期跟随总控但框架未统一（单到期链下钻 ≠ d30/d90 聚合），Databento 接入后必须改造 |
| 10 月间价差 · PCR | ✅ 实装 | IV 期限结构 + PCR 曲线；BCR 占位待付费源；文档 `docs/10面板迭代开发文档.md` |

## 文档索引与迭代状态

| 文档 | 状态 | 备注 |
|---|---|---|
| `docs/05面板迭代开发文档.md` | ✅ **已完成**（三轮记录） | 第三十四轮：列级墙/Flip、TERM Σ 随 mode、下钻联动 store、四档 LOD、全局色阶；第三十八轮：左轴共振文字标签 + 05 独立 wrapper + 直角化；第三十九轮：SPOT 改轴上纯数字、FLIP 最近档吸附；遗留：服务端 payload 裁剪未做（前端 model 层截断） |
| `docs/09面板迭代开发文档.md` | ✅ **已完成**（八轮记录） | 第七轮：周期统一总控+解耦语义修复+列 LOD；遗留：涨跌幅真值待付费源（契约已留 `prev_close/change/change_pct` 恒 null） |
| `docs/06面板迭代开发文档.md` | ✅ **已完成**（记录至第三十七轮） | 第三十七轮：四栏层次定死 [图区][Y 轴][徽标列][VP]；**红线：06 徽标不参与 LOD/缩放/压缩**；遗留：跨天回看未做 |
| `docs/10面板迭代开发文档.md` | ✅ **已完成** | 遗留：BCR 待 P0-3；expiries 三产品同源疑似采集器问题待查；官方 IV=0 远端点未清洗 |
| `docs/周期架构迭代开发文档.md` | 🔄 **部分完成**（scope 五档+回放游标已实装） | 待办清单见该文档第六节（Databento EOD/1min、采集分频、05 对齐、06 收盘墙叠加、jsonl 归档） |
| `docs/看板架构演进.md` | ✅ **步一/步二已完成**（2026-09-03，Dockview + 品种下放 + 链接组 + 窗口配置 store + R1/R3） | 分窗化/链接组/三维联动模型已落地；步三（popout/BroadcastChannel/SSE）远期 |
| `docs/ITERATION.md` | ✅ 历史记录 | 第一轮迭代（数据正确性/采集器 v3） |
| `docs/业务逻辑.md` | 📋 设计意图参考 | 面板设计的原始依据 |
| `docs/数据开发.md` | 📋 参考，部分口径已过时 | scope/缺口判断以最新迭代文档为准 |
| `docs/免费数据源与抓取策略.md` | 📋 参考 | scope 口径已同步；采集策略判断以它为底 |
| `docs/供应商数据需求.md` | 📋 **付费源接入时的权威清单** | P0-2/P0-3/P2-1 等字段需求 |
| `docs/技术架构.md` / `后端规划.md` | 📋 参考 | |

## 迭代惯例

## 面板自适应规范（2026-09-03 起，06 第十九轮首创、本轮推广至 01/05/07/10）

- 新面板必须用共享 hook `src/features/board/use-measure-size.ts`（`useMeasureSize<T>(): [ref, {width,height}]`，ResizeObserver + rAF 合并，SSR 安全，首帧 {0,0} 用兜底尺寸下一帧实测重渲染）。
- chrome 固定 px / 绘图区吸收弹性：字号、徽标、gutter、轴列宽、区间缝一律写死 px 不随窗口缩放；弹性全部让给绘图区（`PLOT = 实测 − 固定 chrome`）。
- 面板级 `overflow-hidden`，任何尺寸下面板自身不出滚动条；wrapper 用 flex 高度链撑满窗口（`flex h-full min-h-0 flex-col overflow-hidden` + 内容 `min-h-0 flex-1`）。
- 禁止写死 viewBox 尺寸：svg `viewBox = 0 0 实测宽 实测高`。实测尺寸由 hook 输出整数（Math.floor）；svg 须显式 `width/height` 属性 + `absolute left-0 top-0`（不用 `h-full w-full` 100%，避免容器小数尺寸把 svg 撑回亚像素缩放、文字发虚），父级 `overflow-hidden` 兜底（06 第二十三轮 1A）。内容滚动型面板（08）用 `width={w}` + `h-auto`。
- 空态/加载态用 `h-full min-h-0` 填满父级弹性格，禁止写死 `min-h-[Npx]` 撑出滚动条。
- **例外（内容纵向滚动型面板）**：行数 × 固定行高、高度随内容增长的面板（08 完整模式、05 到期热力图）保留纵向滚动，滚动由 `DockPanelBody`（`overflow-auto`）承载；此类面板 wrapper 不加 `overflow-hidden`，须在注释中注明例外口径。

- 每个面板/主题一份 `docs/XX迭代开发文档.md`：需求口径 → 数据基础 → 开发步骤 → 明确不做 → 风险 → 执行记录（逐轮追加）。完成后在本文档标注状态。
- 展示红线：无数据显示 `—`/空态并注明原因，不降级为 0，不展示模拟数据。
- 配色/字号只用 `--ms-*` 变量；图表手写 SVG（无图表库）；可读性标准以 09 面板第四轮记录为准。
- 契约字段用 snake_case；引擎输出原始口径（theta 每年、vega 每 1.00），换算只在展示层（单一真源）。
- 负荷原则：原始数据只追加只读一次；回放走游标增量；结果分层缓存；任何请求触发全量重算都是 bug。
- 验证：`npx tsc --noEmit`（项目无单测，lint 即 tsc）；dev 服务常在 4173 端口热重载，可实测接口但**不得 POST 污染 `data/` 落盘**。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
