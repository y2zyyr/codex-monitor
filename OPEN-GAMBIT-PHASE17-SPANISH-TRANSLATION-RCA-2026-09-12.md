# Open Gambit 阶段 1.7 — Spanish translation 根因分析（RCA）

**日期**：2026-09-12
**分支**：`codex/open-gambit-phase17`
**结论**：**`OPEN_GAMBIT_PHASE17_TRANSLATION_VALIDATED`**
**生产**：**未改动**（本轮全程未部署）

---

## 1. Executive verdict

`es` 稳定出现 `TRANSLATION_SCHEMA_INVALID` 的**确定性根因已定位并修复**，且**四个 locale 已通过真实 provider + 真实 publication gate** 验证：**5 个独立 replicate 全部 4/4 `TRANSLATION_READY`**。

根因**不是**模型缺陷、不是语言质量问题、不是预算问题、也不是探针缺陷，而是**产品内部的契约不一致**：

> `gambitTranslationValidationErrors` 要求 `facts` / `beneficiaries` / `pressuredActors` **长度严格相等**，但 prompt **只对 `trajectories` 声明了这条规则**。

模型在写自然散文时把一条较短的 fact 合并掉了，`zh` 恰好保留两条而通过——这正是**只有部分 locale 暴露**该缺陷的原因。

修复方向严格遵守任务给定的优先级 1（修 prompt contract，不放宽任何 gate）。

---

## 2. Exact root cause

`src/open-gambit/publication.ts`：

- **验证器**（既有，未改）：`FACTS_COUNT_OR_TYPE` / `BENEFICIARIES_COUNT_OR_TYPE` / `PRESSURED_ACTORS_COUNT_OR_TYPE` 由 `textArray(record.facts, articleFacts.length)` 产生，要求**输出的数组长度 == 输入的数组长度**。
- **prompt**（修复前）只写：`The trajectories value must be an array with the same number and order as the input`。
  → 对 `facts` / `beneficiaries` / `pressuredActors` **只字未提**长度约束。

字段级诊断实测（真实 provider，真实 article，单次调用直接过验证器）：

| locale | `facts` 实际 vs 期望 | 验证器错误 |
|---|---|---|
| zh | 2 vs 2 | *（无）* |
| ja | 2 vs 2 | *（无）* |
| **fr** | **1 vs 2** | **`FACTS_COUNT_OR_TYPE`** |
| **es** | **1 vs 2** | **`FACTS_COUNT_OR_TYPE`** |

顶层 key 数 **12/12 全部正确**、标量字段无缺失、trajectory keys 完整——**结构其余部分完全合法**，唯一违规就是数组长度。

---

## 3. Why only `es` exposed it

不是 `es` 特殊，而是**散文越长、越容易把一条短 fact 合并进相邻句子**：

- `zh` / `ja` 的译文较短（contentChars 855 / 1199），两条 fact 都保留了；
- `fr` / `es` 的译文更长（2287 / 2285），模型倾向合并——于是长度变成 1。

因此这是**概率 + 文风**效应，`es` 只是最先、最稳定被观测到的那个。修复前的多次运行中，`es` 在 **2/2、3/3、2/2** 中**全部失败**；`fr` 也间歇失败。**这是一个会影响所有 locale 的缺陷，只是暴露顺序不同。**

---

## 4. Exact validator / path that failed

```
translateGambit()
  └─ for attempt in 0..1
       ├─ translationRequest(article, locale, role, { corrective: attempt === 1 })
       ├─ provider.complete(...)                 ← 真实 DeepSeek 调用
       ├─ gambitTranslationValidationErrors(value, locale, article)
       │    ├─ 标量字段缺失检查            → 通过
       │    ├─ textArray(facts, 2)         → ❌ 返回 1 → FACTS_COUNT_OR_TYPE   ← 失败点
       │    ├─ nativeTranslationQualityErrors(...)  → 通过
       │    └─ trajectory 一致性检查        → 通过
       ├─ isTranslationLanguageQualityError(error)?
       │    └─ 否 → failureCode = 'TRANSLATION_SCHEMA_INVALID'   ← umbrella code
       └─ recordLLMAttempt({ status: 'ERROR', errorCode: 'TRANSLATION_SCHEMA_INVALID' })
```

`TRANSLATION_SCHEMA_INVALID` 是**伞形码**，掩盖了底层的字段级 validator。locale readiness gate 随后把该 locale 标为 `TRANSLATION_FAILED`，整个 publication fail closed。

