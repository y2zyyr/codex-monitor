# Open Gambit 阶段 1.7 — 生产部署报告

**日期**：2026-09-12
**状态**：**生产已部署，live 只读验证通过，首日观察已完成（`30 2 * * *` 首次自动 run 已跑完）。**
**执行授权**：人类已明确授权——轮换生产 `GAMBIT_LLM_API_KEY`、apply 生产 migration `0027`–`0030`、更新 `wrangler.jsonc` provenance、`wrangler deploy` 生产 Worker、只读 live 验证、首日观察。

---

## 1. 执行摘要

| # | 步骤 | 结果 |
|---|---|---|
| 0 | 预检与回滚锚点 | ✅ 目标 SHA `7bd7754140ae9a43ff981138a7dbe6ad7e4f81be`；工作区干净 |
| 1 | 轮换生产 `GAMBIT_LLM_API_KEY` | ✅ **SUCCESS**（值未读取/未打印/未落盘） |
| 2 | 生产 D1 migration `0027`–`0030` | ✅ **SUCCESS**，水位 `0026` → **`0030`**；3 个 retry 列齐全 |
| 3 | 更新生产 `wrangler.jsonc` provenance | ✅ `BUILD_SHA` / `BUILD_TIMESTAMP` / `GAMBIT_CONFIG_VERSION` |
| 4 | 部署生产 Worker | ✅ **SUCCESS**，Worker `codex-monitor`，Version ID `5d245735-78ae-496b-8ed0-126e2eb8c476` |
| 5 | 只读 live 验证 | ✅ **全部通过**（含 0 次 401 / 0 次预算越界） |
| 6 | 首日观察 | ✅ **已完成**——`id=8` 于 `02:30:21Z` 自动触发，`COMPLETED`，无错误 |
| 7 | 本报告 | ✅ |

**没有任何停止条件被触发。**

---

## 2. 第 0 步：预检与回滚锚点

```
git fetch origin
origin/codex/open-gambit-phase17 = 7bd7754140ae9a43ff981138a7dbe6ad7e4f81be
HEAD                             = 7bd7754140ae9a43ff981138a7dbe6ad7e4f81be   (0 ahead / 0 behind)
```

> 预检时本地领先 origin 1 个 commit（`7bd7754` 验收报告与 seed 脚本尚未推送）。已先 `git push`，使 `origin` 与 `HEAD` 一致后再继续——否则部署产物会与远端记录不符。

工作区：**无 tracked 修改**（untracked 文件均为既有报告）。部署目标确认为**生产** Worker `codex-monitor`。

**生产 D1 绑定从配置实际读取**（非记忆硬编码）：

| 资源 | 值 |
|---|---|
| Worker | `codex-monitor` |
| D1 | `codex-monitor-db` / `a1d9a5ce-d4c4-4909-99e1-328cefa5246e` |
| R2 | `codex-monitor-production-gambit-snapshots` |
| Workflow | `gambit-analysis-production` |

**回滚锚点（记录备用）**：

| 项 | 部署前值 |
|---|---|
| Worker SHA | `4e937ce9f7130148b894b962e75c545ac6c5dd92` |
| migration 水位 | `0026_classifier_resilience.sql` |
| `GAMBIT_CONFIG_VERSION` | `0024_gambit_political_provenance` |
| `BUILD_TIMESTAMP` | `2026-09-11T07:44:19.377849Z` |

`DEEPSEEK_API_KEY` 存在且非空（35 字符，**值未打印**）。

---

## 3. 第 1 步：secret 轮换

```bash
printf '%s' "$DEEPSEEK_API_KEY" | npx wrangler secret put GAMBIT_LLM_API_KEY --name codex-monitor
```

| 项 | 结果 |
|---|---|
| 命令退出码 | **0** |
| wrangler 输出 | `✨ Success! Uploaded secret GAMBIT_LLM_API_KEY` |
| 值是否被读取 | 否（只从环境变量经 stdin 管道传入） |
| 值是否落入文件/argv/日志/commit | **否** |

**为什么必须做**：staging 验收发现 staging 的同类 secret 对 `api.deepseek.com` 返回 **401**（首次 workflow 触发即 `TRIAGE / http_401 / provider=unknown`）。生产此前**从未验证过**该 secret，且因为 `strategic_eligible=0` 的 discovery run 不发任何 LLM 调用，该缺陷可能在部署后潜伏数日才暴露。本步消除了这个阻塞项。

**不可回滚性（诚实标注）**：旧 secret 无法读回，因此**无法回滚到旧值**。若后续需要撤销，只能再次轮换为另一把 key。

