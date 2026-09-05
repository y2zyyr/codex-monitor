// ============================================================
// Codex Usage Monitor - Classification Provider Interface
// ============================================================
export type { ClassificationProvider } from '../types';
import type {
  ClassificationOutcome,
  ClassificationResult,
  ClassificationSourceContext,
  SourcePost,
} from '../types';

export const CLASSIFIER_VERSION = 'tibo-classifier-v2';

export type SoftResetHintKind = 'RESET_BUTTON' | 'MILESTONE';

export interface SoftResetHintSignals {
  kind: SoftResetHintKind | null;
  score: number;
  hasProductContext: boolean;
  hasFutureIntent: boolean;
  hasMilestoneLanguage: boolean;
  hasDashboardLanguage: boolean;
  hasConservationLanguage: boolean;
  hasResetButton: boolean;
  matchedSignals: string[];
}

const PRODUCT_CONTEXT_PATTERN = /\b(?:codex|chatgpt\s+work|usage|quota|quotas|credits?|limits?|rate\s+limits?)\b|(?:用量|额度|配额|限额|速率限制|codex|chatgpt\s*work)/i;
const FUTURE_INTENT_PATTERN = /\b(?:tomorrow|soon|later(?:\s+today)?|next\s+(?:day|week|time)|in\s+the\s+future|upcoming|coming)\b|(?:明天|很快|稍后|下周|未来|即将)/i;
const MILESTONE_PATTERN = /\b(?:milestone|celebrat(?:e|ed|ing|ion)|achievement|big\s+day)\b|(?:里程碑|庆祝|成就|大日子)/i;
const DASHBOARD_PATTERN = /\b(?:dashboard|metrics?|active\s+users?|users?)\b|(?:仪表盘|指标|活跃用户|用户数)/i;
const CONSERVATION_PATTERN = /\b(?:hold\s+on\s+to|hang\s+on\s+to|save|keep)\s+(?:your\s+)?(?:codex|usage|credits?|quota|limits?)\b|\bhold\s+on\s+to\s+your\s+codex\b|(?:保留|节省|先别用|不要消耗)[^.!?\n]{0,24}(?:codex|用量|额度|配额|限额)/i;
const RESET_BUTTON_PATTERN = /\breset[\s-]+button\b|重置按钮/i;
const EXPLICIT_CODEX_PATTERN = /\bcodex\b/i;

/**
 * Extract the small set of semantic signals Tibo uses when he hints at an
 * upcoming reset without writing the word "reset".  A single word such as
 * "milestone" is deliberately insufficient: the post must also connect the
 * milestone to Codex/usage and a future-looking action.
 */
export function getSoftResetHintSignals(text: string): SoftResetHintSignals {
  const normalized = text.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  const hasProductContext = PRODUCT_CONTEXT_PATTERN.test(normalized);
  const hasFutureIntent = FUTURE_INTENT_PATTERN.test(normalized);
  const hasMilestoneLanguage = MILESTONE_PATTERN.test(normalized);
  const hasDashboardLanguage = DASHBOARD_PATTERN.test(normalized);
  const hasConservationLanguage = CONSERVATION_PATTERN.test(normalized);
  const hasResetButton = RESET_BUTTON_PATTERN.test(normalized);

  const matchedSignals: string[] = [];
  if (hasProductContext) matchedSignals.push('Codex/usage context');
  if (hasFutureIntent) matchedSignals.push('future timing');
  if (hasMilestoneLanguage) matchedSignals.push('milestone/celebration language');
  if (hasDashboardLanguage) matchedSignals.push('dashboard/metric context');
  if (hasConservationLanguage) matchedSignals.push('usage-conservation language');
  if (hasResetButton) matchedSignals.push('reset-button language');

  const score = (hasProductContext ? 2 : 0)
    + (hasFutureIntent ? 2 : 0)
    + (hasMilestoneLanguage ? 2 : 0)
    + (hasDashboardLanguage ? 1 : 0)
    + (hasConservationLanguage ? 2 : 0)
    + (hasResetButton ? 3 : 0);

  const hasExplicitFutureResetAction = hasResetButton && hasFutureIntent;
  const hasImplicitMilestoneHint = hasProductContext
    && hasFutureIntent
    && (hasMilestoneLanguage || hasConservationLanguage);

  return {
    kind: hasExplicitFutureResetAction
      ? 'RESET_BUTTON'
      : hasImplicitMilestoneHint ? 'MILESTONE' : null,
    score,
    hasProductContext,
    hasFutureIntent,
    hasMilestoneLanguage,
    hasDashboardLanguage,
    hasConservationLanguage,
    hasResetButton,
    matchedSignals,
  };
}

