# Open Gambit 阶段 1.6 — N6 修复验证 + 配置修复 + 基线重跑

**日期**：2026-09-11
**分支**：`codex/open-gambit-phase16`（自 `93825ff` 起，detached HEAD 已转为分支）
**commit**：`bf97d51`(T1 探针) → `701302f`(延迟插桩) → `7f04f2a`(T2 配置) → `837ceef`(T3 探针) → `e695502`(T4) → 本报告
**授权边界**：本轮仅按 operator 明确授权执行 —— 修改 analysis `tokenBudget` 4000→8000、修改 critic `tokenBudget` 3000→6000、`GAMBIT_MAX_LLM_TOKENS_PER_RUN` 18000→28000、本地隔离环境真实 LLM 调用。
**未执行**：deploy、production migration、cron/secret/生产变量变更（除上述授权项）、写生产 D1/R2、启动生产 Workflow、发布内容。

---

## 0. 执行摘要

**N6 已解决，但它不是 analysis 专属问题——这是本轮最重要的发现。**

1. **方案 A 成立**：analysis `tokenBudget` 4,000 → 8,000 后，**24/24 次真实调用产出可解析裁决，0 个 provider 错误**（阶段 1.5：26/33 失败）。reasoning 实测 1,791–5,143，8,000 有约 3,000–3,300 tokens 余量。**8,000 足够，不需要更高。**
2. **N6 同样击中 critic**：critic 在 3,000 下 **8/11 截断**。原因与 analysis 完全同构 —— reasoning 吃光预算、`finish_reason=length`、content 0 字节。**阶段 1.5 「triage、critic 稳定通过，只有 analysis 系统性失败」的结论被 n=11 的数据否证**；那个结论建立在 critic 仅 3 次执行样本上。
3. **critic 3,000 → 6,000 有效**：矩阵 B 的 `AUTO_PUBLISH_ELIGIBLE` 从 **1/12 升至 8/12**；20 轮有效矩阵 B 中 12 次 `AUTO_PUBLISH_ELIGIBLE`。
4. **诚实路径（矩阵 A）首次产出可发布草稿**：有效 21 轮中 **6 次 `AUTO_PUBLISH_ELIGIBLE`** —— 真实 triage + 真实 analysis + 真实 critic + 真实确定性发布门，无任何强制准入。这是本项目测量史上第一次。
5. **新发现 N7 —— 第二个上限**：非 translation 角色的 `timeoutMs` 在代码里被钳制到 **30,000 ms 且无法由配置提高**。critic 在 6,000 tokens 下有一次**成功**调用耗时 **29.4 s**，analysis 在 8,000 下最长 **27.1 s**。两个上限同时成为瓶颈：**再提高 token 预算会先撞 deadline，因此配置层面已到顶。** 残余的 critic 截断尾部（约 1/3）只能靠代码变更（有界 critic 操作失败重采样）解决。
6. **新发现 N8（测量完整性）**：长时间运行的探针进程会累积退化 —— 在单个进程内累计约 25–35 次流式调用后，**所有后续调用都在 30 s deadline 上超时**。这污染了 T3 的第一轮执行（**矩阵 B 全部 24 轮无效，绝不可读作 0/24**）。换新进程后立即恢复正常（39 次调用 4 个错误），且生产 Workflow 每个实例最多 5 次 LLM 调用，因此**不是生产缺陷**，是探针必须分块运行的约束。
7. **零发布仍是健康结果**：以上全部是**测量**结论。本轮未放宽 `0.45` 阈值、未触碰 `deterministicPublicationGate`、未启用 `allowCanonicalFallback`、未改准入规则、未换源。

---

## 1. T1：N6 只读验证（方案 A）

### 1.1 探针与观测方法

新增 `tests/open-gambit-downstream-probe-phase16.test.ts`（默认 skip，需 `GAMBIT_PHASE16_PROBE=1`）。**仅矩阵 B**（强制准入，因为准入不是本轮目标），4 条 T6 放行正样本 × 3 次 = 12 轮。使用**真实生产客户端 `providerForRole()`**，不传 `dependencies.repository`（不写 D1/R2）。

**为什么必须注入 fetch tee**：生产客户端在结构化 JSON 完整到达后**正确地**立刻停止读取 SSE（N3 修复）并 `reader.cancel()`。而承载 `completion_tokens_details.reasoning_tokens` 的 `usage` 帧**在那一刻之后才到**，所以成功调用在结构上**永远读不到 usage**。探针因此注入一个 `tee()` 的 `fetchImpl`：一路保持客户端的原始分块时序，另一路独立读到结束，从而在任何结果下都能拿到 reasoning/completion tokens 与 `finish_reason`。实测证实了这一点：`usage present` 在未插桩的阶段 1.5 探针里是 **2/67**，在插桩探针里是 **35/35**。

