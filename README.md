# Marsoon Option

CME 期货期权市场结构看板（ES / NQ / GC）。Next.js App Router + 手写 SVG，主题对齐 `marsoon-rs` 的 ClassicDark / Marsoon Tide。

产品只有两块，导航也只有两项：

```text
Marsoon Option
├── 拼装看板  /board      主工作台：Dockview 分窗，面板往里加
└── 教学看板  /teaching   独立教学页：整页 iframe
```

01 / 05 / 06 这类编号**不是**顶层产品，而是拼装看板里的数据面板。

## 产品结构

### 1. 拼装看板 `/board`

可拖拽分窗的工作台。顶栏管品种、周期、模板和数据状态；窗里放面板。布局可存成本地模板，也可用 `?layout=` 分享。

**工作台能力**

- 品种：NQ / ES / GC
- 周期总控（多选，至少 1 个）：收盘 | 0DTE | 30DTE | 90D | RTH  
  收盘档预留给 Databento EOD，目前恒空态
- 窗口可与总控联动或解耦（品种 + 周期一起冻/跟）
- 模板：保存 / 应用 / 设默认 / 删除 / 复制分享链接
- 侧栏可收起，状态全站共享

**面板（都挂在拼装看板下）**

| 编号 | 面板 | 回答的问题 |
| --- | --- | --- |
| 01 | 总览 | 现在什么状态？墙和 Flip 在哪？ |
| 05 | 到期热力图 | 仓位堆在哪些到期 × 执行价？ |
| 06 | 日内变化 | 价格贴着哪堵墙？K 线 + 关键位 + 可选 VP |
| 07 | 微笑偏斜 | 这条链的 IV 形状 |
| 08 | GEX 拆分 | 每个执行价上 call / put 仓位怎么拆 |
| 09 | 期权链 | 单到期 T 字链下钻 |
| 10 | 月间价差 · PCR | IV 期限结构与 PCR |

面板细节、口径和迭代记录在 `docs/05面板迭代开发文档.md`、`docs/06面板迭代开发文档.md` 等，不在 README 展开。

### 2. 教学看板 `/teaching`

独立页：功能栏（侧栏开关 + 标题）+ 整页 iframe 加载 `public/teaching.html`。换课件只覆盖该文件。

### 其它路由

`/`、`/gamma`、`/zero-dte`、`/flow`、`/volatility` 是旧仪表盘容器，已移出导航，仅保留路由。`/panel-shot` 是截图工具，不是产品入口。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS 4
- TanStack Query
- Lucide React
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
# TypeScript 检查
pnpm lint

# 生产构建
pnpm build

# 启动生产构建
pnpm start
```

## 页面路由

| 路径 | 层级 | 说明 |
| --- | --- | --- |
| `/board` | 产品：拼装看板 | 主工作台。面板 01–10 在这里打开 |
| `/teaching` | 产品：教学看板 | `public/teaching.html` |
| `/board?layout=v1.…` | 拼装看板能力 | 布局分享（deflate + base64url；无 CompressionStream 时 `v0.`） |
| `/` `/gamma` `/zero-dte` `/flow` `/volatility` | 非产品 | 旧页，已移出导航 |
| `/panel-shot` | 工具 | 单面板 HTML 导出 |

## 数据接口

Route Handler 优先消费 Barchart 采集器推送的真实快照（`source: barchart-delayed`，延迟 ≥15 分钟）；无快照时回退 `local-demo`：

```http
GET  /api/options/dashboard
GET  /api/options/levels
GET  /api/options/chain
GET  /api/options/term
GET  /api/options/intraday      （jsonl 快照日内回放，06 面板消费）
POST /api/ingest/barchart   （采集器推送，见 scripts/barchart-poller.mjs，15min/轮）
```

页面顶部显示 `DEMO` 时，代表当前是本地演示数据，不是生产行情。
设计文档（产品逻辑、数据开发、抓取策略、迭代计划）见 `docs/` 目录。

前端请求、类型和 ViewModel 已分层，替换为正式后端时不应重写图表组件：

```text
API Response
    ↓
