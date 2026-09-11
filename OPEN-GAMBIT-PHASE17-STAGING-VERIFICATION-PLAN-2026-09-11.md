# Open Gambit 阶段 1.7 — Staging 验证计划（**不执行**）

**日期**：2026-09-11
**状态**：**计划文档。本次会话未执行本文件中的任何一步。** 所有标记为「需授权」的步骤都必须先获得 operator 的明确授权。
**取代**：`OPEN-GAMBIT-PHASE16-STAGING-VERIFICATION-PLAN-2026-09-11.md`（已执行前的计划版本；本文件在其基础上加入 N7 修复的 migration、预算与验收标准）
**目标**：在 N7 修复后，用一次隔离 staging 的全链路运行确认「端到端可用」，即 discovery → 准入 → Top-K → Workflow → triage → analysis → critic → 确定性发布门 → translation → publication。**不是**为了产出文章。

> **零发布是健康结果**（`AGENTS.md`）。本计划的验收标准**不包含**「必须有一篇文章发布」。如果 staging 跑完全链路后没有 `AUTO_PUBLISH_ELIGIBLE`，只要失败原因是可解释的（triage 正确淘汰 routine、critic 判断性拒绝、或残余 token 墙），那就是**通过**。

---

## 0. 先决条件

| 前置 | 状态 |
|---|---|
| T1 N7 只读诊断完成 | ✅ 已完成（`OPEN-GAMBIT-PHASE17-T1-N7-DIAGNOSIS-2026-09-11.md`） |
| T2 N7 修复完成（代码 + migration `0030`） | ✅ 已完成（commit `721fe91`） |
| T3 下游基线重跑完成 | ✅ 已完成（`OPEN-GAMBIT-PHASE17-T3-BASELINE-2026-09-11.md`） |
| T4 provider/model 决策落定 | ✅ 已完成（`deepseek` / `https://api.deepseek.com` / `deepseek-flash`，用户授权） |
| T4 显式声明 `GAMBIT_MAX_TRANSLATION_LLM_*` | ✅ 已完成（生产 + 两个模板） |
| **local gates 全绿** | 见阶段 1.7 报告 §门禁 |
| **clean candidate SHA** | **待定**：本阶段最后一次 commit 的 SHA；见 §6 |
| **staging 凭据与 Cloudflare 访问** | **需 operator 提供/确认** |

> ✅ **阶段 1.6 的部署前阻塞项已解除**：`wrangler.jsonc` 的
> `GAMBIT_LLM_PROVIDER` / `GAMBIT_LLM_BASE_URL` / `GAMBIT_LLM_MODEL` 已从
> `opencode-go` / `mimo-v2.5` 切换到 `deepseek` / `https://api.deepseek.com` /
> `deepseek-flash`。因此 staging 与 production 现在运行在**同一个已测定的
> (model, budget) 组合**上，staging 的结论可以外推到生产。

---

## 1. 需要 operator 授权的步骤（逐项）

| # | 步骤 | 需授权 | 原因（依据 `AGENTS.md`） |
|---|---|---|:---:|
| 1 | 只读查询 staging `d1_migrations` 水位 | 否 | 只读 |
| 2 | 在 staging D1 上 apply 缺失的 migration（预期 `0027`–`0030`） | **是** | migration 是 mutation；即使 staging 也需显式授权 |
| 3 | 修改 staging 变量 `GAMBIT_MODEL_ROLES_JSON`（analysis 8,000 / critic 6,000） | **是** | 修改 LLM budget |
| 4 | 修改 staging 变量 `GAMBIT_MAX_LLM_TOKENS_PER_RUN`（18,000 → **33,000**） | **是** | 修改 LLM budget |
| 5 | 修改 staging 变量 `GAMBIT_MAX_TRANSLATION_LLM_*`（显式化 8 / 16,000） | **是** | 修改 LLM budget（值等于代码默认，行为中性，但仍属变量变更） |
| 6 | 修改 staging 变量 `GAMBIT_LLM_PROVIDER` / `GAMBIT_LLM_BASE_URL` / `GAMBIT_LLM_MODEL` | **是** | 修改 provider/model |
| 7 | 部署 staging Worker（`codex-monitor-staging`） | **是** | deploy |
| 8 | 手动触发**一次** staging discovery（**非 cron**） | **是** | 手动触发 discovery |
| 9 | 只读查询 staging D1 | 否 | 只读 |
| 10 | 观察 staging Workflow（`gambit-analysis-staging`） | 否 | 只读 |
| 11 | 任何 production 步骤 | **是，且本计划不含** | 见 §7 |