---

## 5. Raw failure classification counts

修复前（3 replicates，真实 publication 路径）：

| 分类 | 次数 |
|---|---:|
| **array parity mismatch (`FACTS_COUNT_OR_TYPE`)** | **3** |
| native-language quality failure | 0 |
| provider transport failure / empty response / invalid JSON | 0 |
| immutable-field mismatch | 0 |
| trajectory parity mismatch | 0 |
| missing key / wrong type | 0 |
| **合计 `TRANSLATION_SCHEMA_INVALID`** | **3** |

→ **100% 是 array parity mismatch。** 这是判定「根因唯一」而非「多种失败混合」的依据。

修复后同一路径的失败分类（5 replicates × 4 locales）：

| 分类 | 次数 |
|---|---:|
| language-quality（`ja`，均被 corrective retry 救回） | 4 次首样本 |
| **array parity mismatch** | **0** |
| 其它 | 0 |

---

## 6. Before / after behavior

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `es` 通过率（多次运行） | **0/2、0/3、0/2** | **5/5** |
| 首个 attempt 的 `attemptErrors` 数 | 每 run 4–6 次失败 | 每 run 0–1 次（`ja`） |
| 全 4 locale READY 的 replicate | 0/3 | **5/5** |
| publication 达到可发布态 | 否（`published=false`） | **是（`published={articleId,revisionId}`）** |
| 每 run translation 用量 | 16,000+ tokens | **16,000–20,000 / 32,000** |

---

## 7. Code changes

| 文件 | 改动 | 依据 |
|---|---|---|
| `src/open-gambit/publication.ts` | prompt 明确声明 `facts`/`beneficiaries`/`pressuredActors` 的长度与顺序必须与输入**完全一致**，禁止 merge/split/add/omit | 优先级 1：prompt contract 不明确 |
| `src/open-gambit/publication.ts` | prompt 增加「**每个** prose 字段与**每个**数组元素都必须真正翻译，不得逐字复制标题/句子；但产品名、公司名、缩写、标识符保留原形」 | 第二个实测缺口：模型把整条英文标题原样嵌入日文散文 |
| `src/open-gambit/publication.ts` | corrective 提示语由「failed the language-quality check」改为覆盖**质量与结构**两类失败，并明确「若数组变短或变长，恢复到输入长度与顺序」 | 原先对数组失败给出**错误的重试指令** |
| `src/open-gambit/llm.ts` | `DEFAULT_ROLE_CONFIG.translation.tokenBudget` `2_000 → 4_000` | 消除**已知坏**的静默 fallback |
| `src/open-gambit/budget.ts` | translation token 配额默认 `16_000 → 32_000`（`gambitBudgetFromEnv` 与 `normalizeBudgetLimits` 两处） | 与新 role budget 保持不变量一致 |
| `tests/open-gambit-translation-parity.test.ts` | 新增 8 例 | 见 §11 |
| `tests/open-gambit-translation-probe.test.ts` | 配额由 `BUDGET * 6` 改为 `LOCALES.length * MAX_TRANSLATION_ATTEMPTS_PER_LOCALE * BUDGET`；新增隐私安全的字段级诊断（可选）与 locale 过滤 | 消除 magic number 与重复知识 |
| `tests/open-gambit-prompt-provenance.test.ts` | 冻结指纹 `bffe71fb → f6c34a28`，并记录原因 | 冻结表按设计拦住了 prompt 改动 |
| `tests/open-gambit-translation-budget.test.ts` / `tests/open-gambit-budget-fail-closed.test.ts` | 默认值期望 `16_000 → 32_000`；corrective marker 跟随新措辞 | 默认值变更的连带修正 |

**未改动**：`deterministicPublicationGate`、`0.45` 阈值、`allowCanonicalFallback`、locale completeness 要求、任何其它 role 的 budget、`gambitTranslationValidationErrors` 的任何判定逻辑。

---

## 8. Probe / config drift audit

| 表面 | translation role budget | translation token quota | calls |
|---|---:|---:|---:|
| `wrangler.jsonc` | 4,000 | 32,000 | 8 |
| `wrangler.staging.jsonc` | 4,000 | 32,000 | 8 |
| `wrangler.example.jsonc` | 4,000 | 32,000 | 8 |
| `wrangler.staging.example.jsonc` | 4,000 | 32,000 | 8 |
| `src/open-gambit/llm.ts`（默认） | 4,000 | — | — |
| `src/open-gambit/budget.ts`（默认） | — | 32,000 | 8 |

