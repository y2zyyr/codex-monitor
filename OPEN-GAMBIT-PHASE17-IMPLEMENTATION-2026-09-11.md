# Open Gambit — 阶段 1.7 实施报告

**日期**：2026-09-11
**范围**：N7 修复（有界 critic 操作性重采样 + deadline 钳制评估）+ 部署前准备
**状态**：T1–T4 全部完成。**未 deploy、未 apply 任何 migration、未改 cron、未改生产 secret、未写生产 D1/R2、未启动生产 Workflow、未发布任何内容。**

分支 commits：

| # | commit | 内容 |
|---|---|---|
| T1 | `6e5625f` | `test(open-gambit): add the opt-in Phase 1.7 N7 critic-diagnosis probe` |
| T2 | `721fe91` | `fix(open-gambit): bound the critic operational failure with one re-sample` |
| T4a | `848f2be` | `docs(open-gambit): record the N7 fix, the budget envelope, and the pinned provider` |
| T4b | 本报告所在 commit | 阶段报告 + staging 验证计划 |

阶段报告：

- `OPEN-GAMBIT-PHASE17-T1-N7-DIAGNOSIS-2026-09-11.md` — N7 精确诊断（T1）
- `OPEN-GAMBIT-PHASE17-T3-BASELINE-2026-09-11.md` — N7 修复后基线重跑（T3）
- `OPEN-GAMBIT-PHASE17-STAGING-VERIFICATION-PLAN-2026-09-11.md` — staging 验证计划（不执行）

---

## 1. 前提确认（用户拍板）

| # | 项 | 用户决策 |
|---|---|---|
| 1 | 生产 provider/model | **方案 A**：`deepseek-flash` @ `api.deepseek.com` |
| 2 | 授权修改 `wrangler.jsonc` | **授权**（限本阶段列出的变量；不 deploy） |
| 3 | N7 修复方案 | **方案 i**：critic 恰好一次有界操作性重采样 |
| 4 | 授权本地真实 LLM 调用 | **授权** T1 + T3 |

---

## 2. T1 — N7 精确诊断

**问题**：阶段 1.6 观测到 critic 在 6,000 下的残余失败形态是 **28.5–30.3 s 接近 deadline**，同时又有一次**成功**调用耗时 29.4 s。这同时符合两个**方向相反**的根因，而它们要求相反的修复：

- **(a) token 墙** —— 模型还需要更多 token，被 `finish_reason=length` 截断；~30 s 只是「生成 6,000 reasoning tokens 所需的时间」。
- **(b) deadline 墙** —— 模型本可完成，但 30,000 ms clamp 先杀了连接。

**方法**：新探针从 **transport 层**分类每一次失败的 critic 调用（捕获的 SSE 是否以 `finish_reason=length` 结束，还是无终止帧 / 显式 `timeout`），而不是从耗时推断。探针**断言自己前提**（请求的 token 预算真的未被静默钳制、role `timeoutMs` 确实等于 clamp）。矩阵 B、critic 6,000、4 候选 × 5 replicate、按 ≤24 次观测请求分块（规避 N8），每块独立进程。

**结果**（保留块 14 次 critic 调用）：

```
critic calls=14  ok=11  failed=3  (21.4%)
  TOKEN-WALL   empty_response           finish=length  rt=6000  ct=6000  contentChars=0
  TOKEN-WALL   empty_response           finish=length  rt=6000  ct=6000  contentChars=0
  TOKEN-WALL   invalid_structured_json  finish=length  rt=5887  ct=6000  contentChars=506
  => token 墙 = 3 (100%)   deadline = 0 (0%)
```

**结论：token 墙，不是 deadline 墙。** 特征精确：`reasoning_tokens = completion_tokens = 6,000`，content 为 0 字节或 506 字节截断前缀。这些调用耗时 25.9–29.0 s **正是因为**它们生成了 6,000 tokens——耗时是 token 墙的副作用，不是 deadline 碰撞的证据。

