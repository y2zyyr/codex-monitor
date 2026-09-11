# Implementation & Verification — Tibo Codex Monitor X 推文遗漏修复

Date: 2026-09-11
Branch: `codex/open-gambit-v1-staging-candidate`
Production mutation: **NO** — 未 deploy、未跑 migration、未改 cron/变量、未写生产 D1/R2。
前置诊断见 `DIAGNOSIS-X-TWEET-MISS-2026-09-11.md`。

## 一、变更摘要（按根因）

### P0-1 取消 `exclude=replies`（摄入层保留回复）
`src/providers/x-api.ts`：
- `fetchUserTimeline()` 请求参数由 `exclude=retweets,replies` 改为 `exclude=retweets`（`x-api.ts:290-293`）。回复、线程后续、引用的帖子全部进入 `source_posts`；retweets 仍被排除以压噪。
- 噪音处理下沉到分类层（既有的 `isObviousIrrelevant`、`keywordPrefilter`、Codex 锚点与 admission 门不变）。
- 副作用：时间线 payload 变大，但 X 预算仍为 96 次/日 + 单次最多 3 页（backfill 除外），语义不变。

### P0-2 直连健康时也允许补充搜索
- `src/utils/search-schedule.ts`：新增 `shouldRunSupplementalWebSearch()`（独立冷却 `WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS`，默认 1h；与主搜索共用每日预算；`disabled` / `daily_budget_exhausted` / `interval_not_elapsed` 均 fail closed）。
- `src/providers/search-provider.ts`：新增 `getReplySupplementQueries()`（reply 导向的 web 查询，`purpose: 'reply_supplement'`）；`SearchPurpose` 增加 `'reply_supplement'`（`src/providers/types.ts`）。
- `src/cron.ts`（2b 块）：当 X 直连为 automatic、本轮直连未失败、常规搜索本轮未跑、且处于活跃模式（WATCHING/CONFIRMING）时，允许一次补充搜索。NORMAL 模式不加额外搜索（保持 6 次/日成本曲线）。

### P0-3 一次性历史回填
- `src/providers/x-api.ts`：`XApiFetchOptions` 新增 `ignoreStoredCursor`、`backfillMaxPages`（上限 `MAX_X_BACKFILL_PAGES = 20`）；provider 永不推进游标（游标推进仍只由 cron 的 `persistXAccountBatches` 完成）。
- `src/db/repository.ts`：新增 `getOldestDirectXSourcePostId()`（回填下界；无存量时走最近窗口）。
- `src/cron.ts`：`persistXAccountBatches()` 增加 `{ advanceCursor }` 选项（默认 true，cron 行为不变）；新增导出 `backfillHistoricalXTimeline()` —— 回填默认从最早存量帖为下界向前抓取，经 `upsertSourcePost` 去重/升级后入库，`advanceCursor: false`，不生成事件，新帖 `classification_pending=true` 进入常规分类队列。
- `src/index.ts`：新增 `POST /__cron/backfill-x`（CRON_SECRET 门控，可选 `since` / `maxPages` 参数），与既有 `/__cron/trigger` 同权。对生产回填仍须按 AGENTS.md 显式授权。

### P1-1 活跃模式搜索预算
- `src/utils/search-schedule.ts`：新增 `WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT`（默认 24）与 `getWebSearchDailyLimitForMode(mode, env)`；`shouldRunWebSearch` / `nextWebSearchAt` / `isWebSearchOverdue` / `getEstimatedMonthlyRequests` 改为按模式取预算。NORMAL 仍为 6 次/日、4h 间隔（成本不变）；活跃模式 1h 节奏、24 次/日（可配）。
- `src/providers/search-provider.ts`：provider 硬门改为两个池子的 `max()`（cron 是模式感知的主闸，provider 是不再误拒的第二硬闸），预算耗尽仍 fail closed。

### P1-2 分类每轮上限
- `src/cron.ts`：`MAX_CLASSIFICATIONS_PER_RUN` 5 → 10，并支持 `CLASSIFICATIONS_PER_RUN` 环境变量（1–50 钳制）。
- `prioritizeCandidates()`：确定性 reset hints（`isCompletedResetHint` / `isSoftResetHint` / 可信上下文完成）排在关键词优先级之上，预算优先花在最可能的漏报候选上；`getUnclassifiedPosts(20)` 提高到 50。

### P1-3 短推文确定性短语库（守住既有不变量）
`src/classifier/types.ts`：
- 代码锚定短语（显式含 “codex”，直接确定性完成，无需活跃周期）：`Codex resets applied` / `Codex quota reset complete` / `Codex usage limits restored` / `usage … restored for all Codex users`，接入 `isCompletedResetHint`。
- 上下文化短完成短语（仍需可信活跃周期 + 广泛受众）：`Resets applied for everyone` / `We've reset for everyone` / `Quota reset complete for everyone` / `Usage limits restored for everyone` / `Everyone's usage has been reset`（扩展 `SHORT_COMPLETION_RESET_PATTERN`），`BROAD_RESET_AUDIENCE_PATTERN` 增加所有格形式。
- `buildCompletedResetHintResult()` 摘要/原因改为覆盖整个 completed-state 家族的通用模板（长度天然超过 index-policy 门槛）。
- 不变量保持：`OBSERVATION` 仍永不发布；REJECTED 仍终态；INDEXED 置信度钳制与 `verified_at=null` 未动；显式非 Codex 语言优先；无 codex 锚定的裸 short completion 仍只在活跃周期 + 强短语 + 广泛受众下放行。

