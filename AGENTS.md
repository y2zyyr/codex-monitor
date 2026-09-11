# ModelYard / `codex-monitor`

面向 Coding Agent 的规范操作手册。本文件适用于整个仓库。当前不存在嵌套的 `AGENTS.md` 文件。

## 事实依据、范围与工作方式

描述现有代码，而不是旧计划或期望中的未来系统。当不同来源不一致时，按以下顺序判断：

1. 当前 production 代码与部署/运行时配置；
2. 当前测试；
3. 当前 migrations 与 schema；
4. 当前 release/runtime 证据；
5. 近期已验证的报告；
6. 较早的架构文档；
7. 未经验证的请求或假设。

修改前先检查。保留不相关的 worktree 修改，区分观察事实与推断，优先最小且连贯的改动，并在请求范围完成后停止。如果审计发现代码缺陷，应报告；不得将其作为文档任务的一部分悄悄修复。

## 产品身份

产品层级如下：

```text
ModelYard
├── Tibo Codex Monitor
├── 阳谋 / Open Gambit
├── ModelYard Community
├── AI disclosure / methodology
└── future ModelYard products
```

ModelYard 是站点/产品品牌。Tibo 同时是 monitor 模块，以及被监控的公开 source/person/context（`@thsottiaux`）；`tibo.modelyard.dev` 是它的 hostname，不是整个站点的品牌。Tibo 不是整个网站的品牌；`tibo.modelyard.dev` 的 hostname 不改变整个产品属于 ModelYard 的事实。不得将整个站点称为“Tibo system”、“Tibo AI system”或“Tibo publication system”。Open Gambit 的中文显示名称是 `阳谋`。

## 架构地图

```text
Cloudflare Worker（Hono，`src/index.ts`）
├── Tibo monitor：X/web discovery → classifier → D1 events/reset lifecycle
├── ModelYard Community：public feed/posting → D1 → derived translations/embeds
└── Open Gambit：allowlisted sources → normalized R2 snapshots → D1 candidates
    → Cloudflare Workflow → bounded LLM stages → deterministic gate → publication
static/ 资源通过 Worker 的 ASSETS binding 提供。
```

| 区域 | 规范实现 |
| --- | --- |
| Worker 路由、scheduled handlers、资源 fallback | `src/index.ts`、`src/routes/` |
| 共享 brand/header/footer/navigation/status copy | `src/site-shell.ts` |
| Tibo rendering 与公开 event pages | `src/renderer.ts` |
| Tibo persistence/lifecycle | `src/db/repository.ts`、`src/confirmation.ts`、`src/utils/` |
| Open Gambit domain | `src/open-gambit/` |
| Community domain | `src/community/`、`src/routes/community.ts`、`src/routes/admin-community.ts` |
| Browser hydration | `static/app.js`、`static/community.js`、`static/open-gambit-admin.js` |
| Interface locale 与 route mapping | `src/i18n.ts` |
| D1 schema | `migrations/` |
| Release/build provenance | `src/provenance.ts`、`/api/health` |

## 唯一事实来源

- 共享公开 shell copy 由 `src/site-shell.ts` 负责。
- 站点 locale 集合与 route normalization 由 `src/i18n.ts` 负责。
- Gambit statuses、decisions、locales、probability buckets 以及公开 AI identity values 由 `src/open-gambit/types.ts` 负责。
- Gambit qualification、ranking 与 publication behavior 由 `src/open-gambit/eligibility.ts`、`policy.ts`、`selection.ts` 和 `pipeline.ts` 负责。
- discovery dispatch 与 Workflow boundaries 由 `src/open-gambit/service.ts` 和 `workflow*.ts` 负责。
- translation、immutable publication records 与 public projections 由 `src/open-gambit/publication.ts` 和 `repository.ts` 负责。
- `wrangler.jsonc` 与 `wrangler.staging.jsonc`（若本地存在）是按部署区分、被忽略的配置。被跟踪的 `wrangler.example.jsonc` 与 `wrangler.staging.example.jsonc` 是模板，不是已部署配置的证据。始终通过 `/api/health` 或经授权的只读 release 检查验证 live configuration。
- 仓库中的报告是带日期的证据，不是当前代码的权威。尤其是，描述公开 Gambit watching panel 或强制 human approval 的旧报告，已被当前 renderer/pipeline 取代。

## 共享 Site Shell 与 hydration 不变量

`src/site-shell.ts` 定义 `SITE_BRAND_COPY`、navigation labels、canonical paths，以及 `renderSharedHeader()`/`renderSharedFooter()`。Monitor、Community、Open Gambit、AI disclosure 和普通公开页面必须使用该 shell。不得为特定路由创建全局 brand、navigation、status labels、locale labels 或 footer 的副本。

Shared Site Shell 的 canonical source 是 `src/site-shell.ts`：