// keywordPrefilter is a priority hint only. It must not decide whether a
// source post is relevant: every newly persisted original post still enters
// the pending/classifier path in cron.ts. Word boundaries avoid false priority
// matches such as "pro" inside "products" or "improvements".
const CLASSIFIER_PRIORITY_PATTERNS: RegExp[] = [
  /\bcodex\b/,
  /\b(?:chatgpt\s+work|usage|quota|quotas|credits?|rate\s+limits?|limits?|reset)\b/,
  /\b(?:weekly|5h|5[-\s]?hour|paid\s+subscriptions?|plus|pro)\b/,
  /\b(?:compaction|computer\s+history|usage\s+(?:bug|issue))\b/,
  /\b(?:ship(?:s|ping|ped)?|launch(?:es|ed|ing)?|release(?:s|d|ing)?|roll(?:s|ed|ing)?\s+out|available|added|announced|upcoming|coming|soon|next\s+week|working\s+on|planning|planned|roadmap|feature|feedback|what\s+should\s+we|considering|exploring|idea|workflow|cli|ide|desktop|agent|model|tool|developers?)\b/,
  /(?:发布|上线|推出|更新|即将|很快|下周|路线图|功能|反馈|正在开发|计划|考虑|探索|工作流|工具|桌面|模型|代理)/i,
];

const CODEX_SCOPE_GATED_CATEGORIES = new Set<ClassificationResult['category']>([
  'RESET_PLANNED',
  'RESET_COMPLETED',
  'RESET_TIME_CHANGED',
  'POLICY_CHANGE',
  'CODEX_UPDATE',
  'ROADMAP_HINT',
  'FEATURE_DISCUSSION',
]);

/**
 * Every public Codex Timeline event must be explicitly Codex-scoped. This is
 * a defense-in-depth guard: the classifier prompt asks for the same result,
 * but admission must still reject non-Codex reset, policy, and product
 * categories if a provider returns them as relevant. Descriptive observations
 * are never public events merely because they mention Codex.
 */
export function isCodexProductSignalAdmissible(
  result: Pick<ClassificationResult, 'category' | 'product_scope' | 'statement_nature'>,
): boolean {
  if (result.statement_nature === 'OBSERVATION') return false;
  return !CODEX_SCOPE_GATED_CATEGORIES.has(result.category)
    || result.product_scope === 'CODEX';
}

export function keywordPrefilter(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  return CLASSIFIER_PRIORITY_PATTERNS.some(pattern => pattern.test(normalized))
    || getSoftResetHintSignals(normalized).kind !== null;
}

// Keep the rule-based IRRELEVANT gate deliberately tiny. Anything that is not
// an unmistakable empty/greeting-only post remains eligible for the LLM; in
// particular, absence of a keyword is never enough to discard a post.
const OBVIOUS_IRRELEVANT_PATTERN = /^(?:gm|good\s+morning|good\s+night|happy\s+(?:birthday|new\s+year)|congratulations)[!.…\s]*$/i;

export function isObviousIrrelevant(post: SourcePost): boolean {
  const text = post.text.trim();
  return text.length === 0 || OBVIOUS_IRRELEVANT_PATTERN.test(text);
}

export function buildObviousIrrelevantResult(post: SourcePost): ClassificationResult {
  return {
    relevant: false,
    category: 'IRRELEVANT',
    product_scope: 'OTHER',
    statement_nature: 'FACT',
    confidence: 0.99,
    title_en: '',
    title_zh: '',
    summary_en: '',
    summary_zh: '',
    effective_time: null,
    reset_time: null,
    reason: `The post contains no monitorable product or usage signal: ${post.text.trim() || 'empty text'}.`,
  };
}

