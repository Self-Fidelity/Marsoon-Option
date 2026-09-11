# Marsoon Option

CME 期货期权市场结构看板（ES / NQ / GC）。Next.js App Router + 手写 SVG，主题对齐 `marsoon-rs` 的 ClassicDark / Marsoon Tide。

产品只有两块，导航也只有两项：

```text
Marsoon Option
├── 拼装看板  /board      主工作台：Dockview 分窗，面板往里加
└── 教学看板  /teaching   独立教学页：整页 iframe
```

05 / 06 / 07 这类编号**不是**顶层产品，而是拼装看板里的数据面板。

> ⚠️ **给服务端（Go 后端）同事的必读提示**
> 本仓只是前端 + BFF，大量性能与数据问题只能由 Go 服务端解决。
> **请务必先读 [`docs/backend/服务端优化与更新策略.md`](docs/backend/服务端优化与更新策略.md)**（需求单 + 实测证据 + 优先级），
> 配套再看 [`docs/architecture/K线与期权数据周期管理与防堵塞设计.md`](docs/architecture/K线与期权数据周期管理与防堵塞设计.md) §六（WS 审查清单）
> 和 [`docs/interface/Go后端接口清单.md`](docs/interface/Go后端接口清单.md)。不读后端的待办就直接改本仓，大概率白做。

## 2026-09-11 大版本更新（与上一版对比）

本版是一次**瘦身 + 防堵 + 提速**更新，前端架构收敛为「唯一数据源 = Go 期权服务」。
以下全部变更已落地，旧实现整体删除（不回退、不留开关）。

### 一、彻底删除的内容

**1. barchart 免费源采集链路（整链删除）**
上一版前端内嵌了一条完整的免费数据自采集管线，本版整体移除：

- 采集脚本 `scripts/barchart-poller.mjs`
- 采集推送路由 `src/app/api/ingest/barchart/route.ts`
- 快照内存仓 / Greeks 计算 / 分析模块：`src/server/barchart-store.ts`、`barchart-greeks.ts`、`barchart-analysis.ts`
- 本地期权实时模型 `src/server/options-live-model.ts`、EOD 新鲜度 `src/server/eod-freshness.ts`、Go 适配层 `go-options-adapter.ts`
- 状态徽标组件 `data-source-badge.tsx` 与状态轮询 hook `ingest-status.ts`
- 相关测试脚本（`test-eod-freshness.mjs`、`test-gex-breakdown-model.mjs`、`test-option-stats.mjs`）

**2. local-demo 回退大 BUG（删除）**
上一版的演示/回退数据层是空态与脏数据的第一根因：拿不到 Go 数据时曾回退到本地造数或旧快照，页面显示看似正常、实则口径错误。本版**零降级造数**：任何端点拿不到数据即空态 + `missing_reason`（由 Go 裁决），不再有代码路径级短路。页面顶部的 `DEMO` 语义废弃。

**3. 面板收敛：01 总览、08 GEX 拆分整体删除**
- 两个面板的注册表条目、wrapper、组件、模型、出厂布局、相关测试脚本全部删除；`TableDashWindow` 骨架随之删除。
- 原 01 的 Exposure 剖面图（OI/GEX/DEX/CHEX 模式切换）挪为 **06 底部独立副图指标「Exposure 剖面」**（默认未添加，从「+ 指标」按需开启；未添加或眼睛关闭时不发 dashboard 请求）。
- 05 热力图点击（列头/行头/格子）改为新标签页打开订单流足迹图外链 `https://subapp.marsoon.cn/`；原 05→09/08 下钻联动全链路删除（`board-focus-store.ts` 整删）。
- 老布局存档/模板含 `gex`/`overview` 面板时自动回退出厂布局；出厂布局改为仅日内单窗。

**4. 06 期权 Stats 指标移除**
日内图不再提供期权 Stats 指标；前端入口、副图、模型、请求 Hook、同源 `/api/options/stats` 路由及窗口配置均已删除（后端原始接口未动）。

**5. 其它删除**
- 旧仪表盘页容器与旧文档（docs 根目录平铺的 20+ 份 md）全部归档到 `docs/{architecture,backend,frontend,interface,panels,process,teaching}` 七类子目录，`docs/README.md` 为索引。
- 周期总控的 `all`（RTH）档：本版仍保留为五档之一（见下），但出厂默认不再选它。

### 二、修复后端并发过多导致的请求堆积

上一版所有前端请求无差别并发直推 Go，Go 侧每个请求都触发全量重算（实测 options_only 常态 21~58s），高峰期请求在服务端堆积、互相拖死，表现为大面积超时与空态。本版改为**前端可做的全部防堵**：

