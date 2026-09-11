# Open Gambit 阶段 1.7 — T3：N7 修复后基线重跑

**日期**：2026-09-11
**状态**：**T3 完成**（真实 LLM 调用，用户已授权；只读，不写生产 D1/R2，不部署）
**探针**：`tests/open-gambit-downstream-probe-phase17.test.ts`（默认 skip；`GAMBIT_PHASE17_PROBE=1`）
**原始证据**：`probe-results-t3/`（gitignored；由探针重新生成）

---

## 1. 目的与配置

在 **N7 修复后**的代码上重跑阶段 1.6 的两条矩阵，测量 critic **操作性失败率**与 `AUTO_PUBLISH_ELIGIBLE`（矩阵 A 诚实路径）通过率。

| 项 | 值 |
|---|---|
| provider / model | `deepseek` / `deepseek-flash` @ `https://api.deepseek.com` |
| role budgets | triage 2,400 / analysis 8,000 / **critic 6,000** |
| role `timeoutMs` | 30,000（即代码 clamp，探针断言其成立） |
| 候选 | 阶段 1 T6 放行的 4 条正样本 |
| 结构 | 每矩阵 10 replicate × 4 候选，按 **5 replicate/块** 分块（规避 N8），每块一个**全新进程** |
| 探针预算 | `maxLlmTokens: 40,000`（刻意高于生产的 33,000：本探针测的是 deadline/token 行为，不希望预算短路伪装成被测的尾部） |

矩阵语义：

- **矩阵 A（诚实路径）**：真实 `qualificationGate` → triage → analysis → critic → `deterministicPublicationGate`。**无任何强制准入**。这是唯一可以引用为通过率的数字。
- **矩阵 B（强制准入）**：仅把 `qualificationGate` 的返回值改为 `qualified: true`，其余全真。B 的**失败**有诊断价值，B 的**通过率绝不可引用**。

---

## 2. 结果

### 2.1 矩阵 A — 诚实路径

```
runs = 16
{"AUTO_PUBLISH_ELIGIBLE": 11, "NO_GAMBIT": 4, "FAILED": 1}
AUTO_PUBLISH_ELIGIBLE = 11/16 = 68.8%
```

| 候选 | 运行 | `AUTO_PUBLISH_ELIGIBLE` | `NO_GAMBIT` | `FAILED` |
|---|---:|---:|---:|---:|
| AI Scan for pull request APIs in public preview | 4 | **4** | 0 | 0 |
| Enterprise managed permissions for GitHub Copilot agent operations | 4 | **4** | 0 | 0 |
| GitHub Advanced Security expands trial availability | 4 | 0 | **4** | 0 |
| MAI-Code-1-Flash deprecated | 4 | **3** | 0 | 1 |

**`GitHub Advanced Security expands trial availability` 在 4/4 中都以 `NO_GAMBIT_WORTH_PUBLISHING` 结束。** 逐条核对 triage 的原始返回值后，成因是**确定性的 triage 判定**，不是 critic 失败，也不是准入门：

```
r1  eventImportance=0.25  aiTechRelevance=false  shouldDeepAnalysisRun=false  triageAttempts=1
r2  eventImportance=0.25  aiTechRelevance=false  shouldDeepAnalysisRun=false  triageAttempts=1
r6  eventImportance=0.25  aiTechRelevance=false  shouldDeepAnalysisRun=false  triageAttempts=1
r7  eventImportance=0.30  aiTechRelevance=false  shouldDeepAnalysisRun=false  triageAttempts=1
```

四条都判 `eventImportance` 0.25–0.30（**低于冻结的 `0.45` 阈值**）且 `aiTechRelevance=false`，理由都是「routine 试用资格扩展，无实质性 AI 技术或战略机制」。这是在 **LLM 阶段 1** 淘汰，`analysisCalls=0`、`criticCalls=0`——即 `AGENTS.md` 要求的「routine maintenance 应在 deep analysis 之前结束」的健康路径。

值得单独记录：**四次都花了 `triageAttempts=1`**，即第一样本判拒后触发了阶段 1.5 的有界 triage 重采样，重采样仍判拒（第 2 次调用后停止）。三个有界重采样边界在同一个候选上各司其职，且都没有把一次明确的「不」翻成「是」——这正是「重试只能升级、不能降级」在**未升级**方向上的正确行为。