### 1.2 reasoning token 分布（本次核心证据）

**T1：analysis 8,000 / triage 2,400 / critic 3,000**

| 角色 | 预算 | 调用 | reasoning tokens 实测 | `finish_reason` | 可用 |
|---|---:|---:|---|---|---:|
| **analysis** | **8,000** | 12 | 1,791 / 2,706 / 2,969 / 2,983 / 3,283 / 3,665 / 3,757 / 3,812 / 3,856 / 4,075 / 4,371 / 4,667 | 全部 `stop` | **12/12** |
| **critic** | 3,000 | 11 | 1,840 ✓ / 2,276 ✓ / 2,545 ✓ / **3,000 ×8** | 3 `stop` / **8 `length`** | 3/11 |
| triage | 2,400 | 12 | 159–1,966，一次 2,400 | 11 `stop` / 1 `length` | 11/12 |

**T1b：critic 6,000（其余不变）**

| 角色 | 预算 | 调用 | reasoning tokens（可用者） | 可用 |
|---|---:|---:|---|---:|
| analysis | 8,000 | 12 | 970–5,143 | 12/12 |
| **critic** | **6,000** | 12 | 618 / 1,620 / 2,633 / 2,786 / 3,531 / 3,579 / 3,962 / 4,985 | **8/12** |
| triage | 2,400 | 12 | — | 12/12 |

> **右删失**：截断样本的 reasoning 恰好等于其上限（3,000 或 6,000），即被上限截断，**真实需求只能确定 ≥ 该值**，无法测出具体数值。

### 1.3 终态与漏斗

| 配置 | 轮数 | `AUTO_PUBLISH_ELIGIBLE` | `FAILED` | 其他 |
|---|---:|---:|---:|---|
| T1（critic 3,000） | 12 | **1** | 9 | NO_GAMBIT 1、NEEDS_HUMAN_REVIEW 1 |
| T1b（critic 6,000） | 12 | **8** | 4 | — |
| 矩阵 B 合计（T1b + 诊断轮 8） | 20 | **12** | 7 | NO_GAMBIT 1 |

失败原因在 T1 中 **8/9 是 `PROVIDER_EMPTY_RESPONSE`（critic 截断）**，1 次是 triage 截断。T1b 中 4 次失败全部是 critic 在 6,000 上仍被截断。

> 口径说明：探针只跑 `runGambitStages()`，返回内存中的 draft，**不执行 translation、不写 D1、不发布**。因此 `AUTO_PUBLISH_ELIGIBLE` 在这里的含义是「确定性发布门通过了阶段级判定」，**不等于已发布**。

### 1.4 结论：方案 A 是否解决 N6？8,000 是否足够？

**是，且 8,000 足够。** analysis 24/24 可用、0 provider 错误、reasoning 峰值 5,143（余量约 2,857–3,209）。8,000 同时是 `getGambitModelRoleConfig` 的钳制上限，即**配置能表达的最大值**。

但 **8,000 不足以上下游端到端跑通** —— 瓶颈在 T1 中已经从 analysis 平移到 critic。因此本轮在获得授权后追加了 T1b（critic 6,000），得到 3.3 的结论。

### 1.5 对阶段 1.5 §1.5「关键不对称」的修正

阶段 1.5 用 n=3（矩阵 B 中 critic 仅执行 3 次）断言「triage、critic 稳定通过，只有 analysis 系统性失败」，并据此推断「原因不是预算太小，而是 analysis 的 reasoning 会膨胀」。

**n=11 的实测否证了该推断。** 正确的表述是：

> N6 的根因是**任何角色的 reasoning 都可能超过其 token 预算**。各角色的 reasoning 量级不同（triage 多数 159–1,966；critic 多数 ≥3,000；analysis 多数 3,000–5,000），因而**触发概率**不同。阶段 1.5 只看到 analysis 系统性失败，是因为**下游只有 analysis 有足够多的执行样本** —— critic 当时被 analysis 的失败挡在门外，只跑了 3 次。

### 1.6 探针自身的 bug（自捕获，已修）