```text
`SITE_BRAND_COPY` → `renderSharedHeader()` → public routes
```

SSR 是共享 shell state 的 canonical source of truth（唯一事实来源）。`renderSharedHeader()` 在 `#liveBadge` 上输出 canonical 的逐 locale `data-state-*` labels；`static/app.js` 在 `badgeLabel()`/`updateLiveBadge()` 中读取这些 labels。Browser dictionary 可以为过期 cached HTML 提供防御性 fallback，但它不是第二个 authority，不得重新定义共享 copy/state。任何对 `static/app.js`、`src/site-shell.ts` 或共享 status behavior 的修改，都必须运行 `tests/shared-header-parity.test.ts`。

parity test 覆盖全部五个 locales 和 page families，并保护 canonical Chinese status `监控中`；不得重新引入 `正常监控`，也不得让 homepage、Community、Gambit、disclosure 与普通页面产生不一致。

## Open Gambit：产品与公开边界

Open Gambit 是一个编辑型分析产品，关注 AI 公司、模型、API、协议、开发者生态和产品竞争中可见的 strategic moves。其概念链是：

```text
Evidence → Gambit → Trajectory → Resolution
事实     → 阳谋   → 走势       → 验证
```

它不是阴谋论内容、谣言编造、泛泛 AI 新闻、强制每日评论，也不是 monitoring/pipeline dashboard。公开文章必须区分 `FACT`、`ANALYSIS`、`AI FORECAST`、`COUNTERCASE` 和 `WHAT WOULD CHANGE OUR MIND`。零发布结果是健康结果。

公开 landing page 仅提供编辑型内容：`阳谋`/Open Gambit 描述、`最新分析`/Latest analysis、已发布文章卡片，或克制的本地化空状态。公开产品 UI 与内部 observability 必须分离；不得仅因为 discovery funnel data 存在就暴露它。`gambit_discovery_stats`、run/candidate/workflow counts、source failures、raw/stale/malformed counts、internal scores、token budgets 和 LLM attempt details 都属于内部 diagnostics/admin data。`GambitLatestScan` 及相关 repository helpers 不是添加公开 dashboard 的许可。

## Open Gambit：发现与分析不变量

当前 production 形态如下：

```text
all enabled sources
 → bounded parallel fetch
 → parse/freshness/malformed filtering
 → deterministic strategic-substance eligibility
 → exact and cross-source event deduplication/corroboration
 → one global candidate pool and rank
 → one global Top-K
 → bounded expensive Workflow analysis
 → strict publication pipeline
```

整体原则必须保持为 `BROAD DISCOVERY` → `NARROW ANALYSIS` → `STRICT PUBLICATION`（广泛发现 → 有界分析 → 严格发布）。

以下 production values 已在当前本地 deployment configuration 中验证：

| 控制项 | 值 |
| --- | ---: |
| `GAMBIT_MAX_SOURCES_PER_RUN` | 14 |
| `GAMBIT_FETCH_CONCURRENCY` | 4 |
| `GAMBIT_MAX_HTTP_REQUESTS_PER_RUN` | 20 |
| `GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN` | `3, global` |
| `GAMBIT_MAX_LLM_CALLS_PER_RUN` | `8 per fresh Workflow budget` |
| `GAMBIT_MAX_LLM_TOKENS_PER_RUN` | `33,000 per fresh Workflow budget` |
| `GAMBIT_MAX_ITEMS_PER_SOURCE` | 3 |
| `GAMBIT_MAX_ITEM_AGE_DAYS` | 30 |

当前 registry 包含 14 个启用的 first-party sources（3 个 RSS sources 和 11 个 GitHub release feeds）。registry 由 `src/open-gambit/sources.ts` 解析并 allowlist；disabled 或 malformed entries 不得进入 run。如果 cap 低于 enabled count，则使用 deterministic rotation。不得退回到每天一个 source。内容不得导致抓取任意 follow-up URLs。

先去重 exact fingerprints，再对同一 strategic event 的 corroborating descriptions 进行 clustering。Ranking 必须是全局的，使用 strategic substance、event-family priority、source authority、recency 和 corroboration。昂贵分析上限 `GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN=3` 作用于整个 pool，是 `GLOBAL Top-K`，绝不是 `Top-K per source`，也绝不是每天一个 source。Routine items 即使其 source fetch/snapshot 可以被记录，也不得消耗 deep-analysis LLM calls。