function isDirectXPost(post: SourcePost): boolean {
  return post.canonical_platform === 'x'
    && post.source_quality !== 'INDEXED'
    && (
      post.source === 'x_api'
      || post.source_quality === 'DIRECT'
      || post.source_quality === 'OFFICIAL'
    );
}

function normalizedPostText(post: SourcePost): string {
  return post.text.toLowerCase().replace(/[’]/g, "'");
}

const TRUSTED_TIBO_ACCOUNT = 'thsottiaux';
const TRUSTED_X_URL_PATTERN = /^https:\/\/(?:www\.)?x\.com\/thsottiaux\/status\/(\d{5,30})\/?$/i;
const STRONG_RESET_PHRASE_PATTERN = /\b(?:full\s+)?banked\s+reset\b|\b(?:usage|quotas?|credits?|allowance|limits?|rate\s+limits?)\b[\s\S]{0,80}\b(?:reset(?:ted|ed)?|restor(?:ed|e)|renew(?:ed|e)|replenish(?:ed|e)|refresh(?:ed|e)?)\b|\b(?:reset(?:ted|ed)?|restor(?:ed|e)|renew(?:ed|e)|replenish(?:ed|e)|refresh(?:ed|e)?)\b[\s\S]{0,80}\b(?:usage|quotas?|credits?|allowance|limits?|rate\s+limits?)\b/i;
const BROAD_RESET_AUDIENCE_PATTERN = /\b(?:for|to)\s+(?:(?:all|every|each)\s+)?(?:users?|accounts?|subscribers?|customers?|members?)\b|\b(?:all|every|everyone)\s+(?:users?|accounts?|subscribers?|customers?|members?)\b/i;
const FUTURE_RESET_PATTERN = /\b(?:will|going\s+to|plan(?:ned)?|intend(?:ed)?|today|tomorrow|later|soon|end\s+of\s+day|upcoming|scheduled|coming)\b/i;
const COMPLETED_RESET_PATTERN = /\b(?:has|have|had|was|were|is|are|just|already)\s+(?:been\s+)?(?:fully\s+)?(?:reset(?:ted|ed)?|restor(?:ed|e)|renew(?:ed|e)|replenish(?:ed|e)|refresh(?:ed|e)|completed?|done|propagated)\b|\bfeeling\s+reset(?:ted|ed)?\b|\b(?:reset|usage|quotas?|limits?)\b[\s\S]{0,80}\b(?:propagated|completed?|done|restored|renewed|replenished|refreshed)\b/i;
const NEGATED_RESET_PATTERN = /\b(?:not|never|didn't|did\s+not|hasn't|has\s+not|won't|will\s+not|cannot|can't)\s+(?:be\s+)?(?:fully\s+)?(?:reset(?:ted|ed)?|restor(?:ed|e)|renew(?:ed|e)|replenish(?:ed|e)|refresh(?:ed|e))\b/i;
const NON_CODEX_PRODUCT_PATTERN = /\b(?:chatgpt(?:\s+work)?|sora|dall[-\s]?e|playground|openai\s+api)\b/i;

export function hasExplicitCodexReference(text: string): boolean {
  return /\bcodex\b/i.test(text);
}

export interface TrustedSourceContextEvaluation {
  trusted: boolean;
  sourceContext: ClassificationSourceContext;
}

/**
 * Trusted context is intentionally narrower than “the author is Tibo”. It
 * requires the canonical, direct X representation already used by the
 * monitor, the monitored account, and a URL/id match. This lets the context
 * supplement a missing Codex noun without turning arbitrary resets into
 * Codex events.
 */
