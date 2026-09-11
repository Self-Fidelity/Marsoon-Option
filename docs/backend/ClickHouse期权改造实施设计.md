# ClickHouse 期权改造实施设计

日期：2026-09-04。状态：**设计稿，未实施，未执行迁移**。

> **2026-09-10 注记**：前端已于本日前切到 `OPTIONS_API_MODE=unified`，全部读接口走 Go 服务。这说明后端改造**至少已实施到"看板可查"的程度**，本文"未实施"的状态描述需要由后端同学核实实际迁移进度后更正（尤其是 §三 以后的表结构与发布清单是否落地）。
> 可对照的线上事实：后端自报 `model_version: "black76-oi-flow-v4"`、`source: "databento-go"`，`scope` 已支持 `0dte/d30/d90/close`（见 `../interface/Go后端接口清单.md`）。
> 遗留待办与本文未覆盖的性能问题，见 `../interface/Go后端接口清单.md` §9。

适用后端：`/Users/mima0000/Desktop/github/trading-platform-main`。
适用前端：`/Users/mima0000/Desktop/Marsoon-Option-main`。

本设计细化《Go期权API对接与改进方案》，以继续使用 ClickHouse 为前提。它不是已经完成的功能清单。前一轮已撤回的 Go 接口代码不在本设计执行范围内恢复。

## 一、改造边界与已核实基础

复用现有 Databento Worker、Black-76、candles、OI 最新表和旧八个期权 API。新数据旁路写入、独立验收后再接前端；不删旧表，不原地修改旧列含义，不为看板另外建设一套期货 K 线系统。

本次会话已通过只读连接核对本机实际表结构：

- `option_open_interest` 为 `ReplacingMergeTree(source_unix) ORDER BY raw_symbol`，是最新值表；官方统计历史需要另存。
- `option_strike_metrics_1m` 为 `ReplacingMergeTree(quote_source_unix)`，排序键不含模型/修订身份。
- 市场状态和价位表按 `source_unix` 替换，也未将模型/修订身份纳入排序键。
- `option_quote_quality_1m` 有原始报价与拒绝原因字段，但当时只有 GC 的 2026-08-07 单次样本；当前仓库没有查到该表的写入/迁移实现。只作为结构参考，不当作完整生产输入。
- 实际价位表有 `zone_low/zone_high`，仓库当前类型/写入没有对应字段。新增迁移前需保存实际 DDL 与迁移版本，明确差异来源，不能根据早期建表文件直接覆盖。
- 本机有 ES/NQ/GC 状态和对应期货 K 线；有记录不等于已验证全期限覆盖和历史连续性。

## 二、第一批：写入可靠性与合约数据基础

第一批限定为：修写入生命周期、补完整身份、新增合约快照/统计历史/发布清单三个数据层。暂不扩订阅范围，不切前端数据源。

### 2.1 先修现有写入生命周期

当前 `collectZeroDTEStrikeVolumes()` 取桶时立即删除 `w.strikeVolumes` 中的数据，后续 `InsertOptionStrikeVolumes()` 失败则返回。当前这条路径未看到恢复被删除桶的逻辑，存在写入失败导致丢失的风险。

新流程：

1. `sealBucket`：将该分钟数据冻结为不可变批次，从接收中的累加器移至待写队列；迟到数据另开修订，不能继续修改在途批次。
2. 为批次固定 `snapshot_id`、`revision`、内容校验值。数据库超时后仍重用同一批次重试。
3. 待写批次持久化到本机待发目录，采用原子落盘与恢复机制；不能只依赖进程内 map 保证重启不丢。
4. `flushBatch`：写各组件，逐项确认。已成功的组件可按相同身份重试，读取时不重复计量。
5. `publishBatch`：组件完整后写发布清单。
6. `ackBatch`：确认发布成功后才清理待写批次、推进已确认游标。

这是应用层发布协议，不是 ClickHouse 跨表事务。原始行情、成交量、分析结果是不同数据域：没有可计算 Greeks 不能阻止已观察到的真实成交量发布。旧写入路径如保持双写，也必须复用冻结输入，不能在两个路径分别消耗同一个 map。

### 2.2 修正身份与缓存键

当前 `strikeVolumeKey` 只有 minute/expiration/strike，`hedgeFlowKey` 只有 minute/expiration；Worker 按 product 独立，但一个 product 可以关联不同 underlying/系列。

建议新增完整身份：