`GambitRunBudget` 分为 `gambit_llm`、`gambit_translation`、`gambit_http`、`gambit_search`、`gambit_x` 和 `gambit_github` namespaces，并在耗尽时 fail closed。`gambit_translation` 是独立配额（默认 8 calls / 16,000 tokens）：translation 与 deep analysis 是同一 Workflow 内两个顺序阶段，共用一个 `GAMBIT_MAX_LLM_TOKENS_PER_RUN` 上限时，只要有一个 locale 需要既有的 corrective 第二次尝试就会让整次发布以 `GAMBIT_LLM_BUDGET_EXCEEDED` 失败。每个 Workflow 的合计最坏情况因此是 `maxLlmTokens + maxTranslationLlmTokens`。构造函数会把缺失/非正的 limit 归一化为文档化的默认值，绝不解释为“无上限”。在 production Workflow path 中，每个 Workflow 内部都会创建 fresh budget；global run-wide analysis bound 是已 dispatch 的 3 个 candidates。重新检查 orchestration 之前，不得假定名为 `*_PER_RUN` 的 environment variable 是跨全部 3 个 Workflow instances 的 single global LLM cap。

单候选（一个 fresh Workflow budget）的 token 账，按角色**声明**的预算预扣（`optionalStage` 在每次尝试前 `consume`，不是按实际用量）：

```text
最坏路径  triage 2,400×2 + analysis 8,000×2 + critic 6,000×2 = 32,800 tokens / 6 calls
最佳路径  triage 2,400   + analysis 8,000   + critic 6,000   = 16,400 tokens / 3 calls
```

`GAMBIT_MAX_LLM_TOKENS_PER_RUN=33,000` 必须覆盖**最坏**路径（余量 200），`GAMBIT_MAX_LLM_CALLS_PER_RUN=8` 覆盖 6 次调用。上限不足时该 candidate 以 `GAMBIT_LLM_BUDGET_EXCEEDED` fail closed，绝不降级。

三个 `×2` 分别是 triage、analysis 与 critic 的**恰好一次**有界重采样。critic 的重采样只针对**操作性失败**（见 N7），不针对判断性拒绝。

### critic 的操作性失败与有界重采样（N7）

critic 是确定性发布门之前的最后一次 LLM 调用，因此它在这里失败是最昂贵的位置：triage 已通过、analysis 已产出 QUALIFIED 与 trajectories，然后整次 run 以**没有任何裁决**结束。

Phase 1.6 测得 critic 在 3,000 下 11 次中 8 次截断，在 6,000 下 12 次中约 4 次截断。**Phase 1.7 T1 精确诊断了残余尾部**：在 critic 6,000 下，存活的失败**不是** deadline 撞墙，而是 **token 墙**——每一次都以 `finish_reason=length` 结束、`reasoning_tokens = completion_tokens = 6,000`、content 0–506 字节，即模型在预算耗尽时**仍在 reasoning，从未输出答案**。21 次调用中 5 次是这一形态，2 次是 deadline 被杀。判定性拒绝率不是问题：critic 对它能裁决的候选接受约 2/3。

**方向由证据决定，不是偏好**：

| 方案 | 对残余尾部的实际效果 | 结论 |
| --- | --- | --- |
| 提高 `tokenBudget` 到 8,000 | 测得成功调用已达 29.7 s（clamp 30,000 ms），8,000 会把 token 墙**转换成 deadline 墙**，并每次多付约 8 s | 无效 |
| 提高 `timeoutMs` clamp | 21 次里最多救回 2 次（9.5%），却改动**所有非 translation role** 的代码级上限 | 不划算 |
| **有界 critic 操作性重采样** | 单次失败率 p → p²（p≈0.33 时 33% → 11%） | **采用** |

因而不变量如下（与 0027/0029 同构，2026-09-11 实施）：

- 仅当 critic 返回**可用的裁决**失败时重采样；错误码 allowlist 恰好是**瞬时传输**结果：`timeout`、`network_error`、`stream_read_error`、`empty_response`、`invalid_structured_json`，以及任何 `http_*`。**未知错误码 fail closed**（不重采样）。
- **绝不**重采样判断性拒绝（`accepted=false` 带具体 concern）：那是策略判断，重roll 等于为判断题换一个答案，与政治排除不重采样同理。
- **绝不**重采样 `GAMBIT_LLM_BUDGET_EXCEEDED`：预算是**请求前**检查，耗尽的预算在下次调用仍然耗尽，重采样只会烧 wall clock 与 call 槽位。
- 重采样只能**升级**：失败或 schema 不可用的重采样**保留第一次的失败**，因此上报的 reason 始终是真正让该候选出局的错误。
- 计数写入 `gambit_candidates.critic_attempts`（migration `0030`），0 = 第一次尝试就已裁决（无论通过、拒绝还是成功）。

### LLM 角色预算与两个不可配置的上限（N6）

Role token budgets 是**模型属性**，不是风格偏好。在会先产出 `reasoning_content` 的模型上，答案只在 reasoning 之后输出；当 `tokenBudget` 低于 reasoning 需求时，`finish_reason=length`、content 为 0 字节，管线记 `empty_response`。这就是 N6：**配置失配，不是代码回归**。Phase 1.5/1.6 在 `deepseek-flash` 上的实测：