合并未分块的一次运行（同代码同配置，21 次调用）：**token 墙 5 (71%) / deadline 2 (29%)**，总失败率 33.3% —— 与阶段 1.6 独立的 ~35% 吻合。

**成功调用 latency（n=15）**：min 8.7 s、p50 19.1 s、p90 28.7 s、max **29.7 s**，其中 **4/15（27%）在 clamp 的 20% 以内**。

**因此方案选择由证据决定**：

| 方案 | 实际效果 | 结论 |
|---|---|---|
| 提高 `tokenBudget` 到 8,000 | 最慢成功已达 29.7 s；8,000 会把 token 墙**转换成** deadline 墙，每次还多付约 8 s | **无效** |
| 提高 `timeoutMs` clamp | 21 次里最多救 2 次（9.5%），却改动**所有非 translation role** 的代码级上限 | **不划算** |
| **方案 i：有界操作性重采样** | p → p² | **采用** |

详见 `OPEN-GAMBIT-PHASE17-T1-N7-DIAGNOSIS-2026-09-11.md`。

**成本**：41 次调用 / ~281,000 tokens / ~22 分钟，估算 **≈ $0.11**。

---

## 3. T2 — N7 修复实施

### 3.1 代码（`src/open-gambit/pipeline.ts`）

新增 `GAMBIT_CRITIC_RETRY_LIMIT = 1` 与 **瞬时传输错误码 allowlist**：

```text
timeout · network_error · stream_read_error · empty_response · invalid_structured_json · http_*
```

- 第一次调用**操作性失败**时，允许**恰好一次**重采样；请求**逐字节复用**（prompt / evidence / schema / token 预算都不变），因此重采样只改采样，不可能悄悄重新评判另一个 thesis。
- **重试只能升级**：重采样成功 → 采用它；重采样失败或 schema 不可用 → **保留第一次的失败**，因此上报的 reason 始终是真正让该候选出局的错误。
- 重采样命中**非**重采样条件（预算耗尽）时，**释放** bound，避免配置故障白吃一次重试。

**绝不重采样**：

| 情形 | 理由 |
|---|---|
| `accepted=false` 带具体 concern | 策略**判断**，重 roll 等于为判断题换答案。与政治排除不重采样同理 |
| `GAMBIT_LLM_BUDGET_EXCEEDED` | **确定性**：预算检查在每次请求**之前**，耗尽的预算下次仍然耗尽。重采样只烧 wall clock 与 call 槽位 |
| `CRITIC_PROVIDER_UNAVAILABLE` 及任何**未知**错误码 | 配置故障 / fail closed。未知码默认不可重采样，未来新增错误码不会静默获得重试 |

> **T2 过程中发现的设计缺陷（由测试暴露并修正）**：初版把 `GAMBIT_LLM_BUDGET_EXCEEDED` 当成操作性错误。测试显示一个预算耗尽的 run 会**花掉一次重采样**去重试一个必然失败的调用。已从 allowlist 移除，并新增两个测试钉住这个性质。

### 3.2 Storage（`migrations/0030_gambit_critic_attempts.sql`）

```sql
ALTER TABLE gambit_candidates ADD COLUMN critic_attempts INTEGER NOT NULL DEFAULT 0;
```

与 `0027`（analysis）/ `0029`（triage）同构、append-only、对既有行 additive。语义：**RETRY 计数，不是总尝试数**；0 = 第一次尝试就已裁决（无论通过、拒绝还是成功）。`repository.recordCandidateCriticAttempts` 与其他两个同构（clamp 到 0–10），并在 `runQualifiedGambitWorkflow` 中对**所有**结果（含 `NO_GAMBIT` / `FAILED`）写入，因此 critic 的操作性失败率可从生产数据测量，而不必从本地实验外推。

`scripts/verify-gambit-migration.mjs` 新增 `retryCounterColumns` 断言：在 fresh database 上实测三个 retry counter 列都存在。

### 3.3 测试（`tests/open-gambit-critic-retry.test.ts`，17 例全绿）

