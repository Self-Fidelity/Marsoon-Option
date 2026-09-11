# WS 与增量协议待确认清单（提交数据供应商）

> 创建：2026-09-10。状态：**待供应商回复**。
> 背景：本地侧已完成 K 线的"尾部窗口刷新 + 只增不减缓存 + WS 看门狗"（见 `../frontend/本地侧优化方案.md`），
> 剩余的延迟与稳定性上限取决于本清单这些协议事实。
> 所有问题的背景数字都来自 2026-09-10 的线上实测，可复现命令见 [Go后端接口清单](../interface/Go后端接口清单.md) §11。

---

## 0. 我们已测到的事实（不用重复验证）

| 事实 | 数字 |
|---|---|
| K 线数据形态 | **1 分钟 OHLCV**：`{unix,o,h,l,c,volume,final}`，单根约 109B，间隔严格 60s，无 tick 字段 |
| 24h 整窗载荷 | 1379 根 = **142KB**，Go 链路实测 **16.7s**（有效吞吐 ~8.7KB/s） |
| 30 分钟载荷 | 30 根 = **3.3KB**，实测 **0.73s** |
| 响应压缩 | 请求带 `Accept-Encoding: gzip, br`，响应**无 Content-Encoding**，仅 `Transfer-Encoding: chunked`、无 Content-Length |
| `/ws` 握手 | 无 token 直连：只有 `error` 事件、无 close 帧/码（客户端无法得知失败原因） |
| 前端 WS 消费 | 仅 `stream=4 & timeframe=60`，信封 `{stream, data(base64 JSON), request_id?}`，含 `subscribe/unsubscribe` |
| 前端协议盲区 | `request_id`（疑似 getrange 回补）从未使用；stream 编号表、心跳、推送频率全部未知 |

---

## P0 —— 直接决定"不断联 + 及时更新"能不能做

### 1. `/ws` 协议文档

请提供完整的协议说明（哪怕是内部草稿）：

1. **stream 编号表**：4 = 1 分钟 K 线（已确认）。是否还有其它 stream（水位/逐笔/盘口/资金流）？
2. **信封规范**：`{stream, data, request_id, pair, timeframe}` 各字段的确切语义；`data` 是否恒为 base64 JSON。
3. **`request_id` 的请求-响应语义**：前端代码注释表明存在"历史 getrange 分块"。请给出：
   - 请求方法名与参数（是否可按 `from/to` 拉历史 bar？）
   - 分块/分页规则、结束标记
   - 我们希望用它做**断线后的缺口回补**（目前只能走 HTTP 整窗重拉 142KB）
4. **心跳机制**：服务端是否有 ping/pong？间隔多少？客户端要不要主动发？静默多久视为断线？
5. **鉴权与票**：token 有效期多长？断线重连是否必须重新换票？同一 token 能否多连接并存？

### 2. K 线推送频率与语义（当前卡顿问题的关键）

- 推送时机是 **bar 收盘才推一条**，还是 **bar 进行中每个 tick 都推当前累积值**？
- 若是进行中推送：频率多少（每秒？每 tick？）；`final` 字段的准确语义；
  bar 收盘后会不会**重发一次 final=true 的修正值**？成交量是否会事后修正？
- 同一分钟会不会收到多次？以哪次为准？
- 推送是否有序列号 / 时间戳可用于**丢包对账**？

> 这一项决定前端能否安全地把图表更新降到 1Hz，以及要不要做"收盘确认"逻辑。

### 3. 响应压缩 + Content-Length（全链路收益最大的一项）

- 请在 Caddy 或 Go 侧对 `application/json` 开启 **gzip/br**；
- 并避免边序列化边 flush：先完整序列化到 buffer，带 `Content-Length` 一次性写出。
- 预期收益：142KB → 约 20KB（JSON 压缩比 8~10×），按当前 ~8.7KB/s 的链路，
  K 线整窗加载从 **16.7s → 约 2~3s**；d90 dashboard 从 880KB/几十秒 → 约 100KB/几秒。

---

## P1 —— 把"整包重拉"变成"增量拉取"

