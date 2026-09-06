# 迭代计划

> 最近更新：2026-09-02（第一轮迭代执行完毕，验证结果见文末）

## 2026-09-02 迭代执行记录

本轮主题：修数据正确性 + 消除重复计算 + 收窄拉取范围。

### 已完成

- **共享分析层**（新 `src/server/barchart-analysis.ts`）：同一份快照的 Black-76 计算只做一次，
  按 `capturedAt` 记忆化；`/api/options/dashboard`、`/levels`、`/chain` 三路由全部改为消费
  同一份结果，scope→serie 选择语义集中在共享层。消除了之前每个路由各自跑一遍引擎的重复浪费。
- **0DTE 口径修正**：barchart DTE 在到期当天显示 1，现按"到期日=芝加哥今日"映射为 0DTE
  （`isExpiringToday`），落盘快照/页面真值日期均可支撑该判定。
- **gamma flip 口径**：扫描从"区间低端第一个变号点"改为"距现货最近的变号点"
  （`analyzeChain` 与 `combineAnalytics` 同步），修复 0DTE flip 漂到 call wall 上方的 artifact。
- **采集器 v3**（`scripts/barchart-poller.mjs`）：
  - serie 到期日改抓 serie 页 "N Days to expiration on MM/DD/YY" 文本真值
    （清单刷新时逐 serie navigate，每天一轮）；启发式降级为兜底，日志以 `~` 标记。
    serie 缓存升级 version 2（含 truth + path）。
  - 链死档过滤：OI/成交量/双边报价/last 全空的档位采集侧直接丢弃，日志输出
    `保留/总档数`（如 `231/894档`），推送体量与下游计算量大幅下降。
  - bars1m 失败带错误信息打日志并当轮重试一次（GC 间歇性空返回）。
  - 默认周期 900s（15 分钟）。
- **快照落盘**：ingest 路由每轮追加 `data/snapshots/YYYY-MM-DD.jsonl`，进程重启可回放；
  `data/` 与 serie 缓存已入 .gitignore。
- **05/08 面板修复**：行/档窗口改为"锚点（现货/CW/PW/FLIP 所在档）必含 + 按距现货填充至
  25 档"；锚点仍出窗时绘制贴边标记（带数值的方向标签）；05 热力图新增 gamma flip
  横贯虚线与 FLIP chip。涉及 `dashboard-view-model.ts`、`expiration-heatmap-model.ts`、
  `ExpirationHeatmapPanel.tsx`、`GexBreakdownPanel.tsx`。

### 实机验证（2026-09-02，一轮完整采集 + 三接口抽查）

- **真值抓取全对**：5 条已知错配 serie 全部纠正——ESU26=09/17、MI6V26=10/05、MV1V26=10/06、
  IY1V26=10/05、GCZ26=11/24（dte 84），与官网 serie 页文本一致。20 条 serie 全部抓到真值，无兜底回退。
- **范围过滤**：GCZ26 1788→864 档（-52%），MC1U26 798→514，全线平均约 -35%；
  过滤前后墙/flip 不变（GC nearest 仍 CW 4500 / PW 4300），确认丢弃档对指标零贡献。
  注：第一轮"死档过滤"无效，实测远价区档位都带结算价（settleOnly），改为"只留 OI>0 /
  成交量>0 / 现货±10% 内有双边报价"才真正收窄。
- **三接口一致性**：dashboard-0dte 与 chain 同 serie（IY6U26）的 CW/PW/flip 完全相同
  （4375 / 4315 / 4523），共享计算生效；levels 正常输出三 metric。
- **bars**：三产品本轮各 800 根，GC 未触发重试（日志通道已就位）。
- **落盘**：`data/snapshots/2026-09-02.jsonl` 正常追加。
- 采集器常驻运行中（900s 周期），dev server 127.0.0.1:4173。

### 本轮明确不做

- **P0-2 到期覆盖补全（Week 1~4 / 月度月份选择器）暂缓**：与"拉取范围收窄"方向冲突，
  待死档过滤后的实际体量运行一段时间再评估是否全量纳入。
- /gamma 页 GammaProfile 不画墙/flip 线（本身从不画，仅高亮现货行）；如需另行决定。

