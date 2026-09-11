# Implementation & Verification — Tibo Codex Monitor 残留漏报风险修复（R1/R3/M1/R2/R4/R5/M2）

Date: 2026-09-11
Branch: `codex/open-gambit-v1-staging-candidate`（本地工作树，未提交）
Production mutation: **NO** — 未 deploy、未跑 production migration、未改 cron/变量、未写生产 D1/R2。

前置：`DIAGNOSIS-X-TWEET-MISS-2026-09-11.md`（根因诊断）、`IMPLEMENTATION-X-TWEET-MISS-REPAIR-2026-09-11.md`（上一轮 P0/P1 修复）。
本报告为第二轮（残留风险）修复的完整实现与验证记录。诊断核验结果见本轮开始时给出的《诊断报告》：6 项残留问题全部成立（R2 有一处与上一轮报告不一致：报告声称"1 次 reservation"，代码证实 1 次 reservation 覆盖最多 N 页 HTTP 请求 + 可选用户解析请求，计量不透明 —— 已修复）。

---

## 一、变更摘要（按问题）

### R1（P0）补充搜索放宽：NORMAL 也触发 + 独立小预算池

- `src/utils/search-schedule.ts`
  - 新增 `WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT`（默认 2，独立池）、`WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS`(默认 2)。
  - `shouldRunSupplementalWebSearch()` 重构：预算从独立池读取；触发条件放宽为
    **活跃模式 | NORMAL 且距上次常规搜索 ≥ stale 窗口 | 最近 24h 有直连 reset 信号且未生成事件**；
    新增 `trigger` 字段（`active_mode` / `normal_stale` / `recent_reset_signal`）与 `no_trigger` 跳过原因；仍 fail closed（disabled / daily_budget_exhausted / interval_not_elapsed / no_trigger）。
- `src/providers/search-provider.ts`
  - 新增 `WEB_SEARCH_SUPPLEMENT_PROVIDER_KEY = 'web_search_supplement'`：provider 硬门按 `purpose === 'reply_supplement'` 分流到独立池，主池仍是 max(主, 活跃)。
  - 效果：NORMAL 每日 = 6 次常规 discovery + 至多 2 次 reply 补充（7–8 次/日，符合任务成本要求），且补充通道永远不会耗尽主池。
- `src/db/repository.ts`：新增 `hasRecentDirectResetSignalWithoutEvent(withinHours, now)`（reset 关键词 + 无事件，只读计数）。
- `src/cron.ts`（2b 块）：去掉 `searchMode !== 'NORMAL'` 门；补充搜索消耗独立池、更新 `web_search_supplemental_last_attempt`；跟随决策的原因（disabled/exhausted/no_trigger）仅在主原因为空时透出，主搜索被超越时不双重运行（同一 tick 内 `searchSkipped` 守卫保留）。
- 新测试：NORMAL+stale 主搜索触发、NORMAL+reset 信号触发、NORMAL 无触发静默、provider 池分流、独立池 fail closed（见 `tests/residual-miss-risks.test.ts`、`tests/adaptive-search.test.ts`）。

### R3 / M1（P0）摄入完整性监控（ingestionGap 探针）

- `src/providers/x-api.ts`
  - 导出单一事实源 `X_TIMELINE_EXCLUDE = 'retweets'`（health 从此常量派生，不再硬编码）。
  - `XApiFetchOptions.startTime`（`start_time` 窗口下界）、每账号 `pagesFetched`。
- `src/cron.ts`
  - 新增 `probeXIngestionCompleteness()`：启用时（`X_INGESTION_PROBE_ENABLED=true`，默认关闭）至多每天 1 次，用 1 个 X reservation 拉取最近 24h **完整时间线（含回复，`start_time` 为界，至多 2 页）**，与 D1 `countIngestedDirectXPostsWithin()` 对比，写 `missedCount = max(0, timelineCount - storedCount)` 到 settings。
  - 探针**只计数不写 source_posts、从不推进游标**；失败进入 `X_INGESTION_PROBE_RETRY_HOURS`（默认 4h）退避，防止 X 故障时自耗预算。
  - `executeCron` 1b 块：低频触发（15 分钟 tick 内与主同步争抢同一槽位会被自动跳过，下个 tick 重试）。
- `src/index.ts`：新增 `POST /__cron/x-ingestion-probe`（CRON_SECRET 门控，`force=1` 可跳过间隔门，仍须已启用）。
- `src/routes/api.ts`：`/api/health` 新增顶层 `ingestionGap`（probeEnabled / windowHours / lastProbeAt / windowStart / timelineCount24h / storedCount24h / missedCount / pagesFetched），并与 `monitorGap` 并列；`monitorGap.repliesIncludedInTimeline` 与新增 `lastTimelineFetchExclude` 均从 `X_TIMELINE_EXCLUDE` 常量派生 —— 摄入层过滤参数一旦被改回去，两处立即可见偏离。

### R2（P1）回填预算计量

