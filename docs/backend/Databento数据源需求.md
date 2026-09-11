# Databento 数据源需求

> 创建：2026-09-02（当日按 Gamma 周期分层架构二次修订）
> 对象：Marsoon-Option 项目（CME/COMEX 期货期权实时看板）的数据源迁移
> 范围：数据源选型结论、官方规格摘录、周期分层数据需求、API 数据要求清单（传输协议无关）
> 状态：调研定稿，待采购决策与开发排期
> 依据说明：Databento 官方**没有单独的白皮书**，其官方立场以文档站（databento.com/docs，可公开检索）与 DBN 开源规范（github.com/databento/dbn）为准。本文所有规格均严格取自上述官方来源，链接见文末附录 A，均可被第三方直接检索验证。

## 一、结论

1. 项目当前标的 ES / NQ / GC 均为 **CME/COMEX 期货期权**，对应 Databento 数据集为 **`GLBX.MDP3`（CME Globex MDP 3.0）**，该数据集覆盖 CME、CBOT、NYMEX、COMEX 全部期货与期货期权，历史自 2010 年 6 月起（2017 年 5 月 21 日前为 MDP 2/FIX-FAST 老协议数据）。这是本项目唯一必购数据集。
2. **`OPRA.PILLAR`（美股股票期权，含 SPX/SPY 等）是扩展项而非替代项**：它提供的是股指/股票现货期权，与项目的期货期权（Black-76 口径）不是同一标的链，未来若加 SPX 期权面板再采购。
3. **Databento 不提供官方 Greeks**：其官方路线图（roadmap.databento.com）中"Calculated options greeks schema"仍是未实现的状态项；GLBX.MDP3 的 statistics schema 也不发布结算 IV（stat_type 14）与结算 Delta（stat_type 15）。项目的 Black-76 自算引擎因此必须保留——它现已运行在 Go 服务侧（`model_version: "black76-oi-flow-v4"`）。
4. 接入形态按周期分层（见 §三）：**收盘核算走历史批量（batch）、日内 0DTE 走实时流（Live）或高频轮询、波段/全期限走低频轮询**。三种方式共用同一 DBN 数据结构，历史与实时代码同构。
5. 传输协议（WS / REST / 轮询、推送还是拉取）**不在本文范围**，由后端负责人自行决定；本文 §四 给出传输协议无关的 API 数据要求清单。

## 二、项目数据需求回顾（迁移前契约）

项目当前数据链路（**2026-09-10 已完成迁移**）：Go Worker 订阅 **Databento** → ClickHouse → Go 查询服务 `/options/*` → Next.js BFF `/api/options/*`。
后端自报 `source: "databento-go"`、`model_version: "black76-oi-flow-v4"`，五个读接口实测全部 200。接入时的接口与字段实测见 [`../interface/Go后端接口清单.md`](../interface/Go后端接口清单.md)。
**消费 API 契约不变**（`src/api/options.ts` 类型为准）。当前消费的数据项：

| # | 数据项 | 当前来源 | 消费方 |
|---|---|---|---|
| 1 | 标的期货报价（last/涨跌/时间） | Go 服务（Databento） | dashboard 总览 |
| 2 | 期货 1 分钟 K 线 | Go `/options/underlying-bars` | intraday（06）、levels |
| 3 | 到期清单（到期日/类型/剩余天数/PC 量比/波动率） | Go `/options/status` | dashboard、05 热力图 |
| 4 | 期权链逐档（行权价 × 到期 × C/P：bid/ask/last/volume/OI） | Go `/options/chain` | chain（09）、05、07、08 |
| 5 | Greeks/IV/GEX/墙位 | Go 侧 Black-76 引擎（`black76-oi-flow-v4`） | dashboard、levels、全部 GEX 面板 |

红线沿用 `供应商数据需求.md` §2：缺失一律 `null` 严禁 0 填充、put 侧方向指标自带负号、OI 是快照值不可累加、质量位掩码标记。

