# 产品开发文档

以 `P0-合集/期权看板_初稿V1.html`（产品最终形态初稿）为蓝本的正式设计文档集。
**2026-09-02 起本目录迁入 Marsoon-Option 仓内 `docs/`**，文档与代码同仓维护。

## 文档分工（分开维护，接口唯一）

| 文档 | 管什么 | 什么时候改它 |
|---|---|---|
| [技术架构.md](技术架构.md) | 前后端分层架构、技术选型、性能预算、ClickHouse 后端方案、数据契约、审计记录 | 换框架、加构建步骤、改数据接口、动后端管线 |
| [业务逻辑.md](业务逻辑.md) | Gamma 领域模型、产品三层形态、10 个面板的业务定义、数据口径、视觉规范 | 加/改面板、改教学叙事、改 GEX 口径 |
| [数据开发.md](数据开发.md) | 上游接口盘点、口径红线、面板×数据映射、缺口清单 | 接真实数据、新增接口、改 K线/快照粒度 |
| [后端规划.md](后端规划.md) | 后端传/读/写详细方案（借 orderflow_webgpu 经验裁剪）、运维稳定性、架构缺口清单 | 动采集/计算/存储/传输、上线运维 |
| [免费数据源与抓取策略.md](免费数据源与抓取策略.md) | Barchart 免费层实测端点、采集器架构、频率纪律、合规红线 | 换数据源、改采集周期、发现新渠道 |
| [ITERATION.md](ITERATION.md) | 当前迭代计划：调研结论、已定决策、P0/P1/P2 任务与验收 | 每轮迭代开工/收尾时 |
| [供应商数据需求.md](供应商数据需求.md) | 提交数据供应商的正式需求规格（对外文档） | 向供应商提需求前 |
| [Databento数据源需求.md](Databento数据源需求.md) | Databento 付费源选型结论、官方规格映射、采购与迁移需求 | 采购/接入 Databento 前 |

**边界原则**：两层之间只允许通过「数据契约」（`技术架构.md` 第 5 节）交互。
面板组件（业务）不关心数据从哪来；数据层（技术）不关心图怎么画。

## 现状（2026-09-02）

- **真实数据链路已落通并运行中**：Barchart 浏览器态采集器（`scripts/barchart-poller.mjs`）→ `POST /api/ingest/barchart` → 内存仓 → dashboard/levels/chain 三个 API 优先出真实数据（`source: barchart-delayed`），无快照回退 `local-demo`。
- **看板已实装 5 个面板**：01 总览 / 05 到期热力图 / 07 微笑偏斜 / 08 GEX 拆分 / 09 期权链下钻；06 日内、10 月间价差占位。
- **2026-09-02 复测发现数据正确性问题**（serie→到期日归属错误等）与本轮迭代计划，见 [ITERATION.md](ITERATION.md)。
- 采集周期定案 **15 分钟**；Net GEX Δ5m/15m/30m 指标已删除（细节指标不做，先把产品基础做好）。

代码全部落在本仓（Marsoon-Option）开发（新增 /framework、/teach、/board 路由），`docs/` 只放设计文档，不写代码。

## 现状（2026-09-04）

- **导航收敛为两项**：/board 拼装看板（7 面板全实装，Dockview 分窗 + 本地模板库 + URL 分享 `?layout=`）+ /teaching 教学看板（Next.js 课程导航 + `public/teaching-content/` 自包含 React 模块）；旧路由（/、/gamma、/zero-dte、/flow、/volatility、/panel-shot）保留但移出导航。
- **周期 scope 五档多选总控**：close（收盘，Databento EOD 未接入恒空态）/ 0dte / d30（30DTE）/ d90（90D）/ all（RTH），/board 顶栏全局总控，至少 1 个、固定优先级 0dte > d30 > d90 > all > close，[0] 为主周期；旧 nearest 档已删除。
- **侧栏全站统一、可收起**（收起态存 localStorage，开关见各页功能栏 SidebarToggleButton）；窗口联动语义定稿：联动=跟随总控、解耦=冻结当时快照窗内自治（📌 scopePinned 已废除）。
- **快照落盘 + 日内回放已闭合**：快照落盘 data/snapshots/*.jsonl，06 日内轨迹由 GET /api/options/intraday 回放 jsonl 提供；API 共 5 个消费端点（dashboard / levels / chain / term / intraday，外加 POST /api/ingest/barchart）。
- 采集周期维持 **15 分钟**。
