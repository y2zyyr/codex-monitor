# 第三轮实现与验证：复核闭环、监控可用性、积压治理

日期：2026-09-11。项目：Tibo Codex Monitor（ModelYard）。
本地分支：`codex/open-gambit-v1-staging-candidate`。

**生产零改动**：未 deploy、未执行 remote migration、未改部署配置/cron/生产变量、未写生产 D1/R2、未调用真实 X/LLM/Telegram 生产路径。没有新增 migration。保留工作区原有修改，未提交或回退它们；提示词所说的“前两轮已合入”与本地实际不符，前两轮修改仍有未提交及未跟踪文件。全量 git diff 包含此前两轮，不能全部归为本轮。

修改前证据见 [第三轮诊断](DIAGNOSIS-ROUND3-2026-09-11.md)。本轮新增核心文件 `src/review.ts`、`tests/round3-monitor.test.ts`。

## 1. 按 G1–G8 的实现

### G1：显式复核发布／拒绝及告警

入口：`src/index.ts:377`；业务：`src/review.ts:12`；存储原子保护：`src/db/repository.ts:768`、`:976`。

`POST /__cron/review-resolve` 接收 `{id, action: 'publish'|'reject', category?, reason?}`，要求 CRON_SECRET；支持 `Authorization: Bearer ...`，兼容 query secret。请求大小上限 4096 字符（Content-Length 预检），拒绝无效 ID、action、category 和 reason。响应 no-store，错误不返回异常正文或凭据。修复已有受保护 GET 在缺少 secret 时调用 formData 导致 500 的问题，现在返回 401。

发布流程：

1. 使用已有 D1 lock 对每个 source ID 串行化，锁期 120 秒，竞争请求返回 `REVIEW_BUSY`；不是新的表或迁移。
2. 只处理 REVIEW，拒绝 source REJECTED、OPERATOR_REJECTED、INDEXED、非规范来源。要求可信 canonical Tibo 直连身份和 DIRECT_VERIFIED。
3. 对尚无事件的帖子重新分类；独立 `review_classifier` 池每天最多 8 次，预算先原子预留，耗尽不调用 LLM。拒绝路径不调用 LLM，也不要求 LLM 配置。
4. 重新检查 `isCodexProductSignalAdmissible`、`product_scope === 'CODEX'`、非 OBSERVATION，以及显式 Codex 锚点或既有可信活跃 reset 上下文。category 如提供必须与证据支持的分类一致，不能用它改造事实性质或强制推断产品。
5. 经 `insertEvent(..., true)` 写入 DIRECT_VERIFIED；插入语句原子检查当前 source 仍可发布，复用 unique source_post_id 去重。不会直接向表旁路插入。
6. 调用已有生命周期处理，再关闭 trace 为 EVENT_CREATED / REVIEW_PUBLISHED。若插入后生命周期失败，保留 REVIEW；重试使用已有事件继续处理，不再花 LLM 预算或重复插入。对人工 resolve 的并发使用 per-source lock，已有生命周期处理承担顺序重试去重。

拒绝流程：原子检查 REVIEW、非 REJECTED、不存在事件，写 `classification_decision=NO_EVENT`、`classification_reason_code=OPERATOR_REJECTED`、`classification_pending=0`。`reason` 是受控枚举 `OPERATOR_REJECTED` / `NON_RESET_CONTEXT` / `INSUFFICIENT_EVIDENCE`，保存在 classification_label；不保存自由文本理由。自动重新排队、恢复分类、事件插入及延迟分类 trace 都不能覆盖该终态。

告警：`recordReviewAlert` 在 cron 完成阶段读取队列总量和最老分类时间；默认阈值 6 小时，可用 `REVIEW_ALERT_AFTER_HOURS` 调整。默认只更新 settings 的 `review_queue_alert`，不发 Telegram。`REVIEW_ALERT_PROVIDER_STATUS=true` 时写已有 provider status 通道（`review-queue`，`REVIEW_QUEUE_OVERDUE`）；空队列会清除当前告警状态。`/api/health.reviewQueue` 只读计算 count / oldestAt / overdue / thresholdHours，运维不需读数据库就能看到积压。受保护 review-queue 也返回总量与保存的 alert；列表按最早复核时间排序。