- **按 (product, scope) 粒度调度器**（`src/features/options/data-freshness.ts`）：由 Go 派生的轻量版本端点 `GET /api/options/version`（`(product, scope, unix)` 三元组）驱动失效；分档节奏 0dte 60s / all 300s / d30·d90 3600s + 相位错位 + 每拍≤2 + 失败指数退避 1→2→4→5min；休市重车道全停；节奏恒定不做降频。
- **双车道请求队列**（`src/lib/request-lanes.ts`）：期权重端点经重车道信号量 ≤2 排队，**优先级 K线（快车道）> 09 下钻 > 0DTE > 其他周期**；K 线尾部墙钟对齐整分+4s；options_only 休市停轮、按档分频；close（EOD）档 unix 驱动 + 每交易日最多拉一次；诊断一律 `console.debug("[ms-data]")`，**UI 不出现排队/降频/卡顿提示**。
- **超时链对齐**：Go 重聚合实测常态 25~60s，超时链重对齐为上游 55s / 路由预算 115s / 前端 120s（heatmap 25s 专用）；intraday/VP 锚点改 status 接口（去掉每请求串行一整次 dashboard）；current 兜底懒触发 20s 软上限；K 线整窗按覆盖度自动补拉（最早 bar 缺口 >2h 或整窗 error，冷却 180s）。

权威设计：`docs/architecture/K线与期权数据周期管理与防堵塞设计.md`。

### 三、期权与 K 线数据读取权重优化（首屏提速）

- **K 线优先**：`GET /api/options/intraday?bars_only=true` 只读 status + underlying-bars，不等待 dashboard/期权计算；前端 K 线请求与期权请求并行，K 线返回先画，期权水位/GEX/成交量后到后叠加。
- **本地持久化**：大快照（dashboard/intraday/levels/term/chain/VP）成功响应持久化到 IndexedDB（24h 寿命），启动门控先灌缓存再挂载业务树；调度器 `scopeStates` 持久化到 localStorage + 首见基线修正——**快照 unix 没变时重开页面零重请求、EOD/K线秒开**。
- `refetchOnWindowFocus` 全站关闭；各 hook staleTime 与调度消费节奏对齐（`scopeStaleTimeMs`）。
- BFF 修正：dashboard 不再恒传 days=20（按 scope 给口径 1/30/90/45）；close 档 levels 锚定 close 快照 unix 取窗（修 now-1h 错位）；term 0dte 扇出改并发（最坏 140s→85s）；`resolvedUnderlying` 5min 会话缓存（修 bars_only 的 10s 陪葬 502）；close 五路由 BFF 已放行直连 Go。
- 06 面板 X 轴/读数/十字光标一律美东时间（ET）；默认视野 = 当前交易日开盘到收盘整段；**总控出厂默认周期改为 `close`（EOD）单选**（用户自主保存过的周期不动）。

### 四、不变的红线

- 数据源唯一：Go 期权服务（`OPTIONS_API_BASE_URL`）。本仓**零计算、零本地数据源、零降级造数**；希腊字母、GEX、墙位/翻转位全部由后端预计算下发。
- 空态来源必须是响应的 `has_data`/`missing_reason`（Go 裁决），禁止代码路径级短路。
- 公开文案不暴露 Go/Databento、内部域名、ticker/symbol 等内部信息（`sanitizePublicData` 统一清洗）。
- 展示红线：无数据显示 `—`/空态并注明原因，不降级为 0，不展示模拟数据。

## 产品结构

### 1. 拼装看板 `/board`

可拖拽分窗的工作台。顶栏管品种、周期、模板和数据状态；窗里放面板。布局可存成本地模板，也可用 `?layout=` 分享。

**工作台能力**

- 品种：NQ / ES / GC
- 周期总控（多选，至少 1 个，固定优先级 `0dte > d30 > d90 > all > close`）：收盘 | 0DTE | 30DTE | 90D | RTH
  - `close`（EOD）：Databento EOD 口径，**出厂默认**；BFF 已放行 unified 直连 Go，是否有数据由 Go 裁决，无数据走 `ClosePendingState` 空态。
  - `0dte`：当前 0DTE 口径；`d30`/`d90`：DTE ≤30 / ≤90 聚合（含 0DTE）；`all`（RTH）：全期限盘中口径。
- 窗口可与总控联动或解耦（品种 + 周期一起冻/跟）；表格类消费主周期，line 窗（06/07/10）联动开时跟随总控、关时窗内自治（上限 3）。
- 模板：保存 / 应用 / 设默认 / 删除 / 复制分享链接；自动布局键 `marsoon-board-layout-v4`。
- 侧栏可收起，状态全站共享。

**面板（都挂在拼装看板下）**