---

## 4. 第 2 步：生产 migration

apply 前水位（实测）：`applied=26`、`latest=0026_classifier_resilience.sql`。

逐条 apply（wrangler 输出的最终状态表）：

```
0027_gambit_analysis_attempts.sql   ✅
0028_gambit_version_noise_stats.sql ✅
0029_gambit_triage_attempts.sql     ✅
0030_gambit_critic_attempts.sql     ✅
```

apply 后验证（只读）：

| 校验项 | 期望 | 实测 |
|---|---|---|
| `applied` | 30 | **30** ✅ |
| `latest` | `0030_gambit_critic_attempts.sql` | **`0030_gambit_critic_attempts.sql`** ✅ |
| `analysis_attempts` / `triage_attempts` / `critic_attempts` 三列 | 3 | **3** ✅ |
| `gambit_discovery_stats.version_noise_items`（0028） | 1 | **1** ✅ |
| `PRAGMA foreign_key_check` | 无违反 | **success: true** ✅ |

四条 migration 对既有行均为 additive（`ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT 0` / 新增列），历史行读作「该代码路径当时无重试」，**不是**「0 次尝试」。

---

## 5. 第 3 步：生产配置更新

`wrangler.jsonc`（gitignored，部署专用）：

| 变量 | 旧值 | 新值 |
|---|---|---|
| `BUILD_SHA` | `4e937ce9f7130148b894b962e75c545ac6c5dd92` | **`7bd7754140ae9a43ff981138a7dbe6ad7e4f81be`** |
| `BUILD_TIMESTAMP` | `2026-09-11T07:44:19.377849Z` | **`2026-09-12T01:17:44.122665Z`** |
| `GAMBIT_CONFIG_VERSION` | `0024_gambit_political_provenance` | **`0030_gambit_critic_attempts`** |

**一次自查并修正的错误**：首版 `BUILD_TIMESTAMP` 用了 macOS `date -u +%N`，而 BSD `date` 不支持 `%N`，产生了非法时间戳 `2026-09-12T01:17:35.6NZ`。已改用 Python 生成合法 ISO8601，并重新解析校验：`parses: true`、与当前时间偏差 420 ms。

**部署 SHA 的一致性问题（诚实说明）**：`BUILD_SHA` 记录的是**代码状态**的 commit（`7bd7754`），而 `wrangler.jsonc` 是 gitignored 的部署专用文件，因此写入该值不产生新 commit。实际部署的产物 = commit `7bd7754` **加上**该未跟踪配置文件中的 provenance 值。这与上一次部署的既有约定一致（旧值 `4e937ce` 同为代码 commit）。

**已核验部署产物与 `BUILD_SHA` 的实际差异**：`4e937ce..7bd7754` 在 `src/` 下的改动全部位于 Gambit 域（`budget/eligibility/evidence/llm/pipeline/prompts/publication/repository/service/sources/types` + `provenance.ts`/`routes/open-gambit.ts`/`types.ts`），未触及任何其它域。

---

## 6. 第 4 步：部署

```bash
npx wrangler deploy --name codex-monitor
```

| 项 | 值 |
|---|---|
| Worker | `codex-monitor` |
| Version ID | `5d245735-78ae-496b-8ed0-126e2eb8c476` |
| Upload | 991.57 KiB / gzip 229.18 KiB |
| schedule | `*/15 * * * *`（Tibo）、`30 2 * * *`（Gambit） |
| workflow | `gambit-analysis-production` |
| 关键变量生效 | `GAMBIT_LLM_PROVIDER=deepseek`、`GAMBIT_LLM_MODEL=deepseek-flash`、`GAMBIT_MAX_LLM_TOKENS_PER_RUN=33000`、`GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN=8`、`GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN=16000` |

无部署错误。Gambit cron **保持启用**（`GAMBIT_SCHEDULE_ENABLED=true`、`GAMBIT_CRON_WINDOWS="30 2 * * *"`，与生产既有形态一致）。

---

## 7. 第 5 步：只读 live 验证

### 7.1 健康端点

```
HTTP 200
status         = ok
dbConnected    = true
commitSha      = 7bd7754140ae9a43ff981138a7dbe6ad7e4f81be   ← 与 BUILD_SHA 一致 ✅
schemaVersion  = 0030_gambit_critic_attempts                 ← 与 migration 水位一致 ✅
environment    = production
generatedAt    = 2026-09-12T01:17:44.122Z
reviewQueue.count = 0
```

### 7.2 公开路由