| 身份 | 字段 |
|---|---|
| 合约 | dataset + raw_symbol；instrument_id 仅作为该定义版本的源侧标识 |
| 系列 | 稳定 series_id，来自标准化的产品/标的/到期/上市系列标识；不能只使用到期日 |
| 分钟成交量桶 | product + raw_symbol + minute |
| 单系列计算组 | product + underlying_symbol + series_id |
| scope 输出组 | product + scope + reference_underlying + minute + model_version |

Contract 增加系列标识、类型和定义来源。无法可靠识别系列类型时返回 unknown；不能从星期几或模糊字符串猜成“周度/月度”。同一系列中若存在无法唯一配对的 C/P/strike，返回歧义状态，不能覆盖前一条。

### 2.3 新增 `option_contract_snapshot_1m`

粒度：每个合约一行，一分钟为基础桶，实际输出频率允许分层。一次批次保存当时使用的原始输入和可用分析结果。

| 字段组 | 建议字段及类型 |
|---|---|
| 身份 | `product LowCardinality(String)`、`series_id String`、`raw_symbol String`、`instrument_id UInt32`、`underlying_symbol LowCardinality(String)`、`option_type LowCardinality(String)` |
| 合约定义 | `expiration DateTime64(3,'UTC')`、`strike Float64`、`contract_multiplier Float64`、`min_price_increment Float64`、`definition_revision String` |
| 时间与版本 | `unix DateTime64(3,'UTC')`、`trading_date Date`、`snapshot_id UUID`、`revision UInt64`、`written_at DateTime64(3,'UTC')` |
| 原始行情 | `bid/ask/last Nullable(Float64)`、`bid_size/ask_size Nullable(UInt32)`、`quote_unix/last_trade_unix Nullable(DateTime64(3,'UTC'))` |
| 计算输入 | `underlying_price/mid Nullable(Float64)`、标的报价时间、`oi Nullable(Int64)`、OI 的 reference/source 时间、`risk_free_rate Nullable(Float64)` |
| 分析输出 | `iv/delta/gamma/theta/vega/gex Nullable(Float64)`、`model_version`、`iv_method` |
| 质量 | `quote_status`、`analytics_status`、`quality_schema`、`quality_flags UInt32`、`missing_reason` |

原始报价先保存；可算 Greeks 时再填结果。OI 不足不影响 bid/ask/last 展示；是否纳入库存 GEX 单独判断。现有拒绝条件不能改成“无条件放行”，但也不能继续决定原始数据是否保存。

建议物理设计：

- 分区：`toYYYYMM(unix)`，避免扩展全期限后制造大量细碎日分区；实施前结合实测批量与分区规模复核。
- 排序键：`(product, underlying_symbol, series_id, unix, raw_symbol, model_version, snapshot_id)`。
- `ReplacingMergeTree(written_at)` 只用于同一不可变 snapshot 内的重试去重；新修订分配新 snapshot_id，不能覆盖历史修订。
- 同一 snapshot_id 的重试必须具有相同内容。相同身份但不同内容视为写入协议错误，不依靠替换引擎选择“碰巧最后”的值。
- 先保留 120 个日历日作为分钟热数据目标；是否足够覆盖 60 个交易日按交易日历验收。未建立归档/回填前，不给已有历史表新增清理 TTL。

该表解锁09原始链、07报价/IV输入，并为新分析版本提供可重放底稿。旧表已丢弃的报价不能凭空补回，只能从数据源历史回填并标明来源。

### 2.4 新增 `option_statistics_history`

粒度：每个合约的一次官方统计发布/修订，不按分钟重复保存不变 OI。

关键字段：`dataset`、`raw_symbol`、`product`、`stat_type`、`reference_unix`、`reference_trading_date`、`source_unix`、`received_at`、源序列/通道标识、`update_action`、`stat_flags`、`price Nullable(Float64)`、`quantity Nullable(Int64)`、`event_id`、`written_at`。

- 同时容纳官方 OI 与结算统计，避免另建重复的 OI 历史和结算历史基础表。
- `event_id` 按源记录身份规范化；同一事件重放不新增一份，修订/撤销是新事件。不能只用秒级时间充当唯一键。
- 分区按 reference 日期月份；排序包括合约、统计类型、reference/source 时间及 event_id，保留全部正式修订。
- 继续更新旧 `option_open_interest` 最新表，旧消费者不受影响；历史 API 从新表按可见时间挑选有效发布。
- EOD 区分“当时已知版本”和“今天回看最终修订版”。回填历史时要同时保留源发布时间与本系统首次获得时间，不能用现在的 received_at 冒充当年的可见性。