**发现的漂移（已修）**：

1. `tests/open-gambit-translation-probe.test.ts` 中的 `TRANSLATION_BUDGET * 6` —— **错且重复知识**（真实最坏情况是 × 8）。已改为从 `LOCALES.length × MAX_TRANSLATION_ATTEMPTS_PER_LOCALE × TRANSLATION_BUDGET` 派生。
2. `tests/open-gambit-role-budget.test.ts` 中残留字面量 `4 * TRANSLATION_ATTEMPTS_PER_LOCALE * roleBudget` —— 已改为用已声明的 `TRANSLATION_LOCALES` 常量。
3. `DEFAULT_ROLE_CONFIG.translation.tokenBudget = 2_000` —— 见 §9。
4. `budget.ts` 两处 `16_000` 默认 —— 见 §9。

**注意**：`probe` 的 locale 过滤与 `TRANSLATION_QUOTA` 派生上曾出现一次时序错误（`LOCALES` 在 `TRANSLATION_QUOTA` 之后声明 ⇒ TDZ `ReferenceError`），已修正为 `LOCALES` 先声明。该错误只影响探针，且被探针自身的 collect 失败立即暴露。

---

## 9. Default-role fallback audit

**runtime config precedence**（`getGambitModelRoleConfig`，`src/open-gambit/llm.ts`）：

```
env.GAMBIT_MODEL_ROLES_JSON 缺失 / 非法 JSON / 非对象  → 直接返回 DEFAULT_ROLE_CONFIG（★）
逐 role 合并：某 role 未出现在 JSON 中的              → 保持该 role 的 DEFAULT_ROLE_CONFIG（★）
  tokenBudget: boundedNumber(record.tokenBudget, role.tokenBudget, 100, 8_000)
                                       ^^^^^^^^^^^^^^^^^ 缺失时回落到默认
```

★ = 会静默落入默认值的路径。**调用方**：`DEFAULT_ROLE_CONFIG` 在 `src/` 内**只有 1 处引用**（`getGambitModelRoleConfig` 内部），因此改动它的影响面就是所有 role-config 消费者，安全。生产/暂存/模板四个配置都显式声明了 translation，所以线上**当前**不受影响——但这正是「部分配置的部署会静默不可发布」的风险。

**处置**：`2_000 → 4_000`，并同步 `budget.ts` 的配额默认 `16_000 → 32_000`。

**为什么配额默认也必须动**：`consume()` 在每次尝试前按**声明预算**预扣。若只把 role 默认提到 4,000 而配额仍为 16,000，则 `4,000 × 2 locales × 2 attempts = 16,000` —— **只有 2 个 locale 能被资助**，其余 fail closed。两者必须同时移动，且已由测试钉住。

---

## 10. Budget / quota invariant

```
maxTranslationLlmTokens >= LOCALES × MAX_TRANSLATION_ATTEMPTS_PER_LOCALE × translationRoleBudget
        32,000        >=        4        ×                  2                   ×        4,000     = 32,000  ✓
```

$4,000$ 的余量（修复后实测）：

| 指标 | 值 |
|---|---:|
| observed min completion | 383（zh） |
| observed max completion | 607–718（ja/es） |
| 诊断直连观测峰值 | 982 |
| **budget headroom** | **4.1×–10×** |
| 每 run 实际用量 | 16,000–20,000 / 32,000 |
| worst-case quota | 4 × 2 × 4,000 = **32,000 = quota（余量 0）** |

**结论：4,000 足够，不上调。** 实测峰值 982 tokens，4,000 提供约 4 倍余量。配额最坏情况余量为 0，是**刻意**的——它正好等于重试上限允许的最坏路径，且由 `tests/open-gambit-role-budget.test.ts` 与该不变量断言保护。

---

## 11. Real provider replicate table

**配置**：`deepseek` / `deepseek-flash` / budget 4,000 / quota 32,000 / timeout 60,000 ms
**路径**：真实 `runGambitStages`（上游确定性 mock）+ 真实 `publishQualifiedGambit`（真实 provider / 真实验证 / 真实 locale gate）
**`allowCanonicalFallback`：从不传入**