| 角色 | 预算 | 实测 reasoning tokens | 结果 |
| --- | ---: | --- | --- |
| triage | 2,400 | 159–1,966，偶发 ≥2,400 | 12 次中 1 次截断 |
| gambit_analysis | 4,000 | 3,000–4,000+ | 33 次中 26 次失败（N6 本体） |
| gambit_analysis | **8,000** | 1,791–5,143 | **24/24 可用**（Phase 1.6 两轮各 12 次） |
| critic | 3,000 | 可用者 1,840–2,545，其余 ≥3,000 | 11 次中 8 次截断 |
| critic | **6,000** | 可用者 618–4,985，其余 ≥6,000 | 12 次中 4 次截断 |

两个**无法由配置突破**的上限：

1. `tokenBudget` 的 clamp 上限是 **8,000**（`getGambitModelRoleConfig`）。
2. 非 translation 角色的 `timeoutMs` clamp 上限是 **30,000 ms**。critic 在 6,000 tokens 下实测有一次**成功**调用耗时 **29.4 s**，analysis 在 8,000 tokens 下实测最长 **27.1 s**；因此 critic 失败的形态在 3,000 时是 ~15 s 的纯 token 截断，在 6,000 时变成 **28.5–30.3 s 的 deadline 碰撞**（含一次硬 `timeout`）。

结论：`analysis 8,000` 与 `critic 6,000` 是配置能达到的实际上限，**不能再靠改变量上调**（6,000→8,000 需要 >30 s，会先撞 deadline）。残余的截断尾部（critic 约 1/3）只能靠**代码变更**解决——有界 critic 操作失败重采样，与既有的 triage/analysis 有界重采样同构，并同样遵守“重试只能升级、不能降级”。在授权前不得修改这两个 clamp，也不得修改 `provider/model`。

### 早期资格判定不是发布

Raw source falsifiability 不是 early hard gate。`qualificationGate()` 根据 evidence sufficiency 和 `strategicSubstance()` 判断是否值得进行昂贵分析；它的 `falsifiable` 值是 legacy diagnostic data。Evidence 必须包含一条至少 20 个字符的 non-discovery quote。

Routine maintenance 通常应在 deep analysis 之前结束，并尽可能在进入 LLM 之前淘汰，消耗 0 次 deep-analysis LLM calls：patch releases、dependency bumps、typo/formatting/docs-only changes、minor helpers、MIME enum changes 以及类似噪声。当前 strategic signals 包括 model launches、material capability 或 context changes、material price/access changes（包括 paid-to-free）、open-weight/open-source releases、interoperability/protocol changes、default distribution/bundling、acquisitions、major cloud partnerships、compute incentives，以及 forced API migrations/deprecations。扩展此列表前检查 `eligibility.ts`。

Phase 1 之后的匹配语义（`GAMBIT_ELIGIBILITY_RULES_VERSION = 'gambit-eligibility-v2'`）：

- `strategicSubstance()` 在**连续 clause 组成的滑动窗口**（`WINDOW_TARGET_CHARS = 320`）内匹配，而不是逐 clause。真实公告散文会把事件词与对象词分置两句（Phase 0 实测：12 条信号与 98 条真实语料零交集）。
- 信号分为 `PRECISE`（单独即可通过）与 `BROAD`（`DEVELOPER_PLATFORM_CAPABILITY`、`ACCESS_TIER_CHANGE`）。**BROAD 信号永不单独触发**：必须与同一窗口内的另一个信号共现，否则 `anthropic-sdk-python v0.124.0` 这类例行补丁会进入分析并烧预算。
- `0.45` 阈值、`deterministicPublicationGate` 与 `allowCanonicalFallback` 均未改动。Phase 1 只改匹配粒度与召回，不放宽任何 gate。
- sources 阶段在此之前还有一个 version-noise 前置过滤器（`isVersionNoiseItem()`）：pre-release 标题（nightly/canary/rc/alpha/beta/dev/stage）无条件丢弃；纯版本标题且正文 < 200 字符丢弃。被丢弃条目计入 `gambit_discovery_stats.version_noise_items`。
- 版本号语义：任何会改变准入判定的改动（信号规则、匹配粒度、噪声过滤器、`qualificationGate` 阈值）都必须递增 `GAMBIT_ELIGIBILITY_RULES_VERSION`，因为它是 candidate fingerprint 的输入，决定已拒绝条目能否被重新评估。

### 最终发布门

只有 deterministic/schema/policy gates 才能授予 `AUTO_PUBLISH_ELIGIBLE`；LLM 不得仅凭断言发布。当前路径必须同时满足：