## 三、Gamma 周期分层架构 → 数据分层需求

框架按 gamma 周期分五层（2026-09-02 大框架迭代定稿、2026-09-03 新增 30DTE 层；日内热图在足迹软件，不在本项目）：

| 层 | 定位 | 数据特征 | 延迟要求 | 取数方式 |
|---|---|---|---|---|
| **L1 收盘核算** | 交易指导核心：收盘对**全期限全链**统一核算 gamma，找出 wall / flip，收盘后固定为基准线 | 日频一次，全链结算价 + OI + 官方定义 | 收盘后批量，T+0 即可 | 历史批量下载（batch，每日增量） |
| **L2 0DTE** | 日内交易核心：0DTE 链实时 gamma（wall/flip 日内迁移） | 1 分钟快照，事件源为 L1 tick | ≤1 分钟，越实时越好 | Live 流式订阅，或 ≤1 分钟轮询 |
| **L3 30DTE** | 月中窗口核心（2026-09-03 新增层）：DTE ≤ 30 的链 gamma | 15 分钟级快照即可，窗口外 strike 可稀疏 | ≤15 分钟 | 低频轮询 |
| **L4 90D** | 波段核心：近 3 个月窗口的链 gamma | 15 分钟级快照即可，窗口外 strike 可稀疏 | ≤15 分钟 | 低频轮询 |
| **L5 全期限** | 结构观察：05 长周期热图，全到期 × 行权价网格 | 15–60 分钟快照，全链但聚合粒度粗 | ≤1 小时 | 低频轮询 |

scope 大周期按钮演进：**0DTE / 近月 / 全部 → 收盘固定 / 0DTE / 30DTE / 90D / 全部（RTH）**。其中"收盘固定"是 L1 的盘中回放——直接读 L1 收盘快照，不消耗任何实时数据；其余四个 scope 分别对应 L2 / L3 / L4 / L5 的实时层。

分层对数据源选型的影响：

- **全部五层共用 GLBX.MDP3 一个数据集**，差别只在 schema 组合、取数频率与历史回补方式，不需要为周期分层多买数据。
- 用量集中在 L2：0DTE 链的 L1 流是消息量主体，实时计费按消息量，L2 订阅必须做 symbol 过滤（只订 0DTE 到期 + 标的相关合约）。L3/L4/L5 用低频聚合可把消息量压低一个数量级。
- L1 是唯一依赖**长历史**的层（回填 ≥2 年），走 usage-based 按量付费的 batch 下载最省；L2/L3/L4/L5 只需要近期历史回补（L2 当日、L3/L4 90 天、L5 ≥6 个月）。
- levels（墙位迁移时间序列）面板 = L2 的 1 分钟快照**持续落库**后的派生序列，首次回填用历史批量下载补齐，之后靠实时层滚动累积。

## 四、API 数据要求清单（传输协议无关，交后端）

> 使用说明：本清单只定义"要什么数据、什么字段、什么粒度、什么延迟、多少历史"，WS / REST / 轮询等协议形态与推送机制由后端自行决定。字段口径以 `src/api/options.ts` 类型契约为准；Databento 来源列供后端选 schema 时对照 §六。

### A 组：收盘核算（L1，日频批量）

| # | 数据项 | 内容 / 字段 | 粒度 | 延迟 | 历史深度 | Databento 来源 |
|---|---|---|---|---|---|---|
| A1 | EOD 全期限核算底稿 | **全到期**每合约：行权价、C/P、到期日、结算价、OI、合约乘数；每品种标的期货结算价。用途：收盘对全期限找 wall / flip | 每交易日 1 快照 | 收盘后 T+0 | ≥2 年（回填） | `statistics`（stat_type 3 结算、9 持仓，取当日最后一条 final）+ `definition` |
| A2 | 标的期货日线 | 日 OHLCV + 结算价 | 日频 | 同上 | ≥2 年 | `ohlcv-1d` + `statistics`(3) |
| A3 | 到期日历 | 各品种全部到期日、到期类型（月/周/EOM）、剩余天数 | 日频 | 同上 | 当前 | `definition`（按 expiration 聚合） |