### 2.2 矩阵 B — 强制准入（**不是通过率**）

```
runs = 15
{"AUTO_PUBLISH_ELIGIBLE": 12, "FAILED": 1, "NO_GAMBIT": 2}
```

### 2.3 critic 操作性失败率：N7 修复的核心数字

| 矩阵 | critic 调用 | 操作失败 | 单次失败率 | 失败类型 | 花费重采样 | 救回 | 仍失败 | **残余每 run 失败率** |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| A | 15 | 4 | 26.7% | **全部 TOKEN-WALL** | 3 | 2 | 1 | **1/12 = 8.3%** |
| B | 16 | 2 | 12.5% | **全部 TOKEN-WALL** | 2 | 2 | 0 | **0/14 = 0.0%** |
| **合计** | **31** | **6** | **19.4%** | — | **5** | **4** | **1** | **1/26 = 3.8%** |

**失败类型分布：6/6 全部是 token 墙（`finish_reason=length`），0 次 deadline。** 这与 T1 的诊断完全一致，并在 N7 修复后的代码上再次复现——修复没有改变失败的**性质**，只吸收了它。

有界重采样把 critic 的每 run 操作性损失从 **~19–27% 降到 3.8–8.3%**，符合 `p → p²` 的预期量级。

### 2.4 critic 成功调用的 latency

| 矩阵 | n | min | p50 | p90 | max | ≥24,000 ms（clamp 的 20% 内） |
|---|---:|---:|---:|---:|---:|---:|
| A | 11 | 5,352 | 15,438 | 19,902 | **23,331** | **0** |
| B | 14 | 7,213 | 16,918 | 22,689 | **26,338** | 1 |

矩阵 A 的最慢成功调用只有 **23.3 s**，**没有一个**进入 clamp 的 20% 以内——比 T1 时的 27% 明显更宽松，但仍确认 30,000 ms clamp 是有意义的边界，不是可以随意放弃的余量。

### 2.5 analysis 与 triage

- 矩阵 A：analysis 调用 **12/12 全部可用**，**0 次**首样本 `NO_GAMBIT`（`analysisAttempts = 0`）。阶段 1.6 的「首样本 NO_GAMBIT 仅 1/24」在这一轮进一步收敛为 **0/12**。
- 矩阵 B：analysis 17 次调用、16 次可用，2 次首样本 `NO_GAMBIT`（被有界重采样救回）。
- critic 判定：矩阵 A **accept 11 / reject 0**；矩阵 B accept 12 / reject 2。**critic 的判定不是丢候选的原因**——它在诚实路径上 11/11 接受。

### 2.6 成本

| 项 | 值 |
|---|---:|
| LLM 调用 | **97**（triage **37** + `gambit_analysis` **29** + critic **31**） |
| prompt tokens | 77,748 |
| completion tokens | 280,806 |
| **合计 tokens** | **358,554** |
| 估算成本 | **≈ $0.14**（按 cache-miss 输入 $0.28/M、输出 $0.42/M 计） |

T1 + T3 合计约 **$0.25**、约 500,000 tokens、约 150 次真实调用。

---

## 3. 与阶段 1.6 的对比

| 结论 | 阶段 1.6 | **阶段 1.7（N7 修复后）** | 需修正？ |
|---|---|---|---|
| **`AUTO_PUBLISH_ELIGIBLE`（矩阵 A 诚实路径）** | 6/21 = 28.6% | **11/16 = 68.8%** | **重大修正（向好）** |
| critic 操作失败率（单次调用） | ~35%（12 次中约 4 次截断） | **19.4%（31 次中 6 次）** | 修正（向好） |
| **critic 每 run 操作性损失（修复后）** | ~35%（无重采样） | **3.8%（1/26）** | **新指标：首次可测** |
| critic 失败形态 | 28.5–30.3 s，疑似 deadline 碰撞 | **6/6 全是 token 墙，0 deadline** | **重大修正**：Phase 1.6 的「deadline 碰撞」读数是 token 墙的**时长副作用**，不是 deadline 杀进程 |
| critic 判定拒绝率 | 有效裁决 13 次：accept 12 / reject 1 ≈ 8% | 诚实路径 accept 11 / reject 0；强制准入 accept 12 / reject 2 | 保持成立（拒绝率低） |
| analysis 首样本 `NO_GAMBIT` | 1/24 | **0/12** | 保持成立并进一步收敛 |
| analysis 可用率 | 24/24 | 矩阵 A **12/12**，矩阵 B 16/17 | 保持成立 |
| `AUTO_PUBLISH_ELIGIBLE`（矩阵 B，非通过率） | 12/20 | 12/15 | 仅供参考 |
| 「critic 约 1/3 失败不可由配置解决」 | 成立（推断） | **成立且已量化**：tokenBudget/`timeoutMs` 双 clamp 封顶，残余尾只能靠代码吸收 | **确认** |
| Phase 1.6 §3.5 的「部署前阻塞项：provider/model」 | 阻塞 | **已解除**：生产配置已切到 `deepseek-flash`（T4，用户授权） | **已解决** |

