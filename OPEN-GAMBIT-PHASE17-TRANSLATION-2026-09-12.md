# Open Gambit 阶段 1.7 — translation 路径验证（首个阻塞级发现）

**日期**：2026-09-12
**状态**：**发现并修复了一个阻塞全部发布的生产缺陷。修复已提交但未部署。残留问题未解决，因此不得读作「translation 已验证」。**
**提交**：`5651dd2 fix(open-gambit): stop the translation role burning its budget on reasoning`

---

## 1. 为什么会有这次验证

生产部署报告把 `translation → publication` 列为**唯一在所有环境都未执行过的路径**。生产首日 run 的 `strategic_eligible=0` 意味着它**一次 LLM 调用都没发**，所以这条路径依然未被覆盖。

我没有等生产「首次真正发布」来暴露问题，而是写了一个**隔离探针**直接驱动它：

- `tests/open-gambit-translation-probe.test.ts`（默认 skip）
- 真实 `runGambitStages()`（triage/analysis/critic 用确定性 mock，因为它们的预算已测过）→ 真实 `publishQualifiedGambit()`（**真实 translation provider、真实 validation、真实 locale readiness gate**）
- repository 用内存记录器：**不写 D1、不写 R2、不启动 Workflow、不碰任何环境**
- **从不**传 `allowCanonicalFallback`，因此失败不可能静默降级成 canonical-only 发布

---

## 2. 发现：translation 在生产预算下**必然失败**，阻断全部发布

生产声明的 translation role 预算是 **2,000 tokens**（`GAMBIT_MODEL_ROLES_JSON`）。原始响应尾部（直接抓取，未经过管线）：

```
completion_tokens = 1959
reasoning_tokens  = 1736
content           = ""
finish_reason     = "stop"      ← 注意不是 "length"
```

**模型把整个预算烧在 reasoning 上，然后输出空内容。**

`finish_reason` 是 `stop` 而不是 `length` —— 这正是它从未看起来像 N6 的原因。管线看到 0 字节 content，记 `empty_response`，**四个 locale 全部失败**：

```
gate status = TRANSLATION_FAILED
errors = {"zh":"empty_response","ja":"empty_response","fr":"empty_response","es":"empty_response"}
```

**后果**：任何通过 critic 的候选都无法发布。这不是采样噪声（重采样无法解决），是确定性的预算不足。

**为什么此前无人发现**：这条路径从未在任何环境运行过。阶段 1.5/1.6/1.7 的探针都在 critic 之后停止；staging 验收的候选被 critic 拒绝；生产首日 run 在准入就终止。

### 提高预算**不足以**修复

在 6,000 下 reasoning 仍占 1,310–3,878 tokens，留给 12-key translation schema 的空间不足：

```
error codes = ["invalid_structured_json", ...] / ["TRANSLATION_SCHEMA_INVALID", ...]
```

---

## 3. 修复：translation 关闭 reasoning

translation 是**散文改写**，不是判断，reasoning 通道不产生价值。测量（同一 article、同一 prompt）：

| | 默认（reasoning 开） | `thinking:{type:disabled}` |
|---|---|---|
| completion tokens | 2,031–5,158 | **448–718**（小 7–10 倍） |
| latency | 9.2–21.4 s | **2.3–4.2 s** |
| 四个 locale 全部解析出 12 个 key | 否 | **是** |

实现：`src/open-gambit/llm.ts` 对 `request.role === 'translation'` 应用 `boundedCompletionOptions(this.options.baseUrl)`。

- 该 helper **对任何非 `https://api.deepseek.com` 的 base URL 都是 no-op**，因此不可能影响其他 provider；
- 它正是 Tibo classifier 与 Community translation 已经在用的同一 helper、同一理由；
- analysis / critic 角色**保留** reasoning。

### 配额也必须同步（第二个缺陷）

`gambit_translation` 是独立 fail-closed 配额，且 `consume()` 在**每次尝试前**按**声明**预算预扣。因此必须覆盖 `4 locales × 2 attempts × budget`，而旧的 16,000 覆盖不了。