### B 组：0DTE 日内（L2，实时/准实时）

| # | 数据项 | 内容 / 字段 | 粒度 | 延迟 | 历史深度 | Databento 来源 |
|---|---|---|---|---|---|---|
| B1 | 0DTE 链快照 | 0DTE 到期逐档：bid/ask/size、当日累计 volume、last；按 `instrument_id` 关联定义 | 1 分钟快照 | ≤1 分钟（实时流最佳） | 当日 + 回填 60 交易日 | `mbp-1` / `trades` 聚合 + `definition` |
| B2 | 标的期货行情 | 1 分钟 OHLCV + 实时 last（与期权希腊字母计算同源同合约） | 1 分钟 + tick 价 | ≤1 分钟 | 当日 + 回填 60 交易日 | `ohlcv-1m` + `trades` |
| B3 | Greeks 自算输入 | B1 + B2 快照 + 利率曲线输入 | — | — | — | 服务端 Black-76 计算（非 Databento 字段） |

### C 组：90D 波段（L3，低频）

| # | 数据项 | 内容 / 字段 | 粒度 | 延迟 | 历史深度 | Databento 来源 |
|---|---|---|---|---|---|---|
| C1 | 90D 窗口链快照 | 到期窗口 [T+30, T+120] 的链：bid/ask、OI、volume；窗口外行权价可稀疏 | 15 分钟快照 | ≤15 分钟 | 90 天 | `mbp-1`/`trades`/`statistics`(9) 聚合 |
| C2 | 90D 标的参考 | 对应窗口主力期货报价与 1 分钟 K 线 | 15 分钟 | ≤15 分钟 | 90 天 | `ohlcv-1m` |

### D 组：全期限热图（L4，低频）

| # | 数据项 | 内容 / 字段 | 粒度 | 延迟 | 历史深度 | Databento 来源 |
|---|---|---|---|---|---|---|
| D1 | 全期限网格快照 | 全到期 × 行权价：call/put OI、GEX、IV（自算）、volume；分到期聚合（ATM IV、net GEX、OI） | 15–60 分钟快照 | ≤1 小时 | ≥6 个月（回填） | `definition` + `statistics` + `mbp-1` 稀疏聚合 |

### 派生需求（清单外，但后端实现时要留口）

- **levels 历史序列**：B 组 1 分钟快照的持续落库派生（call wall / put wall / gamma flip / spot 的时间序列），供 levels API 回放 60 分钟窗口；历史靠 batch 回填。
- **收盘固定基准线**：A 组快照的派生（**收盘对全期限算出的** wall/flip/key strike），盘中各 scope 下叠加展示。
- **质量标记**：快照需带 `quality_flags` 位掩码（插值/过期/盘口交叉位定义见 `供应商数据需求.md` §2）。

## 五、GLBX.MDP3 官方规格（与需求相关部分）