### 2.5 新增 `option_snapshot_manifest`

保存 `snapshot_id`、`product`、`scope`、`domain`、`asof`、`revision`、`model_version`、`published_at`、组件 snapshot 引用、行数/校验值、预期/有效合约数、observed 范围、ready/partial 状态及原因。

每个发布记录不可变；新修订写新记录。查询先选已发布版本，再按记录中的组件身份读取，禁止按每张表各自 max(unix) 拼装。单个 scope 内由一个 Worker 负责发布；将来增加多写者时，需要先定义版本分配与写者协调，不能直接依赖机器时钟争“最新”。

第一批验收：低OI合约报价仍保存；缺OI为null；写入失败和进程重启可恢复；相同批次重放不重复计数；任一组件失败不发布完成状态；缺Greeks不丢成交量；旧API契约保持。

## 三、第二批：全期限量与分析结果 v2

### 3.1 新增 `option_trade_volume_1m`

按 `(product,raw_symbol,minute)` 累计 `buy_contracts/sell_contracts/unknown_contracts` 与对应成交笔数，携带 series_id、underlying、expiration、trading_date、snapshot_id、revision、覆盖起止时间和 complete/partial 状态。

存储的是**该分钟完整累计值的一个版本**，不是每次重试都要相加的增量。查询先选每分钟目标版本，再跨分钟累加。不要直接用普通求和物化视图对修订插入相加，否则重放和修订会放大日累计值。

Worker 取消仅在 0DTE 分支保留逐档量的限制；旧0DTE表暂时通过同一批计算结果继续供数。真实成交量与期权价格/IV是否有效独立。

重连去重同时处理两层：源成交事件不重复计入桶；相同分钟批次不重复计入数据库查询。数据源身份不能用只有秒级的时间+价格+数量拼接，合法的相同成交可能多次发生。启动只有短 replay 时返回 partial，补齐交易日起点后才能称当日总量。

### 3.2 新建三个分析结果 v2 表

| v2 表 | 相对现有表增加的核心内容 | 前端用途 |
|---|---|---|
| `option_strike_metrics_1m_v2` | series_id、scope、快照身份、两侧存在/有效性、nullable分析字段 | 05矩阵、08拆分、06真实GEX剖面 |
| `option_market_state_1m_v2` | ATM IV、EM、C/P OI与量、参考到期/期限、覆盖度、参数/快照版本 | 01总览、06历史、10期限摘要 |
| `option_price_levels_1m_v2` | 系列与scope身份、模型/快照版本；继续区分level和value | 所有墙/Flip/EM线 |

三个表都必须保留 model_version 与 snapshot_id 的物理身份，防止不同模型或历史修订被合并掉。单系列行与scope汇总行明确区分，不能在一次合计里同时加两者。scope聚合中的期权bid/ask/last不产出相加值，跨期限IV不直接平均。

单系列分析一次产生逐档、状态和价位结果；scope聚合复用该批输入/中间结果，不重复从原始库重扫。组合Flip需使用逐合约的F/T/IV/乘数做场景重算；墙位从完整scope结果选取，显示裁剪不影响关键位。

第一版 term API 组合已发布单系列状态与已去重的交易日成交量；无需再建一套独立IV计算器或永久期限结构表。若该组合成为实测热点，再增加同版本缓存或专用物化结果。

第二批验收：三个品种的完整链有稳定身份；新旧同输入口径下GEX可解释对照；日量包含Unknown且无重计；量PCR/OI PCR分别使用同一覆盖集合；矩阵裁剪不改变总览；09缺Greeks显示空值。

## 四、第三批：五周期与收盘

1. 新增统一scope选择器：0dte为当日所有有效到期系列，d30/d90分别包含≤30/90日的未过期系列；保留旧nearest供旧客户端；all覆盖不足明确partial。
2. Worker将期限发现范围和刷新频率分离。当前20天默认/45天上限必须实际扩展后，才承诺d90；降低接口查询频率不会自动降低上游订阅量。
3. 跨月份统一参考轴和场景假设，返回reference_underlying及方法版本；09始终按具体系列展示报价。
4. 为close补 definition history：保留有效期、修改/删除事件、来源时间，不能把当前主档当过去主档。
5. 用统计历史中的结算/OI和历史主档生成EOD发布版本。定义哪些输入已final、哪些仍缺失，修订时发布新版本。
6. 09前结算价/CHG读取同一基准交易日；10官方IV无可靠来源时空值，自算IV标明方法。