| 路由 | HTTP | bytes | `TEST_ONLY` |
|---|---:|---:|---:|
| `/` | 200 | 222,381 | 0 |
| `/zh/` | 200 | 222,313 | 0 |
| `/open-gambit/` | 200 | 5,498 | 0 |
| `/zh/open-gambit/` | 200 | 5,418 | 0 |
| `/ja/open-gambit/` | 200 | 5,744 | 0 |
| `/fr/open-gambit/` | 200 | 5,811 | 0 |
| `/es/open-gambit/` | 200 | 5,782 | 0 |
| `/latest/` | 200 | 16,429 | 0 |
| `/about/ai/` | 200 | 5,873 | 0 |

Open Gambit 仍为**正确空状态**（无已发布文章）——与部署前一致，非回归。

### 7.3 运行与预算（只读）

| 检查项 | 期望 | 实测 |
|---|---|---|
| `GAMBIT_LLM_BUDGET_EXCEEDED` | 0 | **0** ✅ |
| `PROVIDER_HTTP_401`（`http_401`） | 0 | **0** ✅ |
| `POLICY_STATE_INCONSISTENT` 候选 | 0 | **0** ✅ |
| `gambit_llm_attempts` 总行数 | — | 1（部署前的历史行） |

**部署后尚未有新的 Gambit run**：最近三次为 `2026-09-09`/`09-10`/`09-11` 的 `30-2-*-*-*`，均为旧代码所跑（`workflow_starts=0`）。下一次 `30 2 * * *` 才是新代码的首次真实运行 → 见 §8。

### 7.4 一条**既存**告警（非本次引入）

`/api/health` 的 `warnings: ["INGESTION_COUNT_DISCREPANCY"]`：

```
probeEnabled       = true
lastProbeAt        = 2026-09-11T07:45:33.765Z     ← 陈旧（部署前）
timelineCount24h   = 17
storedCount24h     = 5
missedCount        = 12
discrepancyRatio   = 0.7059
```

**判定为与本次部署无关，依据是代码级证据而非猜测**：该告警由 Tibo monitor 的 X ingestion probe 产生；而 `4e937ce..7bd7754` 在 `src/` 下的全部改动都位于 Gambit 域，**没有任何一处触及 X API / ingestion / probe 路径**。`status` 仍为 `ok`（部署前后一致，非状态回归）。

**但这确实是一个真实存在的、未解决的 Tibo 侧问题**（采集窗口内 17 条时间线帖子只有 5 条入库），**不在本阶段范围内**，我不在本轮处理它，仅如实上报以免被误读为本次部署的产物。

---

## 8. 第 6 步：首日观察 — **已完成**

`30 2 * * *` 的首次自动 run 在部署后按计划触发。定位方式为「`started_at > 部署时间戳`」，因此这是**新代码的首个真实 run**，不是前一日的残留记录。

### 8.1 run 概览

```
id            = 8
run_key       = gambit-discovery:2026-09-12:30-2-*-*-*     ← 真实 cron 事件
status        = COMPLETED
started_at    = 2026-09-12T02:30:21.741Z
finished_at   = 2026-09-12T02:30:21.741Z
error_message = null
```

### 8.2 漏斗（`gambit_discovery_stats` for run_id=8）

```
sources_attempted 14   sources_succeeded 14
raw_items_observed 194   stale_items 79   malformed_items 1
admitted_items 26        version_noise_items 73   routine_noise_rejects 18
strategic_eligible 0     global_top_k_selected 0   workflow_dispatches 0
```

`gambit_runs` 汇总：`candidates_found=26`、`qualified_gambits=0`、`workflow_starts=0`、`no_gambit_rejects=26`、**`error_message=null`**。

**判定：这是健康的零发布结果，且与 staging 收敛到同一结论。**

- 生产与 staging 的漏斗**逐项一致**（14/14 sources、194 raw、26 admitted、0 eligible、0 dispatch）——同一代码、同一模型、同一源集合下的可复现行为。
- 与 staging 的差异仅在淘汰路径的分布上（staging 记 18 次 `routine_noise_rejects`；生产记 26 次 `no_gambit_rejects`、0 次 routine noise）。**两种路径的最终结果相同：0 个候选通过确定性准入**。对 `AGENTS.md` 的「routine maintenance 应在 deep analysis 之前结束」而言，二者都是正确行为。
- 26 个 admitted 全部为 routine 版本发布与常规功能更新（`v3.12.0`、`wrangler@4.131.1`、`@cloudflare/deploy-helpers@0.11.1` 等），与此前核对结果一致。