第一版探针把「矩阵 B 强制准入」的 triage 覆盖**应用到了所有角色**，于是真实 analysis JSON 在进入 `normalizeAnalysis` 之前被替换成 triage 形状，管线返回 `PROVIDER_SCHEMA_INVALID` / `FAILED`。**症状（HTTP 200、合法响应、内容不可用）与 N6 一致，看起来像新根因（N7），实际是探针 bug。** 已修，并新增断言把覆盖次数钉死为「成功 triage 调用数」，防止再次泄漏。这条与 N3/N6 的关系同构，写进 commit message 是为了保留教训。

---

## 2. T2：N6 配置修复

### 2.1 变更（已授权）

| 变量 | 旧值 | 新值 |
|---|---|---|
| `GAMBIT_MODEL_ROLES_JSON.gambit_analysis.tokenBudget` | 4,000 | **8,000** |
| `GAMBIT_MODEL_ROLES_JSON.critic.tokenBudget` | 3,000 | **6,000** |
| `GAMBIT_MAX_LLM_TOKENS_PER_RUN` | 18,000 | **28,000** |

落地于 `wrangler.jsonc`（gitignored 的部署配置）与 `wrangler.example.jsonc`（受跟踪模板）。**`wrangler.jsonc` 不进 commit（被 gitignore），这是刻意的。**

模板侧另有两处改善：`GAMBIT_MODEL_ROLES_JSON` 由**空字符串**改为显式写入 audited 生产预算（空值会静默回落到 `DEFAULT_ROLE_CONFIG`，其 analysis 2,400 / critic 1,800 **低于推理模型所需**，正是 N6 的失配形态）；补上 `GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN: "3"`（全局 Top-K 不变量此前未在模板中声明）。

### 2.2 预算边界复核

`optionalStage()` 在**每次尝试前**按角色**声明**的 `tokenBudget` 预扣（`pipeline.ts:643`），不是按实际用量：

```text
最坏路径  triage 2,400×2 + analysis 8,000×2 + critic 6,000 = 26,800 tokens / 5 calls
最佳路径  triage 2,400   + analysis 8,000   + critic 6,000 = 16,400 tokens / 3 calls
```

- `26,800 ≤ 28,000`（余量 1,200）✅ 旧值 18,000 会让最坏路径以 `GAMBIT_LLM_BUDGET_EXCEEDED` **fail closed**。
- `5 ≤ GAMBIT_MAX_LLM_CALLS_PER_RUN=8` ✅ 调用数无需调整。
- `gambit_translation` 是独立 namespace（8 / 16,000），不参与此账；单 Workflow 合计最坏 `28,000 + 16,000 = 44,000`。

### 2.3 新发现 N7：第二个上限（30,000 ms deadline，不可配置）

非 translation 角色的 `timeoutMs` 被 `boundedNumber(..., 500, 30_000)` 钳制。实测：

| 角色 | 预算 | 实测延迟 |
|---|---:|---|
| analysis | 8,000 | 6.8 / 17.6 / **27.1** / 20.4 / 22.8 s |
| critic | 6,000 | **29.4 s（成功）** / 13.6 / 11.2 s |

**critic 失败形态随预算升高而改变**：在 3,000 时是 ~15 s 的**纯 token 截断**；在 6,000 时变成 **28.5–30.3 s 的 deadline 碰撞**（含一次硬 `timeout` at 30,016 ms）。

**结论**：`analysis 8,000` 与 `critic 6,000` 已是配置层面能到达的实际上限。6,000→8,000 需要 >30 s，会先撞 deadline。残余的 critic 截断尾部（约 1/3）**必须靠代码变更**解决，不能靠预算。

### 2.4 测试

新增 `tests/open-gambit-role-budget.test.ts`（10 例）：读取两个配置文件，钉住两个角色预算；断言**任何角色的配置值都不超过代码钳制上限**（超出会被静默**调低**，否则看起来"已应用"而实际测的是别的值）；断言所有 deadline 都在 30,000 / 60,000 ms 钳制内；断言单候选最坏与最佳路径都在上限内；断言受跟踪模板显式声明翻译配额。

### 2.5 未授权、因此**未改动**的项

| 项 | 说明 |
|---|---|
| `wrangler.jsonc` 的 `GAMBIT_LLM_PROVIDER` / `_BASE_URL` / `_MODEL` | **仍是 `opencode-go` / `https://opencode.ai/zen/go/v1` / `mimo-v2.5`。** 本轮所有预算是按 `deepseek-flash` 的 reasoning 量级测定的。**在授权切换之前，生产配置与测定配置不一致** —— 这是本轮最需要在部署前解决的前置项。 |
| triage `tokenBudget` | 保持 2,400（实测 12 次中 1 次截断，约 8%；提高会改变最坏路径账目，未获授权） |
| 两个代码钳制上限（8,000 / 30,000 ms） | 修改它们是代码变更，未获授权 |