第三批验收：DTE边界30/31/90/91、无0DTE、多系列、跨月份、Chicago换日/夏令时及特殊交易日；收盘冻结不随盘中输入变化，官方更正有新revision，历史asof无前视。

## 五、最后接查询接口与前端

| 接口能力 | 读取来源 | 约束 |
|---|---|---|
| dashboard | 同版本市场状态、逐档、价位 | 不触发计算；scope总量与visible总量区分 |
| chain | definitions + contract_snapshot | scope筛系列，series_id选具体链；缺边side=null |
| term | 单系列状态 + 全期限分钟量 | PCR分母为0/覆盖不足处理明确；不平均各档PCR |
| levels | price_levels v2 + market_state v2 | 真历史；level是价格，value是强度 |
| underlying-bars | 现有candles | 同underlying；volume包含unknown；[from,to) |
| intraday | bars + levels + current | 回传组件版本和时间；不同组件缺失独立显示 |
| status | manifest及独立K线状态/刷新机制 | 不下载整张heatmap；修订触发刷新，非仅时间戳变化 |

Next.js只做同源代理和契约适配，浏览器不持有Go/数据库服务凭据；正式Go数据不进入前端 BFF 再计算。正常模式删除local-demo、平铺历史和调试VP。09 nullable格式化、balanced_gamma枚举、秒/毫秒、quality_schema同步适配。

前端01/05/06/07/08/09/10的详细字段对照见《Go期权API对接与改进方案》和本次会话前一份逐项映射；本稿限定其后端实施顺序。

## 六、代码落点与提交拆分

| 提交单元 | 预计文件 | 不越过的边界 |
|---|---|---|
| 写入可靠性 | worker.go；新增batch/pending实现；worker_test.go | 不顺手改Greek公式和旧HTTP契约 |
| 主档身份 | types.go、historical.go、groupContractsByExpiry及相关缓存键 | 身份未知时标明，不猜系列 |
| 原始快照/统计历史 | 新迁移、独立Store接口、ClickHouse批量写入、worker接线 | 第一批新增三层，旧表保留 |
| 完整量 | 新量表、trade处理/去重/补数、volume reader | 不用hedge-flow笔数代替合约量 |
| 分析v2 | black76.go、calculator.go、v2类型/表/readers | 同一模型版本使用统一参数与单位 |
| 五周期/EOD | scope.go、调度/历史主档/EOD任务 | 覆盖和模型未完成时保持partial/empty |
| 查询/前端切换 | actor/server、Next路由/类型/hooks/view-model | 不改变看板布局、图表几何和主题 |

单独新增迁移文件；不改已经执行过的历史迁移。先验证新表可建、Writer可重试，再开始双写和回填。切换通过明确的读模型版本配置完成；回退只切回旧读模型，不删除新数据。

ClickHouse注意事项：ReplacingMergeTree按排序键后台去重，正确性不能等待后台合并；nullable字段按目标版本选择完整tuple，避免逐列取最新产生混合快照。参考：[ReplacingMergeTree](https://clickhouse.com/docs/reference/engines/table-engines/mergetree-family/replacingmergetree)、[argMax](https://clickhouse.com/docs/reference/functions/aggregate-functions/argMax)。

## 七、本轮新增确认的源码证据

- [成交量取桶即删除](/Users/mima0000/Desktop/github/trading-platform-main/pkg/options/worker.go:1466) 与 [写入失败直接返回](/Users/mima0000/Desktop/github/trading-platform-main/pkg/options/worker.go:1240)。
- [缺少underlying/系列身份的缓存键](/Users/mima0000/Desktop/github/trading-platform-main/pkg/options/worker.go:274)。
- [按到期及underlying分组，尚无series_id](/Users/mima0000/Desktop/github/trading-platform-main/pkg/options/worker.go:1686)。
- [现有OI最新写入](/Users/mima0000/Desktop/github/trading-platform-main/pkg/db/clickhouse/options.go:85)。
- [现有报价缓存字段](/Users/mima0000/Desktop/github/trading-platform-main/pkg/options/types.go:103)。

本轮只新增本设计文档。Go业务代码未更改，未重启服务，未执行数据库迁移。