**边界：缺少 Codex 锚点或可信上下文的帖子仍返回 422；OBSERVATION 仍不能发布。** 本轮打通可审计的显式处理路径，不承诺每条 REVIEW 都一定能成为事件。原始旧 trace 没有存完整分类结果，因此发布时需要重新分类；未提供绕过分类的强制发布开关。

### G2：关闭可见、启用能运行

保留显式 opt-in，`/api/health.warnings` 顶层返回 `ingestion probe disabled`；DB 诊断失败的响应也保留警告并如实返回 probeEnabled。开启但尚未成功运行时返回 `ingestion probe has never completed`。模板注明上线必查 `X_INGESTION_PROBE_ENABLED=true`，实际部署变量未修改。

新增根因修复（`src/cron.ts:196`）：此前健康主同步每 15 分钟先拿 reservation，同 tick 后置探针永远拿不到槽。到期探针现在先使用该槽，随后主同步按相同预算门跳过，下一个 tick 继续原 cursor 摄入。正常无失败时每天 1 次探针替代 1 个摄入槽，**不增加 96/day 上限**；该次实时摄入会延后一个轮询间隔。探针失败保留既有退避，不推进 cursor、不写 source_posts；手动 force 不能越过禁用、预算和已知 429 冷却。

### G3：回填不抢实时分类

回填通过原有 upsert 设置 `first_discovered_via='backfill'`，保留 source='x_api' 和 canonical 身份。使用已有字段，不迁移。只对本次回填的新来源保留该发现标记，已有记录的 first discovery provenance 不被重写。

`getUnclassifiedPosts` 的 SQL 在 LIMIT 前先排实时、后排 backfill；选出的候选再经 `prioritizeCandidates` 分组排序，每组仍是 reset hints → keyword → ordinary。新实时入库候选继续优先。未按“没有关键词”直接删除帖子，避免长尾漏报。

分页达到上限时，只要所有失败都是 `pagination_limit_reached`，保留已抓取页面并报告 incomplete；此前异常会使这批已抓取页面完全无法入库。真实 HTTP/429 失败仍不摄入该次回填数据。回填游标始终不推进。

限制：历史已入库但没有 backfill provenance 的旧行不能可靠地重新判定来源，本轮未批量改标。持续实时流量可能延长历史积压消化时间，这是实时优先的明确取舍。分页深度仍默认 5、最高 20；大批回填应按时间/ID 下界分批操作，不能将重复同一窗口当作续页接口。

### G4：分类硬上限与实际耗时

`getClassificationBudgetPerRun` 默认 8、硬上限 8、0 关闭，负数钳制 0；不再允许每轮 50 次。八个串行 30 秒 LLM timeout 是约 240 秒网络等待的上界，不是 CPU 时间。

已有 monitor_runs.started_at / finished_at 记录实际运行时钟，调度注入的 now 不再充当真实开始时间；读取 run 时派生 `duration_ms`，不需新增列或迁移。每轮另写 settings `monitor_run_duration`（elapsedMs / thresholdMs / warning / finishedAt），并以 `monitor-runtime` provider status 报 `MONITOR_RUN_SLOW`。默认 `MONITOR_RUN_WARN_MS=240000`。这是墙钟测量，**不是 CPU profiling**；Worker 被平台直接终止时无法保证写 finished_at，该情况仍表现为未完成 run。

