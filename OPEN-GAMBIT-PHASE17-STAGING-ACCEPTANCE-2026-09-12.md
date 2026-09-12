# Open Gambit 阶段 1.7 — Staging 验收报告

**日期**：2026-09-12
**状态**：**已执行。staging 验收通过，但发现 1 个生产阻塞项（已修复）。未部署生产。**
**分支**：`codex/open-gambit-phase17`（已推送 origin）
**验收对象 SHA**：`f7de1e2ef6d8ed655619dc9c14f0ca93bbcb7676`
**staging 目标**：`codex-monitor-staging`（https://codex-monitor-staging.y2zyyr.workers.dev）

---

## 0. 执行摘要

| 结论 | 内容 |
|---|---|
| **staging 验收的净收益** | **发现并修复了生产阻塞项**：staging 的 `GAMBIT_LLM_API_KEY` 是对 `api.deepseek.com` **无效**的凭据（401）。这正是 staging 存在的意义——直接上生产会在第一次运行时 100% 失败。 |
| discovery 全链路 | ✅ 通过（14/14 sources，194 raw → 26 admitted，确定性准入正确拒绝全部 routine 条目） |
| Workflow → triage → analysis → critic | ✅ **通过**（真实调用，provider/model provenance 正确） |
| critic「判断性拒绝不重采样」 | ✅ **在生产代码路径上首次实测确认** |
| 预算余量 | ✅ 0 次 `GAMBIT_LLM_BUDGET_EXCEEDED` |
| 无泄漏 | ✅ 公开站点无 `TEST_ONLY`，正确空状态 |
| **translation → publication** | ⚠️ **未被触达**（无候选通过 critic），仍是未验证路径 |

---

## 1. 第 1 步：discovery 运行（cron 触发）

- 方式：临时武装 `triggers.crons = ["*/2 * * * *"]` + `GAMBIT_SCHEDULE_ENABLED=true` + `GAMBIT_CRON_WINDOWS="*/2 * * * *"`，部署后由真实 cron 事件触发**一次**，随即解除。
- `run_key` = `gambit-discovery:2026-09-12:*/2-*-*-*-*`（证明是真实 cron 事件，非手工入口）
- 结果：`status=COMPLETED`、`error_message=null`

```
sources_attempted 14   sources_succeeded 14   sources_failed 0
raw_items_observed 194  stale 79  malformed 1
admitted_items 26       version_noise_items 73
routine_noise_rejects 18
strategic_eligible 0    global_top_k_selected 0    workflow_dispatches 0
```

26 个 admitted 全部以 `LOW_STRATEGIC_VALUE` 结束。**我逐条核对了边界样本**，确认这是准入门正确工作，而不是门坏了：

| headline | 判定依据 |
|---|---|
| `Add VS Code Agents to Copilot usage metrics` | 使用报表里新增指标，无能力/接入/价格变更信号 |
| `Auto-resolution and analysis updates in Copilot code review` | 功能改进（自动 resolve 评论、生成 commit message） |
| `Piloting the world's first double-blind AI evaluations` | summary 仅 54 字符，无战略机制信号 |
| `Intelligent transcription with Gemini 3.5 Transcribe` | 常规能力改进，无战略机制 |
| `AlphaGenome Atlas: …` | 科研工具发布，非 AI 平台战略动作 |
| 其余 21 条（`v3.12.0`、`wrangler@4.131.1`、`create-cloudflare@2.72.7` …） | 纯版本发布 |

**零发布是健康结果**，且此处 0 次 workflow dispatch 是**正确**的：没有战略内容就不该烧 LLM 预算。

---

## 2. 第 2 步：Workflow 端到端（手工触发一次）

`strategic_eligible=0` 意味着 discovery **一次 LLM 调用都没有发起**，因此上面的运行**无法**验证 staging 的真正目的（真实 provider 路径）。为此做了一个**有界的**端到端验证：

- 用 `scripts/seed-open-gambit-staging-acceptance.mjs` 在 staging D1 种入 **1 个**候选（candidate id 54）。
- 证据**不是编造的**：快照文本逐字取自**冻结的** Phase 1 语料 fixture（`tests/fixtures/open-gambit/real-corpus-2026-09-11.json`）中的真实 GitHub Changelog 公告——即阶段 1.7 T3 在诚实路径上测出 `AUTO_PUBLISH_ELIGIBLE` 4/4 的那一条。**没有 `TEST_ONLY` 标记**。
- 脚本内置 **staging-only 守卫**，在任何写入**之前**断言目标配置声明的是 staging Worker 与 staging D1，且**未**绑定生产库。
- 然后**手工触发一次** `wrangler workflows trigger`（本阶段第 3 次、也是最后一次真实 workflow 调用）。