TypeScript API types
    ↓
Dashboard / Levels ViewModel
    ↓
TanStack Query
    ↓
React presentation components
```

主要文件：

```text
src/
├── api/options.ts
├── app/
│   ├── api/options/{dashboard,levels,chain,term,intraday}/route.ts
│   ├── board/page.tsx          （拼装看板，Dockview 主工作台）
│   ├── teaching/               （page.tsx + TeachingView.tsx：功能栏 + iframe）
│   └── panel-shot/             （快照导出工具页）
├── components/
│   ├── AppShell.tsx            （侧栏收起态 + SidebarToggleContext）
│   ├── Sidebar.tsx             （常驻侧栏 / 移动端底部导航）
│   ├── SidebarToggle.tsx       （功能栏侧栏开关，全站唯一）
│   └── SectionPlaceholder.tsx
├── features/
│   ├── board/                  （panel-registry / dock 布局 / 模板与分享 / 窗口配置 store）
│   └── options/                （旧仪表盘 + ViewModel + Query Hook + 面板组件）
│       ├── dashboard-view-model.ts
│       ├── levels-view-model.ts
│       ├── use-options-dashboard.ts
│       └── components/
│           ├── dashboard-ui.tsx
│           └── dashboard-panels.tsx
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

## 使用提示词扩展模块

推荐每次只扩展一个页面，并在提示词中明确：目标路由、数据接口、字段口径、UI 范围和验收命令。

### 通用提示词模板

复制以下提示词，将方括号内容替换为具体任务：

```text
请在 Marsoon-Option 项目中完成 [模块名称]。

范围：
- 只修改 [目标路由和相关 feature 目录]。
- 使用 Next.js App Router、TypeScript、Tailwind CSS 和 TanStack Query。
- 保持 src/app/globals.css 中的 Marsoon ClassicDark / Marsoon Tide 主题。
- 数据先经过 api types → ViewModel → Query Hook → 展示组件，不允许组件直接解释原始字段。
- 不修改其他页面和已有数据口径。

数据：
- 接口：[接口路径]
- 查询参数：[product/scope/from/to/timeframe 等]
- 关键字段：[字段列表]
- 缺失字段必须显示 -- 或隐藏，不能用 0 或 mock 替代。

UI：
- 页面需要包含：[图表、表格、筛选、详情等]
- 处理 loading、empty、error、stale 和 quality_flags 状态。
- 桌面与 360px 移动端均不可横向溢出。

验收：
- pnpm lint
- pnpm build
- 浏览器验证目标路由、Tab 切换和控制台错误

完成后列出修改文件、已验证内容和仍未接入的数据。
```

### Gamma 页面提示词

```text
请实现 /gamma 页面。

使用 /options/heatmap 的 expiration × strike cells，支持 product、scope 和到期日切换。
主图显示 Call GEX、Put GEX、Net GEX；put_gex 已为负数，不得重复反号。
叠加 Call Wall、Put Wall、Gamma Flip 和 Key Gamma，颜色使用现有 --ms-* 主题变量。
显示 surface observed_min_unix / observed_max_unix，并处理 mixed/stale 状态。
不要请求 /options/dashboard 后再次重复请求相同 Heatmap 数据，除非 Gamma 页面独立加载。
```

### 0DTE 页面提示词

```text
请实现 /zero-dte 页面。

接入 /options/0dte-volume-profile 和 /options/0dte-oi-profile。
成交量展示 Call/Put Buy、Sell、Unknown；总量必须包含 Unknown，但方向 Delta 排除 Unknown。
OI 只展示最新快照，不能跨分钟累加。
提供执行价蝴蝶图、数据时间和空数据状态，保持 Marsoon 主题。
```

### 资金流页面提示词