| 类别 | 覆盖 |
|---|---|
| 升级 | `empty_response` / `timeout` / `invalid_structured_json` / `http_502` 各一例，第一次失败 + 第二次成功 → 成功且 `criticAttempts=1` |
| 有界 | 连续两次操作性失败 → 恰好 2 次调用、最终失败、不再重试 |
| 保留第一次失败 | 重采样失败更硬 / 返回不可用 schema → 上报**第一次**的错误码 |
| **不重采样判断** | 判断性拒绝 + 第二次本会接受 → **只调用 1 次**，`criticAttempts=0` |
| 未知码 fail closed | 未知错误码 → 不重采样、失败 |
| 提供者缺失 | `CRITIC_PROVIDER_UNAVAILABLE` → 不重采样 |
| 不把明确裁决变成失败 | 第一次已返回可用裁决 → 0 次重采样 |
| 可配置关闭 | `retryLimit=0` → 不重采样 |
| **多重试不互相放大** | triage + analysis + critic 同时重采样 → 2 / 2 / 2 次调用，各自恰好一次 |
| 预算 fail closed | 预算不足以支撑重采样 → 不重采样、上报原始操作性错误；预算在 critic 之前耗尽 → `PROVIDER_BUDGET_EXCEEDED`、0 次重采样 |
| 持久化 | 经 `runQualifiedGambitWorkflow` 写入 `critic_attempts`；第一次即裁决时不写（列为默认 0） |

### 3.4 预算（需用户授权的变更，用户已在前提 2 授权）

最坏路径从 `triage 2,400×2 + analysis 8,000×2 + critic 6,000×1 = 26,800 / 5 calls` 变为：

```text
triage 2,400×2 + analysis 8,000×2 + critic 6,000×2 = 32,800 tokens / 6 calls
```

`GAMBIT_MAX_LLM_TOKENS_PER_RUN` **28,000 → 33,000**（覆盖 32,800，余量 200）；`GAMBIT_MAX_LLM_CALLS_PER_RUN=8` 覆盖 6 次调用。已同步 `wrangler.jsonc`、`wrangler.example.jsonc`、`wrangler.staging.example.jsonc` 与 `tests/open-gambit-role-budget.test.ts`。

**关于 deadline 钳制的问题（T2 要求评估）**：**不提高**。T1 证明残余失败不是 deadline 造成的，提高钳制最多救回 21 次中的 2 次，却要改动一个管辖**所有非 translation role** 的代码级上限。30,000 ms 保持原值，并由测试钉住。

---

## 4. T3 — N7 修复后基线重跑

**配置**：`deepseek-flash`、analysis 8,000 / critic 6,000、role `timeoutMs` 30,000、4 候选 × 10 replicate（5 replicate/块，独立进程）。矩阵 A（**真实**准入门，诚实路径）与矩阵 B（强制准入）。

### 4.1 critic 操作性失败率 —— N7 的核心数字

| 矩阵 | critic 调用 | 操作失败 | 单次失败率 | 失败类型 | 花重采样 | 救回 | 仍失败 | **每 run 残余失败率** |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| A | 15 | 4 | 26.7% | **全 token 墙** | 3 | 2 | 1 | **1/12 = 8.3%** |
| B | 16 | 2 | 12.5% | **全 token 墙** | 2 | 2 | 0 | **0/14 = 0.0%** |
| **合计** | **31** | **6** | **19.4%** | — | **5** | **4** | **1** | **1/26 = 3.8%** |

修复后 6/6 失败**仍然全部是 token 墙**——修复没有改变失败的**性质**，只吸收了它，正是 T1 的预测。

### 4.2 `AUTO_PUBLISH_ELIGIBLE`（矩阵 A，诚实路径）

```
runs = 16   {"AUTO_PUBLISH_ELIGIBLE": 11, "NO_GAMBIT": 4, "FAILED": 1}
```

