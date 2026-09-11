# 第三轮诊断（修改前）

2026-09-11；本地 codex/open-gambit-v1-staging-candidate。前两轮代码存在于未提交工作区，并非全部已提交；保留所有已有修改。已核对四份指定报告；历史报告的小时 cron、预算与当前实现冲突时以代码为准。

| 问题 | 修改前位置与证据 | 结论与修复方向 |
|---|---|---|
| G1 | src/index.ts:329 `app.get('/__cron/review-queue'`；src/cron.ts:695 `classification_decision: 'REVIEW'` | 成立，无写入口或积压告警。新增鉴权显式 adjudication，重新分类和严格准入、原子竞争保护、生命周期重试；默认 settings 告警，可选 provider status。没有 Codex 锚点仍拒绝发布。 |
| G2 | src/cron.ts:1013 `=== 'true'`；src/routes/api.ts:605 `probeEnabled` | 成立。保留成本 opt-in，增加顶层 warning 和强制上线清单。 |
| G3 | src/cron.ts:977 persist batches；src/db/repository.ts:566 `ORDER BY COALESCE(last_classification_attempt_at, published_at, fetched_at) ASC` | 成立。标记 first_discovered_via=backfill；SQL 实时优先，组内保持 reset hint 优先。 |
| G4 | src/cron.ts:80 默认10，:84 `Math.min(50, ...)`；monitor_runs 已有 started_at/finished_at | 风险成立但300s是网络等待墙钟，不是CPU。wrangler.jsonc 未声明 cpu_ms，不能证明账户计划。硬上限8、默认8、0关闭；实际耗时从已有时间字段计算，不需迁移；超时告警。 |
| G5 | src/classifier/types.ts:191 包含 done/fixed；:202 只排部分否定与非Codex | 成立，排除 bug/feature/PR/deploy 和 done for today 等语境，正负回归。 |
| G6 | src/cron.ts:1143 `published >= windowStartMs`；src/db/repository.ts:674 只使用下界，now未使用 | 比描述更严重：无上界、无账号范围，存储还以 fetched_at 回退。统一 [start,end) 和账号集合、只用 published_at；公开双方边界和差异比例告警。API created_at 优先，不是 Snowflake 优先。 |
| G7 | src/db/repository.ts:695 `COUNT(*)` | 成立，新增鉴权原因样本端点，最多3条id/规范URL。 |
| G8 | src/providers/x-api.ts:117 logical sync reservation；:302 每页HTTP；src/cron.ts:970 await fetchIncremental | 成立，记录所有HTTP尝试（含lookup/失败），429立即停止、不写回填来源并告警。 |

## 新根因

1. 分页上限被当成 XApiPartialFailureError，回填入口不捕获，已成功抓取页也无法入库。仅分页截断允许有界部分摄入；真正HTTP失败仍fail closed。
2. 人工拒绝若仅写NO_EVENT，会被 deterministic recovery 再处理。操作员拒绝写独立受控原因码并从恢复/升级重排中排除。
3. get queue 的缺失 secret 分支调用 GET formData，可能产生500而非401。新增共用安全凭据读取（Authorization头优先）。
4. 进一步核实：isCodexProductSignalAdmissible 的集合已包含所有公开类别，IRRELEVANT 在调用处排除，不存在公开类别旁路。人工入口另外显式检查CODEX。
5. 新发现：健康15分钟主同步占用每个 reservation slot，位于其后的探针永远抢不到槽。启用时将到期探针提前到主同步前，共享同一预算，主同步下一tick按原cursor追上；不新增cron、不提高预算。

## 外部依据（仅公开文档，无生产请求）

[Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/)：fetch等待不算CPU；Paid小于1小时cron CPU 30秒、墙钟15分钟；本地不能确认实际套餐。waitUntil不是重置CPU预算的分片手段。
[X rate limits](https://docs.x.com/x-api/fundamentals/rate-limits)：按endpoint HTTP请求计限，429必须等待reset；内部reservation不是X请求限额。

按 G1→G8 实施，禁止任何生产修改。自动INDEXED兜底仅出设计，不实现。