### 2.1 第一次触发：**发现生产阻塞项**

| field | value |
|---|---|
| `stage` / `role` | `TRIAGE` / `triage` |
| `status` | **`ERROR`** |
| `error_code` | **`http_401`** |
| `provider` | `unknown` |
| `model_id` | `null` |

staging 的 `GAMBIT_LLM_API_KEY` secret 对 `api.deepseek.com` **无效**。candidate 退回 `DISCOVERED`，workflow 未产出结果。

**这是本次 staging 验证最重要的产出。** 生产会以完全相同的方式失败：生产同样需要一把有效的 `GAMBIT_LLM_API_KEY`（Wrangler secret，本地任何文件中都没有）。**如果跳过 staging 直接上生产，第一次 Gambit run 会 100% 因 401 失败**，而且因为 `strategic_eligible=0` 时 discovery 不发 LLM 调用，这个错误甚至可能延迟数天才暴露。

处置：把 staging secret 轮换为已验证可用的 key（`wrangler secret put`，值经 stdin 传入，未落入 argv、文件、日志或 commit）。验证方式：`POST /chat/completions` → HTTP 200，`model: deepseek-flash`。

### 2.2 第二次触发：**端到端通过**

| stage | role | status | latency | provider | model_id | prompt_version |
|---|---|---|---|---:|---|---|
| TRIAGE | triage | **SUCCESS** | 4,131 ms | **deepseek** | **deepseek-flash** | `gambit-triage-v1@7e189e15` |
| ANALYSIS | gambit_analysis | **SUCCESS** | 18,391 ms | **deepseek** | **deepseek-flash** | `gambit-analysis-v1@8aaa1e73` |
| CRITIC | critic | **SUCCESS** | 22,900 ms | **deepseek** | **deepseek-flash** | `gambit-critic-v1@3eb0e79b` |

（表内另有第 1 次触发的 `http_401` 行，同一 candidate。）

最终：`status=REJECTED`、`rejection_reason=UNSUPPORTED_MOTIVE`、`triage_attempts=0`、`analysis_attempts=0`、`critic_attempts=0`。

**三个独立的关键确认**：

1. **真实 provider 路径可用**：triage → analysis → critic 三次调用全部成功，`provider` 与 `model_id` 两列都是正确填充的（未成功的那次是 `unknown`/`null`）——operational provenance 真实。
2. **critic 判断性拒绝不重采样，已在生产代码路径上实测**：critic 返回 `accepted=false`（motive concern），管线在**一次** critic 调用后即终止，`critic_attempts=0`。这正是阶段 1.7 T2 的设计——判断性拒绝是策略决定，不重 roll。之前只有单元测试证明它，现在有真实调用证明。
3. **预算余量充足**：`GAMBIT_LLM_BUDGET_EXCEEDED` 计数 = **0**，实测三次调用共约 18,400 ms 的推理时间、远未触及 33,000 tokens 上限。

### 2.3 验收标准逐项

| # | 标准 | 结果 |
|---|---|---|
| A1 | staging 变量与生产逐字一致 | ✅ provider/base/model/role budgets/33,000/translation quota 全部对齐 |
| A2 | 迁移水位达 `0030`，三个 retry counter 列存在 | ✅ `applied=30`、`latest=0030_gambit_critic_attempts.sql`、`retry_cols=3` |
| A3 | 健康端点报告目标 SHA、`dbConnected` | ✅ `commitSha=f7de1e2ef6d8…`、`schemaVersion=0030_gambit_critic_attempts`、`dbConnected=true` |
| A4 | 无 `GAMBIT_LLM_BUDGET_EXCEEDED` | ✅ 0 |
| A5 | 无 `POLICY_STATE_INCONSISTENT` | ✅ 无 |
| A6 | 无 `TEST_ONLY` 泄漏到公开路由 | ✅ `/zh/open-gambit/` HTTP 200、0 处 `TEST_ONLY`、正确空状态（`暂无`） |
| A7 | staging 未写生产资源 | ✅ 全程只操作 `codex-monitor-staging-db` / `codex-monitor-staging-gambit-snapshots` / `gambit-analysis-staging` |
| A8 | 无自动 cron 启用 | ✅ 验收后已还原为 `crons: []` + `GAMBIT_SCHEDULE_ENABLED=false` |

**观察项 B4 特别说明**：本次 critic 调用 `SUCCESS`、耗时 22,900 ms、**未出现 `timeout`**。也就是说**没有**观察到 T1 预测之外的失败形态，30,000 ms clamp 在本次真实调用中不构成瓶颈。（n=1，不足以推翻 T1 的 33% 单次失败率估计，但方向一致。）

---

## 3. 诚实标注：未验证的路径