### 8.3 LLM 尝试

**该 run 的候选没有任何 LLM 尝试行**——因为 `strategic_eligible=0`，`workflow_dispatches=0`，管线在确定性准入就终止，**一次 LLM 调用都没有发起**。

### 8.4 translation 路径（唯一未验证段）

```
translation_attempts = 0
```

**translation 在生产依然未被触达。** 与前文一致——这**不是**失败，而是「没有候选走到发布门」的直接后果。**该路径在部署后仍然完全未经验证。**

### 8.5 停止条件复核（全部通过）

| 条件 | 实测 |
|---|---|
| `PROVIDER_HTTP_401` | **0** ✅ |
| `GAMBIT_LLM_BUDGET_EXCEEDED` | **0** ✅ |
| `POLICY_STATE_INCONSISTENT` | **0** ✅ |
| run `error_message` | **null** ✅ |
| 公开页 `TEST_ONLY` / 坏内容 | **0**（`/zh/open-gambit/` HTTP 200、正确空状态 `暂无`）✅ |
| 健康端点 | `status: ok`、`dbConnected: true`、`commitSha 7bd7754140ae…`、`schemaVersion 0030_gambit_critic_attempts` ✅ |

**没有任何停止条件被触发，未执行任何回滚动作。** 系统在 run 后保持 `status: ok`。

### 8.6 关于 N8 的旁证

run 8 在**数秒内**完成、`error_message=null`、且未发起任何 LLM 调用，因此本次观察**不构成**对 N8（单进程流式调用退化）的证据。N8 仍为机制未确定，生产形态下（每 Workflow ≤6 次调用、全新实例）预期不构成缺陷，但**本文不声称已验证**。

**未伪造任何结果；以上全部为只读查询所得。**

### 若观察中出现停止条件的处置预案

| 触发 | 动作 |
|---|---|
| `PROVIDER_HTTP_401` | 立即把 `GAMBIT_SCHEDULE_ENABLED` 置 `false` 并重新部署（停止继续跑），报告并等待人工决定 |
| `GAMBIT_LLM_BUDGET_EXCEEDED` | 同上；同时复核 33,000 上限与最坏路径 32,800 的差距 |
| translation 失败 | 按错误路径处理：`TRANSLATION_FAILED` 会使发布 fail closed（**不会**公开坏内容）。不据此放宽门 |
| 公开页出现 `TEST_ONLY` 或坏内容 | 立即停止并报告 |

---

## 9. 已消除风险 vs 残留风险

### 已消除（本次部署直接消除）

1. **生产 `GAMBIT_LLM_API_KEY` 未验证** → 已轮换为已验证可用的 key。这是 staging 验收发现的**唯一生产阻塞项**。
2. **生产代码停留在阶段 1 起点**（`4e937ce`，23 个 commit 未部署）→ 已部署 `7bd7754`，包含阶段 1.5/1.6/1.7 全部修复。
3. **生产 schema 缺少重试计数列** → 若先部署代码而不 apply migration，首个 analysis 阶段会 `no such column` 直接失败。已按顺序先 migration 后部署，规避。
4. **生产 provider/model 与实测预算不一致** → 已切换到 `deepseek` / `deepseek-flash`，与全部实测所用模型一致。
5. **`/api/health` 谎报 schema** → `GAMBIT_CONFIG_VERSION` 已从 `0024` 更新为 `0030`。

### 残留风险

1. **`translation → publication` 在生产仍是未验证路径。** staging 的候选未走到发布门，因此 `translateGambit`（4 locale × 2 attempts）**从未在任何一个环境真实执行过**。这是本次部署最大的残留风险。
2. **三个有界重采样分支未在真实链路触发过**（单元测试覆盖 17 例；staging 的 critic 首次即成功）。
3. **Tibo 侧 `INGESTION_COUNT_DISCREPANCY`**（§7.4）未解决，属另一域。
4. **旧 secret 无法回滚**（§3）。
5. **N8**（单进程流式调用退化）机制仍未确定；生产每个 Workflow 最多 6 次调用、全新实例，不构成生产缺陷，但未在生产形态下验证。

---

## 10. 未验证路径（明确列出，不得外推 staging 结论）