| replicate | zh | ja | fr | es | translation | published | calls | tokens | attemptErrors |
|---|---|---|---|---|---|---|---|---|---|
| 1 | READY | READY | READY | READY | `TRANSLATION_READY` | ✅ | 5 | 20,000 | ja 首样本失败（救回） |
| 2 | READY | READY | READY | READY | `TRANSLATION_READY` | ✅ | 5 | 20,000 | ja 首样本失败（救回） |
| 3 | READY | READY | READY | READY | `TRANSLATION_READY` | ✅ | 5 | 20,000 | ja 首样本失败（救回） |
| 4 | READY | READY | READY | READY | `TRANSLATION_READY` | ✅ | 5 | 20,000 | ja 首样本失败（救回） |
| 5 | READY | READY | READY | READY | `TRANSLATION_READY` | ✅ | 4 | 16,000 | 无 |

**5/5 replicate 全部 4/4 `TRANSLATION_READY`，publication gate 推进到可发布态。**

`reasoningTokens` 在**真实 transport 的 usage 帧**中为 `null`（`usage.completion_tokens_details.reasoning_tokens` 缺席）——即 reasoning 确实关闭，**不是从 request options 推断**。采样落在 `stream: false` 的非流式响应上，usage 直接可读。

---

## 12. zh / ja / fr regression status

| locale | 修复前 | 修复后 | 备注 |
|---|---|---|---|
| **zh** | 通过（2/2） | **5/5 通过** | 无回归 |
| **ja** | 通过（此前） | **5/5 通过** | 首样本在 4/5 中触发 `JA_CROSS_LANGUAGE_SENTENCE_CONTAMINATION`，**均被 corrective retry 救回** |
| **fr** | **间歇失败**（parity） | **5/5 通过** | 与 `es` 同源，一并修复 |
| **es** | **稳定失败 0/2、0/3、0/2** | **5/5 通过** | **目标缺陷已消除** |

**`ja` 的残留行为（诚实标注）**：模型在**首次**尝试中 4/5 会把整条英文标题原样嵌入日文散文，触发语言质量规则。这是**正确的拒绝**——实测被标记句子的目标文字占比仅 0.22 / 0.38，确实是「大部分为复制来的英文」。现有 corrective retry 在本次 5/5 中**全部救回**，因此**全链路 5/5 通过**。

**若将来该形态不再被 retry 化解，它将成为新的 blocker**；本轮未观察到该情况，故不作断言。

---

## 13. Test results

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run lint` | ✅ PASS |
| `npm test` | ✅ **718 passed / 7 skipped, 0 failed**（58 files） |
| `npm run migration:parity` | ✅ `overall=true`、latest `0030_gambit_critic_attempts.sql` |
| `git diff --check` | ✅ clean |
| 探针默认 skip | ✅ `npm test` 零 provider 消耗 |

**新增测试（`tests/open-gambit-translation-parity.test.ts`，8 例）**——保护**不变量**而非 fixture 输出：

1. prompt 必须对 `facts`/`beneficiaries`/`pressuredActors`/`trajectories` **全部**声明 array parity（不只 trajectories）
2. prompt 必须禁止 merge/split/add/omit
3. **`es` 回归例**：`facts` 长度 1 vs 2 → 断言 `FACTS_COUNT_OR_TYPE`
4. `beneficiaries` / `pressuredActors` 长度违规同样被拒
5. 结构完整的西语 payload **通过**（证明规则只关于结构，不是针对西语词形）
6. prompt 必须要求「每个字段都真正翻译」，同时**允许**产品名/缩写保留原形
7. **反例**：整段复制英文 → `es` 触发 `ES_TARGET_LANGUAGE_DOMINANCE`、`ja` 触发 `JA_CROSS_LANGUAGE_SENTENCE_CONTAMINATION`（证明 gate 未被放宽）
8. translation 默认预算 == 4,000 且默认配额 ≥ 4×2×budget

---

## 14. Git SHA / branch / push state

```
branch : codex/open-gambit-phase17
HEAD   : 7ed6903  fix(open-gambit): state the translation contract the validator already enforced
```

相关 commit chain（**实际**，非推测）：

| SHA | 内容 |
|---|---|
| `da13a64` | `docs(open-gambit): record the blocking translation defect and its fix` |
| `7f3cdb0` | `fix(open-gambit): stop the translation role burning its budget on reasoning` |
| `e9da792` | `docs(open-gambit): record the first production Gambit run under the deployed code` |
| `8f24825` | `docs(open-gambit): record the Phase 1.7 production deployment` |

**关于 `5651dd2`（题目要求解释，不得猜测）**：

`5651dd2` 是 `7f3cdb0` **被 amend 之前的原始 commit**。证据：

- 两者 **parent 相同**（均为 `e9da792`）；
- 两者 **tree 完全相同**（`23d2bea5df98df5e484673c6ccf7527541c73059`）→ 内容一字不差；
- 两者 author date 相同（`Sat Sep 12 11:41:51 2026 +0800`）；
- `diff` 仅显示 **message** 差异：`5651dd2` 的 message 中所有反引号因 shell 命令替换被剥离（`content , finish_reason stop`、`records , and fails`），`7f3cdb0` 为用 heredoc 重新写成 `content ""`, `finish_reason "stop"`, `records "empty_response"` 的版本。
- `git merge-base --is-ancestor 5651dd2 HEAD` → **否**。

**结论**：`5651dd2` = **被 amend 掉的孤儿 commit（message-only 差异，代码内容完全相同）**，不在任何分支上，不是独立的一次工作。

---

## 15. Production untouched evidence

```
GET https://tibo.modelyard.dev/api/health
  commitSha     : 7bd7754140ae9a43ff981138a7dbe6ad7e4f81be   ← 本会话未变
  schemaVersion : 0030_gambit_critic_attempts
  status        : ok
  dbConnected   : true