| 编号 | 面板 | 回答的问题 |
| --- | --- | --- |
| 05 | 到期热力图 | 仓位堆在哪些到期 × 执行价？点击任意格子/行列头新标签页打开订单流足迹图 |
| 06 | 日内变化 Intraday | 价格贴着哪堵墙？蜡烛/折线 + 量柱 + 关键位 + 可选 VP + 可选 Exposure 剖面副图 |
| 07 | 微笑偏斜 | 这条链的 IV 形状 |
| 09 | 期权链 T 字面板 | 单到期 T 字链下钻（⚠️ 周期跟随总控但按单到期链口径，接入 Databento 后需统一聚合口径） |
| 10 | 月间价差 · PCR | IV 期限结构与 PCR |

面板细节、口径和迭代记录在 `docs/panels/`，不在 README 展开。

### 2. 教学看板 `/teaching`

Next.js/React 导航壳，默认首页，`?lesson=05`～`10` 切换课程；7 个自包含 React HTML 维护在 `public/teaching-content/`。

### 其它路由

`/`（重定向 /board）、`/gamma`、`/zero-dte`、`/flow`、`/volatility` 是旧仪表盘容器，已移出导航，仅保留路由。`/panel-shot` 是截图工具，不是产品入口。

## 技术栈

- Next.js 16 App Router（注意：本仓锁定的 Next 版本与公开文档有出入，改代码前先读 `node_modules/next/dist/docs/` 对应指南）
- React 19
- TypeScript
- Tailwind CSS 4
- TanStack Query
- Dockview（分窗）/ Lightweight Charts（06 K线）
- pnpm

## 快速启动

环境要求：Node.js 20.9+、pnpm 11+。

```bash
git clone https://github.com/Self-Fidelity/Marsoon-Option.git
cd Marsoon-Option
pnpm install
pnpm dev
```

访问：

```text
http://127.0.0.1:4173
```

常用命令：

```bash
# TypeScript 检查（项目无单测，lint 即 tsc）
pnpm lint

# 生产构建
pnpm build

# 启动生产构建
pnpm start
```

## 页面路由

| 路径 | 层级 | 说明 |
| --- | --- | --- |
| `/board` | 产品：拼装看板 | 主工作台。面板 05/06/07/09/10 在这里打开 |
| `/teaching` | 产品：教学看板首页；`?lesson=05`～`10` 切换各面板课程 | `public/teaching-content/` |
| `/board?layout=v1.…` | 拼装看板能力 | 布局分享（deflate + base64url；无 CompressionStream 时 `v0.`） |
| `/gamma` `/zero-dte` `/flow` `/volatility` | 非产品 | 旧页，已移出导航 |
| `/panel-shot` | 工具 | 单面板 HTML 导出 |

## 数据接口

Route Handler 是同源 BFF，代理 Go 期权服务（`OPTIONS_API_BASE_URL` 配置），是浏览器与 Go 之间的**唯一通道**：

```http
GET  /api/options/dashboard     05/07 面板 + 06 关键位/副图
GET  /api/options/levels        关键位与状态时序
GET  /api/options/chain         09 期权链
GET  /api/options/term          10 期限结构 / PCR
GET  /api/options/intraday      06 日内（K线 + 水位；bars_only=true 只取 K线）
GET  /api/options/iv-term       IV 期限（支持 ?date= 历史）
GET  /api/options/volume-profile  0DTE 成交量分布
GET  /api/options/version       轻量版本三元组 (product, scope, unix)，驱动全站失效调度
GET  /api/options/status        全站数据状态
GET  /api/auth/session|activity 登录会话与活跃上报（Token 只在 HttpOnly Cookie / 服务端）
```

后端接口实测手册见 `docs/interface/Go后端接口清单.md`；接入状态与遗留缺口见 `docs/interface/正式HTTP接入.md`。
**服务端改造需求单（必读）：`docs/backend/服务端优化与更新策略.md`**；数据周期调度设计：`docs/architecture/K线与期权数据周期管理与防堵塞设计.md`。

数据源没有演示回退：拿不到数据即显示空态与原因说明（`has_data` / `missing_reason`），不降级、不造数。
设计文档见 `docs/`（按 7 大类分目录：架构契约 / 后端数据源与需求 / 前端看板 / 接口鉴权 / 面板规格 / 教学 / 迭代计划），索引在 `docs/README.md`。

前端请求、类型和 ViewModel 已分层，替换后端实现时不应重写图表组件：

```text
API Response
    ↓
TypeScript API types
    ↓
Dashboard / Levels / Intraday ViewModel
    ↓
TanStack Query（staleTime 对齐调度节奏；IndexedDB 持久化大快照）
    ↓
React presentation components
```

主要文件：