| 路径 | staging | 生产 |
|---|---|---|
| discovery → 确定性准入 | ✅ 已验证（14/14 sources，26 admitted / 0 eligible） | ✅ 已验证（run 8：14/14 sources，26 admitted / 0 eligible） |
| critic workflow 调度 | ✅ 已验证（手工触发 1 次） | ❌ **未触达**（0 dispatch，无候选通过准入） |
| triage → analysis → critic 真实调用 | ✅ 已验证（3 次成功，provider/model 正确） | ❌ **未触达**（该 run 0 次 LLM 调用） |
| critic 判断性拒绝不重采样 | ✅ 已验证（`critic_attempts=0`） | ❌ 未触达 |
| 三个有界重采样**实际触发** | ❌ 未触达 | ❌ 未触达 |
| **translation（4 locale × 2 attempts）** | ❌ **未触达** | ❌ **未触达**（`translation_attempts=0`） |
| 发布 / `publishAutomaticallyArticle` | ❌ 未触达 | ❌ 未触达 |
| 自动 cron 形态 | ✅ 已验证（真实 cron 事件触发 1 次） | ✅ 已验证（run 8，真实 `30 2` 事件） |

**没有为了覆盖这些路径而放宽任何门，也没有制造可发布内容。**

---

## 11. 回滚锚点与回滚方式

| 项 | 回滚目标 |
|---|---|
| Worker 代码 | `4e937ce9f7130148b894b962e75c545ac6c5dd92`（`wrangler deploy` 该 SHA 的 checkout） |
| migration 水位 | `0026_classifier_resilience.sql` |
| `GAMBIT_CONFIG_VERSION` | `0024_gambit_political_provenance` |
| `GAMBIT_LLM_API_KEY` | **不可回滚**（旧值不可读）；如需撤销只能再轮换 |
| `GAMBIT_MODEL_ROLES_JSON` / 预算 / provider | 回滚 deploy 时随 `wrangler.jsonc` 一并恢复（旧值为 provider `opencode-go` / model `mimo-v2.5` / 上限 28,000） |

**注意**：四条 migration 是 additive 的 `ADD COLUMN`，回滚代码**不需要**（也无法）删除列。SQLite 不支持 `DROP COLUMN` 的简单回退路径，且列存在不影响旧代码。

**紧急停止开关**（不依赖回滚代码）：把 `GAMBIT_SCHEDULE_ENABLED` 置为 `"false"` 并重新部署，即可停止 Gambit 继续运行，而保留其余功能。

---

## 12. 结论

**继续（有条件）。** 部署已完成且 live 验证通过；无停止条件触发。生产现在运行在阶段 1.7 修复后的代码上，schema 与配置 provenance 一致。

**但不得声称「生产已验证可用」**：`translation → publication` 这条路径在**任何环境都未被真实执行过**，而它正是「首次真正发布文章」必经的路径。首日 run 之后这一结论**没有改变**——首日 run 的 `translation_attempts=0`，因为 0 个候选通过准入。生产首次发布仍存在未量化的失败概率。

**生产侧唯一被真实执行过的 Gambit LLM 调用，仍然只有 staging 那次手工触发。** 生产自己的 LLM 路径自部署以来**一次都没跑过**（首日 run 在准入即终止）。

**待人工决定的事项**：首日 `02:30Z` run 的观察结果出来后再评估。若该 run 仍为 `strategic_eligible=0`（与 staging 一致的合理结果），则 translation 路径**依旧不会**被覆盖——届时应考虑是否需要在**隔离环境**中以真实候选结构性地验证 translation，而不是等生产首次发布时才发现问题。

**上游未决**：`codex/open-gambit-phase17`（HEAD `8f24825`）尚未合并到 `main`，也未开 PR。

---

## 13. 首次自动 run 后的结论更新

首日 run（`id=8`，`2026-09-12T02:30:21Z`，`COMPLETED`，`error_message=null`）**确认了部署在真实自动调度下稳定**，但**没有推进任何未验证路径**：

| 问题 | 首日 run 后的答案 |
|---|---|
| 新代码能在生产 cron 下跑完吗？ | ✅ **能**（14/14 sources，无错误） |
| 生产 provider/model 配置可用吗？ | ❓ **仍未验证**——该 run 0 次 LLM 调用 |
| translation 路径可用吗？ | ❌ **仍未验证**（0 次尝试） |
| 有没有引入 401 / 预算越界 / 策略不一致？ | ✅ **没有** |
| 需要回滚吗？ | **不需要** |

**下一步的真正阻塞点**：只要 discovery 持续产出 `strategic_eligible=0`，translation 与发布路径就**永远不会**被覆盖，生产会在「看起来健康」的状态下长期保留一个未验证的首次发布风险。建议的处置方向（需你决定，本轮不执行）：在**隔离环境**中用真实候选结构性地驱动一次 translation，而不是把首次验证留给生产首发。
