# Open Gambit 阶段 1.6 — Staging 验证计划（**不执行**）

**日期**：2026-09-11
**状态**：**计划文档。本次会话未执行本文件中的任何一步。** 所有标记为「需授权」的步骤都必须先获得 operator 的明确授权。
**目标**：在 N6 修复后，用一次隔离 staging 的全链路运行确认「端到端可用」，即 discovery → 准入 → Top-K → Workflow → triage → analysis → critic → 确定性发布门 → translation → publication。**不是**为了产出文章。

---

## 0. 先决条件

| 前置 | 状态 |
|---|---|
| T1 N6 只读验证完成 | ✅ 已完成（analysis 8,000：24/24 可用） |
| T2 配置修复完成 | ✅ 已完成（`wrangler.jsonc` + `wrangler.example.jsonc`） |
| T3 下游基线重跑完成 | ✅ 已完成（见阶段 1.6 报告） |
| T4 后续小任务完成 | ✅ 已完成 |
| local gates 全绿（typecheck / lint / test / build / migration:parity / demo） | 见阶段 1.6 报告 §门禁 |
| clean candidate SHA | **待定**：本分支 `codex/open-gambit-phase16` 的最终 SHA |
| staging 凭据与 Cloudflare 访问 | **需 operator 提供/确认** |

> ⚠️ **本计划的前置阻塞项**：`wrangler.jsonc` / `wrangler.staging.jsonc` 目前仍声明
> `GAMBIT_LLM_PROVIDER="opencode-go"` / `GAMBIT_LLM_MODEL="mimo-v2.5"`。阶段 1.6 的
> analysis 8,000 / critic 6,000 预算是**按 `deepseek-flash` 的 reasoning 量级测定的**。
> 在 provider/model 决策落定之前，staging 验证的结论**不能**外推到生产。见 §3.4 与 §8。

---

## 1. 需要 operator 授权的步骤（逐项）

| # | 步骤 | 需授权 | 原因（依据 AGENTS.md） |
|---|---|---|:---:|
| 1 | 在 staging D1 上 apply `0027`、`0028`、`0029` | **是** | migration 是 production mutation；即使 staging 也必须显式授权 |
| 2 | 修改 staging 变量 `GAMBIT_MODEL_ROLES_JSON`（analysis 8,000 / critic 6,000） | **是** | 修改 LLM budget |
| 3 | 修改 staging 变量 `GAMBIT_MAX_LLM_TOKENS_PER_RUN`（18,000 → 28,000） | **是** | 修改 LLM budget |
| 4 | 修改 staging 变量 `GAMBIT_MAX_TRANSLATION_LLM_*`（显式化 8 / 16,000） | **是** | 修改 LLM budget（值等于代码默认，行为中性，但仍属变量变更） |
| 5 | 修改 staging 变量 `GAMBIT_LLM_PROVIDER` / `GAMBIT_LLM_BASE_URL` / `GAMBIT_LLM_MODEL` | **是** | 修改 provider/model |
| 6 | 部署 staging Worker（`codex-monitor-staging`） | **是** | deploy |
| 7 | 手动触发一次 staging discovery（**非 cron**） | **是** | 手动触发 discovery |
| 8 | 只读查询 staging D1 | 否 | 只读 |
| 9 | 观察 staging Workflow（`gambit-analysis-staging`） | 否 | 只读 |
| 10 | 任何 production 步骤 | **是，且本计划不含** | 见 §8 |

**明确不在本计划内**：production deploy、production migration、production 变量/secret、production cron、写 production D1/R2、启动 production Workflow、发布内容。

---

## 2. 需要 apply 的 migration

仓库中三个新增 migration（**append-only**，均未编辑既有 migration）：

| migration | 内容 | 契约 |
|---|---|---|
| `0027_gambit_analysis_attempts.sql` | `gambit_candidates.analysis_attempts INTEGER NOT NULL DEFAULT 0` | analysis 消耗的**有界重试次数**（0 = 首次即决定），不是总尝试数 |
| `0028_gambit_version_noise_stats.sql` | `gambit_discovery_stats.version_noise_items` | 被 version-noise 前置过滤丢弃的条目数，使 zero-pass run 能区分「source 没有战略内容」与「过滤器丢掉了全部内容」 |
| `0029_gambit_triage_attempts.sql` | `gambit_candidates.triage_attempts INTEGER NOT NULL DEFAULT 0` | triage 消耗的有界重采样次数（语义同 0027） |