```

本轮**未**执行：deploy、production migration、cron 变更、secret 变更、production D1/R2 写入、Workflow 启动、内容发布。

探针使用内存 repository（`createRecorder`），**不写任何 D1/R2**；`allowCanonicalFallback` **从未传入**；无 Workflow 被启动。

---

## 16. Residual risks

1. **`ja` 首样本污染（中等）**：4/5 首样本触发语言质量拒绝，依赖 corrective retry 化解。本次 5/5 全部救回，但这是一次**单样本单 article** 的测量；不同文章结构下的比例未知。
2. **配额最坏情况余量为 0（低）**：`quota == 4 × 2 × budget` 是精确值。若未来 role budget 上调而配额未同步，将 fail closed。已由测试钉住，但这是「刚好够」而非「有缓冲」。
3. **`es`/`fr` 修复基于单篇真实文章（中）**：验证只用了冻结语料中的 1 个真实 article。不同 fact 数量/长度的文章下，array parity 的达成难度可能不同（fact 越短越容易被合并）。**已通过 prompt 明确契约降低该风险，但未用多篇文章验证。**
4. **新增 prompt 措辞未经长期观察（低）**：prompt 变长，`gambit-translation-v1@f6c34a28`；冻结指纹已更新。
5. **生产仍不可发布（阻塞，已知）**：生产仍是旧 translation 配置（budget 2,000 / quota 16,000），修复**未部署**。失败为 fail-closed，**未公开任何坏内容**。

---

## 17. Deployment recommendation

**建议部署，但先做一次受控的 staging 验证。**

理由与顺序：

1. **本修复解决的是「完全无法发布」，不是「偶尔失败」**。生产当前 100% 无法完成任何 publication（translation role budget 2,000 已实测被 reasoning 吃光）。这是纯收益变更。
2. **四项已实测确认**：`es` 5/5、`fr` 5/5、`zh` 5/5、`ja` 5/5（全链路），`published` 在 5/5 中为真，`allowCanonicalFallback` 从未介入。
3. **风险已被限定**：变更只涉及 translation prompt 措辞、corrective 措辞、两个默认值与一处探针派生；验证器、发布门、阈值、其它 role 全部未动。
4. **建议顺序**（每一步独立授权）：
   a. 部署到 **staging**，跑一次真实全链路，确认 `ja` 的 retry 行为与生产形态一致；
   b. 同 SHA 部署 production；
   c. 只读 live 验证 + 首日 run 观察（重点看 `stage='TRANSLATION'` 的 attempt 与 error code）。
5. **若 staging 观察到 `ja` 的 corrective retry 未能救回**：**停止**，不要按「再放宽一点」的思路处理——那会触及语言质量门。届时应作为独立议题重新评估（例如是否把 retry 上限从 1 提高，那是成本决策而非质量决策）。

**本轮结束状态：代码、测试、commit 已完成；未部署；等待 operator 授权。**