---

## 3. T3：重跑下游基线

### 3.1 执行方式与污染（诚实标注）

阶段 1.5 探针的参数已提到环境变量（默认 4,000 / 3,000，**不加覆盖时仍逐字复现阶段 1.5 基线**）。T3 以 `ANALYSIS=8000 CRITIC=6000` 运行。

**第一次执行（48 轮 / 67 次调用）被 N8 污染**：
- 矩阵 A：前 13 轮全部正常；**自第 14 轮起每次调用都 `timeout`**。
- 矩阵 B：**24 轮全部 `PROVIDER_TIMEOUT`**，triage 从未完成 → 强制准入从未触发 → analysis 一次都没跑。**这 24 轮必须读作「无效」，绝不可读作 `AUTO_PUBLISH_ELIGIBLE` 0/24。**

换新进程补跑（16 轮 / 39 次调用，4 个错误）后恢复正常，且仍出现零星 timeout。两次运行合并后：

- **矩阵 A 有效 21 轮**（第一轮的前 13 轮 + 补充轮的 8 轮）
- **矩阵 B 有效 8 轮**（补充轮）+ T1b 的 12 轮 = **20 轮**

### 3.2 矩阵 A（诚实路径，无任何强制准入）—— 有效 21 轮

| 终态 | 次数 |
|---|---:|
| **`AUTO_PUBLISH_ELIGIBLE`** | **6** |
| `NO_GAMBIT` | 12 |
| `FAILED` | 3 |

- **analysis 产出可用裁决 9 次，全部 `QUALIFIED`**（阶段 1.5 矩阵 A 是 **0/24**）。
- critic 有效裁决 7 次：accept 6 / reject 1（3 次因 provider 错误未产出裁决）。
- **6 次 `AUTO_PUBLISH_ELIGIBLE` 走完真实 triage + 真实 analysis + 真实 critic + 真实确定性发布门**，没有任何强制。
- 3 次 `FAILED` 全部是 provider 层失败：2 次 critic 截断（`PROVIDER_EMPTY_RESPONSE`）+ 1 次 analysis 超时。
- 1 次 `NO_GAMBIT` 是 **critic 拒绝**：`CRITIC_UNSUPPORTED_MOTIVE` —— "The thesis attributes to GitHub the strategic motive ... but the supplied evidence ... does not state or demonstrate that intention."。**这是 critic 门在正常工作，不是缺陷。**

**triage 通过率（矩阵 A 有效样本）**

| 候选 | 类型 | `eventImportance` | triage 放行 |
|---|---|---|---|
| AI Scan for PR APIs | 正 | 0.55 ×3 / 0.62 | 4/4 |
| Enterprise managed permissions | 正 | 0.62 / 0.65 / 0.70 | 4/4 |
| GHAS expands trial | 正 | 0.20 / 0.25 ×2 / 0.20 | **0/4** |
| MAI-Code-1-Flash deprecated | 正 | 0.25 / 0.32 / 0.62 | 1/4 |
| Refreshed repository PR page | 负 | 0.20 / 0.32 | 0/2 |
| CodeQL 2.27.0 | 负 | **0.45** | **1/1（恰好踩线）** |
| [v1.31.0] Custom labels | 负 | 0.35 | 0/1 |
| Xcode 27 runner image | 负 | 0.30 | 0/1 |

- 正样本放行 **9/16（56%）**；负样本拒绝 **4/5**。
- **⚠️ 需修正阶段 1.5 的「负样本 0/12」**：本轮 CodeQL 2.27.0 的 `eventImportance` 恰好落在 **0.45**，通过 `0.45` 阈值进入 analysis，随后 analysis 判 `NO_GAMBIT`。**阈值边界上的假阳性是真实的**（阶段 1.5 的矩阵 B 里，唯一那条 `AUTO_PUBLISH_ELIGIBLE` 也是 CodeQL 2.27.0）。发布门兜住了它，但准入并未兜住。
- **⚠️ 阶段 1.5 的「prompt v2 系统性压低 `eventImportance`」仍然成立**：GHAS 4 次全部 0.20–0.25，MAI 3 次 0.25–0.62。两条 T6 正样本被 `0.45` 挡在昂贵分析之外。

