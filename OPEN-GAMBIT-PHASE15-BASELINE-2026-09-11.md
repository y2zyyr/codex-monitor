# Open Gambit 阶段 1.5 — 重做下游基线 + triage 有界重试

**日期**：2026-09-11
**基线 commit**：`53405b1`（N3 修复后的 HEAD）
**本阶段 commit**：`962cd94`（T4）、`a720bfc`（T3）、`293b0fd`（T2）
**工作目录**：`codex-monitor/`

---

## 0. 执行摘要

| 任务 | 状态 | 结果 |
|---|---|---|
| T1 重做下游基线 | **部分完成**（测量已完成，但基线无法与阶段 0 对照） | 发现新根因 **N6**，下游在 DeepSeek 上系统性不可用 |
| T2 triage 有界重试 | **完成** | 12 个新测试全绿，含全部 4 条不变量 |
| T3 budget fail-open 全量审计 | **完成** | 发现并修复同类缺陷第 2 例（transport retry bound） |
| T4 AGENTS.md 纳管 | **完成** | 独立 commit `962cd94` |

**最重要的一句话**：阶段 1.5 没有推翻阶段 0 的下游结论，而是**证明了当前生产配置下下游根本跑不通**。根因是 **N6 —— DeepSeek 的 reasoning token 吃光了 analysis 角色的 token 预算**。这不是代码回归，而是 `provider/model` 与 `GAMBIT_MODEL_ROLES_JSON` 之间的配置失配（AGENTS.md 明确禁止在未授权下修改 provider/model）。

---

## 1. T1：重做下游基线

### 1.1 探针与测量口径

新增 `tests/open-gambit-downstream-probe-phase15.test.ts`（默认 skip，需 `GAMBIT_PHASE15_PROBE=1`）。

**为什么必须新建探针而不是复用阶段 0 的**：阶段 0 的 `tests/open-gambit-downstream-probe.test.ts` 有三个使其无法作为 N3 后基线的性质：

1. **它绕过 N3 的代码路径**。阶段 0 探针自建 provider，用 `fetch(..., { stream: false })`；N3 缺陷在 `src/open-gambit/llm.ts` 的 `parseStreamingCompletion()` 里。**绕过生产客户端的探针无法测量对该客户端的修复**。
2. 只覆盖 4 条候选、每候选只跑 1 次，无法区分"模型真实翻转"与"传输截断"。
3. 手工注入 `x-opencode-session`；阶段 1 已把该头移入生产 `llm.ts`，再注入会掩盖回归。

新探针使用**真实生产客户端 `providerForRole()`**（因此走真实流式读取器），并记录每次调用的原始返回值。

**测量语义变化（必须标注）**：阶段 0 测的是 `mimo-v2.5` @ `opencode.ai/zen/go`；本阶段按 operator 指示改为 `deepseek-flash` @ `https://api.deepseek.com`。**provider + model + 传输三者同时改变**，因此对比表**不能**读作"N3 修复的幅度"。

**两个矩阵**：
- **矩阵 A（诚实路径）**：triage 真实判定。回答"真实 triage 通过率"。
- **矩阵 B（强制准入）**：真实调用 triage 并记录其真实输出，但把返回给 pipeline 的裁决替换为合成通过。回答"给定准入，analysis/critic 有多稳定"。**矩阵 B 的结果绝不可引用为通过率。**

**规模**：8 候选（4 正 + 4 负）× 3 次 × 2 矩阵 = 48 轮，**86 次真实调用**。

### 1.2 预检：N3 修复在 DeepSeek 上成立

先用真实生产客户端单独验证，再跑矩阵：

- 流式路径正常：HTTP 200 `text/event-stream`，1,510 帧，7 个字段全部到达。
- `normalizeTriage` 正确地把嵌套 `political` 对象映射为扁平 `politicsExcluded`（`pipeline.ts:639`/`:653`）——DeepSeek 5/5 次返回嵌套 `political` 而不返回扁平键，这不是缺陷。

**结论：N3 修复对 DeepSeek 成立。**

### 1.3 矩阵 A 结果（诚实路径）