本地 `wrangler.jsonc` 无明确 cpu_ms，不能证明实际套餐或 Dashboard 覆盖。[Cloudflare 官方限额](https://developers.cloudflare.com/workers/platform/limits/) 区分 CPU 与网络等待：Paid 小于一小时 cron 的 CPU 限额为 30 秒，scheduled 墙钟为 15 分钟；真实生产限额和 CPU 分位数仍需只读验证。没有用 waitUntil 冒充新的 CPU 配额，没有改计划、变量或 cron。

### G5：复核语境排噪

`src/classifier/types.ts:209`：排除 bug(s)、feature(s)、PR/pull request、deploy、typo，以及 done for today/the day。补充 not/never/isn't/aren't 等否定后接 done/fixed/lifted/normal/reset/restored 的检测。

负例：Fixed a bug everyone reported；Done for today, everyone；Feature rolling out for everyone；PR done for all users；Deploy fixed for everyone；Limits aren't lifted for everyone。

正例：Limits lifted for everyone；Done. Everyone should be good now.；Usage restored for all users。

这只收紧 REVIEW 噪声检测；已有确定性强 reset 发布门仍执行原来的严格证据规则。涉及 bug 的真实随意 reset 通知可能不再进 REVIEW，需结合一周样本审查评估。

### G6：计数口径一致、边界可核对

`src/cron.ts:1154`、`src/db/repository.ts:684`：双方都使用 published_at，在同一个 **[start,end)** 窗口内比较，只统计配置的监控账号。SQL 使用 julianday 兼容 ISO/SQLite 时间格式，移除 fetched_at 回退；时间线按 account + canonical ID 去重，避免跨页重复造成虚假缺口。API created_at 优先；缺失 published_at 时不拿 fetched_at 冒充发布时间。

探针结果和 health 同时给出 timelineWindowStart/End、storedWindowStart/End。新增 `discrepancyRatio = abs(timelineCount-storedCount)/max(1,timelineCount,storedCount)`；严格大于 1% 写 `INGESTION_COUNT_DISCREPANCY` 到 settings，也暴露到 health warning；missedCount 仍是非负差值。

限制：这是计数诊断，不是逐 ID 集合对账，等量不同帖子仍可能掩盖差异；超过分页上限会失败并保留上次成功探针，不把不完整页数标为完整观测。源时间缺失/偏差也可能触发差异，不能仅凭计数断言漏报。

### G7：有界拒绝样本

`GET /__cron/rejection-samples?reason=...`，CRON_SECRET 门控。只接受已知 reason code，最近 7 天无事件的来源，最多 3 条 `{id,url}`。查询绑定参数、固定 LIMIT；URL 从合法账号和数字 canonical ID 重建，不直接输出数据库任意 URL，也不输出 raw_json、推文文本、模型理由、密钥或其他内部字段。原 rejectionBreakdownLast7d 结构兼容不变。

### G8：区分 reservation 和真实请求，429 停止

[X 官方 rate limits](https://docs.x.com/x-api/fundamentals/rate-limits/) 按 endpoint HTTP 请求及时间窗计限；内部 reservation 是本应用逻辑同步预算，不是 X 请求额度。没有假定任何具体付费套餐可承受 20 页，响应 headers 是运行时依据。

新增 backfill.httpRequestsUsed，统计所有实际 HTTP 尝试，包括用户 lookup、时间线页和失败请求；reservationsUsed 表示已预留逻辑同步次数。成功/分页截断时 pagesFetched 是成功页数；HTTP 失败响应中 pagesFetched 是已尝试时间线请求数，判读失败分支时以 errors 和 httpRequestsUsed 为准。

收到 429 立即停止当前及后续账号，不重试、不摄入该次回填、不推进游标；返回 `X_BACKFILL_RATE_LIMITED`，记录 settings/provider status，并保留 rate-limit reset headers。后续 reservation 在已知冷却窗口内 fail closed。若 remaining=0 且还有下一页，也会在下一请求前停止。每个 X fetch 增加 20 秒 AbortSignal timeout。独立请求失败照常计数，预算耗尽则 httpRequestsUsed=0、reservationsUsed=0。后续成功回填清除旧告警，分页截断则报告 incomplete。

## 2. 不变量与测试

| 项目 | 验证 |
|---|---|
| DIRECT/OFFICIAL 优于 INDEXED | 原有证据升级测试保留；人工入口拒绝 INDEXED |
| INDEXED confidence≤0.85，verified_at=null | 原 classifier/provider 回归通过，未放宽 |
| 仅权威证据触发生命周期 | 人工入口严格 DIRECT；复用既有生命周期门 |
| OBSERVATION、不明产品不公开 | 人工入口正负测试覆盖，category 无旁路 |
| REJECTED、人工拒绝终态 | 插入 SQL 原子门、恢复/重排排除、延迟 trace 防覆盖；SQLite 实跑 |
| 去重及失败重试 | UNIQUE source、per-source lock、生命周期失败重试测试 |
| cursor 只进不退 | 回填/探针无 cursor 写入测试 |
| 预算 fail closed | 0 分类、独立 review 预算、X reservation 耗尽与 429 冷却测试 |

本轮 `tests/round3-monitor.test.ts` 共 **40 项**，涵盖鉴权真实路由、健康接口、复核失败/竞争/终态、告警阈值、实时优先、噪声、窗口边界和重复 ID、HTTP 计量与探针调度。SQLite 测试执行 repository 实际 SQL，覆盖先拒绝再发布、先发布再拒绝、重复插入、延迟 trace、账号/窗口口径、SQL LIMIT 前实时优先、样本 LIMIT 3。旧测试桩为新增 provider status / rate-limit 查询补齐依赖，未放宽原断言。

| 本地 gate | 最终结果 |
|---|---|
| npm test | PASS：40 files；556 passed；1 skipped（已有 shadow test） |
| npm run typecheck | PASS |
| npm run lint | PASS |
| npm run build | PASS：Wrangler `--dry-run: exiting now`，无部署 |
| npm run migration:parity | PASS：临时本地 D1，链到 0026_classifier_resilience.sql；immutability 攻击 9/9 拒绝 |
| npm run open-gambit:demo | PASS：2 tests，虚构本地数据 |
| git diff --check | PASS |

未声称真实 X、真实 LLM、真实 Telegram 或生产环境已验证；测试使用 mock provider，SQL 检查与 migration parity 都只写本地隔离库。

## 3. 人工验证步骤（仅隔离本地环境）

先准备与生产隔离的本地 D1、dev vars 以及测试用分类 provider；不要把以下命令指向生产。新写入口在测试 suite 中已有 fixture 示例，可复用 direct/REVIEW、OBSERVATION、INDEXED 和 REJECTED 样本。

```bash
# 查看队列与健康（CRON_SECRET 在本地环境中已设置，勿打印其值）
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:8787/__cron/review-queue
curl -s http://localhost:8787/api/health | jq '{warnings,reviewQueue,ingestionGap,lastRun}'

# 合法 direct+Codex+FACT 复核样本；以本地 fixture ID 替换 1
curl -s -X POST http://localhost:8787/__cron/review-resolve \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  --data '{"id":1,"action":"publish","category":"RESET_COMPLETED"}'

# 本地无事件 REVIEW 样本 ID 2；检查 NO_EVENT / OPERATOR_REJECTED 与 reason label
curl -s -X POST http://localhost:8787/__cron/review-resolve \
  -H "Authorization: Bearer $CRON_SECRET" -H 'Content-Type: application/json' \
  --data '{"id":2,"action":"reject","reason":"NON_RESET_CONTEXT"}'

curl -s -H "Authorization: Bearer $CRON_SECRET" \
  'http://localhost:8787/__cron/rejection-samples?reason=OPERATOR_REJECTED'
```

还应验证：无鉴权 401、无 CRON_SECRET 503、坏 JSON 400、OBSERVATION/缺锚点 422、拒绝终态 409、review 预算耗尽 429；重复发布不新增事件；人为注入生命周期失败后重试可以关闭原 REVIEW。分类不可用时队列保留，拒绝仍可操作。

本地将队列 age 设置到阈值两侧，运行一次 mock cron，检查 settings 和 provider opt-in 状态；默认没有 Telegram HTTP 请求。将探针启用并运行两个相邻 mock tick，第一轮探针成功、第二轮恢复 intake，预算保持共享。用 mock timeline 的 start/end 边界、另一账号、重复 ID、429、多页上限样本验证响应和无 cursor 写入。

## 4. 授权上线前的强制清单（本轮未执行）

- 审核并提交完整本地候选（包括前两轮仍未提交的修改），先通过隔离 staging，再考虑同 SHA 发布；生产需另行明确授权。
- 必须显式配置并核验 `X_INGESTION_PROBE_ENABLED=true`，不能以仅有 probeEnabled 字段作为验收。等待一次成功探针，确认四个窗口边界、lastProbeAt 和告警；确认下一 tick 恢复摄入。
- 确认实际 Workers 套餐、CPU 限额及运行观测；本地 duration_ms 不能替代平台 CPU 指标。观察未完成 monitor_runs 和 MONITOR_RUN_SLOW。
- 明确复核负责人和巡检方式。默认仅 settings 是按任务要求的静默模式；如要主动运维状态提醒，授权配置 REVIEW_ALERT_PROVIDER_STATUS。当前实现不发 Telegram。
- 观察一周：每天记录进入 REVIEW 的数量、人工拒绝数、NON_RESET_CONTEXT 数、合法发布数、未解决 age。噪音率建议用“NON_RESET_CONTEXT 拒绝数 / 已完成复核数”，同时报告未解决数，避免只看幸存样本。检查被语境规则排除的 bug/reset 混合样本，再决定是否进一步收紧。
- **一周真实噪音观察尚未完成**：未部署、未改生产配置，也未创建后台定时任务。不能从本地正负样本推断实际一周噪音率。

## 5. 仅设计、未实现：自动 INDEXED 兜底与 P2 复核 UI

自动兜底会触及产品证据边界，默认应保持关闭。候选设计为：仅 REVIEW 且等待≥24h、可信规范账号、强 reset 短语和广泛受众、无否定/非 reset/冲突产品语境、无已有事件、非任何终态，才进入重新分析；需要日预算、幂等键和逐条审计。不因时间经过就增加置信度。

**必须先作的产品决策**：当前 REVIEW 很多本身已是 DIRECT 来源，问题是语义/产品锚点不充分。把 DIRECT 来源“降级成 INDEXED”并不能补足 Codex 证据，且会误导证据来源。推荐保留原始 DIRECT provenance，另加独立 publication/review state；不能覆盖 source_quality 或让较低证据压过直接证据。

若用户以后明确批准 INDEXED_ONLY 公开分支，也必须继续满足 product_scope=CODEX、有明确 Codex 锚点、非 OBSERVATION、非 REJECTED；缺任一条件就继续留在内部队列。公开副本 confidence≤0.85、verified_at=null，不写 reset 生命周期、不确认 quota 已恢复；UI 明确显示“待复核 / Unverified”，并定义搜索索引、列表计数和撤回规则，避免被当作已确认重置。DIRECT/OFFICIAL 后续升级仍走既有严格升级与去重流程。

实施前先做一周 shadow-only 评估、审核误报与漏报样本，明确授权具体允许发布的证据类型、标签和回滚策略。现有代码没有自动 INDEXED 发布开关或隐藏路径。

P2 内部 UI 可围绕现有鉴权 API 提供队列、原始公开来源链接、age、发布/拒绝按钮、原因枚举和错误码提示；UI 不提供绕过 OBSERVATION/Codex 门的“强制发布”。本轮完成服务端写入口，未扩展 UI。
