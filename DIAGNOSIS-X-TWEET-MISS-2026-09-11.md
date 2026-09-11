# Diagnosis — Tibo Codex Monitor X 推文遗漏（漏报）

Date: 2026-09-11
Scope: read-only diagnosis of `codex-monitor` (branch `codex/open-gambit-v1-staging-candidate`).
Production mutation during diagnosis: **NO**.

本节逐条核验任务书中列出的 6 个根因，附文件、行号与代码片段。另列出诊断中发现的其他根因。修复见后续实现报告。

---

## 根因 1：X API 直连使用 `exclude=retweets,replies` — ✅ 成立

`src/providers/x-api.ts:276`：

```ts
url.searchParams.set('exclude', 'retweets,replies');
```

- X API v2 `/users/{id}/tweets` 默认包含回复（含他人推文的回复与自线程后续）。`exclude=replies` 在摄入层直接砍掉了所有回复/线程第 2、3 条。
- `tests/provider.test.ts:71` 把该行为锁定为不变量：

```ts
expect(url.searchParams.get('exclude')).toBe('retweets,replies');
```

- 影响：Tibo 的“重置了”如果是回复（reply to someone）或线程后续（thread continuation），永远不会进入 `source_posts`，后续分类/发布更无从谈起。这是系统性漏报的首要摄入层根因。

## 根因 2：搜索仅在直连不可用/过期时作为回退触发 — ⚠️ 部分成立（有补充）

`src/cron.ts:266-282`：

```ts
const normalDecision = shouldRunWebSearch(now, searchMode, searchLastAttemptAt, searchUsage, env);
const directNeedsFallback = xApiAutomaticSync && (
  xSyncFailedThisRun
  || isXApiSyncOverdue(now, xLastSuccessAt, env, xUsage)
);
...
const shouldSearch = normalDecision.allowed || fallbackAllowed;
```

- 事实上 **常规节奏的搜索在 NORMAL 模式每 4 小时、活跃模式每 1 小时照常执行**（`normalDecision.allowed`），并不依赖 X 是否 stale。
- 但问题在于：
  1. **NORMAL 模式间隔 4 小时**（`src/utils/search-schedule.ts:88`：`mode === 'NORMAL' ? getNormalSearchIntervalHours(env) : 1`），且 web 索引对 X 新帖有滞后，错过窗口很大。
  2. **回退（fallback）仅在 `xSyncFailedThisRun || isXApiSyncOverdue(...)` 时允许** — 直连“健康但漏抓”不会触发回退；恰好漏抓的正是根因 1 中被 exclude 掉的回复。
  3. 搜索命中是 `INDEXED` 证据，即使发现帖子，置信度被钳制 ≤0.85 且 `verified_at=null`（`src/classifier/llm.ts:245-247`、`src/providers/search-provider.ts:250-256`），在无后续直连验证时只能作为次等证据。
- 结论：直连健康时**没有**一条“回复补充搜索”通道；该根因成立，且与根因 1 叠加。

## 根因 3：Web 搜索每日预算 6 次，活跃模式 1 小时一次 — ✅ 成立

`src/utils/search-schedule.ts:7-14`：

```ts
export const DEFAULT_NORMAL_SEARCH_INTERVAL_HOURS = 4;
export const DEFAULT_WEB_SEARCH_DAILY_LIMIT = 6;
...
export const APPROXIMATE_RESET_MAX_AGE_HOURS = 48;
```

`src/utils/search-schedule.ts:84-89`：

```ts
export function getWebSearchIntervalHours(mode, env): number {
  return mode === 'NORMAL' ? getNormalSearchIntervalHours(env) : 1;
}
```

- `wrangler.jsonc:88`、`wrangler.example.jsonc:58`：`"MAX_WEB_SEARCH_REQUESTS_PER_DAY": "6"`。
- 活跃模式（WATCHING/CONFIRMING）1 小时 1 次 × 每日 6 次 ⇒ 跑 6 小时就耗尽；`tests/adaptive-search.test.ts:120-135` 锁定“全天重置模拟 = 6 次、23:00 后 daily_budget_exhausted”。
- 结论：成立。活跃模式恰好是漏报最在意的时段，预算却在最需要时最先耗尽。

## 根因 4：分类/发布门槛卡掉短推文 — ⚠️ 部分成立（需分层）

拆成三块：

### 4a. `OBSERVATION` 永不生成事件 — ✅ 成立（设计使然，非缺陷）

`src/classifier/types.ts:116-122`：

```ts
export function isCodexProductSignalAdmissible(result): boolean {
  if (result.statement_nature === 'OBSERVATION') return false;
  return !CODEX_SCOPE_GATED_CATEGORIES.has(result.category) || result.product_scope === 'CODEX';
}
```

`src/cron.ts:712-713`（trace 原因码）：`'OBSERVATION_NOT_ADMITTED'`。
LLM 提示词 `src/classifier/llm.ts:115` 也明确 “Do not use OBSERVATION for CODEX_UPDATE or RESET_COMPLETED; those categories require FACT”。
AGENTS.md 不变量：“Descriptive observations are never public events merely because they mention Codex.”
结论：这是**有意的防伪门**，不是 bug；不应放宽。真正的风险是 LLM 把“重置已完成”误标成 OBSERVATION——已有确定性规则覆盖（见 4c）。

### 4b. 摘要长度门槛 — ✅ 仅影响 SEO 索引，不影响站点显示

`src/utils/index-policy.ts:26-34`：