## 2026-09-02 第二轮迭代（面板体验）

- **01 总览底部新增 ④ GEX/OI/VOL 逐档分布总结**（仿初稿图一）：三列迷你胶囊条，
  现货附近 13 档、左低右高与价位轴同向；GEX 红绿定号、OI 蓝、VOL 绿，右上角为窗口合计。
  数据链路：dashboard cells 补 `call_vol/put_vol`（契约扩展），view-model 的 GammaRow
  聚合 OI/VOL，`overview-model` 派生 `profile`。
- **08 SPOT 修复**：现货行高亮原用 `tickSize×2` 容差匹配档位，GC（tick 0.1、档距 10）下
  永不命中——改为距现货最近档；并新增 SPOT 蓝色水平虚线 + 标签（与墙/flip 同机制，
  出窗有贴边标记）。
- **09 期权链美观**：单元格 10→11px、行距收紧（py-1→py-0.5）、行权价 12px 加粗、
  标注 chip 7→8px、GEX 微条加粗加宽；墙行整行淡色底（绿=CW/红=PW）替代仅靠小 chip。
- **默认布局重排**：01 h9→13（容纳 ④ 区）、05/08 h→14（适配 25 档窗口），其余面板顺移；
  布局存储 key 升 `marsoon:board:v2`（旧存档布局自动作废重建，用户也可手动"重置布局"）。
- 浏览器截图实测：01 三图渲染正常、08 SPOT/CW/PW/FLIP 四线齐全、09 密度与墙显示改善。

### 本轮明确不做（第二轮）

- 05 面板 25 档 × 30px 行高在 h14 下仍需少量内部滚动，未再加大（可拖角缩放）。

## 数据链路现状

```text
scripts/barchart-poller.mjs（WebBridge 浏览器态采集 v3）
    ↓ POST /api/ingest/barchart（同时落盘 data/snapshots/*.jsonl）
src/server/barchart-store.ts（内存仓，仅存最新快照）
    ↓ src/server/barchart-analysis.ts（Black-76 共享计算，按快照记忆化，算一次）
/api/options/dashboard · /api/options/levels · /api/options/chain
    ↓
ViewModel → Query Hook → 面板（/gamma 首页、/board 拼装看板）
```

## 2026-09-02 调研结论（均已对照官网页面/API 实测）

### 链数据本身完整

- 官网 merged 页面只发一个请求：`quotes/get?symbol=<serie>&list=futures.options&groupBy=optionType&raw=1`，与采集器一致。
- 单次返回全量链（GC：894 calls + 894 puts，`total` 吻合），无分页、无跨到期重复档。
- `futuresOptionsView=merged` 只是 Stacked/Split 展示开关，不提供额外数据。

### serie → 到期日归属有系统性错误（`resolveSerieExpiry` 启发式失效）

以官网 serie 页面的 "N Days to expiration on MM/DD/YY" 为真值：

| serie | 官网真值 | 采集器指派 | 偏差 |
| --- | --- | --- | --- |
| ES 月度 ESU26 | 09/17/26 | 09/16 | 1 天（expirations API 把 09/17 标成 weekly，代码偏爱 monthly 类型） |
| ES 周一 MI6V26 | 10/05/26（页面 "Week 1: Oct 2026"） | 09/14 | 3 周（按"最近星期一"匹配，忽略代码月字母 V=10 月） |
| ES 周二 MV1V26 | 10/06/26 | 09/08 | 4 周 |
| GC 周一 IY1V26 | 10 月（V26） | 09/14 | 错列（OI 仅 4） |
| GC 月度 GCZ26 | 11/24/26（合约月是 12 月，到期在 11 月） | 12/16 | 22 天，T 高估 26%；且 11/24 不在 expirations API 返回中 |

后果：热力图出现错日期列（ES 09-08/09-14 两根列其实是 10 月合约）、scope=all 聚合混入错 T 的 serie、到期结构表日期与官网不符。

### 站内数据渠道盘点

