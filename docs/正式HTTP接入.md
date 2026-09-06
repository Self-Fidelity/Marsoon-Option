# 正式期权 HTTP 接入

服务地址由服务端环境变量 OPTIONS_API_BASE_URL 指定，浏览器仅访问本项目 /api/options/*，无需跨域或暴露服务端令牌。

本次只接入现有读取接口，不修改 Go 服务、采集器或数据落盘。

| 页面 | 正式接口 | 当前状态 |
| --- | --- | --- |
| 总览、关键位 | /options/levels | 市场状态与同快照关键位 |
| 到期热力图、GEX 拆分、价格档位 IV | /options/heatmap + /options/levels | 按市场状态匹配合约及到期日 |
| 数据状态 | /options/levels | 使用业务时间和质量标记，不假定存在 /options/status |
| 日内蜡烛 | /options/intraday | 当前 404，显示空态，不从稀疏状态造 OHLC |
| 期权报价链 | /options/chain | 当前 404，显示空态，不把价格档位当报价链 |
| 期限结构 / PCR | /options/term | 当前 404，显示空态 |

目前仅 0dte / all 可准确匹配页面周期。30DTE、90D、收盘 EOD 不映射到 nearest 或 all，缺口明确展示。

热力图到期汇总仅代表返回价格窗口和最多 90 天到期范围，不能当全市场总量；总览 GEX 保留服务端 MarketState 原值。重复行取同合约、到期日、执行价下最新快照，不跨快照累加 OI。put_gex 已带负号。

验证：node --test scripts/test-options-live.mjs；npm run lint。启动：npm run dev，访问 http://127.0.0.1:4173/board。