### 4. 快照 revision + 304 条件请求

- dashboard / levels / chain 响应加 `ETag`（建议直接用 `snapshot_unix`）与 `Cache-Control: no-cache`；
- 支持 `If-None-Match` 返回 304 + 空体。
- 前端已有版本轮询（`/api/options/version`，30s、几百字节），配合 304 后：
  "问一句有没有变"的成本接近零，变了才拉整包。

### 5. 轻量 current 端点（或字段裁剪参数）

- `GET /api/options/intraday?options_only=true` 响应中的 `levels[]` 轨迹序列
  **自 2026-09-09 前端移除历史水位后已无任何消费方**，却占响应体积的大头；
- 请提供其一：
  - `?include_levels=false` 之类的裁剪参数；或
  - 独立的轻量端点只返回 `current`（spot / call_wall / put_wall / gamma_flip / atm_iv）。
- 在此之前前端已把该接口降频到 300 秒（仅作 current 兜底）。

### 6. levels 的增量拉取

- `/options/levels` 已支持 `from/to` 范围（很好）。请确认：
  - 是否支持 **`If-Range`/续传语义**，或我们按 `from = 上次最后时间点 + 60` 自行续拉是否有坑；
  - 旧分钟的水位会不会被**事后修正**（若会，纯续拉会漏掉修正值，需要显式的"修订通知"）。

---

## P2 —— 远期与口径

### 7. tick 级数据可查性

- ClickHouse 是否保留**逐笔成交（tick）**可查？未来若做 tick 级图表 / 成交流 / 大单统计，是否需要新增接口？
- 若保留，查询接口是否支持按合约 + 时间范围的流式输出？

### 8. 数据口径

- `quality_flags` 的权威位定义（当前前端只用 `1<<2` MISSING_OI，其余位含义不明）；
- `chain.rows` 的 `last/oi/volume/change` 大量 null 的原因与补齐计划；
- 收盘档 `state: partial` 的完整发布时间点。

---

## 附：浏览器端 WS 推送频率自测脚本

> 登录 `/board` 后在浏览器控制台粘贴运行，60 秒后输出统计。
> 这是我们最需要的一个数字（决定前端要不要做 1Hz 节流），供应商不方便时我们可以自测。

```js
(async () => {
  const ticket = await fetch("/api/auth/candles-ws", { credentials: "include" }).then((r) => r.json());
  if (!ticket.url) return console.log("换票失败", ticket);
  const ws = new WebSocket(ticket.url);
  const times = []; let bytes = 0; let bars = 0; let finals = 0;
  ws.onopen = () => ws.send(JSON.stringify({ method: "subscribe",
    data: { stream: 4, pair: { exchange: "DATABENTO", symbol: "NQU6" }, timeframe: 60 } }));
  ws.onmessage = (e) => {
    const raw = typeof e.data === "string" ? e.data : "";
    times.push(performance.now()); bytes += raw.length;
    try {
      const payload = JSON.parse(atob(JSON.parse(raw).data));
      bars += payload.values?.length ?? 0;
      finals += payload.values?.filter((v) => v.final).length ?? 0;
    } catch { /* 非 K 线消息 */ }
  };
  setTimeout(() => {
    const gaps = times.slice(1).map((t, i) => Math.round(t - times[i]));
    console.log("WS 60 秒统计", {
      消息数: times.length,
      平均每秒字节: Math.round(bytes / 60),
      bar 更新总次数: bars,
      final 占比: bars ? (finals / bars).toFixed(2) : "-",
      前 30 个消息间隔ms: gaps.slice(0, 30),
      最大间隔ms: gaps.length ? Math.max(...gaps) : 0,
    });
    ws.close();
  }, 60000);
})();
```

预期判读：
- `消息数 ≈ 1~2` → 后端只在 bar 收盘推，前端 1Hz 节流无意义，卡顿另有原因；
- `消息数 ≥ 60` → 后端在推 in-progress bar，前端的 1Hz 节流就是必要的；
- `bar 更新总次数` 远大于 `消息数` → 一条消息打包多根 bar（批量推送），前端合并逻辑已兼容。