### 3.1 一条新的观察（阶段 1.6 未记录）

`GitHub Advanced Security expands trial availability` 在**诚实路径上 0/4 通过**，原因见 §2.1：triage 四次都判「routine，`eventImportance` 0.25–0.30、`aiTechRelevance=false`」。而在**强制准入下**（矩阵 B），triage 被覆写为通过，该候选进入 critic，critic 2/4 次以 unsupported-motive / weak-causality 拒绝它。

两条读数**互相印证**：该事件（把自托管 GHAS 试用扩展到更多 Enterprise Cloud 客户）确实是一个**分发/GTM 动作而非 AI 技术能力事件**，triage 与 critic 两道彼此独立的门得出了同一结论。这是健康信号，不是缺陷。

**一个必须诚实标注的限定**：矩阵 A 的 16 个 run 中，上述 4 个在 triage 阶段就结束，因此**没有**触达 analysis/critic/发布门。所以矩阵 A 的 11/16 里，真正走完「triage → analysis → critic → 确定性发布门」全链路的只有 12 个 run，其中 11 个 `AUTO_PUBLISH_ELIGIBLE`、1 个 `PROVIDER_EMPTY_RESPONSE`。以全链路分母表述即 **11/12 = 91.7%**，以全部 run 表述即 **11/16 = 68.8%**。两个数字都对，取决于分母是否包含被 triage 正确淘汰的 routine 候选；本报告两个都给出，避免挑选更好看的那个。

**另一个限定**：阶段 1.6 矩阵 A 的 6/21 无法逐条重算（本次未重新核对阶段 1.6 的原始探针数据），因此**无法确认**两者分母是否完全可比。可确认的是：同一代码路径、同一模型、同一预算下，`AUTO_PUBLISH_ELIGIBLE` 的**绝对数量与比例都显著上升**。

---

## 4. 结论

1. **N7 修复有效且方向正确。** critic 的操作性损失从 ~19–27%（单次）降到 **3.8%**（每 run，26 个 run 中 1 个），矩阵 B 上为 **0%**。
2. **修复没有放宽任何门。** 矩阵 A 的 11/16 全部经过真实 `qualificationGate`、真实 triage/analysis/critic 与真实 `deterministicPublicationGate`；`0.45` 阈值、`allowCanonicalFallback`、发布门均未触碰。
3. **修复没有改变失败的性质**：修复后 6 次失败仍然**全部**是 token 墙。这正是 T1 预测的——有界重采样吸收采样损失，但不改变模型的 reasoning 需求。
4. **残余 3.8% 是诚实的残余**，以 `PROVIDER_EMPTY_RESPONSE` 上报并被保留为失败，从未降级为发布。
5. **`GitHub Advanced Security` 的 0/4 是 triage 的成功，不是缺陷**；它证明 routine 分发类公告在 deep analysis 之前被淘汰，消耗 **0 次 analysis / 0 次 critic** 调用，并且其两次 triage 调用也正确地没有把明确的「不」翻成「是」。

---

## 5. 与本阶段不变量的符合性

- 未 deploy、未 apply migration、未改 cron、未改生产 secret、未写生产 D1/R2、未启动生产 Workflow、未发布任何内容。
- 探针默认 **skip**，`npm test` 不消耗任何 provider 额度。
- 探针从不传 `dependencies.repository`，因此 `recordLLMAttempt` 从不触发，不写任何存储。
- 未修改阶段 1/1.5/1.6 的任何冻结 fixture 行。
- 矩阵 B 的数字在探针输出中自带 **"NEVER a pass rate"** 标注，本报告亦如此标注。