| 候选 | 类型 | `eventImportance` × 3 | `shouldDeepAnalysisRun` × 3 | 终态 × 3 |
|---|---|---|---|---|
| AI Scan for pull request APIs | 正（T6 放行） | 0.55 / **0.45** / 0.62 | T / T / T | FAILED ×3 |
| Enterprise managed permissions | 正（T6 放行） | 0.65 / 0.60 / 0.70 | T / T / T | FAILED ×3 |
| GitHub Advanced Security expands trial | 正（T6 放行） | 0.25 / 0.20 / 0.20 | F / F / F | NO_GAMBIT ×3 |
| MAI-Code-1-Flash deprecated | 正（T6 放行） | 0.60 / 0.60 / **0.32** | T / T / **F** | NO_GAMBIT / FAILED / NO_GAMBIT |
| Refreshed repository PR page | 负 | 0.25 / 0.20 / 0.25 | F / F / F | NO_GAMBIT ×3 |
| CodeQL 2.27.0 | 负 | 0.30 / 0.40 / 0.40 | F / F / F | NO_GAMBIT ×3 |
| [v1.31.0] Custom labels | 负 | 0.25 / 0.18 / 0.30 | F / F / F | NO_GAMBIT ×3 |
| Xcode 27 runner image | 负 | 0.35 / 0.35 / 0.25 | F / F / F | NO_GAMBIT ×3 |

**汇总**：
- triage 放行 **8/24**（= 3/3 + 3/3 + 0/3 + 2/3）。**4 条正样本全部被放行 ≥2 次；4 条负样本 0/12 被放行。**
- 终态：`NO_GAMBIT` 17、`FAILED` 7。
- **analysis 产出可用裁决：0/24。critic 执行：0/24。**

### 1.4 矩阵 B 结果（强制准入）

| 终态 | 次数 |
|---|---|
| FAILED | 20 |
| AUTO_PUBLISH_ELIGIBLE | 2 |
| NO_GAMBIT | 1 |
| NEEDS_HUMAN_REVIEW | 1 |

- analysis 裁决：`None`（不可用）19、`QUALIFIED` 5。
- critic 执行 **3/24**，acceptance 2 / rejection 1。

**注意**：仅有的 1 条 `AUTO_PUBLISH_ELIGIBLE`（CodeQL 2.27.0，即阶段 1 未放行的 **neg样本**）是在**强制准入**下产生的，且 analysis 首次即成功（`calls=3`：triage + analysis + critic，无重试）。它**不代表**该候选应当发布，也不代表管线健康。

### 1.5 N6：analysis 角色 token 预算被 reasoning 吃光（本阶段最重要发现）

**证据 1 —— 错误分布（86 次调用）**：

| 错误 | 次数 | 角色 |
|---|---|---|
| `empty_response` | 18 | analysis 16、critic 2 |
| `invalid_structured_json` | 10 | analysis 10 |
| `timeout` | 1 | triage 1 |

**analysis 26/33 次调用失败**（16 空响应 + 10 非法 JSON）。

**证据 2 —— 生产客户端诊断**：每次失败的 analysis 都跑满约 1,400–1,600 帧 / 18–22 秒，`contentBytes` 要么 0，要么是一个不完整的 JSON 前缀（461 / 620 / 1051 / 1996 / 2700 / 3163 / 4179 / 6988 / 9044 字节，`jsonComplete=false`）。

**证据 3 —— 受控 token 预算实验**（同一请求、同一证据，只改 `max_tokens`）：

| 角色 | `max_tokens` | content 字符 | reasoning 字符 | `finish_reason` | `reasoning_tokens` | JSON 可解析 |
|---|---:|---:|---:|---|---:|---|
| analysis | 4,000 | **0** | 19,367 | **length** | 4,000 | ✗ |
| analysis | 4,000 | 2,850 | 16,331 | **length** | 3,445 | ✗ |
| analysis | 4,000 | **0** | 20,081 | **length** | 4,000 | ✗ |
| analysis | 8,000 | 5,094 | 15,326 | stop | 3,151 | **✓ 11 键** |
| analysis | 8,000 | 5,479 | 16,105 | stop | 3,355 | **✓ 11 键** |
| analysis | 8,000 | 5,476 | 19,406 | stop | 3,991 | **✓ 11 键** |
| analysis | 8,000 | 4,510 | 14,559 | stop | 3,059 | **✓ 11 键** |
| critic | 3,000 | 1,046 | 4,293 | stop | 861 | ✓ 10 键 |
| critic | 3,000 | 829 | 5,093 | stop | 973 | ✓ 9 键 |
| triage | 2,400 | 598 | 1,921 | stop | 379 | ✓ 7 键 |
| triage | 2,400 | 555 | 2,776 | stop | 566 | ✓ 7 键 |