```text
请实现 /flow 页面。

接入 /options/hedge-flow 和 /options/levels。
明确区分库存 Net GEX 与成交 Hedge Flow。
主图显示 net_delta_notional 和 cumulative_net_delta_notional，可切换 Call/Put。
增加 Wall Migration 与 level-events 时间标记，不得把模型 GEX 命名为真实成交对冲金额。
```

### 波动率页面提示词

```text
请实现 /volatility 页面。

当前只实现：
1. 同一 expiration 下 call_iv / put_iv by strike 的 IV Smile。
2. dashboard.expiries[].atm_iv 的 ATM IV Term Structure。

IV 小数需要乘 100 显示为百分数。
不要实现或伪造 IV Rank、Skew Rank、25Δ Risk Reversal、VRP。
```

### Review 提示词

```text
请 review 当前改动，只报告会导致数据错误、数据丢失、口径错误、路由故障或移动端不可用的问题。

重点检查：
- put_gex 是否重复反号
- Unknown volume 是否被丢失或进入方向 Delta
- OI 是否被跨分钟累加
- 空值是否错误绘制为 0
- product/scope 切换后是否残留旧响应
- quality_flags 是否被当作枚举
- 页面是否引入 globals.css 以外的新主题颜色
- pnpm lint 和 pnpm build 是否通过
```

## 使用 Codex Skill 扩展

如果团队经常重复开发同类页面，可以创建一个个人 Skill，例如 `marsoon-option-ui`。

推荐用 Codex 的 `skill-creator` 创建，并要求 Skill 至少执行以下流程：

1. 完整读取项目根目录 `AGENTS.md`。
2. 读取 `README.md` 的数据口径和主题规范。
3. 读取 `src/api/options.ts`、对应 ViewModel 和现有 Query Hook。
4. 阅读安装版本自带的 `node_modules/next/dist/docs/` 中相关 Next.js 文档。
5. 只实现用户指定的路由和接口，不顺手扩展其他模块。
6. 新字段先进入类型和 ViewModel，再进入组件。
7. 复用 `--ms-*` 主题变量。
8. 运行 `pnpm lint`、`pnpm build` 和浏览器验证。
9. 明确区分：已写代码、类型检查、生产构建、浏览器验证和真实后端接入。

创建 Skill 时可使用：

```text
请使用 skill-creator 创建一个名为 marsoon-option-ui 的个人 Skill。
它用于扩展当前 Marsoon-Option Next.js 项目。
将本 README 中的数据口径、主题变量、API→ViewModel→Query→Component 分层、范围控制和验收流程写入 Skill。
不要复制具体业务页面代码；Skill 应指导后续 agent 先检查当前仓库，再按用户指定模块实现。
```

创建后，组员可这样调用：

```text
$marsoon-option-ui
请实现 /zero-dte 页面，只接成交量与 OI Profile，不修改 Dashboard。
```

如果团队成员没有该 Skill，直接使用上一节的通用提示词模板即可。

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
- `.github/CODEOWNERS`：共享文件默认请求 `@Jsoooooooo` 审核。

每位组员应从最新 `main` 创建功能分支：

```bash
git checkout main
git pull origin main
git checkout -b feature/<module-name>
```

其他 PR 合并后，在自己的功能分支同步：

```bash
git fetch origin
git merge origin/main
pnpm install
pnpm lint
pnpm build
```

推荐在 GitHub Rulesets 中保护 `main`，要求 Pull Request、至少一次审核，并将 CI 的 `quality` Job 设置为 Required Status Check。

## 当前边界

- 收盘档（close）依赖 Databento EOD，尚未接入，各面板显示空态。
- 10 面板的 BCR 曲线占位，待付费数据源。
- 尚未处理登录和权限。
- `/gamma` `/zero-dte` `/flow` `/volatility` 旧页面目前只有路由容器，已移出导航。
- 当前仓库不代表生产部署已经完成。