| 渠道 | 状态 | 说明 |
| --- | --- | --- |
| 每 serie 链（quotes/get + list=futures.options） | ✅ 已用，完整 | — |
| 到期日历（options-expirations/get） | ✅ 已用 | expirationType 与日期覆盖不完全可靠，不能当真值用 |
| 1min K线（queryminutes.ashx） | ⚠️ 已用有洞 | GC 间歇返回 0 根，采集器 catch 吞错误无日志 |
| 周期权页 "Week 1~4" 选择器 | ❌ 未用 | 每个工作日 serie 暴露 4~5 个符号（如周一 MI7U26=9/14 … MI6V26=10/05），现仅抓 1 个，9 月中下旬每日到期链缺失 |
| 月度页月份选择器 | ❌ 未用 | GC 有 Oct 2026~Jul 2027 各月；scope=all 实际只聚合近端 |
| 官方 Greeks 字段（delta/gamma/theta/vega） | ❌ 未用 | 月度 serie 有真值（ES 7600C δ=0.5804）；部分周期权为 0 占位；IV 确认为 N/A，自算 IV 必须保留 |
| serie 页 "N Days to expiration" 文本 | ❌ 未用 | 到期日的唯一可靠真值来源 |

### 面板结合问题（WALL / GAMMA FLIP）

- 01 总览价位轴自适应 min/max，墙永远可见（正常）。
- 08 GEX 拆分只渲染现货附近 11 档，墙线仅在窗口内绘制；GC 实例：spot 4355、CW 4500、PW 4300 均在窗外 → 两墙都不画。
- 05 热力图行轴截断 13 档，同理丢墙；且 gamma flip 在 05 无图形表达（只有 chip）。
- levels 接口无历史（内存仓只有最新快照），"关键价位迁移" sparkline 恒为平线。
- 墙口径是 GEX 加权（OI×gamma），与官网 OI 分布视觉最大值不同（GC 月度 OI 集中在 6000/8000C 与 3500P，GEX 墙在 4500/4300）。
- 0DTE gamma flip 易出现 artifact（GC 0DTE flip=4537 高于 call wall 4375）：扫描从区间低端取第一个变号点 + T 地板 0.35 天所致。

## 本轮决策（已定）

- 采集周期固定 15 分钟（`INTERVAL_SEC=900`）。源数据延迟 10–20 分钟，5 分钟轮询无收益。
- 删除 Net GEX `Δ5m / Δ15m / Δ30m` 指标（15 分钟周期下 Δ5m 无意义，细节指标不做）。
- K线继续拉 1min（每次返回约 800 根 ≈13 小时窗口，15 分钟间隔不断档；15min 级别需要时本地聚合）。

## P0 · 数据正确性（本轮执行）

1. ✅ **serie 到期日改为页面真值**：refreshSerieList 时逐 serie navigate 抓 "N Days to expiration on MM/DD/YY"；启发式退役为兜底（`scripts/barchart-poller.mjs`）。
2. ⏸️ **到期覆盖补全**：Week 1~4 / 月份选择器符号全量纳入——本轮暂缓（与收窄拉取方向冲突，待过滤后体量运行评估）。
3. ✅ **GC bars1m 修复**：fetch 失败带错误信息打日志并当轮重试一次。
4. ✅ **快照落盘**：ingest 路由追加写 `data/snapshots/YYYY-MM-DD.jsonl`。

## P1 · 面板修复

1. ✅ 05 / 08 窗口改为锚点必含 + 填充至 25 档；窗外锚点画贴边标记；05 增加 flip 横贯虚线。
2. ⏳ 墙口径确认：GEX 加权 vs 纯 OI 最大，必要时双显——未动，待与官网视觉对照后定。
3. ✅ gamma flip 取距现货最近变号点；到期当天（到期日=芝加哥今日）映射 0DTE。
   另：本轮顺带完成"三路由共享一次计算"（barchart-analysis 记忆化）。

## P2 · 增强（后续迭代）

- 官方 Greeks 交叉校验自算 IV/gamma（月度 serie 有真值）。
- levels API 消费落盘快照，关键价位迁移图与日内变化恢复意义。
- 06 日内变化面板（K线数据已具备）。

## 验收标准

- 逐 serie 对照官网页面核对到期日与 DTE，全部一致。
- 05/08 面板任意 scope 下两面墙与 flip 均可见（或明确贴边标记）。
- `pnpm lint`、`pnpm build` 通过。
- 采集器连续运行 1 小时无静默失败（日志可查）。