**第一步必须先只读确认 staging 当前 migration 水位**（`0027`/`0028` 可能已在阶段 1/1.5 部署过）：

```sql
SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 10;
```

只 apply 缺失的那些。`0027`/`0029` 是 `ALTER TABLE ADD COLUMN ... DEFAULT 0`，`0028` 是新增列；三者对既有行都是 additive，历史行读作「该代码路径当时无重试」，不是 0 次尝试。

---

## 3. 需要修改的 staging 变量

隔离 staging 身份（来自 `wrangler.staging.jsonc`，该文件被 `.git/info/exclude` 忽略）：

| 资源 | staging 值 |
|---|---|
| Worker | `codex-monitor-staging` |
| D1 | `codex-monitor-staging-db` |
| R2 | `codex-monitor-staging-gambit-snapshots` |
| Workflow | `gambit-analysis-staging` |
| `GAMBIT_SCHEDULE_ENABLED` | `false`（保持关闭；本次用一次性手动触发，不走 cron） |

### 3.1 `GAMBIT_MODEL_ROLES_JSON`

```json
{"triage":{"timeoutMs":30000,"tokenBudget":2400},
 "gambit_analysis":{"timeoutMs":30000,"tokenBudget":8000},
 "critic":{"timeoutMs":30000,"tokenBudget":6000},
 "translation":{"timeoutMs":60000,"tokenBudget":2000}}
```

### 3.2 `GAMBIT_MAX_LLM_TOKENS_PER_RUN`

`18000` → **`28000`**。依据：单候选最坏路径 `triage 2,400×2 + analysis 8,000×2 + critic 6,000 = 26,800`（5 calls）。旧值 18,000 会让最坏路径以 `GAMBIT_LLM_BUDGET_EXCEEDED` fail closed。

### 3.3 `GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN` / `..._TOKENS_PER_RUN`

显式写入 `8` / `16000`。值等于代码默认，改动**行为中性**，目的是让翻译配额不再依赖代码默认（阶段 1.5 §8.4 item 3）。**注意**：gitignored 的 `wrangler.jsonc` 与本 staging config 目前都**没有**声明这两个变量 —— 这正是 T4 报告中列为「待授权」的一项。

### 3.4 `GAMBIT_LLM_PROVIDER` / `GAMBIT_LLM_BASE_URL` / `GAMBIT_LLM_MODEL`

**仍然待决策**。当前 staging 值是 `opencode-go` / `https://opencode.ai/zen/go/v1` / `mimo-v2.5`。
若要用本次测定的预算做验证，必须切到 DeepSeek（`deepseek` / `https://api.deepseek.com` / `deepseek-flash`）—— 这属**修改 provider/model**，需单独授权。**在授权前不要动这三个变量**；否则 staging 会用一个未测定的 (model, budget) 组合运行，验证结果无法解释。

---

## 4. 一次性操作：手动触发 staging discovery（**非 cron**）

保持 `GAMBIT_SCHEDULE_ENABLED=false`，通过 authenticated admin endpoint 触发一次 discovery，而不是等待或改动 cron。触发前确认：

- 目标是 **staging** host，不是 `tibo.modelyard.dev`；
- `GAMBIT_ANALYSIS_WORKFLOW` 绑定指向 `gambit-analysis-staging`（不是 `gambit-analysis-production`）；
- staging 的 `GAMBIT_SOURCE_REGISTRY_JSON` 是 staging registry。

**一次就够，不要反复触发。** 重复触发会重复消耗 provider 配额，并让「零发布」的判定变得不可归因。

---

## 5. 需要观察的 D1 表与查询

按漏斗顺序。`run_id` 取本次 discovery 的 `gambit_runs.id`。

### 5.1 `gambit_runs` + `gambit_discovery_stats` — 漏斗是否打通