export function getTrustedSourceContext(post: SourcePost): TrustedSourceContextEvaluation {
  const sourceId = post.source_post_id.trim();
  const urlMatch = TRUSTED_X_URL_PATTERN.exec(post.source_url.trim());
  const trusted = isDirectXPost(post)
    && post.source === 'x_api'
    && post.source_account.trim().toLowerCase() === TRUSTED_TIBO_ACCOUNT
    && post.canonical_platform === 'x'
    && post.canonical_post_id?.trim() === sourceId
    && urlMatch?.[1] === sourceId
    && post.verification_status !== 'INDEXED_ONLY'
    && post.verification_status !== 'REJECTED';
  return {
    trusted,
    sourceContext: trusted ? 'TRUSTED_CODEX_SOURCE_AVAILABLE' : 'UNTRUSTED_SOURCE',
  };
}

export interface StrongResetSignal {
  strong: boolean;
  hasStrongResetPhrase: boolean;
  hasAudienceContext: boolean;
  hasFutureIntent: boolean;
  hasCompletionLanguage: boolean;
  matchedSignals: string[];
  category: 'RESET_PLANNED' | 'RESET_COMPLETED' | null;
}

/**
 * A contextual reset must contain domain-specific reset language plus a
 * broad plan/user scope. “Reset” by itself is intentionally insufficient.
 */
export function getStrongResetSignal(post: SourcePost): StrongResetSignal {
  const text = normalizedPostText(post);
  const planMatches = text.match(/\b(?:plus|pro|business|enterprise)\b/gi) ?? [];
  const hasStrongResetPhrase = STRONG_RESET_PHRASE_PATTERN.test(text);
  const hasAudienceContext = BROAD_RESET_AUDIENCE_PATTERN.test(text) || planMatches.length >= 2;
  const hasFutureIntent = FUTURE_RESET_PATTERN.test(text);
  const hasCompletionLanguage = COMPLETED_RESET_PATTERN.test(text);
  const negated = NEGATED_RESET_PATTERN.test(text);
  const strong = !negated && hasStrongResetPhrase && hasAudienceContext;
  const matchedSignals: string[] = [];
  if (hasStrongResetPhrase) matchedSignals.push('strong usage/reset phrase');
  if (hasAudienceContext) matchedSignals.push('broad user or plan scope');
  if (hasFutureIntent) matchedSignals.push('future timing');
  if (hasCompletionLanguage) matchedSignals.push('completed-state language');
  return {
    strong,
    hasStrongResetPhrase,
    hasAudienceContext,
    hasFutureIntent,
    hasCompletionLanguage,
    matchedSignals,
    category: strong
      ? hasFutureIntent ? 'RESET_PLANNED' : hasCompletionLanguage ? 'RESET_COMPLETED' : 'RESET_PLANNED'
      : null,
  };
}

export function isStrongResetSignal(post: SourcePost): boolean {
  return getStrongResetSignal(post).strong;
}

export function isTrustedContextualReset(post: SourcePost): boolean {
  const context = getTrustedSourceContext(post);
  const text = normalizedPostText(post);
  const hasExplicitCodex = hasExplicitCodexReference(text);
  const hasNonCodexConflict = NON_CODEX_PRODUCT_PATTERN.test(text) && !hasExplicitCodex;
  return context.trusted && getStrongResetSignal(post).strong && !hasNonCodexConflict;
}

function isResetLifecycleCategory(category: ClassificationResult['category']): boolean {
  return category === 'RESET_PLANNED'
    || category === 'RESET_COMPLETED'
    || category === 'RESET_TIME_CHANGED';
}

function buildTrustedContextResetResult(post: SourcePost, signal: StrongResetSignal): ClassificationResult {
  const author = post.source_account.toLowerCase() === TRUSTED_TIBO_ACCOUNT
    ? 'Tibo'
    : `@${post.source_account}`;
  const completed = signal.category === 'RESET_COMPLETED';
  return {
    relevant: true,
    category: completed ? 'RESET_COMPLETED' : 'RESET_PLANNED',
    product_scope: 'CODEX',
    statement_nature: completed ? 'FACT' : 'INTENTION',
    confidence: completed ? 0.8 : 0.74,
    title_en: completed ? `${author} indicates a Codex usage reset` : `${author} announces a Codex usage reset`,
    title_zh: completed ? `${author}表示 Codex 用量已重置` : `${author}宣布 Codex 用量重置`,
    summary_en: completed
      ? `${author} reports a strong usage-reset signal covering multiple user plans. The direct source does not provide an absolute reset timestamp.`
      : `${author} announces a strong usage-reset signal covering multiple user plans. The reset timing is relative or not stated and remains unconfirmed.`,
    summary_zh: completed
      ? `${author}报告了覆盖多个用户方案的强用量重置信号。直接来源没有提供绝对重置时间。`
      : `${author}宣布了覆盖多个用户方案的强用量重置信号。重置时间为相对时间或未说明，仍待确认。`,
    effective_time: null,
    reset_time: null,
    reason: 'Trusted canonical Tibo X context was used only because strong usage/reset semantics and a broad user or plan scope were present.',
  };
}