### 3.3 矩阵 B（强制准入）—— 有效 20 轮

| 终态 | 次数 |
|---|---:|
| **`AUTO_PUBLISH_ELIGIBLE`** | **12** |
| `FAILED` | 7（全部为 critic 截断或 provider 失败） |
| `NO_GAMBIT` | 1（critic 以 `UNSUPPORTED_MOTIVE` + `WEAK_CAUSALITY` 拒绝） |

- **analysis：17 次可用裁决全部 `QUALIFIED`，0 次 `NO_GAMBIT`。**
- critic：13 次可用裁决 → **accept 12 / reject 1（拒绝率 ≈ 8%）**；7 轮因 provider 错误未产出裁决（**操作失败率 ≈ 35%**）。

### 3.4 与阶段 0 / 1.5 的对比表（含需修正项）

| 结论 | 阶段 0 | 阶段 1.5 | 阶段 1.6 重测 | 需要修正？ |
|---|---|---|---|---|
| analysis 翻转率 | ~50% | **无法测量**（矩阵 A 0/24 可用） | 矩阵 B **17/17 可用裁决全部 QUALIFIED，0 次 NO_GAMBIT**；首样本 NO_GAMBIT 仅 1/24（该次重试后升级为 QUALIFIED） | **需修正（重大）**：~50% 的翻转率在 8,000 预算下**不成立**（首样本 ≈4%）。阶段 0 的 50% 极可能主要来自 N6 截断与 reasoning 方差的混合，而非论点的真实非确定性 |
| critic 拒绝率 | 50%（n 极小） | 无法测（n=3） | 有效裁决 13 次：**accept 12 / reject 1（≈8%）** | **需修正**：约 8%，不是 50%。**真正吃掉候选的是 critic 的操作失败率（≈35% 矩阵 B / 3 次中 3 次矩阵 A），不是它的判断** |
| critic 执行次数 | 0 | 3/24 | 矩阵 A 有效样本中 7 次产出裁决；矩阵 B 13 次 | **需修正**：N6 修复后不再被 analysis 阻塞 |
| triage 通过率 | 1/4（未标注 N3 前后） | 正样本 8/24 次放行；负样本 **0/12** | 正样本 **9/16（56%）**；负样本 **拒绝 4/5，CodeQL 恰好 0.45 过关** | **需修正**：负样本「0/12」未能复现为 0 |
| prompt v2 压低 `eventImportance` | — | 负样本 12/12 ≤0.40 | 仍成立（GHAS 0.20–0.25、MAI 0.25–0.32），但存在 0.45 边界样本 | **保持不变（成立）**，边界需注意 |
| 「只有 analysis 系统性失败」 | — | 成立（n=3） | **否证**：critic 8/11 截断 | **需修正（重大）** |
| `AUTO_PUBLISH_ELIGIBLE`（矩阵 B） | — | 2/24 | **12/20** | **需修正（向好）** |
| `AUTO_PUBLISH_ELIGIBLE`（矩阵 A 诚实路径） | — | 0/24 | **6/21** | **需修正（首次非零）** |
| 阶段 1 T6 放行 4/98 | 未测 | 未测 | 未重测（本轮不改准入） | 不适用 |

**数据来源标注**

| 数据 | 来源 |
|---|---|
| 阶段 0 各项 | N3 修复前，阶段 0 自建非流式 provider |
| 阶段 1.5 各项 | N3 修复后，真实生产流式客户端，analysis 4,000 / critic 3,000 |
| 阶段 1.6 T1 / T1b / T1c | 真实生产流式客户端 + fetch tee，analysis 8,000 / critic 3,000 或 6,000 |
| 阶段 1.6 T3 | 同上；矩阵 B 与矩阵 A 均存在 N8 污染，**已按有效样本口径剥离** |

---

## 4. T4：阶段 1.5 §3.6 后续小任务