**明确不在本计划内**：production deploy、production migration、production 变量/secret、production cron、写 production D1/R2、启动 production Workflow、发布内容、把 runtime ID 当作 public identity。

---

## 2. 需要 apply 的 migration

阶段 1.7 结束时的迁移链末端是 **`0030_gambit_critic_attempts.sql`**。stage 1.6 的计划已列出 `0027`/`0028`/`0029`；本阶段新增：

| migration | 内容 | 契约 |
|---|---|---|
| `0030_gambit_critic_attempts.sql` | `gambit_candidates.critic_attempts INTEGER NOT NULL DEFAULT 0` | critic 消耗的 bounded **操作性**重采样次数（0 = 第一次尝试就已裁决，无论通过、拒绝还是成功）。**不是**总尝试数 |

**第一步必须先只读确认 staging 当前水位**，只 apply 缺失的那些：

```sql
SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 10;
SELECT COUNT(*) FROM pragma_table_info('gambit_candidates') WHERE name IN ('analysis_attempts','triage_attempts','critic_attempts');
```

`0027`/`0029`/`0030` 都是 `ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT 0`，`0028` 是新增列。四者对既有行都是 additive，历史行读作「该代码路径当时无重试」，**不是**「0 次尝试」。

> 注意：production 在 2026-09-09 的只读查询显示水位停在 `0025`。staging 的水位**未经本次会话确认**，必须按上面的只读查询实测，不得假设。

---

## 3. 需要修改的 staging 变量

隔离 staging 身份（`wrangler.staging.jsonc` 被 `.git/info/exclude` 忽略；模板 `wrangler.staging.example.jsonc` 已在 T4 更新）：

```text
Worker    codex-monitor-staging
D1        codex-monitor-staging-db
R2        <staging gambit snapshots>
Workflow  gambit-analysis-staging
cron      []（无自动 cron）
```

需要与 production 对齐的变量：

| 变量 | staging 现值 | 目标值 | 备注 |
|---|---|---|---|
| `GAMBIT_MODEL_ROLES_JSON` | analysis 4,000 / critic 3,000 | analysis **8,000** / critic **6,000** | N6/N7 修复的预算 |
| `GAMBIT_MAX_LLM_CALLS_PER_RUN` | 8 | **8** | 覆盖 6 次调用（最坏路径），余量 2 |
| `GAMBIT_MAX_LLM_TOKENS_PER_RUN` | 18,000 | **33,000** | 必须覆盖 32,800 的最坏路径 |
| `GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN` | 未声明 | **8** | 显式声明 |
| `GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN` | 未声明 | **16,000** | 显式声明 |
| `GAMBIT_LLM_PROVIDER` | `opencode-go` | **`deepseek`** | 与 production 一致 |
| `GAMBIT_LLM_BASE_URL` | `https://opencode.ai/zen/go/v1` | **`https://api.deepseek.com`** | 与 production 一致 |
| `GAMBIT_LLM_MODEL` | `mimo-v2.5` | **`deepseek-flash`** | 与 production 一致 |
| `GAMBIT_SCHEDULE_ENABLED` | `false` | **`false`（保持不变）** | staging 不得自动跑 |
| `GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN` | — | **3** | 若未声明需补 |

**Secret**：staging 需要自己的 `GAMBIT_LLM_API_KEY`。不得复用 production secret，也不得把任何 secret 值写入报告、命令或 commit。

---

## 4. 执行序列（全部需授权）

```text
1. 只读：确认 staging migration 水位与当前变量                     [无需授权]
2. apply 缺失的 staging migration（0027–0030）                    [需授权]
3. 修改 staging 变量（§3 表）                                     [需授权]
4. deploy staging Worker（目标 SHA = §6 的 clean candidate SHA）   [需授权]
5. 手动触发一次 staging discovery（非 cron）                       [需授权]
6. 只读观察该次 run 的全链路                                        [无需授权]
7. 只读查询 staging D1 的漏斗与 attempt 计数                        [无需授权]
8. 对照 §5 验收标准并记录结论                                       [无需授权]
```

**触发后发现全链路未走完时**：不要反复触发（`AGENTS.md` 禁止「为了看到结果反复运行 pipeline」）。先只读定位在哪一阶段停止，记录原因，再决定是否需要一次（且仅一次）新的触发。

---

## 5. 验收标准

### 5.1 必须通过（fail 则 staging 不接受）