export interface TrustedResetContextResult {
  outcome: ClassificationOutcome;
  sourceContext: ClassificationSourceContext;
  applied: boolean;
  strongReset: StrongResetSignal;
}

/**
 * Repair the specific missed-reset failure mode after the provider result is
 * available. Explicit Codex classifications remain authoritative; the
 * supplemental context only repairs a strong, trusted reset that the model
 * discarded or assigned to a non-Codex scope. Explicit non-Codex text wins.
 */
export function applyTrustedResetContext(post: SourcePost, outcome: ClassificationOutcome): TrustedResetContextResult {
  const context = getTrustedSourceContext(post);
  const signal = getStrongResetSignal(post);
  const text = normalizedPostText(post);
  const hasExplicitCodex = hasExplicitCodexReference(text);
  const hasNonCodexConflict = NON_CODEX_PRODUCT_PATTERN.test(text) && !hasExplicitCodex;
  if (!context.trusted || !signal.strong || hasNonCodexConflict) {
    return { outcome, sourceContext: context.sourceContext, applied: false, strongReset: signal };
  }

  if (outcome.status === 'SUCCESS'
    && outcome.result.relevant
    && isResetLifecycleCategory(outcome.result.category)
    && outcome.result.category === signal.category
    && outcome.result.product_scope === 'CODEX'
    && isCodexProductSignalAdmissible(outcome.result)) {
    return { outcome, sourceContext: context.sourceContext, applied: false, strongReset: signal };
  }

  return {
    outcome: { status: 'SUCCESS', result: buildTrustedContextResetResult(post, signal) },
    sourceContext: 'TRUSTED_CODEX_SOURCE_APPLIED',
    applied: true,
    strongReset: signal,
  };
}

/**
 * Detect explicit completed-state language in a direct X post. These rules
 * intentionally require both an authoritative X observation and wording that
 * describes a reset as already effective. Future-looking announcements are
 * excluded so a metaphorical or speculative post cannot confirm a reset.
 */