```sql
SELECT id, run_key, status, started_at, finished_at,
       sources_fetched, fetch_failures, candidates_found, duplicates,
       political_rejects, no_gambit_rejects, qualified_gambits,
       workflow_starts, workflow_failures, error_message
FROM gambit_runs ORDER BY id DESC LIMIT 3;
```

```sql
SELECT run_id, sources_attempted, sources_succeeded, sources_failed,
       raw_items_observed, stale_items, malformed_items, admitted_items,
       exact_duplicates, routine_noise_rejects, strategic_eligible,
       event_duplicates, global_pool_size, global_top_k_selected,
       workflow_dispatches, workflow_failures, partial_source_failure,
       version_noise_items
FROM gambit_discovery_stats ORDER BY run_id DESC LIMIT 3;
```

**关键断言**：`strategic_eligible > 0`、`workflow_dispatches >= 1`、`global_top_k_selected <= GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN (3)`。

### 5.2 `gambit_candidates` — triage / analysis 重试是否被写入

```sql
SELECT id, substr(headline,1,60) AS headline, status, rejection_reason,
       strategic_value, evidence_sufficient, political_topic,
       triage_attempts, analysis_attempts, discovered_at, updated_at
FROM gambit_candidates
WHERE discovered_at >= (SELECT started_at FROM gambit_runs ORDER BY id DESC LIMIT 1)
ORDER BY id DESC;
```

**关键断言**：本次 run 的候选行上 `triage_attempts` / `analysis_attempts` 列**存在**（证明 migration 已 apply），并且取值 ∈ {0,1}。非 0 值证明有界重采样在**真实调度路径**中真的发生了 —— 这一点本地探针无法证明，因为探针不传 `dependencies.repository`、不写 D1。

### 5.3 `gambit_workflow_instances` — Workflow 是否真的被启动与落库

```sql
SELECT workflow_id, candidate_id, status, article_id, revision_id,
       last_error, created_at, updated_at
FROM gambit_workflow_instances ORDER BY created_at DESC LIMIT 10;
```

**关键断言**：`status` 落在 `COMPLETED` / `WAITING_FOR_REVIEW` / `NEEDS_HUMAN_REVIEW` / `NO_GAMBIT` / `FAILED`；`workflow_id` 与 candidate 一一对应（idempotency）。

### 5.4 `gambit_llm_attempts` — 各角色是否真正执行，错误码是什么

```sql
SELECT stage, role, provider, model_id, display_name, prompt_version,
       status, error_code, input_tokens, output_tokens, latency_ms, created_at
FROM gambit_llm_attempts
WHERE created_at >= (SELECT started_at FROM gambit_runs ORDER BY id DESC LIMIT 1)
ORDER BY id;
```

```sql
SELECT stage, role, status, error_code, COUNT(*) AS n,
       ROUND(AVG(latency_ms)) AS avg_latency_ms, MAX(latency_ms) AS max_latency_ms
FROM gambit_llm_attempts
WHERE created_at >= (SELECT started_at FROM gambit_runs ORDER BY id DESC LIMIT 1)
GROUP BY stage, role, status, error_code ORDER BY stage, role;
```

**关键断言与判读**：

| 观察 | 含义 |
|---|---|
| `ANALYSIS` 有 `status='SUCCESS'` 行 | N6 在真实路径中被修复 |
| `error_code='PROVIDER_EMPTY_RESPONSE'` 出现在 `CRITIC` | 已知残余（阶段 1.6 实测 critic 约 1/3 截断）；**不是回归** |
| `error_code='PROVIDER_TIMEOUT'` 出现在 `ANALYSIS`/`CRITIC` | **第二个上限**（30,000 ms deadline）被撞到，需代码变更 |
| `provider`/`model_id` 与预期不一致 | provider/model 配置与测定配置不匹配，本次验证结论作废 |
| `TRIAGE` 行数 > 候选数 | 有界 triage 重采样发生（每候选最多 2 次） |

**绝不记录**：prompt 文本、response body、chain-of-thought、凭据。`gambit_llm_attempts` 只存 role/provider/model/prompt_version/request_hash/status/usage/latency/bounded error code —— 该表已是这个契约，查询时不得扩展到别的列。