- 有 grounded evidence 和 strategic mechanism；
- 针对 AI/technology relevance、evidence、importance 和 non-political scope 的 triage approval；
- structured facts、thesis、countercase，以及 independent critic；不得存在 unsupported-motive、weak-causality、sensationalism、political-framing 或 falsifiability concern；
- 1 至 3 条 trajectories，使用精确 probability bucket `20/30/40/50/60/70/80`，包含 future absolute deadline、evidence criteria 和 distinct falsifier；
- immutable canonical provenance，以及 `zh`、`ja`、`fr` 和 `es` 的 locale readiness。

`critic`、`falsifier`、`future deadline`、`trajectory`、`probability bucket`、`countercase`、`evidence grounding`、`political provenance`、`locale readiness` 和 `prediction immutability` 都是必须保留的不变量。

正常的 qualified path 会创建 auto-publish-pending draft，要求全部 target translations 通过 validation，然后通过 `publishAutomaticallyArticle()` 发布。Exceptional ambiguous/critic cases 进入 authenticated review queue。不得为了填充空页面而降低这些 gates。Translation 只能改写 prose；IDs、entities、evidence links、probabilities、deadlines、conditions 和 trajectory identity 必须来自 canonical English record。

### Workflow、provider 与 provenance 边界

Production/staging 必须配置 `GAMBIT_ANALYSIS_WORKFLOW` binding。Workflow IDs 按 candidate 确定，并且 start reservation/result writes 具有 idempotency。Inline fallback 只允许在明确 local opt-in 的 local execution 中使用。当前 Cloudflare entrypoint 在 five-minute timeout 下使用一次 `step.do()` 和一次 exponential retry；`src/open-gambit/workflow.ts` 中的 stage names 是该 step 内的 conceptual boundaries。

Deterministic work 包括 source validation/fetch bounds、snapshot hashing、political policy、strategic eligibility、dedup/ranking、schema validation、publication state transitions、translation semantic checks 和 resolution evaluation。LLM work 受限于 bounded triage、strategic analysis、independent criticism 和 translation。安全的 LLM provenance 记录 role、已知时的 actual provider/model、public identity、prompt version、request hash、status、usage、latency 和 bounded error code；绝不得存储或记录 prompts、response bodies、credentials 或 chain-of-thought。

## 政治安全与 provenance

Political detection 针对 political actors、elections/parties、geopolitics/war、ideology/culture-war、legislative conflict 和 government-only subjects，采用 deterministic、fail-closed 方式处理。Technology/regulatory context 可以作为事实背景，但不得将 political content 静默改标为 technology analysis。

`POLITICAL_TOPIC_EXCLUDED` 必须具备可审计的 provenance：`excluded=true`、至少一个非空 reason，以及来源 `DETERMINISTIC_POLICY`、`LLM_TRIAGE` 或 `HYBRID` 之一。pipeline 遇到 bare/malformed political boolean 时返回 `POLICY_STATE_INCONSISTENT`，而不是接受它；decision 必须通过 candidate record 持久化。绝不得制造或保留类似 `political_topic=0` 与 political exclusion decision 配对的 impossible state。只持久化受控的 rejection taxonomy，不得持久化 model free text 或拼接后的 gate-error strings。

## Tibo Codex Monitor

Tibo Monitor 是一个独立模块，跟踪公开的 `@thsottiaux` 信号，包括 Codex usage resets、rate limits、ChatGPT Work usage 以及 policy/product updates。它不访问 user accounts，也不修改 usage limits。必须将 Direct X/API 和 official evidence 与 indexed web evidence 区分开；公开 events 必须携带 source 和 verification status。

Monitor 运行于 `*/15 * * * *`。scheduled handler 会 ingest source posts，在 bounded budget 内完成分类，更新 reset-cycle state，并运行 translation backfill。direct source identity 必须是 canonical 的：direct X/API representation、account `thsottiaux`、platform `x`、匹配的 canonical post ID、精确的 `x.com/thsottiaux/status/<id>` URL，以及 non-indexed/non-rejected verification。

只有在 source/account/platform/post verification 通过，并且 post 包含 strong usage/reset phrase 与 broad user/plan scope 后，reset context 才可以补充 classifier result。明确的 non-Codex product language 优先。Weak 或不可信的 reset language 不是 Codex reset event。Deterministic completed-reset 与 narrowly defined direct soft-hint rules 可以覆盖 model drift 或 temporary classifier failure，但不得臆造 exact reset time。在 `src/utils/reset-source.ts` 定义的 bounded matching rules 内，Direct/official completion evidence 可以 supersede operator Telegram report。

## ModelYard Community

Community 在同一个 Worker 与 D1 chain 中实现：