| 候选 | run | AUTO | NO_GAMBIT | FAILED |
|---|---:|---:|---:|---:|
| AI Scan for pull request APIs in public preview | 4 | **4** | 0 | 0 |
| Enterprise managed permissions for GitHub Copilot agent operations | 4 | **4** | 0 | 0 |
| GitHub Advanced Security expands trial availability | 4 | 0 | **4** | 0 |
| MAI-Code-1-Flash deprecated | 4 | **3** | 0 | 1 |

**诚实的两个分母**：16 个 run 中有 4 个在第 1 个 LLM 阶段（triage）就被正确淘汰，从未触达 analysis/critic/发布门。全链路分母 = **11/12 = 91.7%**；全部 run 分母 = **11/16 = 68.8%**。两个数字都给出，避免挑选更好看的那个。

### 4.3 与阶段 1.6 的对比

| 结论 | 阶段 1.6 | **阶段 1.7** | 需修正？ |
|---|---|---|---|
| **`AUTO_PUBLISH_ELIGIBLE`（矩阵 A）** | 6/21 = 28.6% | **11/16 = 68.8%**（全链路 11/12） | **重大修正（向好）** |
| critic 单次操作失败率 | ~35% | **19.4%** | 修正（向好） |
| **critic 每 run 操作性损失** | ~35%（无重采样） | **3.8%** | **新指标** |
| critic 失败形态 | 「28.5–30.3 s deadline 碰撞」 | **6/6 全是 token 墙，0 deadline** | **重大修正**：阶段 1.6 的 deadline 读数是 token 墙的**时长副作用** |
| critic 判断性拒绝率 | accept 12 / reject 1 | A: accept 11 / reject 0；B: accept 12 / reject 2 | 保持成立 |
| analysis 首样本 `NO_GAMBIT` | 1/24 | **0/12** | 保持成立并收敛 |
| analysis 可用率 | 24/24 | A **12/12**，B 16/17 | 保持成立 |
| `AUTO_PUBLISH_ELIGIBLE`（矩阵 B，非通过率） | 12/20 | 12/15 | 仅供参考 |
| 「critic ~1/3 失败不可由配置解决」 | 推断 | **量化确认**：双 clamp 封顶 | **确认** |
| 「部署前阻塞项：provider/model」 | 阻塞 | **已解除** | **已解决** |

### 4.4 阶段 1.6 未记录的一条新观察

`GitHub Advanced Security expands trial availability` 在诚实路径上 0/4 通过，成因是 **triage 四次都判「routine，`eventImportance` 0.25–0.30（< 冻结的 0.45）、`aiTechRelevance=false`」**，`analysisCalls=0`、`criticCalls=0`。而在强制准入下它进入 critic，critic 2/4 次以 unsupported-motive / weak-causality 拒绝它。**triage 与 critic 两道独立的门得出同一结论**——这是健康信号，不是缺陷。

**并且四次都花了 `triageAttempts=1`**：第一样本判拒 → 触发阶段 1.5 的 triage 重采样 → 重采样仍判拒 → 停止。这是「重试只能升级」在**未升级**方向上的正确行为。

**成本**：97 次调用 / 358,554 tokens，估算 **≈ $0.14**。

---

## 5. T4 — 部署前准备

### 5.1 provider/model 决策落地（用户选方案 A）

`wrangler.jsonc`（gitignored，本地）：

```
GAMBIT_LLM_PROVIDER   opencode-go                  -> deepseek
GAMBIT_LLM_BASE_URL   https://opencode.ai/zen/go/v1 -> https://api.deepseek.com
GAMBIT_LLM_MODEL      mimo-v2.5                    -> deepseek-flash
```

理由：阶段 1.6 的预算（analysis 8,000 / critic 6,000）与阶段 1.7 T1 的诊断**全部在 `deepseek-flash` 上测定**，而部署变量此前仍指向 `opencode-go` / `mimo-v2.5`。两者不一致时生产跑在一个**未测定的 (model, budget) 组合**上——这是阶段 1.6 的部署前阻塞项，现已解除。

`AGENTS.md` 已把该决策记为 **runtime provider/model 决策（2026-09-11，Phase 1.7 T4，经用户授权）**，并保留「不得把 runtime ID 当作 public identity」的既有约束。