### P1-4 漏报监控
- `src/db/repository.ts`：新增 `countDirectPostsWithoutEventsWithin(days)`（7 天内已摄入但无事件的直接 X 帖计数）。
- `src/routes/api.ts`：`GET /api/health` 新增 `monitorGap.directXPostsWithoutEventsLast7d`（自动同步开启时）与 `repliesIncludedInTimeline`，纯内部诊断，不新增公开 dashboard。

### 规则/行为变更说明（对照旧报告）
- `ADAPTIVE-SEARCH-BUDGET-REPORT.md` / 旧测试曾锁定“活跃模式 6 次/日”——已按本任务要求上调为 24 次/日（`WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT`，默认 24，fail closed）。
- 旧报告注明“每轮分类预算 5”——已上调为 10（可配），确定性 reset hints 优先。
- X 时间线请求 `exclude=retweets,replies` → `exclude=retweets`（旧的 `tests/provider.test.ts` 断言同步更新）。
- 新通道：`/__cron/backfill-x`、`web_search_supplemental_last_attempt` 设置项、`monitorGap` health 字段。

### P2（中期，本期未实现，记录设计方案）
1. 人工补录通道：站内已有 `manual_reset_reports` 体系（`src/manual-reset.ts`、`reset-source.ts`），未新增 MANUAL 事件类别。
2. UI 区分 `DIRECT_VERIFIED` / `INDEXED_ONLY` / `MANUAL_REPORTED`：事件表已存 `verification_status`，渲染层未改（避免超范围）。
3. 审计日志与人工回滚：现有 `monitor_runs` + classification trace 已可支撑，未新增。
4. 域名信誉/社区确认独立性与确认搜索机制保持现状。

## 二、测试

新增/更新：
- `tests/x-tweet-miss-fixes.test.ts`（新，9 项）：exclude=retweets 且回复帖以 DIRECT 证据入库；回填忽略游标/不推进游标/显式 sinceId/无下界回退最近窗口；直连健康+活跃模式触发 reply_supplement 搜索；NORMAL 与预算耗尽时不触发；分类预算默认与 env 覆盖；reset hint 排序。
- `tests/reset-hints.test.ts`（+4 项）：codex 锚定 terse 完成短语入事件（LLM 不可用时也成立）；无 codex 锚定不误放；short-completion 库在活跃周期内的正/负样本；模板摘要长度达标。
- `tests/provider.test.ts`：`exclude` 断言改为 `retweets`。
- `tests/adaptive-search.test.ts`：NORMAL 6/日不变；活跃模式 24/日 + 可配 + fail closed；补充搜索冷却/预算/禁用；provider 硬门 = max 池 + 耗尽 fail closed；成本投影更新（WATCHING 720/月）。
- `tests/api.test.ts`：health 形状含 `monitorGap`。

已守住的不变量（回归类）：
- INDEXED 置信度钳制 ≤0.85、`verified_at=null`（`llm.ts` 未改，测试通过）。
- 预算 fail closed（`disabled`/`daily_budget_exhausted` 两条路径均有测试）。
- `OBSERVATION` 永不生成公开事件（`isCodexProductSignalAdmissible` 未改）。
- REJECTED 终态、事件去重（insertEvent `INSERT OR IGNORE` + UNIQUE）、cursor 只进不退。

门禁结果（本地）：

| Gate | Result |
|---|---|
| 全量测试（vitest） | PASS — 38 files, 498 passed, 1 skipped |
| typecheck | PASS |
| lint | PASS |
| build（`wrangler build`） | PASS（dist 重新生成） |
| migration:parity | PASS |
| open-gambit:demo | PASS — 2 tests |
| git diff --check | PASS |
| 部署配置 `wrangler.jsonc` | 未修改（新变量走代码默认/模板示例） |

## 三、人工验证步骤（本地 dev，非生产）

回填通道（一次性回填历史回复/线程；游标不动、走去重）：
```bash
curl -X POST 'http://localhost:8787/__cron/backfill-x?secret=<CRON_SECRET>'        # 从最早存量帖下界回填
curl -X POST 'http://localhost:8787/__cron/backfill-x?secret=<CRON_SECRET>&since=<snowflakeId>'  # 指定下界
```
回填后无需额外操作：新帖 `classification_pending=true`，常规 cron 分类队列会消化（每轮预算 10，reset hints 优先）。
漏报监控：
```bash
curl -s http://localhost:8787/api/health | jq .monitorGap   # directXPostsWithoutEventsLast7d > 0 即提示存在已摄入但未发布事件
```

## 四、风险与说明
- P0-1 后回复噪声进入管道：由分类层既有的 admission 门处理，不回退摄入层。
- 活跃模式预算 24/日意味着每日最多 24 次 web 搜索（仅活跃期、且被补搜冷却与 fail-closed 双重限制）；NORMAL 成本不变。
- 回填会消耗 1 次 X 每日 reservation 槽；重复执行安全（去重幂等）。
- 生产上线需另行显式授权：`db:migrate` 不需要（本次无迁移）；部署/变量/回填执行均须授权。