### 5.5 `gambit_articles` — 是否（以及是否应当）发布

```sql
SELECT id, candidate_id, slug, status, published_at, created_at, updated_at
FROM gambit_articles ORDER BY id DESC LIMIT 10;
```

```sql
SELECT COUNT(*) AS published FROM gambit_articles WHERE status = 'PUBLISHED';
```

**「零发布」是健康结果**（`AGENTS.md`）。`published = 0` 且候选都停在 `NO_GAMBIT` / `NEEDS_HUMAN_REVIEW` / `FAILED` 时，结论是 **HEALTHY_WITH_NO_PUBLICATION**，**不是**失败。验收标准是「下游能跑通并被观测」，不是「页面有内容」。

---

## 6. Acceptance criteria

| # | 判据 | 判定 |
|---|---|---|
| A1 | `gambit_runs.status = 'COMPLETED'` | 必须 |
| A2 | `strategic_eligible > 0` | 必须（阶段 0 连续三天为 0，T6 已修复准入） |
| A3 | `workflow_dispatches >= 1` 且 `gambit_workflow_instances` 有对应行 | 必须 |
| A4 | 本次 run 的候选行上 `triage_attempts` / `analysis_attempts` 列存在且 ∈ {0,1} | 必须（证明 0027/0029 已 apply 且写入路径通） |
| A5 | `gambit_llm_attempts` 中出现 `stage='ANALYSIS' AND status='SUCCESS'` | 必须（N6 修复在真实路径成立） |
| A6 | `stage='CRITIC'` 至少出现一行（无论 SUCCESS 或 ERROR） | 必须（证明 analysis 之后管线继续） |
| A7 | `error_code NOT IN ('PROVIDER_BUDGET_EXCEEDED')` | 必须（证明 28,000 上限够） |
| A8 | `gambit_articles.status='PUBLISHED'` 的行数 | **不作判据**。0 或 >0 都可接受，取决于语料。 |
| A9 | 无 `TEST_ONLY` 内容进入 staging 公开路由 | 必须 |
| A10 | 公开 `/zh/open-gambit/` 仍渲染编辑型空状态或真实文章，不出现内部 funnel 数字 | 必须 |

**任何 A1–A7、A9、A10 失败都必须报告，不得臆造成功。**

---

## 7. 可回滚性

- staging 的 Worker / D1 / R2 / Workflow 与 production **完全隔离**（不同 Worker 名、不同 D1、不同 bucket、不同 Workflow 名）。
- `0027`/`0028`/`0029` 都是 additive；staging D1 可整体丢弃并从零重建。
- `GAMBIT_SCHEDULE_ENABLED=false` 意味着不存在自动重跑；本次是一次性手动触发。
- 本次 staging 不写入任何 production 资源，因此回滚**不涉及** production。
- 若 A5 失败（analysis 在真实路径仍不可用），下一步不是放宽发布门，而是回到 T1 式的只读探针定位，并考虑代码变更（见 §8）。

---

## 8. 未决项与下一步

| 项 | 状态 |
|---|---|
| provider/model 切换（`opencode-go`/`mimo-v2.5` → `deepseek`/`deepseek-flash`） | **待授权**。未授权前 staging 验证无法得到可解释的结论 |
| `GAMBIT_MAX_TRANSLATION_LLM_*` 在 `wrangler.jsonc` / staging config 中显式声明 | **待授权**（行为中性） |
| 有界 **critic 操作失败重采样**（残余约 1/3 截断） | **需代码变更**。与既有 triage/analysis 有界重采样同构，遵守「重试只能升级、不能降级」 |
| 非 translation 角色的 `timeoutMs` clamp（30,000 ms）是否提高 | **需代码变更**。critic 在 6,000 tokens 下实测成功调用 29.4 s，analysis 在 8,000 下最长 27.1 s |
| 阶段 2（源结构再平衡） | **不建议**在 A5/A6 于 staging 成立之前开始。理由：源扩容只会让更多候选死在尚未证实的下游阶段 |
| production 受控运行 | **本计划不含**。必须等 staging acceptance 通过、且同一 SHA 的 production 部署获授权之后 |