```text
src/
├── api/options.ts
├── app/
│   ├── api/options/{dashboard,levels,chain,term,intraday,version,…}/route.ts
│   ├── board/page.tsx          （拼装看板，Dockview 主工作台）
│   ├── teaching/               （导航壳 + iframe 课程）
│   └── panel-shot/             （快照导出工具页）
├── features/
│   ├── board/                  （panel-registry / dock 布局 / 模板与分享 / 窗口配置 / 各面板）
│   ├── options/                （ViewModel + Query Hook + 数据新鲜度调度 + 双车道 + 查询持久化）
│   │   ├── data-freshness.ts        （(product,scope) 版本调度器）
│   │   ├── query-persistence.ts     （IndexedDB 大快照持久化）
│   │   └── candle-stream-manager.ts （K线 WS 管理）
│   └── retention/              （登录后活跃上报，幂等重试）
├── lib/request-lanes.ts        （重车道信号量 ≤2 + K线快车道优先级）
└── server/
    ├── go-options.ts           （BFF 唯一出口：超时链 / 口径 / 会话缓存 / sanitizePublicData）
    └── intraday-candles.ts     （K线窗覆盖度补拉）
```

## 数据口径

开发新功能时必须遵守：

- `put_gex` 已经带负号：`net_gex = call_gex + put_gex`。
- Unknown 成交量计入总成交量，但不进入方向 Delta。
- OI 是快照，不能跨分钟累加。
- `quality_flags` 是位掩码，不是单值枚举。
- 缺失 Wall、Gamma Flip、IV 时不绘制，不能降级成价格 `0`。
- Unix 时间单位是秒，`from/to` 采用 `[from,to)`。
- Heatmap 各执行价可能来自不同时间，不能假定为原子快照。
- 未有正式数据的 IV Rank、Max Pain、ΔOI、25Δ Skew、VRP、Pinning 必须隐藏或显示 `--`。
- 不用前端临时公式制造后端没有提供的“智能指标”。
- 契约字段 snake_case；引擎输出原始口径（theta 每年、vega 每 1.00），换算只在展示层。

## 主题规范

主题来自 `marsoon-rs/src/ui_style.rs`：

| 语义 | 色值 |
| --- | --- |
| App Background | `#0F0F0F` |
| Panel Background | `#1C1C1E` |
| Card Background | `#2C2C2E` |
| Elevated Background | `#3A3A3C` |
| Chart / Plot | `#0C0C0C` / `#0A0A0C` |
| Primary Text | `#F2F2F2` |
| Secondary Text | `#9A9A9E` |
| Brand | `#FFD21E` |
| Buy / Positive | `#18D5B5` |
| Sell / Negative | `#FF5A70` |
| Success | `#2BD576` |
| Danger | `#FF4D5E` |
| Key Gamma | `#32AAFF` |

不要在组件里随意新增相似颜色。优先使用 `src/app/globals.css` 中的 `--ms-*` 语义变量。

设计细节：

- Panel 圆角 10px。
- Button/Input 圆角 8px。
- Panel 内边距约 12px。
- 使用细分隔线和轻阴影构建层级。
- Sidebar、Topbar 等贴边容器不添加外圆角。
- 品牌金仅用于选中、Gamma Flip 和重要交互，不用于大面积装饰。
- 买卖方向色不能与成功/失败状态色混用。
- 避免玻璃拟态、霓虹渐变、巨大光晕和常见 AI Dashboard 风格。

## 提交前检查

```bash
pnpm lint
pnpm build
```

同时确认：

- 目标路由能够直接打开。
- 产品和 scope 切换不会显示旧产品数据。
- 360px 页面没有横向溢出。
- 浏览器控制台没有 React/Next.js 错误。
- 没有把 Demo 数据描述为生产数据。
- README 与实现保持一致。

## GitHub 协作规则

仓库已经提供：

- `.github/workflows/ci.yml`：Pull Request 和 `main` Push 自动执行安装、类型检查与生产构建。
- `.github/PULL_REQUEST_TEMPLATE.md`：统一 PR 范围、数据口径、截图和验收说明。

每位组员应从最新 `main` 创建功能分支：

```bash
git checkout main
git pull origin main
git checkout -b feature/<module-name>
```

推荐在 GitHub Rulesets 中保护 `main`，要求 Pull Request、至少一次审核，并将 CI 的 `quality` Job 设置为 Required Status Check。

## 当前边界

- 收盘档（close）是否有数据由 Go 裁决，无数据时各面板显示空态（不造数）。
- 10 面板的 BCR 曲线占位，待付费数据源（需求见 `docs/backend/供应商数据需求.md`）。
- 09 期权链周期口径为单到期链下钻，接入 Databento 后需对齐 d30/d90 聚合口径。
- 服务端性能需求（请求零重算、压缩、ETag、WS 推送、背压等）见 `docs/backend/服务端优化与更新策略.md`——**这是给后端的需求单，后端同事必读**。
- 尚未处理登录和权限（登录会话已接 Go，权限未做）。
- `/gamma` `/zero-dte` `/flow` `/volatility` 旧页面目前只有路由容器，已移出导航。
- 当前仓库不代表生产部署已经完成。