**机制**：`deepseek-flash` 在输出答案前先产出一段很长的 `reasoning_content`。analysis 角色预算 4,000 tokens，而 reasoning 单独就要吃 3,000–4,000+ tokens，于是 `finish_reason=length`，JSON 要么完全没开始、要么被截断。

**关键不对称**：triage（2,400 预算）**稳定成功**，critic（3,000 预算）**多数成功**，只有 analysis（4,000 预算）**系统性失败**。原因不是"预算太小"，而是 **analysis 的 reasoning 会膨胀到占满整个预算**——两个 4,000 试验里 reasoning_tokens 恰好 = 4,000，即被上限截断。

**N6 与 N3 的关系**：N3 是"流式读取器过早停止"，已修复；N6 是"模型根本没来得及输出内容"。两者症状相同（HTTP 200、合法响应、内容不可用），根因完全不同。N3 的修复是正确且必要的，它让 N6 **变得可见**——修复前 N6 会被 N3 的静默截断吞掉。

**为什么不是代码回归**：N3 后的 commit 未触碰 token 预算、prompt 或模型配置。阶段 0 在 `mimo-v2.5` 上 analysis 能产出完整 JSON。变化的是**模型**（按 operator 指示改为 DeepSeek），而 `GAMBIT_MODEL_ROLES_JSON` 的 analysis 预算仍是 4,000。**这是配置失配，不是回归。**

**本轮未修**：AGENTS.md 禁止在未授权下修改 `provider/model` 与 `LLM budget`。N6 的修复需要在两选一之间做产品决策（见 §5）。

### 1.6 与阶段 0 结论的对比表

| 阶段 0 结论 | 阶段 1.5 重测 | 需要修正？ |
|---|---|---|
| triage 通过率 1/4（**未标注是 N3 前后**） | 矩阵 A：**4 条正样本全部通过**（8/24 次）；负样本 0/12 | **需修正（向好的方向）**。但受模型更换混淆，不能算作 N3 的功劳 |
| critic 执行 0 次，"拒绝率不可测" | 矩阵 A 仍是 0/24；**矩阵 B 下 critic 执行 3/24，acceptance 2 / rejection 1** | **需修正**。阶段 0 的"0 次"是准入拒绝所致；N3 修复后 analysis 仍拿不到可用裁决，所以"不可测"结论**依然成立**，但原因已从"准入拒绝"变为"N6 token 耗尽" |
| analysis 非确定性 ~50% | **无法测量**：8 次分析的 analysis 产出全部不可用（矩阵 A 0/24） | **需修正**。阶段 0 的 "~50% 翻转" 在 DeepSeek 上**无法复现**，因为连"稳定失败"都算不上——是 100% 不可用。阶段 0 的 50% 数字很可能**部分**是 N3 截断位置的假象，但这一点**无法确认**，因为模型已更换 |
| critic 拒绝率 50% | 样本量 n=3（矩阵 B），不足以对照 | **保持不变**（无法确认） |
| prompt v2 系统性压低 `eventImportance` | **仍成立且有更强证据**：负样本 12/12 次 `eventImportance` ≤ 0.40；正样本中 GHAS 三次 0.20–0.25。`0.45` 阈值把这些正样本挡在 analysis 之外 | **保持不变（成立）** |
| 阶段 1：T6 放行 4/98 | 未重测（本轮不改准入） | 不适用 |

**明确标注的数据来源**：

| 数据 | 来源 |
|---|---|
| 阶段 0 的 triage 1/4、critic 0 次、analysis ~50% 翻转 | **N3 修复前**，且用阶段 0 自建的非流式 provider |
| 本阶段矩阵 A / B 全部数据 | **N3 修复后**（`53405b1` HEAD），走真实生产流式客户端 |
| 本阶段 token 预算实验 | **N3 修复后**，直接测原始流式传输 |

### 1.7 T1 的诚实边界

- **无法**给出"重做后的 triage 通过率 / analysis 翻转率 / critic 拒绝率"作为可与阶段 0 直接对照的数字，因为 provider+model 同时改变。要得到可对照的基线，必须用 `opencode-go` + `mimo-v2.5` 重跑——该凭据本会话不可用。
- 矩阵 B 的强制准入是**测量手段**，不是生产行为。
- `n=3` 对翻转率而言样本偏小；`eventImportance` 的结论（阈值 0.45 挡人）有 12/12 的负样本一致性支撑，可信度较高。