```ts
return hasText(event.title_en, 10)
  && hasText(event.title_zh, 2)
  && hasText(event.summary_en, 80)
  && hasText(event.summary_zh, 20);
```

- 已核验：`isEventIndexEligible` 只用于 robots/sitemap（`src/renderer.ts:1855,1873,2639,3080,3130`），**不**用于 `/latest/`、事件页等公开数据查询（公开页走 `repo.getEvents`，见 `src/index.ts:111,448,514`、`src/routes/api.ts:283`）。
- 结论：摘要长度不会导致“网站没显示”；但确定性模板摘要天然超长，短推文走模板即可过此门（P1-3 落实）。

### 4c. Codex 锚点要求 — ✅ 成立（可卡掉无 codex 字样的短推文）

`src/cron.ts:578-582`：

```ts
const hasCodexAnchor = hasExplicitCodexReference(post.text) || contextualClassification.applied;
if (!result.relevant
  || result.category === 'IRRELEVANT'
  || !isCodexProductSignalAdmissible(result)
  || (result.product_scope === 'CODEX' && !hasCodexAnchor)) { ... 拒绝 ... }
```

- 短推文 “All reset for everyone.”（无 codex 字样）只有在 `applyTrustedResetContext` 命中（`TRUSTED_CODEX_SOURCE_APPLIED`）且存在可信活跃重置周期（`hasCredibleActiveResetContext`，`src/classifier/types.ts:207-212`）时才能放行。
- 现有确定性完成规则 `isCompletedResetHint`（`src/classifier/types.ts:439-458`）要求显式出现 “codex” 一词，且是 “feeling reseted / brand new usage / usage have been reset” 等既定措辞。
- 结论：对“无活跃周期 + 无 codex 字样”的短推文，当前规则确实拒收（`MISSING_PRODUCT_CONTEXT`）。符合 AGENTS.md 的“不得仅凭作者推断 Codex”不变量，但对 `resets applied` / `quota reset complete` / `usage limits restored` 这类措辞缺少确定性覆盖 → P1-3 在既有约束内扩展短语库。

## 根因 5：分类每轮上限 5 条 — ✅ 成立

`src/cron.ts:68`：

```ts
const MAX_CLASSIFICATIONS_PER_RUN = 5;
```

- 新候选 + 待重试 + D1 恢复三条队列共用每轮 5 次预算（`src/cron.ts:368-414`）。
- 15 分钟一轮；大量积压时 5 条/轮会拖慢在途“重置了”帖子的处置（虽然 `classification_pending=1` 保留后续轮次，但延迟放大漏报窗口）。

## 根因 6：`since_id` 推进导致历史回复无法回填 — ✅ 成立

`src/providers/x-api.ts:166-167,277`：

```ts
const accountSinceId = options.sinceId ?? (storedSinceId || undefined);
...
if (sinceId) url.searchParams.set('since_id', sinceId);
```

- 游标推进：`src/cron.ts:778` → `advanceXApiCursor`（`src/db/repository.ts:1199-1214`，只前进不后退）。
- 根因 1 时期被 exclude 掉的历史回复，永远在游标之后，现有代码无任何回填通道（`getDirectPostsWithoutEvents` 是 D1-only 恢复队列，明确“never refetches from X”，`src/db/repository.ts:572-576`）。
- 结论：成立，需要一次性回填。

---

## 其他发现的根因 / 观察

- **O7-a**：`tests/adaptive-search.test.ts` 将 6 次/日预算与活跃模式 6 次上限锁定为不变量；P1-1 调整预算必须同步更新这些测试。
- **O7-b**：搜索预算登记 `reserveProviderUsage` 的槽位含 query（`src/providers/search-provider.ts:298`），同一轮内不同 query 可各自登记；补充搜索必须服从同一每日预算、fail closed。
- **O7-c**：`getUnclassifiedPosts(20)`（`src/cron.ts:379`）与 `getDirectPostsWithoutEvents(50)`（`src/cron.ts:399`）上限偏低，叠加上限 5 条/轮时积压明显。
- **O7-d**：`INDEXED` 置信度钳制与 `verified_at=null`（`src/classifier/llm.ts:245-247`）是**现有不变量**，本次修复不得破坏；直接 X 数据仍应优先。
- **O7-e**：`REJECTED` 终态（`src/db/repository.ts:316-320`）与事件去重（`monitor_events UNIQUE(source_post_id)`, `src/db/repository.ts:775` 附近）是现有保护；回填必须走 `upsertSourcePost` 去重/升级路径，不得绕过。

## 结论

| # | 根因 | 判定 | 修复 |
|---|------|------|------|
| 1 | `exclude=replies` | ✅ 成立 | P0-1 改为 `exclude=retweets`，噪音下沉到分类层 |
| 2 | 搜索仅回退触发 | ⚠️ 部分成立 | P0-2 直连健康时也允许补充搜索（独立间隔、同一预算） |
| 3 | 每日 6 次预算 | ✅ 成立 | P1-1 活跃模式预算默认提升到 24（可配） |
| 4 | OBSERVATION / 摘要长度 / Codex 锚点 | ⚠️ 分层 | P1-3 扩展确定性完成短语（仍守不变量）；OBSERVATION 与摘要门槛不动 |
| 5 | 每轮分类上限 5 | ✅ 成立 | P1-2 默认提至 10（可配）+ reset 关键词/确定性 hint 优先 |
| 6 | since_id 不回填 | ✅ 成立 | P0-3 一次性回填通道（不推进游标、走 upsert 去重） |
| — | 无漏报监控 | — | P1-4 健康面新增直接帖未入事件计数 |