- `src/providers/x-api.ts`：`XApiAccountBatch.pagesFetched`（每账号实际打出的时间线 HTTP 页数）。
- `src/cron.ts` `backfillHistoricalXTimeline()`：
  - 默认页数 10 → **5**（`DEFAULT_X_BACKFILL_MAX_PAGES`，`X_API_BACKFILL_MAX_PAGES` 仍可覆盖，上限 20）。
  - 响应新增 `pagesFetched`（各账号之和）与 `reservationsUsed: 1`。
  - `since` 远时保护：`sinceId` 解码出日期早于 `X_BACKFILL_MAX_LOOKBACK_DAYS`（默认 14 天）时抛 `BACKFILL_SINCE_TOO_OLD`，需 `force=true` 才继续（页数无法预知，故拒绝而非估算）。
- `src/index.ts` `POST /__cron/backfill-x`：透传 `force`，响应即含 `pagesFetched`/`reservationsUsed`。
- 新测试：默认 5 页、pagesFetched/reservationsUsed 计量、远的 since 拒绝 + force 放行。

### R4 / R5（P1）NEEDS_REVIEW 人工复核通道

- `src/types.ts`：`CLASSIFICATION_DECISIONS` 增加 `'REVIEW'`；`CLASSIFICATION_REASON_CODES` 增加 `'NEEDS_REVIEW'`（两列均为无 CHECK 约束的 TEXT，**零迁移**）。
- `src/classifier/types.ts`：新增 `isNeedsReviewStrongResetSignal()` —— 可信直连源（thsottiaux 规范表示）+ 强短语（reset/restored/**lifted**/**back to normal**/**done**/**fixed**/**working again**/rolling out/just pushed the reset/should be good 等）+ 广泛受众（everyone/all users 等），排除否定、显式非 Codex 产品语言。R4 所列随意措辞全部覆盖；裸 "Reset done." 无受众仍按原样拒绝（与 R5 任务文本"强 reset 短语 + 广泛受众"严格一致，且不违反"不得仅凭作者推断 Codex"——REVIEW 不是发布）。
- `src/cron.ts` `classifyAndCreateEvent()`：admission 拒绝分支先查 `isNeedsReviewStrongResetSignal`，命中则写 `classification_decision='REVIEW'` + `classification_reason_code='NEEDS_REVIEW'` 的 trace、`markClassified`、**不生成事件**。REVIEW 行仍可被确定性恢复通道重访（attempts<5），非终态。
- `src/db/repository.ts`：`getPostsNeedingReview(limit)`。
- `src/index.ts`：新增 `GET /__cron/review-queue`（CRON_SECRET 门控，返回待复核帖子 id/text/url/id 等有界字段）。
- 新测试：正样本（two 条短完成语 → REVIEW）、负样本（非可信账号 / 无受众 / 显式非 Codex / 否定）、OBSERVATION 只入复核队列**永不发布**、队列查询。

### M2（P2）拒绝原因聚合

- `src/db/repository.ts`：`countRejectionReasonsWithoutEventsWithin(days)` —— 按 `classification_reason_code` 统计 7 天内无事件的帖子。
- `src/routes/api.ts`：`monitorGap.rejectionBreakdownLast7d: { MISSING_PRODUCT_CONTEXT: n, OBSERVATION_NOT_ADMITTED: n, ... }`（自动同步开启时），运维一眼区分"系统性摄入漏报（某一原因暴涨）"与"有意拒绝"。
- 新测试：聚合结果与 SQL 绑定参数断言。

### 配置/模板
- `src/types.ts` `Env`：新增 `WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT`、`WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS`、`X_BACKFILL_MAX_LOOKBACK_DAYS`、`X_INGESTION_PROBE_ENABLED/INTERVAL_HOURS/WINDOW_HOURS/MAX_PAGES/RETRY_HOURS`。
- `wrangler.example.jsonc`：注释模板同步（`wrangler.jsonc` 生产配置**未改**）。

## 二、不变量守住核验

| 不变量 | 处置 |
|---|---|
| INDEXED 置信度钳制 ≤0.85、`verified_at=null` | 未触碰 `llm.ts` / `search-provider.ts` 证据字段（回归测试通过） |
| 预算 fail closed | 补充池 0 → disabled；耗尽 → daily_budget_exhausted；探针未启用 → probe_disabled + 无 API 调用（均有测试） |
| `OBSERVATION` 永不公开 | NEEDS_REVIEW 仅写 trace，不建事件；OBSERVATION 也可入复核队列但**永不发布**（测试覆盖） |
| REJECTED 终态 | 未改（upsert/事件路径未动） |
| 事件去重 | `monitor_events UNIQUE(source_post_id)` 相关路径未动 |
| cursor 只进不退 | backfill `advanceCursor:false`、探针永不推进（测试断言 advanceXApiCursor 未调用） |
| 直接证据压过索引证据 | 未动证据优先级与升级路径 |

## 三、门禁结果（本地）