---

## 2. T2：triage 有界重试

### 2.1 实现

`src/open-gambit/pipeline.ts`：把 triage 请求提为 `triageRequest`（字节级复用），加 `GAMBIT_TRIAGE_RETRY_LIMIT = 1` 与同构的重采样循环。`triageAttempts` 贯穿全部 9 个 return 点，并在 `runQualifiedGambitWorkflow` 中持久化。

`migrations/0029_gambit_triage_attempts.sql`：`ALTER TABLE gambit_candidates ADD COLUMN triage_attempts INTEGER NOT NULL DEFAULT 0;`（append-only，镜像 0027，是 RETRY 计数而非总尝试数）。

`src/open-gambit/repository.ts`：`recordCandidateTriageAttempts()`，与 `recordCandidateAnalysisAttempts()` 同契约（clamp 到 [0,10]）。

### 2.2 不变量（重试只能升级，不能降级）

| 场景 | 行为 | 测试 |
|---|---|---|
| 第一次拒绝、第二次通过 | 通过，counter = 1 | ✓ |
| 连续两次拒绝 | 保持拒绝，counter = 1，**不再重试** | ✓ |
| 第二次报错 | **保留第一次有效判决**，不变成 FAILED | ✓ |
| 第二次 schema 不可用 | 保留第一次有效判决 | ✓ |
| 第一次即通过 | 不花费重试，counter = 0 | ✓ |
| `shouldDeepAnalysisRun=false` / `evidenceSufficient=false` / `eventImportance<0.45` | 三种拒绝都可重采样 | ✓ |
| 政治排除 | **不重采样**（策略决定，非采样噪声） | ✓ |
| triage 与 analysis 同时重采样 | 各自独立有界于 1 次，不复合 | ✓ |

**新增测试**：`tests/open-gambit-triage-retry.test.ts`（12 个）——**全部通过**。

### 2.3 未改动（守住约束）

triage prompt 文本、`0.45` 阈值、`deterministicPublicationGate`、`allowCanonicalFallback`、`eligibility.ts`、source registry、任何 `GAMBIT_MAX_*` 配置值。

### 2.4 成本

| 项 | 值 |
|---|---|
| 每次重采样 | +1 次 triage 调用，2,400 tokens |
| 触发条件 | 仅当首次 triage 拒绝 |
| 上界 | 3 candidates/天 × 2,400 = **+7,200 tokens/天 ≈ +216k tokens/月**（≈ +3 calls/天） |
| 预算合规 | 单候选最坏 4 → **5 calls**、11,800 → **14,200 tokens**，**仍在 `GAMBIT_MAX_LLM_CALLS_PER_RUN=8` / `18000` 之内**，无需放宽任何预算 |

**已知有界行为**：3 个候选同时触发 triage 与 analysis 双重试时，单 Workflow 最坏 8 calls / 24,800 tokens > 18,000 token 上限，会触发 `GAMBIT_LLM_BUDGET_EXCEEDED`（fail-closed，非降级）。这是预算兜底的正确行为，未改动预算，故如实记录。

---

## 3. T3：budget namespace fail-open 全量审计

### 3.1 审计清单

| Namespace / 函数 | 省略 limit 的后果 | 缺陷？ |
|---|---|---|
| `GambitRunBudget.maxLlmCalls` | `positiveLimit(undefined, 12)` → 12 | 否 |
| `…maxLlmTokens` | → 24,000 | 否 |
| `…maxTranslationLlmCalls` | → 8 | 否 |
| `…maxTranslationLlmTokens` | → 16,000 | 否 |
| `…maxSearchRequests` | → 6 | 否 |
| `…maxXRequests` | → 6 | 否 |
| `…maxGithubRequests` | → 6 | 否 |
| `…maxHttpRequests` | → 20 | 否 |
| `constructor(NaN / 0 / 负数 / Infinity)` | 全部回落到文档默认值 | 否 |
| `gambitBudgetFromEnv()` 全部 9 个 env | 全部经 `bounded()`，非有限值回落 | 否 |
| `getXApiDailyLimit` | `Number.isFinite ? : fallback`，`<=0` 即 disabled | 否 |
| `getXApiPollIntervalMinutes` | 同上 | 否 |
| `getWebSearchDailyLimit` | 同上 | 否 |
| `getWebSearchActiveModeDailyLimit` | 同上 | 否 |
| `getNormalSearchIntervalHours` | 同上 | 否 |
| **`OpenAICompatibleGambitProvider.complete` 的 `request.retryLimit`** | **`maxAttempts = NaN` ⇒ 循环体 0 次执行** | **是（已修）** |