来源：[CME Globex MDP 3.0 数据集规格](https://databento.com/docs/venues-and-datasets/glbx-mdp3)（官方文档站）。

### 5.1 覆盖范围

- CME Group 通过 MDP 3.0 发送 CME / CBOT / NYMEX / COMEX 四家交易所的**全深度订单簿数据**，Databento 自 2010 年 6 月起全量覆盖全部期货与期货期权。
- 2017-05-21 起为 MBOFD 逐订单事件数据；之前为 MDP 2（FIX/FAST）聚合数据——**2017 年前的历史数据没有 MBO schema，最高粒度只有 MBP-10**。本项目分钟级聚合与 L1 不受影响。
- 数据含交易所上市价差/组合（spread/combo），期权腿组合归入期权 parent 符号（见 §六符号系统）。

### 5.2 时间戳

| Databento 字段 | MDP 3.0 来源 | 含义 |
|---|---|---|
| `ts_event` | Tag 60-TransactTime | 撮合引擎收到时间（纳秒） |
| `ts_in_delta` | Tag 52-SendingTime | 撮合引擎发出时间差 |
| `ts_recv` | — | Databento 采集服务器收到时间 |

### 5.3 官方统计（statistics schema）的归一化

GLBX.MDP3 归一化 CME 的日度统计：**结算价（settlement，区分 preliminary/final 与 actual/theoretical 标志）、平仓量（cleared volume）、持仓量（open interest）、询价定价（fixing price）**；会话统计：开盘/指示开盘价、时段高/低、时段最高买/最低卖；以及涨跌停板价（upper/lower price limit）。

- 同一交易日同一统计可能发布多条，**最后一条为最终值，应优先采用**（A 组核算直接受益）。
- CME 对无持仓无成交量的合约不发布结算价。
- **缺口：GLBX.MDP3 不发布结算 IV 与结算 Delta**（见官方统计类型表，stat_type 14/15 不在 GLBX 列）。

### 5.4 交易时段

CME 按**周日开盘至周五收盘的每周会话**组织，日内有暂停。Databento 为便于历史 MBO 回放，在每个工作日 00:00:00 UTC 附加订单簿快照。开盘集合竞价前盘口锁定/交叉属正常现象。

## 六、符号系统与 schema 映射

### 6.1 符号系统（symbology）

来源：[Symbology 官方文档](https://databento.com/docs/standards-and-conventions/symbology)。四种 stype：`raw_symbol`、`instrument_id`、`parent`、`continuous`。GLBX.MDP3 支持全部四种（continuous 仅限期货）。

| 需求 | 用法 | 说明 |
|---|---|---|
| 一次取某品种全部期权链 | parent 符号 `ES.OPT` / `NQ.OPT` / `GC.OPT`（`stype_in=parent`） | 官方定义：`[ROOT].OPT` 指向该品种全部期权与期权组合，配合 definition schema 的 `instrument_class`（C=Call/P=Put）过滤；`[ROOT].FUT` 同理指期货 |
| 标的期货主力 | continuous 符号 `ES.c.0`（日历月规则） | 官方明确为**未复权原始价**，不做 back-adjust；`n` 按持仓、`v` 按成交量排名 |
| 具体合约 | raw_symbol，如 `ESU26`（产品码+月码+年） | 官方注意：旧合约为 1 位年码，近期新上市合约开始出现 2 位年码（如 `NGN25`） |
| 符号解析 | `symbology.resolve` 端点（免费） | 任意 stype 互转，返回逐日区间映射 |
| 全市场扫描 | `ALL_SYMBOLS` | 配合 raw_symbol 或 parent 输入 |

关键映射：definition schema 的 `asset` 字段是 parent 符号的根；`underlying` / `underlying_id` 字段把期权挂到标的期货合约，正是本项目"周期权挂对应期货合约"归属逻辑的基础。

### 6.2 schema 与清单字段映射

schema 总表见官方 [Schemas and data formats](https://databento.com/docs/schemas-and-data-formats)。本项目按 L0→L1 选型，明确不需要 L2/L3：

| 清单用途 | Databento schema | 关键字段 | 对应本项目数据项 |
|---|---|---|---|
| A1/A3 到期与链骨架（含 C1/C2/D1 骨架） | `definition`（L0） | `instrument_class`(C/P)、`strike_price`(1e-9 定点)、`expiration`、`activation`、`underlying`、`unit_of_measure_qty`（合约乘数）、`min_price_increment`、`raw_symbol` | 到期清单 + 链结构 |
| A2/B2/C2 期货 K 线 | `ohlcv-1d` / `ohlcv-1m`（L0） | `open/high/low/close/volume` | 期货 K 线（`/options/underlying-bars`） |
| B1/C1/D1 链逐档 bid/ask | `mbp-1`（L1） | `bid_px_00/ask_px_00`、`bid_sz_00/ask_sz_00`、`action` | 链逐档 bid/ask |
| B1/C1 成交（last/volume） | `trades`（L1，MBP-1 的 `action='T'` 子集） | `price`、`size`、`side`（主动方） | 成交 last/volume |
| A1/C1/D1 官方 OI / 结算价 | `statistics`（L0） | `stat_type`（3=结算、5/4=时段高/低、6=平仓量、9=持仓）、`price`/`quantity`、`stat_flags` | OI / 结算价 |
| B2 标的期货报价 | `mbp-1` 或 `trades`（期货合约） | 同上 | 标的期货报价 |

要点：

- **数据契约适配**：DBN 价格为 1e-9 定点整数，转换浮点时注意精度；`instrument_id` 是 uint32 数值主键，全表 join 靠它。
- **OI 口径**：Databento 的 OI 是 CME 官方日度统计，按 `ts_ref` 交易日归组、取最后一条，与 `供应商数据需求.md`"OI 是快照值、不可累加"红线一致。
- **逐笔方向（BCR）可行性**：`trades`/`mbp-1` 带主动方 `side`（隐含成交有 aggressor）；但仍存在 `side=N` 的未知方向，按"计入总量、不计方向拆分"处理。当前线上尚未启用 BCR。
- **频率决策**：快照聚合层保持项目既定的 1 分钟粒度（`供应商数据需求.md` §2）；L3/L4 用 15–60 分钟粗粒度压低消息量。

## 七、OPRA.PILLAR 扩展评估（暂不采购）

来源：[OPRA 数据集规格](https://databento.com/docs/venues-and-datasets/opra-pillar)。若未来加做 SPX/SPY 等现货期权面板：

- 符号为 OCC/OSI 21 位定长格式（如 `SPX   260920C00600000`：6 位根符号+YYMMDD+C/P+8 位定点行权价）。
- **OPRA 不发布成交方向，trade 的 side 恒为 N**；BCR 只能自算（Lee-Ready / midpoint 规则）。
- 合并盘口走 `cmbp-1` schema（数据量大，官方建议用 batch 下载）；2023-02-28 前的历史数据非抓包生成，粒度受限（BBO 最高 `cbbo-1m`，无 cmbp-1/tcbbo）。
- statistics 含时段高/低、成交量、VWAP 与聚合口径 OI。
- 股指现货期权用 Black-Scholes（标的是指数/ETF），与项目现有 Black-76 引擎不同，接入时需加定价模型分支（`../architecture/技术架构.md` 审计记录 #4：期货期权用 Black-Scholes 是致命错误，反之亦然）。

## 八、采购与许可需求

来源：[Databento Pricing](https://databento.com/pricing)（官方，价格以官网实时为准，本表为 2026-09-02 调研快照）：

| 方案 | 月费 | 与本项目相关的要点 |
|---|---|---|
| Usage-based | 按量 $/GB | 仅历史数据；新注册赠 $125 额度（注册 6 个月内有效），够做 ES 单品种全链数月的 L1 数据验证 |
| Standard | $199 | 含实时数据、无 pass-through license fee；L0（ohlcv/definition/statistics/status）16+ 年，L1（mbp-1/tbbo/bbo/trades）1 年，L2/L3 1 个月，更早年份按量付费 |
| Plus | $1,750 + license fee | L1 全历史（16+ 年）、外部分发授权 |
| Unlimited | $4,500 + license fee | 全 schema 全历史 |

采购前待确认事项：

1. CME 实时数据的 license fee 为交易所 pass-through（官网称不加价），个人非展示用途与商用展示用途费率不同，需在 Portal 问卷确认。
2. 实时按消息量计费（usage-based live），L2 的 0DTE 全链流是消息量主体，必须按 symbol 过滤后估算；L3/L4 低频轮询的消息量可忽略。
3. 数据**对外展示/再分发**需要 Plus 及以上（Standard 不含 external distribution）。
4. 按 §四清单估算：L1 回填 ≥2 年（usage-based 按量）、L2/L3/L4 订阅 Standard 档起步即可，L1 全历史属 Plus 档权益，可视预算后补。

## 九、迁移步骤（2026-09-10 已完成）

1. **验证期**：Python 客户端（`databento` pip 包，`timeseries.get_range`）拉取 `ES.OPT` 的 definition + statistics + `ES.c.0` 的 ohlcv-1m/1d，验证 §六映射表字段齐全性与 1e-9 定点转换，并复算收盘核算底稿的 wall。
2. **双跑期**：新链路与旧链路并行比对 Greeks/GEX（同一 Black-76 引擎、双价格源）。
3. **切换期**：旧链路退役，0DTE 快照从 15 分钟升到 **60 秒**（实测），levels 面板首次拥有真历史。
4. **扩展期**（可选）：OPRA.PILLAR 接入 SPX/SPY 期权，新增 Black-Scholes 定价分支。

> 完成状态：线上 Go 服务已稳定出数，本仓旧链路代码已全部删除（2026-09-10）。

> 后端存储/批计算架构（二次迭代）由专人另行负责，本文不预设方案；§四清单即为交给后端的全部数据要求。

## 十、风险与缺口清单

| 风险/缺口 | 影响 | 对策 |
|---|---|---|
| 无官方 Greeks（含结算 IV/Delta） | IV/GEX/墙位仍需自算 | 保留 Black-76 引擎；定价利率曲线自建 |
| 隐含成交 side=N | BCR 方向仍有 Unknown | 沿用"Unknown 计入总量"红线 |
| definition 是 point-in-time 时间序列（逐条带纳秒时间戳，Add/Modify/Delete） | 不能当静态证券主档用 | 建链时按 `security_update_action` 重放；官方保证 UTC 午夜起 24h 请求含全部活跃合约定义快照 |
| GLBX raw_symbol 年码位数变化（1 位→2 位） | 合约代码解析 | 一律以 definition 的 `maturity_year/month` 字段为准，不解析字符串 |
| 2017 前历史无 MBO、毫秒级时间戳 | 深历史回放受限 | 项目只需分钟级聚合，无影响 |
| OPRA live 与 historical 的 instrument_id 映射不一致 | 扩展期符号管理 | 用 raw_symbol 做持久键，按周重建映射 |
| L2 实时消息量计费不可控 | 成本超支 | symbol 过滤（只订 0DTE + 标的），订阅前用官网估价器测算 |

## 附录 A：官方来源清单（均可公开检索）

| 内容 | 链接 |
|---|---|
| CME Globex MDP 3.0 数据集规格（GLBX.MDP3） | https://databento.com/docs/venues-and-datasets/glbx-mdp3 |
| OPRA 数据集规格（OPRA.PILLAR） | https://databento.com/docs/venues-and-datasets/opra-pillar |
| 符号系统（parent/continuous/resolve） | https://databento.com/docs/standards-and-conventions/symbology |
| definition schema 字段全表 | https://databento.com/docs/schemas-and-data-formats/instrument-definitions |
| statistics schema 字段与按数据集可用性矩阵 | https://databento.com/docs/schemas-and-data-formats/statistics |
| schema 总目录（MBO/MBP/OHLCV/Trades 等） | https://databento.com/docs/schemas-and-data-formats |
| 定价 | https://databento.com/pricing |
| 数据集产品页（OPRA） | https://databento.com/datasets/OPRA.PILLAR |
| DBN 编码规范（GitHub 官方仓库） | https://github.com/databento/dbn |
| 官方路线图（Greeks schema 状态） | https://roadmap.databento.com |
| CME MDP 3.0 官方协议（上游规格） | https://www.cmegroup.com/confluence/display/EPICSANDBOX/CME+Market+Data+Platform+3.0+Market+Data |

## 附录 B：项目内交叉引用

- 数据契约红线：`供应商数据需求.md` §2
- 数据契约（接口唯一交互层）：`../architecture/技术架构.md` §5
- 现行数据链路与字段实测：`../interface/Go后端接口清单.md`
- 消费 API 类型契约：`src/api/options.ts`