1. **`<<<FAILSHAPE>>>` 修复 —— 真实缺陷与报告描述的不同。**
   阶段 1.5 归因于去重键。去重键确实错了（`matrix|candidate|role` 使每个 replicate 之后都塌缩为 `{note:'already-captured'}`），但**主缺陷是调用方把 `captureFailureShape()` 返回的 Promise 未 `await` 就存了起来**，于是 `JSON.stringify` 把每一项都渲染成 `{}` —— 报告里那行是 **38 个空对象**，不携带任何信息。两者都已修（`await` + 键含 `replicate` 与 `seq`）。
   **真实验证**（把 critic 预算压到 600 强制制造失败）：输出现在含 `httpStatus` / `rawBytes` / `frames` / `contentChars` / `finishReason` / reasoning・completion・prompt tokens / `parsedOk` / `keys`。该捕获同时是 **N6 在第三个预算值上的独立确认**：critic 600 → `finish_reason=length`、`reasoningTokens=600`、content 0 字节。
   同一次运行还**端到端确认了 analysis 重试不变量**：analysis #1 返回 `NO_GAMBIT`，有界重采样 `timeout`，候选**保留第一次的有效 `NO_GAMBIT` 裁决**而非降级为 `FAILED`。
2. **fail-open 共享断言 helper**：新增 `tests/helpers/fail-closed-bounds.ts`。阶段 1.5 手工审计了两次同一缺陷类（budget namespace，然后 transport retry bound）；现在该类被通用钉死：任何缺失/非有限的输入都必须解析为有限且可用的 bound，并在契约规定处回落到文档默认值。`zeroIsValid` 覆盖「0 表示 disabled」的限值；`stringInputsOnly` 覆盖 `string | undefined` 的 env 解析器（其 `value.trim()` 会对非字符串抛错 —— 生产不可达，但会让审计以错误的理由失败）；`JSON_SAFE_*` 覆盖经 `GAMBIT_MODEL_ROLES_JSON` 到达的解析器（`JSON.stringify` 把 NaN/Infinity 编码为 `null`，在那里断言默认值会编码一个代码并不具备的契约）。已接入既有审计：**14 → 19 例**，覆盖全部角色的 `tokenBudget`/`timeoutMs`/`retryLimit` 与全部 budget namespace。
3. **显式写入 `GAMBIT_MAX_TRANSLATION_*`**：`wrangler.example.jsonc` **已声明**（8 / 16,000），新增的 role-budget 测试现在**断言它必须声明**，因此受跟踪模板不会再静默依赖代码默认值。
   **未做**（需授权）：gitignored 的 `wrangler.jsonc` 仍**未声明**这两个变量，依赖代码默认。今天行为完全相同；在那里声明属生产变量变更，列为待授权项（见 §10）。

---

## 5. T5：staging 验证计划

见 `OPEN-GAMBIT-PHASE16-STAGING-VERIFICATION-PLAN-2026-09-11.md`（**计划，未执行**）。摘要：

- **需 apply 的 migration**：`0027`、`0028`、`0029`（append-only；先只读确认 staging 当前水位，只 apply 缺失者）。
- **需修改的 staging 变量**：`GAMBIT_MODEL_ROLES_JSON`（analysis 8,000 / critic 6,000）、`GAMBIT_MAX_LLM_TOKENS_PER_RUN`（28,000）、显式 `GAMBIT_MAX_TRANSLATION_LLM_*`；**provider/model 仍待决策**。
- **一次性操作**：保持 `GAMBIT_SCHEDULE_ENABLED=false`，经 authenticated endpoint **手动触发一次** discovery（非 cron）。
- **观察**：`gambit_runs`、`gambit_discovery_stats`、`gambit_candidates`（`triage_attempts` / `analysis_attempts`）、`gambit_workflow_instances`、`gambit_llm_attempts`、`gambit_articles`。
- **验收**：`strategic_eligible > 0`、`workflow_dispatches ≥ 1`、`ANALYSIS` 出现 `SUCCESS`、`CRITIC` 至少出现一行、无 `PROVIDER_BUDGET_EXCEEDED`。**`gambit_articles` 是否 PUBLISHED 不作判据**。
- **需授权步骤**：apply migration、改 staging 变量、改 provider/model、部署 staging、触发 discovery —— 逐项列在 §1。

---