export function isCompletedResetHint(post: SourcePost): boolean {
  if (!isDirectXPost(post)) return false;

  const text = normalizedPostText(post);
  if (!EXPLICIT_CODEX_PATTERN.test(text)) return false;
  const hasFutureIntent = /\b(?:tomorrow|soon|later|next\s+(?:day|week|time)|in\s+the\s+future|will|going\s+to|plan(?:ned)?)\b/.test(text)
    || /\b(?:find|look\s+for)\s+(?:it|the\s+reset\s+button)\b/.test(text)
    || /\bdust\s+(?:it|that)\s+up\b/.test(text);
  if (hasFutureIntent) return false;

  const hasNegatedReset = /\b(?:not|never|didn't|did\s+not|hasn't|has\s+not|won't|will\s+not)\s+(?:be\s+)?(?:reset(?:ed|ted)?|restored|renewed|refreshed|replenished)\b/.test(text);
  if (hasNegatedReset) return false;

  return [
    /\bfeeling\s+reset(?:ed|ted)\b/,
    /\b(?:brand\s+new|new)\s+usage\b[\s\S]{0,120}\b(?:chatgpt\s+work|codex)\b/,
    /\b(?:usage|quotas?|limits?)\b[\s\S]{0,80}\b(?:have|has|were|was)\s+(?:been\s+)?(?:reset|restored|renewed|refreshed|replenished)\b/,
    /\b(?:reset|quotas?|limits?)\b[\s\S]{0,80}\b(?:propagated|completed|complete|done|restored|back)\b/,
  ].some(pattern => pattern.test(text));
}

/**
 * Convert an explicit completed-state signal into a high-confidence direct
 * event. No exact time is invented because the post does not necessarily
 * state when the reset took effect.
 */
export function buildCompletedResetHintResult(post: SourcePost): ClassificationResult {
  const author = post.source_account.toLowerCase() === 'thsottiaux'
    ? 'Tibo'
    : `@${post.source_account}`;

  return {
    relevant: true,
    category: 'RESET_COMPLETED',
    product_scope: 'CODEX',
    statement_nature: 'FACT',
    confidence: 0.82,
    title_en: `${author} indicates Codex usage has reset`,
    title_zh: `${author}表示Codex用户用量已重置`,
    summary_en: `${author} said they felt reset and that ChatGPT Work and Codex users had brand-new usage, indicating the usage reset had taken effect.`,
    summary_zh: `${author}表示自己感觉已重置，并称 ChatGPT Work 和 Codex 用户获得了全新用量，表明额度重置已经生效。`,
    effective_time: null,
    reset_time: null,
    reason: 'The direct X post uses completed-state language such as “feeling reseted” and “brand new usage”; it does not announce a future reset.',
  };
}

/**
 * Detect a narrow class of direct X posts that are useful as early warning
 * signals even when they do not announce an exact reset time.  This is
 * intentionally not applied to web-index snippets: an indexed snippet is
 * provisional evidence and must not create a direct-source reset hint.
 */
export function isSoftResetHint(post: SourcePost): boolean {
  if (!isDirectXPost(post)) return false;
  const text = normalizedPostText(post);
  return EXPLICIT_CODEX_PATTERN.test(text)
    && getSoftResetHintSignals(text).kind !== null;
}

/**
 * Convert a direct future-looking implicit signal into a visible,
 * low-confidence event. The absence of reset_time is deliberate: this is a
 * soft hint pending confirmation, not proof of a completed reset or a
 * prediction of when one will happen.
 */
export function buildSoftResetHintResult(post: SourcePost): ClassificationResult {
  const author = post.source_account.toLowerCase() === 'thsottiaux'
    ? 'Tibo'
    : `@${post.source_account}`;
  const signals = getSoftResetHintSignals(normalizedPostText(post));

  if (signals.kind === 'MILESTONE') {
    return {
      relevant: true,
      category: 'RESET_PLANNED',
      product_scope: 'CODEX',
      statement_nature: 'HINT',
      confidence: 0.58,
      title_en: `${author} hints at a possible Codex reset milestone`,
      title_zh: `${author}暗示可能有 Codex 重置里程碑`,
      summary_en: `${author} referred to a Codex-related milestone to celebrate in the future and told users to hold on to Codex. This is an indirect reset signal, not confirmation that a reset is scheduled.`,
      summary_zh: `${author}提到未来可能有值得庆祝的 Codex 相关里程碑，并提醒用户暂时保留 Codex 用量。这是间接的重置线索，不代表重置计划已经确认。`,
      effective_time: null,
      reset_time: null,
      reason: `The direct X post combines ${signals.matchedSignals.join(', ')}. Tibo often uses milestone and conservation language as an indirect early warning; no explicit reset or exact time was stated.`,
    };
  }

  return {
    relevant: true,
    category: 'RESET_PLANNED',
    product_scope: 'CODEX',
    statement_nature: 'HINT',
    confidence: 0.55,
    title_en: `${author} hints at a possible reset`,
    title_zh: `${author}暗示可能进行额度重置`,
    summary_en: `${author} referred to finding and using a reset button in the future. This is a soft hint, not confirmation that a Codex usage reset will occur.`,
    summary_zh: `${author}提到未来可能寻找并使用“重置按钮”。这是一条关于 Codex 额度重置的软性暗示，并不代表重置已经发生或时间已经确认。`,
    effective_time: null,
    reset_time: null,
    reason: 'A direct X post contains a future-looking reset-button reference. Recorded as a low-confidence reset hint pending confirmation; no exact time was stated.',
  };
}