| 项 | 状态 | 影响 |
|---|---|---|
| **translation → publication** | ⚠️ **未被触达**。没有候选到达 `AUTO_PUBLISH_ELIGIBLE`，因此 `translateGambit`（4 locales × 2 attempts，含 `GAMBIT_LLM_API_KEY` 与 translation role 预算）**从未真实执行** | 这是本次验收最大的残留风险。生产首次发布若 translation 有问题，不会在 staging 暴露 |
| critic 操作性重采样（N7 在真实链路上的行为） | ⚠️ 未被触达。critic 第一次就成功，因此重采样分支**没有真实执行** | 已有 17 个单元测试覆盖；真实链路未触发 |
| analysis 重采样 / triage 重采样 | ⚠️ 未被触达（`analysis_attempts=0`、`triage_attempts=0`） | 同上 |
| N8（单进程流式调用退化） | 未观察（本次 staging 只 3 次调用） | 与阶段 1.6 结论一致，仍不构成生产缺陷 |
| 自动 cron 下的真实日更 | 未观察（staging 无 cron；`30 2 * * *` 未到） | 需生产首日观察 |

**为什么不把这些路径也测掉**：唯一办法是放宽确定性准入门或发布门，或者凭空造一条会通过全链路的内容——两者都是 `AGENTS.md` 明确禁止的（「绝不为填空页面而降低门槛」）。**我没有那样做。** 这次的 0 发布与 0 translation 是真实门槛的直接后果，我选择如实报告缺口，而不是制造一次「好看」的通过。

---

## 4. 对生产部署的影响

### 4.1 必须先解决的阻塞项

**生产的 `GAMBIT_LLM_API_KEY` 必须验证有效。** staging 的那把无效，生产的**从未被验证过**（本地没有任何文件保存它）。部署前必须：

1. 只读验证生产 secret 可用（一次性 `curl` 探针，或按 staging 的做法轮换）；
2. 否则生产首日会以 `PROVIDER_HTTP_401` 全量失败。

### 4.2 已消除的风险

- ✅ provider/model 配置在真实链路可用（deepseek / deepseek-flash）
- ✅ 迁移链 `0027`–`0030` 在**真实远程 D1** 上 apply 成功（不只是 fresh temp db）
- ✅ 预算上限 33,000 在真实调用下有充足余量
- ✅ 判断性拒绝路径行为正确
- ✅ 无 `TEST_ONLY` 泄漏、无预算越界、无策略状态不一致

### 4.3 建议的部署顺序

1. 推送已完成（`codex/open-gambit-phase17` → origin）
2. **只读验证 + 必要时轮换生产 `GAMBIT_LLM_API_KEY`**
3. production D1 migration（实测生产水位 `0026`，待 apply `0027`–`0030`）
4. 更新 `wrangler.jsonc` 的 `BUILD_SHA` / `BUILD_TIMESTAMP` / `GAMBIT_CONFIG_VERSION` → 目标 SHA / `0030`
5. `wrangler deploy`（带出 33,000 上限、deepseek provider、显式 translation quota）
6. 只读 live 验证
7. **首日观察**：`30 2 * * *` 首次自动 run 后检查 `gambit_runs`、`gambit_llm_attempts`，特别是 translation 路径（本次唯一未验证段）

---

## 5. 附带发现（既存，非本次引入）

- **staging D1 中有 4 条 `TEST_ONLY` 文章**（`gambit_articles` id 1–4，全部 `status=REJECTED`，创建于 2026-09-04/05）。它们**不在公开站点可见**（公开页正确显示空状态），但存在于 staging 存储中。属于历史验证遗留，本次未改动。
- staging `gambit_predictions` 有 10 行，同源。
- staging 健康状态长期为 `degraded`，原因是 **Tibo monitor** 侧的 `TAVILY_API_KEY` / `X_API_BEARER_TOKEN` / 分类器凭据未配置（`not_configured`），与 Gambit 无关，属预期。

---

## 6. 本次对 staging 的实际改动（全部已还原或为隔离资源）

| 资源 | 改动 | 现状 |
|---|---|---|
| `codex-monitor-staging-db` | apply `0027`–`0030`；种入 1 候选 + 1 快照；写入若干 attempt 行 | 保留（迁移需保留；候选为真实证据） |
| `codex-monitor-staging` Worker | 部署新代码 + 新变量 | 已还原为不武装状态（`crons: []`、`SCHEDULE_ENABLED=false`） |
| `GAMBIT_LLM_API_KEY`（staging secret） | 轮换为有效 key | 保留（这是修复，不是临时改动） |
| production `codex-monitor` | **未改动** | 仍为 `4e937ce`、migration `0026` |
| production D1 / R2 | **未改动** | 未写入、未 apply |