+ `GET /api/community/posts` 暴露已批准的公开 posts，支持 cursor pagination 以及 topic/feature/GitHub filters。
+ Anonymous posting 必须由 server 通过 allowed origin、Turnstile、abuse HMAC secret、input limits、nickname reservations、duplicate/rate/spam checks 以及 public/pending status 进行 gate。只保留 HMAC-derived source hash，不保留 raw IP。
+ `POST /api/community/agent/posts` 是独立的 server-to-server trust boundary。Identity 来自 `src/community/identity.ts` 中的 allowlist（`Tibo Scout`、`Skill Hunter`、`Repo Hunter`、`Codex Watch`、`Lab Notes`）；clients 不得自行指定 agent identity。Agent defaults 受限为每 run 3 篇、每天 8 篇。
- Community admins 使用 authenticated `/admin/community/` boundary 进行 moderation 和 official announcements。Browser 不得选择 admin、agent 或 official roles。
+ GitHub cards 接受 canonical repository roots，并使用有界的 GitHub API metadata。Original post content 是权威来源；translations 和 embeds 是 derived cached data。Missing/failed translations 必须保留 original，并暴露 fallback state，而不是替换 source。

不得将 aspirational Community features 记录为已实现功能。

## 本地化与时区

canonical site/Gambit locales 严格为 `en`、`zh`、`ja`、`fr`、`es`。English 使用 unprefixed route；其他 routes 使用 `/zh`、`/ja`、`/fr` 或 `/es`。`SITE_HTML_LANG` 将中文映射为 `zh-CN`。server dictionaries 位于 `src/site-shell.ts`、`src/renderer.ts` 和 Gambit renderer 中；browser hydration dictionaries 必须完整且在语义上保持一致。

Default display time zones 按 interface locale 固定：English 和 Spanish 使用 `America/New_York`，Chinese 使用 `Asia/Shanghai`，Japanese 使用 `Asia/Tokyo`，French 使用 `Europe/Paris`。不得为了 canonical SSR meaning 而静默使用 device timezone。

UI localization 与 generated editorial translation 是两套不同系统。Monitor 的 English/Chinese fields 是 canonical，event translations 是 derived；Community 的 `original_content` 是 canonical，其 locale records 是 derived；Open Gambit 的 English 是 canonical，`zh`/`ja`/`fr`/`es` translations 必须通过 publication readiness/semantic gates。Renderer fallbacks 必须显式并带标记（`data-locale-fallback`）；不得使用未标记的 route-specific English inheritance 绕过 locale gate。修改 locale 或 shell code 时运行 `tests/locale-parity.test.ts` 和 shared-header parity test。

## 公开 AI 身份

访客可见的 identities 严格为：

```text
Claude Fable 5 · GPT-5.6 Sol · DeepSeek V4 Pro
```

这些是 presentation identities，不一定是 provider/model IDs。实际 runtime routing 来自 Gambit provider/model configuration 与 role overrides。必须保持 operational provenance 的真实性并将其分离；不得从 public identity 推导 routing，也不得在没有明确 product decision 时把 runtime ID 呈现为 public identity。

**runtime provider/model 决策（2026-09-11，Phase 1.7 T4，经用户授权）**：production 的 `GAMBIT_LLM_PROVIDER` / `GAMBIT_LLM_BASE_URL` / `GAMBIT_LLM_MODEL` 定为 `deepseek` / `https://api.deepseek.com` / `deepseek-flash`。

理由是**预算与实测模型必须一致**：Phase 1.6 的 role budget（analysis 8,000、critic 6,000）与 Phase 1.7 T1 的 N7 诊断全部是在 `deepseek-flash` 上测定的，而此前的部署变量仍指向 `opencode-go` / `mimo-v2.5`（Phase 1.5 之前的基线模型）。两者若不一致，生产就运行在一个**未测定的 (model, budget) 组合**上，这是部署前阻塞项。切换后，production 的 (model, budget) 组合与已测定的一致。

不得在没有明确 product decision 的情况下改动 provider/model，也不得把 runtime ID 当作 public identity。

## Cloudflare 与生产资源

规范基础设施是一套带静态 `ASSETS` 的 Cloudflare Worker、一个 D1 database、一个 private Gambit R2 snapshot bucket，以及一个 Cloudflare Workflow binding：

| 资源 | 当前 production 角色 |
| --- | --- |
| Worker `codex-monitor` | Hono application 与 scheduled handlers |
| D1 `codex-monitor-db` | Tibo、Community 与 additive Gambit schema |
| R2 `codex-monitor-production-gambit-snapshots` | normalized、content-addressed 的 private evidence snapshots |
| Workflow `gambit-analysis-production` | `OpenGambitAnalysisWorkflow` execution |
| domains | `tibo.modelyard.dev` canonical；`codex.modelyard.dev` legacy browser redirect |

当前 production schedules 是 Tibo `*/15 * * * *` 与 Open Gambit `30 2 * * *`。production-shaped values 是 `GAMBIT_SCHEDULE_ENABLED=true` 与 `GAMBIT_CRON_WINDOWS="30 2 * * *"`。每个 scheduled event 仍会调用 Tibo monitor 与 event translation backfill；只有在 `GAMBIT_SCHEDULE_ENABLED` 不为 false 且 cron 匹配 `GAMBIT_CRON_WINDOWS` 时，Open Gambit 才运行。