| Gate | Result |
|---|---|
| 全量测试（vitest） | PASS — 39 files, 516 passed, 1 skipped |
| typecheck（tsc --noEmit） | PASS |
| lint | PASS |
| build（wrangler build，dry-run 语义=成功，dist 重新生成） | PASS（dist/index.js 13:32 刷新） |
| migration:parity | PASS（0026 链完整，immutability 攻击 9/9 拒绝） |
| open-gambit:demo | PASS — 2 tests |
| git diff --check | PASS |
| 本地 D1 迁移 + 新 SQL 实跑验证 | PASS（`db:migrate:local` 全绿；4 条新 SQL 在真实本地 D1 执行成功） |
| 部署配置 `wrangler.jsonc` | 未修改 |

新增/更新测试：`tests/residual-miss-risks.test.ts`（16 项，新）、`tests/adaptive-search.test.ts`（补充池/触发/成本曲线）、`tests/x-tweet-miss-fixes.test.ts`（真实 snowflake fixture + 信号查询 mock）、`tests/api.test.ts`（health 新字段形状）。

## 四、人工验证步骤（本地 dev，非生产）

```bash
# R1：NORMAL 静默期 reply 补充搜索（观察 search.status/reason 与 supplement 池计数）
curl -s 'http://localhost:8787/api/health' | jq '.webSearch, .monitorGap, .ingestionGap'

# R2：回填计量（响应含 pagesFetched / reservationsUsed；远时 since 须 force）
curl -s -X POST 'http://localhost:8787/__cron/backfill-x?secret=<CRON_SECRET>&maxPages=5'
curl -s -X POST 'http://localhost:8787/__cron/backfill-x?secret=<CRON_SECRET>&since=<旧id>'            # → BACKFILL_SINCE_TOO_OLD
curl -s -X POST 'http://localhost:8787/__cron/backfill-x?secret=<CRON_SECRET>&since=<旧id>&force=true'

# R3：摄入完整性探针（需 .dev.vars 设 X_INGESTION_PROBE_ENABLED=true 才真正拉取；force 仅跳过间隔）
curl -s -X POST 'http://localhost:8787/__cron/x-ingestion-probe?secret=<CRON_SECRET>&force=true'
curl -s 'http://localhost:8787/api/health' | jq '.ingestionGap'   # missedCount>0 即摄入层漏抓

# R4/R5：人工复核队列（只读）
curl -s 'http://localhost:8787/__cron/review-queue?secret=<CRON_SECRET>'

# M2：拒绝原因分布
curl -s 'http://localhost:8787/api/health' | jq '.monitorGap.rejectionBreakdownLast7d'
```

## 五、风险与说明

1. **补充搜索成本**：NORMAL 上限 = 6 常规 + 2 补充 = 8 次/日（独立池，互不耗尽）；活跃模式补充仍走独立池（每次补充不占 24 次/日的确认池）。Brave 月度成本净增 ≤ 60 请求/月。
2. **探针口径**：`timelineCount` 受页数上限（默认 2 页）约束，高流量账号 24h 内 >200 条时会低估 → missedCount 偏保守（低估漏报而非高估），可通过 `X_INGESTION_PROBE_MAX_PAGES` 调高；`storedCount` 与 timeline 都按 `published_at` 在窗口内统计，口径一致。
3. **REVIEW 队列噪音**：规则刻意严格（可信源 + 强短语 + 广泛受众），意图把队列保持在个位数；裸 "Reset done." 无受众仍拒绝（与任务文本一致）。队列内容含推文原文，仅 CRON_SECRET 持有者可读（已 noindex）。
4. **生产上线仍需显式授权**：本分支的部署、`db:migrate`（本次无新 migration，不需要）、新环境变量（`X_INGESTION_PROBE_ENABLED` 等）、回填执行均属生产变更，须按 AGENTS.md 单独授权后执行。
5. **wrangler.jsonc 未动**：新变量走代码默认 + 模板注释，避免误改生产配置。

## 六、P2 未实现项设计（记录，不实施）

1. **复核台写操作**：`review-queue` 目前只读。后续可加 `POST /__cron/review-resolve`（CRON_SECRET 门控）：`{id, action: 'publish'|'reject', category?}`。发布前必须先 `markClassified` 重置 + 复检 `isCodexProductSignalAdmissible` + 以 `verification_status='DIRECT_VERIFIED'` 走 `insertEvent`（复用既有去重/生命周期）；拒绝则写 `classification_decision='NO_EVENT'` + 具理由 code。两端都是显式写操作，不做成自动路径。
2. **复核待办 UI**：内部 admin 面新增 `NEEDS_REVIEW` 列表与一键发布/驳回（复用 `static/open-gambit-admin.js` 的鉴权边界），公开面零改动。
3. **ingestionGap 告警**：`missedCount > 0` 连续 N 次探针时通过既有 provider status / Telegram 通道提醒运维；阈值与提醒通道可配，默认只写 settings 不打扰。
4. **回填页数估算**：当前采用"远时拒绝 + force"而非估算。若要估算，可缓存每账号最近一次同步的"每分钟发帖密度"再换算页数——需要额外元数据表，超出本轮范围。