## 6. 全量门禁结果

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm test` | **PASS** — 51 文件通过 / 3 skip；**693 测试通过 / 5 skip**（阶段 1.5：50 文件 / 678 测试；本轮新增 `open-gambit-role-budget.test.ts` 10 例、fail-closed 审计 +5 例） |
| `npm run build` | **PASS**（dry-run） |
| `npm run migration:parity` | **PASS** — `latestMigration=0029_gambit_triage_attempts.sql`、29 migrations、19 tables、18 indexes、0 FK 违规、immutability 9/9 攻击被拒 |
| `npm run open-gambit:demo` | **PASS** — 2 测试 |
| `git diff --check` | **PASS**（干净） |

本轮 focused tests 在各任务提交前分别运行：`open-gambit-role-budget.test.ts`(10)、`open-gambit-budget-fail-closed.test.ts`(19)、`open-gambit-streaming-completeness.test.ts`(7)、`open-gambit-eligibility.test.ts`(45) 全绿。

**未触碰**：`0.45` 阈值、`deterministicPublicationGate`、`allowCanonicalFallback`、`eligibility.ts`、source registry、`0027`/`0028`/`0029`、冻结 fixture（`real-corpus-2026-09-11.json`、`prod-candidates-2026-09-11.json`）、生产 cron/secret、生产 D1/R2、Tibo 模块全部不变量（含 INDEXED 置信度钳制）。

**保留**：全部未跟踪文件、既有 `stash@{0}`、`.env`（gitignored）。

---

## 7. 成本

### 7.1 本阶段实验实际消耗

| 运行 | 调用数 | 估算/实测 tokens |
|---|---:|---:|
| 凭据冒烟（curl ×1） | 1 | ~0.2k |
| T1 单候选预检 | 2 | 8.0k（实测） |
| T1 主运行（12 轮） | 35 | **126.4k（实测）** |
| T1b（critic 6,000，12 轮） | 36 | **144.5k（实测）** |
| T1c（延迟测量，4 轮） | 13 | **47.6k（实测）** |
| T3 第一轮（48 轮，被 N8 污染） | 67 | ~100k（估算） |
| T3 补充轮（16 轮） | 39 | ~58k（估算） |
| T4.1 验证 | 6 | ~9k（估算） |
| **合计** | **~199** | **~494k** |

按 deepseek-chat 公开价（输入 cache-miss $0.28/M、输出 $0.42/M）粗估 **≈ $0.25**。`deepseek-flash` 的实际定价**未经核实**，因此该金额只作量级参考。阶段 1.5 报告记录其消耗约 141 次 / 195k tokens 作为对照。

### 7.2 N6 修复后的生产月度增量

分析按**最坏路径的声明预算**计算（每候选一个 fresh Workflow budget）：

| 项 | 阶段 1.5 配置 | 阶段 1.6 配置 | 月度增量（3 候选/天） |
|---|---:|---:|---:|
| 单候选最坏 tokens | 15,800 | **26,800** | +11,000 |
| 单候选最坏 calls | 5 | 5 | 0 |
| 每天（3 候选，全部走最坏路径） | 47,400 | **80,400** | **+33,000/天 ≈ +990k tokens/月** |
| 每天（3 候选，全部走最佳路径） | 35,400 | **49,200** | +13,800/天 ≈ +414k tokens/月 |

- **上界 +990k tokens/月**（仅当每天 3 个候选全部触发 triage 与 analysis 双重试时达到，实测罕见）。
- **更现实的下界 +414k tokens/月**。
- 这是**配额上限**的增量，不是实际消耗增量：实际只在候选被放行到昂贵阶段时消耗。
- 成本仍完全受 `GAMBIT_MAX_LLM_TOKENS_PER_RUN=28,000` fail-closed 约束，且 global Top-K 仍是 3 候选/run。

---

## 8. 新根因与开放问题

### N7 —— 角色 `timeoutMs` 的 30,000 ms 钳制成为第二个瓶颈（**已确认**）

非 translation 角色的 deadline 被代码钳制在 30,000 ms，**无法由配置提高**。critic 在 6,000 tokens 下实测**成功**调用 29.4 s，analysis 在 8,000 下最长 27.1 s。因此两个上限同时生效，`critic 6,000` 与 `analysis 8,000` 是配置层面的实际天花板。

**建议（需授权，属代码变更）**：
1. 把非 translation 角色的 `timeoutMs` 钳制上限提高（例如 60,000 ms），与 translation 对齐；**同时**相应调整 Workflow 内单 step 的时间安排。
2. **更有价值的是**：给 critic 加**有界操作失败重采样**（`empty_response` / `invalid_structured_json` / `timeout` 时重采样一次，与既有 triage/analysis 有界重采样同构，遵守「重试只能升级、不能降级」）。这直接针对残余的 ~1/3 尾部，成本为失败时 +1 次 critic 调用；对应地把最坏路径改为 `2,400×2 + 8,000×2 + 6,000×2 = 32,800`，需要上限 ≥33,000。

### N8 —— 长进程探针累积退化为 100% `timeout`（**机制未确定**）

**可复现的观察**：在单个 Node 进程内，累计约 25–35 次流式调用后，**所有后续调用在 30 s deadline 上超时**且不再恢复；换新进程立即恢复正常（39 次调用 4 个错误）。T3 第二轮与 T4.1 验证轮中也出现零星 timeout（后者在仅第 6 次调用上就发生），说明**还存在一个与进程寿命无关的间歇性 timeout 形态**。

**未确定**：是 undici 连接/流资源累积、还是 provider 侧限流表现为挂起。**本轮没有足够证据区分，不做断言。**

**为什么不是生产缺陷**：生产 Workflow 每个实例最多 5 次 LLM 调用、运行在新建的 Worker 实例中，不存在 25–35 次累积；且 timeout 在管线中被正确映射为 `PROVIDER_TIMEOUT`（fail closed，不降级）。

**影响与缓解**：这是**测量完整性**约束 —— 探针必须**分块运行（每进程约 8–12 轮）**，并且任何单进程长跑的结果在报告前必须先检查 timeout 比例。第 3.1 节正是这样处理的。

---

## 9. 未完成项与诚实标注

| 项 | 状态 | 原因 |
|---|---|---|
| **生产 provider/model 切换**（`opencode-go`/`mimo-v2.5` → `deepseek`/`deepseek-flash`） | **未执行** | 未获授权（属「修改 provider/model」）。**这是部署前必须解决的前置项**：本轮预算按 DeepSeek 测定，而 `wrangler.jsonc` 仍指向 mimo-v2.5 |
| `wrangler.jsonc` 显式声明 `GAMBIT_MAX_TRANSLATION_LLM_*` | **未执行** | 行为中性，但属生产变量变更，未获授权 |
| 矩阵 B 干净的 3×8 全量样本 | **未获得** | N8 污染；有效样本为 T1b（4 正样本 ×3）+ 补充轮（8 候选 ×1）。已按有效样本口径报告 |
| 阶段 0「50% 翻转中有多少是 N3 假象」 | **仍无法确认** | 需要 `opencode-go` / `mimo-v2.5` 凭据；本会话不可用 |
| 与阶段 0 的同模型对照 | **无法执行** | 同上 |
| critic 截断尾部的彻底消除 | **未解决** | 受 N7 两个上限约束，需代码变更（N7 建议 2） |
| 生产 D1 只读查询 | **未执行** | 本轮为本地验证，无需；`triage_attempts` / `analysis_attempts` 的真实写入只有受控 staging/生产运行才能观测 |
| 阶段 2（源结构再平衡） | **未开始，且不建议现在开始** | 下游已可用但仍有 ~1/3 critic 操作失败率；扩容源只会让更多候选死在那里 |

---

## 10. 结论与下一步

### 10.1 结论

1. **N6 已解决**（analysis 与 critic 两侧均已验证），**0.45 阈值、发布门、准入规则、source registry 全部未动**。
2. **可以进入 staging 验证**，但**必须先决定 provider/model**（§9 第 1 项），否则 staging 会用一个未测定的 (model, budget) 组合运行，结论无法解释。
3. **不建议立即进入阶段 2（源结构再平衡）**：下游虽已端到端可用，但仍有约 1/3 的 critic 操作失败率，且它受 N7 的两个不可配置上限约束。**先做 N7 建议 2（有界 critic 操作失败重采样）的授权与实现，收益大于扩容源。**
4. **受控生产运行前需要的三件授权**：provider/model 切换、有界 critic 重采样（代码）、`wrangler.jsonc` 翻译配额显式化。
5. **零发布仍是健康结果**：本轮**没有**为了填空页面降低任何门槛；`AUTO_PUBLISH_ELIGIBLE` 的增加来自修复截断，而不是放宽判定。

### 10.2 本阶段 commit 序列（每项独立、可单独回滚）

```text
bf97d51  test(open-gambit): add the opt-in Phase 1.6 N6 verification probe         (T1)
701302f  test(open-gambit): record per-call latency in the Phase 1.6 probe         (T1 补)
7f04f2a  fix(open-gambit): size the analysis and critic role budgets ...            (T2)
837ceef  test(open-gambit): parameterise the Phase 1.5 probe budgets ...           (T3)
e695502  test(open-gambit): repair the FAILSHAPE capture and share ...              (T4)
<本报告>  docs(open-gambit): record the Phase 1.6 N6 fix, the baseline redo ...      (T5)
```

> 两个探针文件默认 skip，不污染 `npm test`，且**不会**在常规测试中发起任何真实调用。