**结论**：阶段 1 修掉的 `gambit_translation` 是**唯一**的 budget namespace 实例；Tibo 模块的 schedule budget **全部 fail-closed**。但同类缺陷在 **transport retry bound** 上存在第 2 例。

### 3.2 缺陷 2：transport retry bound（已修）

```js
Math.min(2, Math.max(1, request.retryLimit + 1))  // undefined + 1 = NaN
Math.min(2, Math.max(1, NaN))                     // = NaN
for (let attempt = 0; attempt < NaN; ...)          // 0 < NaN === false ⇒ 0 次
```

循环体是**唯一**发射诊断和调用 `fetch` 的地方。因此省略 `retryLimit` ⇒ **0 次网络调用、0 条诊断、只抛一个裸 `provider_error`**。实测 `fetchCalls = 0`。

生产路径全部经 `getGambitModelRoleConfig` 供给有界值，所以是**潜伏缺陷而非线上故障**；但 JS 调用方、过期字面量、`as never` 强转都能触达，且 `tsconfig` 只检查 `src` 所以编译期不报——与阶段 1 修复 budget 的论证完全一致。

**修复过程中我自己引入并修正了一个 off-by-one**：第一版把 `retryLimit` 原地归一化后仍套同一个 `+1` 公式，把 2 次尝试降为 1 次，**静默移除了角色配置要求的重试**。既有的 `tests/open-gambit-llm-session.test.ts` 429 重试用例抓到了它。最终实现命名为 `boundedAttemptCount()`（返回**尝试数**），并新增两个测试双向钉死：`retryLimit=1` 恰好 2 次尝试；`retryLimit=100` 仍最多 2 次。

### 3.3 测试

`tests/open-gambit-budget-fail-closed.test.ts`（14 个）——**全部通过**。

---

## 4. T4：AGENTS.md 纳入版本控制

方案 i（operator 选定）。commit `962cd94`，仅含 `AGENTS.md`（321 行），内容零改动，独立于本阶段代码 commit 以便单独 review/回滚。提交前已确认不含任何 secret 形态字符串。

**为什么纳管而非写 changelog**：AGENTS.md 是"代码据以被验证"的不变量正典（零发布即健康、发布门冻结、budget namespace、migration 契约）。不纳入版本控制的不变量记录无法与某个 commit 对照审计。

---

## 5. 全量门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm test` | **PASS** — 50 文件通过 / 2 skip；678 测试通过 / 4 skip |
| `npm run build` | **PASS** |
| `npm run migration:parity` | **PASS** — `overall=true`，`latestMigration=0029_gambit_triage_attempts.sql`，29 migrations，19 tables，18 indexes，0 FK 违规 |
| `npm run open-gambit:demo` | **PASS** — 2 测试 |
| `git diff --check` | **PASS**（干净） |

**未触碰**：生产 deploy、production migration、cron、生产变量/secret、生产 D1/R2 写入、Workflow 启动、内容发布、`GAMBIT_MAX_*` 配置值、`0.45` 阈值、`deterministicPublicationGate`、`allowCanonicalFallback`、`eligibility.ts`、source registry、`0027`/`0028`、冻结 fixture（`real-corpus-2026-09-11.json`、`prod-candidates-2026-09-11.json`）。

**保留**：全部未跟踪文件、`.env`（已 gitignore）、既有 stash `stash@{0}`。

---

## 6. 成本

### 6.1 本阶段实验实际消耗

| 项 | 调用数 | 估算 tokens |
|---|---:|---:|
| 预检（triage × 5） | 5 | ~5,000 |
| 冒烟与迭代（triage/analysis） | ~30 | ~45,000 |
| 主矩阵（86 次） | 86 | ~70,600 |
| 失败形状捕获 | ~8 | ~33,000 |
| token 预算实验 | 12 | ~40,000 |
| **合计** | **~141** | **~195,000 tokens** |

### 6.2 T2 月度增量（生产）