### 5.2 显式声明 `GAMBIT_MAX_TRANSLATION_LLM_*`

`wrangler.jsonc` 与 `wrangler.staging.example.jsonc` 现在显式声明 `GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN: "8"` 与 `GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN: "16000"`（此前依赖代码默认值）。`wrangler.example.jsonc` 在阶段 1.6 已有。

`tests/open-gambit-role-budget.test.ts` 已改为：

- 断言**每一个** shape（含新纳入的 `wrangler.staging.example.jsonc`）都显式声明**两个**变量；
- 断言两个**tracked 模板**必须都被覆盖（`wrangler.jsonc` 是 gitignored，存在则一并断言，不强制要求）。

### 5.3 `wrangler.example.jsonc` / `wrangler.staging.example.jsonc`

- 预算边界更新为 N7 后的 **33,000 / 6 calls**，并写明 32,800 的推导。
- `wrangler.staging.example.jsonc` 之前还是**阶段 1.5 之前**的形态（analysis 4,000 / critic 3,000 / 24,000），现已与生产对齐。
- role 预算注释补充「30,000 ms 就是代码 clamp，阶段 1.7 T1 实测成功调用达 29.7 s」的理由。

### 5.4 `AGENTS.md`

- 单候选最坏路径更新为 **32,800 tokens / 6 calls**，上限 **33,000**（余量 200）。
- 新增 **「critic 的操作性失败与有界重采样（N7）」** 一节：token 墙 vs deadline 墙的证据、三个方案的效果对比与取舍、五条不变量（allowlist、不重采样判断、不重采样 `BUDGET_EXCEEDED`、只能升级、计数写 `critic_attempts`）。
- migration 清单补 `0029` / `0030`，latest 从 `0028` 更正为 `0030`，并记录新的 `retryCounterColumns` 断言。
- 回归类别新增一条：三个有界重采样各自的「只能升级、不能降级」语义，以及 critic 只对操作性失败重采样。

### 5.5 staging 验证计划

`OPEN-GAMBIT-PHASE17-STAGING-VERIFICATION-PLAN-2026-09-11.md`（**不执行**）。要点：

- 需 apply 的 migration：**`0027`–`0030`**（先只读查询水位，只 apply 缺失的）。
- 需修改的 staging 变量：provider/model 三个、`GAMBIT_MODEL_ROLES_JSON`、`GAMBIT_MAX_LLM_TOKENS_PER_RUN` 18,000 → **33,000**、显式 `GAMBIT_MAX_TRANSLATION_LLM_*`。
- 验收标准：8 项必须通过（A1–A8）+ 6 项观察项（B1–B6），其中 **B4 明确要求观察失败类型**——若出现大量 `timeout`（而非 token 墙），那是**新根因**，必须报告而不是继续。
- **零发布是健康结果**：验收标准**不含**「必须发布一篇文章」。

---

## 6. 本地门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run lint` | ✅ PASS（`node --check` ×6 + `tsc --noEmit`） |
| `npm test` | ✅ PASS |
| `npm run build` | ✅ PASS |
| `npm run migration:parity` | ✅ `overall=true`、latest `0030_gambit_critic_attempts.sql`、30 migrations、19 tables、18 indexes、0 FK violations、`retryCounterColumns` = 三项齐全 |
| `npm run open-gambit:demo` | ✅ PASS |
| `git diff --check` | ✅ clean |

---

## 7. 成本估算（含 N7 修复的月度增量）

### 7.1 本轮一次性成本

| 项 | 调用 | tokens | 估算 |
|---|---:|---:|---:|
| T1 诊断 | 41 | ~281,000 | ≈ $0.11 |
| T3 基线重跑 | 97 | 358,554 | ≈ $0.14 |
| **合计** | **138** | **~640,000** | **≈ $0.25** |

（按 cache-miss 输入 $0.28/M、输出 $0.42/M 计；实际成本可能更低。）

### 7.2 生产月度增量