| 项 | 旧值 | 新值 | 依据 |
|---|---|---|---|
| translation role `tokenBudget` | 2,000 | **4,000** | reasoning 关闭后实测峰值 982 tokens |
| `GAMBIT_MAX_TRANSLATION_LLM_TOKENS_PER_RUN` | 16,000 | **32,000** | = 4 × 2 × 4,000（重试上限允许的最坏情况） |
| `GAMBIT_MAX_TRANSLATION_LLM_CALLS_PER_RUN` | 8 | 8（不变） | 4 × 2 |

四个配置文件全部更新：`wrangler.jsonc`、`wrangler.staging.jsonc`、`wrangler.example.jsonc`、`wrangler.staging.example.jsonc`。

`tests/open-gambit-role-budget.test.ts` 现在断言**这个关系**（`4 × 2 × roleBudget ≤ quota`）而不是一个固定常量，因此预算与配额无法再静默失配。

> 顺带说明：这次是我的**自己的测试**先抓住了配额设错——我最初把 budget 提到 6,000 却只把 quota 提到 36,000，测试报出 `expected 48000 to be less than or equal to 36000`。这正是它该做的事。

---

## 4. 未解决：`es` 确定性失败

在修复后的配置（budget 4,000 / quota 32,000）下，2 个 replicate：

| replicate | zh | ja | fr | **es** |
|---|---|---|---|---|
| 1 | ✅ READY | ✅ READY | ✅ READY | ❌ `TRANSLATION_SCHEMA_INVALID` |
| 2 | ✅ READY | ✅ READY | ✅ READY | ❌ `TRANSLATION_SCHEMA_INVALID` |

**`es` 在 2/2 中确定性失败**，而 zh/ja/fr 全部通过。这与预算缺陷是**不同**的问题。

**我未能定位其根因，因此不做断言。** 已排除的：

- **不是**预算（`es` 的失败发生在 4,000 token 预算下，且 reasoning 已关闭）；
- **不是**配额耗尽（该 replicate 只用了 16,000/32,000）；
- **不是**我的探针 fixture（这次 article 由真实的 `composeDraft` 产出，数组长度与 validator 的 parity 要求一致——此前手搓 fixture 导致的 `TRANSLATION_SCHEMA_INVALID` 是**探针**问题，已修正）。

最可能的方向（**未验证的假设**）：validator 的 `nativeTranslationQualityErrors` 或 `gambitTranslationValidationErrors` 的某项字段/长度校验对西班牙语输出不成立。**要给出确定答案需要继续测量，我没有继续。**

---

## 5. 当前生产状态（重要）

**修复已提交到分支，但未部署。** 因此：

| | 状态 |
|---|---|
| 生产 Worker | 仍是 `7bd7754`（阶段 1.7 部署的那个） |
| 生产 translation 配置 | 仍是 **budget 2,000 / quota 16,000** → **translation 必然失败** |
| 生产可否发布文章 | **不能**（`TRANSLATION_FAILED` → fail closed） |
| 有没有坏内容被公开 | **没有**。失败是 fail-closed：不发布，而不是发布坏内容 |

**这不会造成运行期损害**：生产当前处于「零发布」状态，而这本身就是 `AGENTS.md` 认可的健康结果。但生产**目前不具备发布能力**，这一点此前无人知道。

---

## 6. 待决事项

1. **是否部署本修复？** 部署后 `es` 仍会失败，因此**发布依然会被阻断**——只是从「4 个 locale 全失败」变成「1 个 locale 失败」。所以：
2. **必须先解决 `es`。** 这是发布能力的真正门槛。
3. 是否授权我继续定位 `es`（需要约 10–20 次真实调用）。

我的建议：**先查 `es` 再部署**。现在部署只会把「完全不能发布」变成「仍然不能发布」，却多一次生产变更。

---

## 7. 本轮门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm test` | ✅ **710 passed / 7 skipped, 0 failed** |
| `npm run migration:parity` | ✅ `overall=true`、latest `0030` |
| 探针默认 skip | ✅ `npm test` 零 provider 消耗 |

**未部署、未碰生产、未写任何 D1/R2。**