**+216k tokens/月（≈ +3 calls/天）为绝对上界**，仅当每天都用满 3 个候选且全部首次 triage 拒绝时达到。按 T1 实测的正样本 triage 放行率（4/4 候选至少放行 2 次），实际会显著低于上界。

---

## 7. 未完成项与诚实标注

| 项 | 状态 | 原因 |
|---|---|---|
| T1 与阶段 0 的**同模型**对照基线 | **无法执行** | `opencode-go` / `mimo-v2.5` 凭据本会话不可用；operator 指示改用 DeepSeek |
| analysis 真实翻转率 | **无法测量** | N6 使 analysis 产出可用裁决 0/8；连"稳定失败"都测不出翻转率 |
| critic 真实拒绝率 | **样本不足** | n=3（矩阵 B），不足以支撑结论 |
| 阶段 0 "50% 翻转中有多少是 N3 假象" | **无法确认** | 需要同模型重跑 |
| N6 的修复 | **未修** | 超出授权（AGENTS.md 禁止未授权改 provider/model 与 LLM budget） |
| T1 探针的 `<<<FAILSHAPE>>>` 输出 | **部分失效** | 该辅助函数的去重键使多数捕获返回 `{note:'already-captured'}`；不影响主结论（主结论由生产客户端诊断 + 独立预算实验支撑） |
| 生产 D1 只读查询 | **未执行** | 本轮无需；T2 的效果需在受控生产运行后从 `triage_attempts` 列观测 |

---

## 8. 下一步建议

### 8.1 是否可以进入阶段 2（源结构再平衡）？

**不建议，且这一结论与阶段 0 的理由不同。**

阶段 0 的问题是"准入太严"。阶段 1.5 证明：**准入已修好（4 条正样本全部放行、负样本 0/12 放行），但下游在 DeepSeek 配置下跑不通。** 此时做源结构再平衡，只会让更多候选死在 analysis 上，无法观测到收益。

**必须先解决 N6。**

### 8.2 N6 的三个候选修复（需 operator 决策）

| 方案 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **A. 提高 analysis 角色 token 预算** | `GAMBIT_MODEL_ROLES_JSON.analysis.tokenBudget` 4,000 → 8,000 | 单候选 analysis 最坏翻倍；需同步复核 18,000 上限与 T2 的 14,200 最坏值 | 改动 `GAMBIT_MAX_LLM_*` 语义边界，**需授权** |
| **B. 关闭 reasoning** | 若该端点支持 reasoning 控制参数，对 analysis 关闭/限流 | 需先确认端点能力 | 可能降低裁决质量 |
| **C. 换回非推理模型** | analysis 角色回到 `mimo-v2.5` 一类 | 需恢复该凭据 | **需授权改 provider/model** |

**我的建议**：先做一次**成本极低的只读验证**——用方案 A 的参数（8,000）在真实管线里跑 3 个候选 × 3 次，确认 `AUTO_PUBLISH_ELIGIBLE` 能稳定产生（本阶段已见 1 例）。若成立，再申请授权改配置。**在授权前不应修改任何预算值。**

### 8.3 是否需要受控生产运行？

**需要，但在 N6 修复之后。** 理由：T2 的 `triage_attempts` 列只有在真实调度中才会写入，其效果（triage 翻转率、重试升级率）**无法从本地探针得出**——本地探针不传 `dependencies.repository`，不写 D1。

建议顺序：
1. 解决 N6（需授权）
2. 本地全量门禁复验
3. 隔离 staging：apply `0029` + 部署 + staging acceptance
4. 同一 SHA production migration + deploy
5. 只读观察 3 天 `triage_attempts` / `analysis_attempts` / `gambit_articles`
6. 再决定阶段 2

**零发布仍是健康结果**：即使 N6 修好，若真实语料无合格战略事件，`gambit_articles = 0` 是正确结果。本轮**没有**为了填空页面降低任何门槛。

### 8.4 建议后续小任务

1. 修 T1 探针的 `<<<FAILSHAPE>>>` 去重键（或直接在报告中废弃该输出）。
2. 把 `boundedNumeric` 的 fail-open 检查做成一个共享断言 helper，供新 namespace 复用。
3. 在 `wrangler.jsonc`（gitignored）与 `wrangler.example.jsonc` 中显式写入 `GAMBIT_MAX_TRANSLATION_*`，让翻译配额不再依赖代码默认值（当前生产未设置这两个变量，靠默认 8 / 16,000）。