**上界（最坏路径，声明预算预扣）**：每候选 `26,800 → 32,800` tokens（+6,000 / +1 call）。`GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN=3`、每天 1 次 → 最坏 +18,000 tokens/天 → **+540,000 tokens/月**。

**期望值（重采样只在操作性失败时触发，p≈0.33）**：每 run 额外 ≈ `0.33 × 3 = 0.99` 次 critic 调用 ≈ **5,940 tokens/天** → **≈ 178,000 tokens/月 ≈ $0.07–$0.12/月**。

**关键区分**：把上限从 28,000 提高到 33,000 是**提高限额，不是增加支出**——只有真正花掉的才算。因此 N7 修复的真实月度增量约为 **+$0.07–$0.12**，相对基线（阶段 0 实测的 ~$0.13/月量级）增量约 **+10%**。

---

## 8. 新根因 / 未完成项（诚实标注）

### 8.1 本轮未发现新的生产缺陷

T1 与 T3 的失败形态一致且已解释（token 墙）。**N8 仍未定机制**，本轮延续不作断言：探针的 `observedRequests` 上限（24/进程）与「每块一个全新进程」的做法**成功地规避了它**，两个矩阵 4 个块全部正常完成，无一例 100% timeout 退化。

### 8.2 未测量 / 无法确认

| 项 | 状态 |
|---|---|
| 「critic 8,000 + 提高 deadline 是否会成功、耗时多少」 | **未测量**。T1 只给出 ~35–38 s 的**外推**（基于 29.7 s @ 5,224 tokens 的成功样本），报告已明确标注为外推而非事实 |
| 阶段 1.6 矩阵 A 的 6/21 是否与阶段 1.7 的分母完全可比 | **无法确认**（未重新核对阶段 1.6 原始探针数据）。可确认的是绝对值与比例都显著上升 |
| staging migration 水位 | **未确认**（未连接 staging） |
| staging / production 的任何变更 | **未执行**（本阶段不含） |
| `GAMBIT_MAX_LLM_CALLS_PER_RUN` 在 production 是否应随 N7 调整 | **保持 8**（覆盖 6 次调用，余量 2）。`wrangler.example.jsonc` 为 12。两者都覆盖最坏路径，故未改动 |

### 8.3 未触碰的不变量（确认）

- `deterministicPublicationGate` **未改动**。
- `0.45` 阈值 **未改动**。
- production 路径 **未启用** `allowCanonicalFallback`。
- `OBSERVATION` 仍未成为公开事件；`REJECTED` 仍是终态。
- 两个 clamp（`tokenBudget` 8,000 / 非 translation `timeoutMs` 30,000）**未改动**。
- 未修改阶段 1/1.5/1.6 的任何冻结 fixture 行。
- 未回退或覆盖既有 worktree 修改。

---

## 9. 下一步建议

**可以进入 staging 验证**，但有三个前置必须由 operator 提供：

1. **staging 凭据与 Cloudflare 访问**（本轮全程未接触任何 Cloudflare 资源）。
2. **对本计划 §1 授权表的逐项授权**（migration apply、变量变更、deploy、手动触发各一次）。
3. **clean candidate SHA**：以本阶段最后一个 commit 为准，且全部门禁在该 SHA 上重跑通过。

**不建议现在进入阶段 2（源结构再平衡）**：N7 修复把 critic 的每 run 操作性损失压到 **3.8%**，残余已不再是主要瓶颈；但矩阵 A 上仍有 **1/16 的 run 因 critic 操作性失败而出局**，且该残余集中在特定候选（两轮都出现同一形态）。在 staging 确认该数字在生产形态下同样成立之前扩容源，只会让更多候选撞上同一个墙。

**若 staging 观察到 B4（失败类型）中出现大量 `timeout`**：说明 30,000 ms clamp 在生产形态下**确实**成为瓶颈，那时才应重新评估方案 ii（提高 clamp），并先补上 T1 未做的直接测量（critic 8,000 + 提高 deadline 的成功率与耗时）。