| # | 标准 | 判据 |
|---|---|---|
| A1 | staging 变量与 production **逐字一致**（§3 表） | 只读 dump 后逐项比对 |
| A2 | migration 水位达到 `0030`，三个 retry counter 列都存在 | §2 的只读查询 |
| A3 | `/api/health` 报告目标 SHA 且 `status: ok`、`dbConnected: true` | 只读 |
| A4 | 该 run 中**没有任何** `GAMBIT_LLM_BUDGET_EXCEEDED` | `gambit_llm_attempts` 只读查询 |
| A5 | 该 run 中**没有** `POLICY_STATE_INCONSISTENT` | 同上 |
| A6 | 未产生任何 `TEST_ONLY` 内容 | 公开路由 + D1 只读查询 |
| A7 | staging 未写 production 资源 | 确认 binding 指向 staging |
| A8 | 无自动 cron 被启用 | `GAMBIT_SCHEDULE_ENABLED=false`、`triggers.crons` 为空 |

### 5.2 观察项（记录，不判 fail）

| # | 观察 | 期望 |
|---|---|---|
| B1 | discovery 漏斗：`strategic_eligible`、`workflow_dispatches`、`version_noise_items` | 记录实际值 |
| B2 | 每候选的 `triage_attempts` / `analysis_attempts` / `critic_attempts` | 记录；三者应各自 ≤ 1 |
| B3 | critic 操作性失败率 | 单次 ≤ ~35%（= 已测范围）；**每 run 残余失败率应 ≤ ~10%** |
| B4 | critic 失败类型 | 应为 **token 墙**（`finish_reason=length` @ 6,000）。**若观察到大量 `timeout`，那是新根因，必须报告而不是继续** |
| B5 | 每个 role 的 latency | critic 成功调用应 < 30,000 ms；若逼近则说明 clamp 重新成为瓶颈 |
| B6 | 有没有 `AUTO_PUBLISH_ELIGIBLE` → translation → publication 走通 | **有则好，没有也是健康结果**（零发布） |

### 5.3 明令禁止的「为了通过而通过」

- ❌ 放宽 `deterministicPublicationGate`
- ❌ 改动 `0.45` 阈值
- ❌ 启用 `allowCanonicalFallback`
- ❌ 制造 `TEST_ONLY` 生产内容填页
- ❌ 因为「页面还是空的」而降低任何门

---

## 6. clean candidate SHA 与本地门禁

staging 部署必须使用**通过全部本地门禁的单一 SHA**。执行前须记录：

```bash
git rev-parse HEAD                 # clean candidate SHA
git status --porcelain             # 必须为空（或仅有已知的 gitignored 文件）
npm run typecheck
npm run lint
npm test
npm run build
npm run migration:parity
npm run open-gambit:demo
git diff --check
```

**必须明确**：本地测试 PASS ≠ production deployed；staging PASS ≠ production deployed。只有真实 production Worker 已更新且 live site 已验证，才能声称 `production deployment complete`。

---

## 7. staging 之后到 production 的路径（**不在本计划内，仅列出**）

1. staging 按 §5 验收通过。
2. 用**完全相同的 SHA** 对 production 执行：
   - production migration（预期 `0026`–`0030`，取决于实测水位）；
   - production 变量变更（§3 表，已在 `wrangler.jsonc` 中就绪，但**尚未 deploy**）；
   - production deploy。
3. 只读 live 验证：`/api/health`、`/`、各 locale homepage、`/zh/open-gambit/` 及其 locale 路由、Community、`/latest/`、`/about/ai/`。
4. 检查 status、brand、shell parity、无 `TEST_ONLY` 泄漏、正确的 empty/editorial state。

每一步都需要独立授权。

---

## 8. 本计划**没有**覆盖的事项（诚实标注）

| 项 | 状态 |
|---|---|
| production deploy / migration / 变量变更 | **未执行，且未授权** |
| staging deploy / migration / 变量变更 | **未执行**（本文件是计划） |
| staging 凭据与 Cloudflare 访问 | **未确认**（需 operator） |
| clean candidate SHA | **待定**（取决于本阶段最终 commit） |
| staging migration 水位 | **未确认**（需 §2 的只读查询） |
| 「critic 8,000 + 提高 deadline 是否会成功」 | **未测量**。T1 只做了基于 latencies 的外推（~35–38 s）。若 staging 的 B4 观察到大量 `timeout`，应重新评估这个未测问题，而不是继续 |