当前 production shape 不包含 KV、Queues、Durable Objects、Workers AI、AI Gateway、Vectorize、Browser Rendering 或 auxiliary Worker。

Staging 必须使用隔离的 Worker、D1、R2 bucket、Workflow name、secrets、source registry 和 deployment config。审计的 staging config 不使用 automatic cron，且 `GAMBIT_SCHEDULE_ENABLED=false`。绝不得让 local/staging 指向 production resources。

在 2026-09-09 audit 时，`git HEAD` 与 live `GET /api/health` 都报告了预期的 application SHA `2e887efdabc261006a005e0da747621c9982931d`。这是 audit observation，不能替代 release 时重新检查 SHA。Live health 还报告 `status: ok` 与 `dbConnected: true`。一次独立的只读 production D1 query 确认 `d1_migrations` 已到 `0025_gambit_discovery_stats.sql`，并发现 `gambit_discovery_stats` table。

health payload 的 `schemaVersion: "0024_gambit_political_provenance"` 不是 D1 migration state。`/api/health` 中由 `GAMBIT_CONFIG_VERSION` 得出的 `provenance.schemaVersion` 是 configuration/provenance marker（配置/溯源标记），不是 D1 migration state。`src/routes/api.ts` 调用 `buildProvenance(c.env)`，`src/provenance.ts` 从 deployment variable `GAMBIT_CONFIG_VERSION` 获取该 field（代码 fallback 为 `0021_open_gambit`）。验证 schema parity 时直接查询 D1 migration metadata；不得将这个 marker 解释为 live migration shortfall。

## 数据库与 migration discipline

Migrations 是 append-only。绝不得编辑已经应用的 production migration；应新增 numbered migration，检查 foreign keys/indexes/triggers，并在 release 前验证 parity。仓库当前包含截至 `0030_gambit_critic_attempts.sql` 的 migrations。

相关 contracts：

- `0021` 增加 Gambit domain tables。
- `0022` 增加 bounded Tibo classifier decision trace fields。
- `0023` 将 Gambit translation locales 扩展到全部五个 locales。
- `0024` 增加 political decision source/confidence provenance。
- `0025` 增加 internal discovery-funnel observability，不重写旧 rows；migration 之前的 history 是 NULL stats，不是 zeroes。
- `0026` 增加 Tibo classifier resilience fields。
- `0027` 增加 `gambit_candidates.analysis_attempts`：candidate 消耗的 bounded analysis 重试次数（0 = 第一次就决定）。它是 RETRY 计数，不是总尝试数。
- `0028` 增加 `gambit_discovery_stats.version_noise_items`：被 version-noise 前置过滤器丢弃的条目数，使 future 的 zero-pass run 能区分“source 没有发布战略内容”与“新过滤器丢掉了全部内容”。
- `0029` 增加 `gambit_candidates.triage_attempts`：candidate 消耗的 bounded triage 重采样次数。语义同 `0027`（RETRY 计数，不是总尝试数）。
- `0030` 增加 `gambit_candidates.critic_attempts`：candidate 消耗的 bounded critic **操作性**重采样次数（见 N7）。返回可用裁决的 critic 记 0，即使 critic 确实跑过。
- Gambit original predictions 是 immutable。Resolution events 与 corrections 必须 append-only 且有 evidence backing；保留 original statements、probabilities、targets、deadlines、hashes 和 provenance。

安全的 local checks 是 `npm run db:migrate:local`、`npm run migration:parity` 和 `node scripts/verify-gambit-migration.mjs`。`npm run migration:parity` 针对 fresh temporary database 运行 current-chain Gambit verifier，并检查 Gambit schema/immutability contracts；其 explicit assertions 覆盖关键的 `0021`/`0023`/`0024` contracts，报告的 latest migration 是 `0030`，并显式断言三个 retry counter 列（`analysis_attempts` / `triage_attempts` / `critic_attempts`）都存在于 fresh database（本地验证结果：`overall=true`、19 tables、18 indexes、0 foreign-key violations）。release 期间还要直接查询 production `d1_migrations` 与 `sqlite_master`；health `schemaVersion` marker 是独立的 `GAMBIT_CONFIG_VERSION` value。较早的 monitor `0019 → 0020` transition 由 `tests/migration-parity.test.ts`/`scripts/verify-migration-parity.mjs` 覆盖，而不是由该 package script 覆盖。`npm run db:migrate` 会应用 remote D1，是 production mutation：只能在明确授权的 release 中使用。

## 生产安全与凭据

在没有用户明确授权时，不得：

- `deploy production`；
- 执行 `production migration`；
- 修改 Cloudflare production variables；
- 修改 `Cron`；
- 手动触发 `production discovery`；
- 创建 `TEST_ONLY` production content；
- 修改 `publication threshold`；
- 修改 `LLM budget`；
- 修改 `provider/model`；
- 修改 `source registry`；
- 写入 production `D1`/`R2`；
- 为了“看到结果”反复运行 `pipeline`；
- 启动 production `Workflow`、发布 content 或修改 production secrets。

审计任务默认优先只读。不得随意 trigger production discovery、生成 `TEST_ONLY` production content、修改 cron schedules、source registries、LLM budgets、publication thresholds、provider/model configuration 或 secrets。除非用户明确授权该 mutation，否则不得 apply D1 migrations、写 production D1/R2、start production Workflow、publish content 或 deploy。

绝不得 print、echo、log、commit 或 copy secret values。使用 local `.dev.vars`、Wrangler secrets 或已配置的 secret store。父级 environment file 可能提供名称不同的 Cloudflare token（审计的 local setup 使用过 `CLOUDFLARE_TOKEN`）；如果 Wrangler 需要另一个变量名，只能在 process memory 中映射。绝不得将 token 或 secret value 放进本文件、reports、commands 或 test output。

## 发布纪律

规范 release sequence 是：

```text
audit → implement → focused tests → full local gates → clean candidate SHA
→ isolated staging migration/deploy → staging acceptance
→ same SHA production migration/deploy → read-only live verification
```

必须明确：本地测试 PASS ≠ production deployed；Staging PASS ≠ production deployed。只有真实 production Worker 已更新，并且 live site 已验证，才能声称 `production deployment complete`。

Local gates 按适当顺序执行：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run migration:parity
npm run open-gambit:demo
git diff --check
```

在完整 suite 之前，先为被修改的不变量运行 focused tests，例如相关的 Gambit discovery/eligibility tests、`tests/shared-header-parity.test.ts`、`tests/locale-parity.test.ts`、`tests/reset-hints.test.ts` 或 `tests/community.test.ts`。Local demo 使用虚构的 `TEST_ONLY` data，不得误认为 production content。

仓库中没有任何 script 能单独使 staging 或 production deploy 安全。使用经过 review 的 deployment-specific Wrangler config 和明确的 Cloudflare commands。Staging 必须先通过 acceptance checks，之后才能将完全相同的 commit 部署到 production。准备好的 Wrangler command、通过的 local tests 或通过的 staging 都不能证明 production deployment。Production claim 要求 live Worker 报告目标 SHA，并且 live routes 已检查。

在获得授权的 production deployment 之后，验证 `/api/health`、`/`、一个或多个 locale homepages、Open Gambit 及其 locale routes、Community 及其 locale routes、一个普通 monitor route（例如 `/latest/`），以及 `/about/ai/` 和一个 locale variant。检查 status、brand、shell parity、没有 `TEST_ONLY` 泄漏、正确的 empty/editorial state、适用时已发布 article 的可见性，以及相关 localized content。Local renderer test 不能证明 production UI 已改变。

不得声称 due Gambit forecasts 会自动 resolve：deterministic resolver 存在于 `src/open-gambit/resolution.ts`，但当前 scheduled handler 没有调用 `resolveDuePredictions`；修改 resolution operations 前必须先验证这一点。

## 必须保留的回归类别

Tests 与 review 必须继续覆盖以下 invariant classes，而不能只覆盖 happy-path rendering：

- shared header/status parity 与 five-locale parity；
- all-source discovery、per-source failure isolation、global event dedup、ranking 和 global Top-K；
- routine patch/dependency noise，以及 zero deep-analysis LLM calls；
- strategic-event 在不要求 source forecast text 的情况下进入 analysis 的能力；
- evidence grounding、final falsifiability、critic gate、translation readiness，以及 no-publication/empty-state behavior；
- 三个有界重采样各自的“只能升级、不能降级”语义，以及 critic 只对操作性失败重采样（判断性拒绝与 `GAMBIT_LLM_BUDGET_EXCEEDED` 绝不重采样）；
- political provenance consistency 与 fail-closed malformed decisions；
- Tibo direct-source verification、reset precedence 与 trusted-context rules；
- Community Turnstile/abuse controls、server-issued agent identities，以及 original-content/translation boundaries；
- migration parity、foreign-key integrity、Workflow idempotency，以及 immutable prediction/history records。

## 宣布任务完成前

确认只修改了请求范围；为每个受影响的不变量重新检查 canonical source of truth；运行 focused tests 和完整 gates；检查 `git diff --check`；确认没有 secrets 或 `TEST_ONLY` data 泄漏；区分本任务与 pre-existing worktree changes；如有 blocker，应报告，而不是臆造 deployment、migration、scheduling 或 publication 成功。
