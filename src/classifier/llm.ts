// ============================================================
// Codex Usage Monitor - LLM Classification Provider
// ============================================================
import type { ClassificationFailureKind, ClassificationProvider, ClassificationOutcome, SourcePost, Env } from '../types';
import { EVENT_CATEGORIES, PRODUCT_SCOPES, STATEMENT_NATURES } from '../types';
import type { ProductScope, StatementNature } from '../types';
import { boundedCompletionOptions } from '../utils/llm-request';
import { getTrustedSourceContext } from './types';

interface LLMRequestMessage {
  role: 'system' | 'user';
  content: string;
}

interface LLMRequest {
  model: string;
  messages: LLMRequestMessage[];
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

interface LLMResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
  error?: {
    message: string;
    type: string;
    code?: string | null;
    status?: number | null;
  };
}

export const LLM_CLASSIFIER_TIMEOUT_MS = 30_000;

export const CLASSIFIER_CONFIGURATION_KEYS = ['LLM_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL'] as const;

export function missingClassifierConfiguration(env: Pick<Env, typeof CLASSIFIER_CONFIGURATION_KEYS[number]>): string[] {
  return CLASSIFIER_CONFIGURATION_KEYS.filter((name) => !env[name]?.trim());
}

export interface LLMClassifierOptions {
  /** Test/local override. Production uses the fixed bounded default. */
  timeoutMs?: number;
}

// Only accept an LLM-produced timestamp when the source text contains an
// absolute calendar date. Relative phrases such as "tomorrow", "next week",
// and "soon" are useful classification signals but are not interpretable
// effective times for a durable event record.
const EXPLICIT_CALENDAR_DATE_PATTERN = /\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,|\s+)\s*20\d{2})\b/i;

/**
 * LLMClassifier - Uses an OpenAI-compatible API to classify posts.
 * Falls back gracefully on errors.
 */
export class LLMClassifier implements ClassificationProvider {
  readonly name = 'llm';
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private maxTokens: number;
  private timeoutMs: number;

  constructor(env: Env, options: LLMClassifierOptions = {}) {
    const missing = missingClassifierConfiguration(env);
    if (missing.length > 0) {
      throw new Error(`Classifier configuration is missing: ${missing.join(',')}`);
    }
    this.apiKey = env.LLM_API_KEY!;
    this.baseUrl = env.LLM_BASE_URL!.replace(/\/+$/, '');
    this.model = env.LLM_MODEL!;
    this.maxTokens = Number(env.LLM_MAX_TOKENS) || 2000;
    this.timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Math.min(60_000, Number(options.timeoutMs)))
      : LLM_CLASSIFIER_TIMEOUT_MS;
  }

  async classify(post: SourcePost): Promise<ClassificationOutcome> {
    const systemPrompt = `You are a high-recall classifier for meaningful public signals from Tibo (@thsottiaux) about OpenAI Codex and its related coding-agent workflow.

Classify the post for this monitoring scope: Codex usage/reset behavior, limits, policies, subscription terms, Codex product changes, roadmap direction, or feature/workflow discussion. A post can be relevant before anything ships. Do not turn this monitor into a mirror of every post.

Return one JSON object with exactly these fields:
{
  "relevant": true/false,
  "category": "RESET_PLANNED" | "RESET_COMPLETED" | "RESET_TIME_CHANGED" | "POLICY_CHANGE" | "CODEX_UPDATE" | "ROADMAP_HINT" | "FEATURE_DISCUSSION" | "IRRELEVANT",
  "product_scope": "CODEX" | "CHATGPT_WORK" | "CHATGPT" | "OPENAI_GENERAL" | "OTHER" | "AMBIGUOUS",
  "statement_nature": "FACT" | "OBSERVATION" | "INTENTION" | "HINT" | "QUESTION" | "SPECULATION",
  "confidence": 0.0-1.0,
  "title_en": "Short factual English title (max 12 words)",
  "title_zh": "简短、事实性的中文标题",
  "summary_en": "1-2 sentence summary that preserves uncertainty",
  "summary_zh": "1-2 句保留不确定性的中文摘要",
  "effective_time": null or ISO 8601 UTC string (ONLY for an explicitly stated absolute date/time),
  "reset_time": null or ISO 8601 UTC string (ONLY for an explicitly stated absolute reset date/time),
  "reason": "Why this classification was chosen"
}

RELEVANCE AND TAXONOMY:
1. Set relevant=true for meaningful Codex product/usage/policy/roadmap/feature signals, including requests for feedback and exploratory questions. Generic personal chatter, unrelated announcements, and posts with no meaningful connection to Codex are IRRELEVANT.
2. Set product_scope independently. Use CODEX only when the post explicitly names Codex, Codex CLI/App/SDK/agent, or clearly binds an IDE, desktop, tool, model, or coding workflow to Codex. Use CHATGPT_WORK for ChatGPT Work or Work-specific workflows unless the text explicitly binds it to Codex. Use CHATGPT for ordinary ChatGPT products such as ChatGPT desktop, Sites, image generation, or general integrations. Use OPENAI_GENERAL for company-wide, generic model, DevDay, culture, or broad AI content. Use OTHER for clearly unrelated content. Use AMBIGUOUS when the text does not reliably distinguish Codex from ChatGPT or another OpenAI product. Never infer CODEX only because the author is Tibo.
3. CODEX_UPDATE means a Codex product change is explicitly announced, confirmed, shipped, released, launched, available, rolling out, or already happened. It is a FACT category and requires product_scope=CODEX. Do not use it for a plan, idea, question, or speculation.
4. ROADMAP_HINT means future direction or intent such as upcoming, soon, next week, coming, working on, planning, considering, or what the team wants to build. It is a future signal, requires product_scope=CODEX, and is not a release confirmation. Never invent a launch date.
5. FEATURE_DISCUSSION means a Codex feature, CLI, IDE, desktop, agent, model, tool, context, or workflow is being explored, proposed, debated, or used to ask for user feedback. It requires product_scope=CODEX for public Codex admission. A question such as "What should we ship next week?" is normally FEATURE_DISCUSSION with statement_nature QUESTION, or ROADMAP_HINT with QUESTION only when the surrounding context is clearly roadmap-oriented. It must never become a confirmed release.
6. Keep category and statement_nature separate:
   - FACT: stated as already true, shipped, changed, or confirmed
   - OBSERVATION: a descriptive observation about usage, adoption, behaviour, trends, or circumstances; it does not by itself establish a release, policy change, roadmap commitment, or confirmed product change
   - INTENTION: the author/team says they plan or want to do it
   - HINT: indirect future signal
   - QUESTION: asks what to build, ship, or investigate
   - SPECULATION: possibility or uncertainty without confirmation
7. OBSERVATION does not by itself imply relevant=true or public admission. A Codex adoption/usage observation may be 'IRRELEVANT' with 'statement_nature=OBSERVATION' and must not become a public event merely because product_scope=CODEX. Do not use OBSERVATION for CODEX_UPDATE or RESET_COMPLETED; those categories require FACT.
8. If the post is not relevant, set relevant=false and category=IRRELEVANT. IRRELEVANT must not be treated as a monitor event.

RESET AND POLICY RULES:
9. RESET_PLANNED is a Codex reset announced/intended but not yet completed. RESET_COMPLETED is Codex completed/propagated/reset-now language. RESET_TIME_CHANGED means a Codex upcoming reset time changed. POLICY_CHANGE means a Codex current or explicitly announced usage limit, rate-limit, subscription, or policy change. For all RESET_* categories and POLICY_CHANGE, product_scope must be CODEX for public admission. If the post explicitly concerns ChatGPT Work, ordinary ChatGPT, or another non-Codex product, do not create a Codex event merely because it contains the word "reset" or describes a policy change.
10. Prefer reset categories over generic product categories when reset language is explicit. Use this precedence: RESET_COMPLETED > RESET_TIME_CHANGED > RESET_PLANNED > POLICY_CHANGE > CODEX_UPDATE > ROADMAP_HINT > FEATURE_DISCUSSION > IRRELEVANT.
11. Direct Tibo wording such as "feeling reseted", "brand new usage", or "the reset propagated" is RESET_COMPLETED unless clearly negated or postponed. Future reset-button or milestone/conservation wording without confirmation is a low-confidence RESET_PLANNED hint.

TRUSTED SOURCE CONTEXT:
12. A verified direct canonical X post from the monitored @thsottiaux account may provide supplemental Codex context when the text contains a strong usage/quota reset signal with broad user or plan scope but omits the word Codex. This is supplemental context, not author-based inference: a generic or weak reset is not enough, arbitrary/untrusted sources do not receive this context, and explicit ChatGPT, ChatGPT Work, or another non-Codex product remains non-Codex unless the same text explicitly binds the reset to Codex.

SAFETY:
13. Never infer a fact from a question, discussion, intention, hint, observation, or speculation. In particular, do not write "will launch next week" merely because the post asks what should ship next week.
14. Never invent or convert relative dates. For "tomorrow", "next week", "soon", or similar wording, keep effective_time and reset_time null. Only return a time when the post itself contains an interpretable absolute calendar date/time.
15. Titles and summaries must state what the post says, not what it might imply. Preserve words such as possible, considering, asking, observing, or upcoming when they matter.

AUTHOR CONTEXT:
The source account is provided below. When it is @thsottiaux, call the author Tibo or @thsottiaux, not "a user".`;

    const trustedContext = getTrustedSourceContext(post).trusted
      ? 'Trusted supplemental context is available: this is a verified direct canonical X post from the monitored Tibo account. Apply it only to a strong usage/reset signal with broad user or plan scope.'
      : 'No trusted supplemental Codex source context applies to this post.';
    const userMessage = `Post text: "${post.text}"
Published at: ${post.published_at}
Source: ${post.source_url}
Source account: @${post.source_account}
Evidence quality: ${post.source_quality ?? 'DIRECT'}
Verification status: ${post.verification_status ?? 'DIRECT_VERIFIED'}
${trustedContext}
If evidence quality is INDEXED, treat the snippet as provisional evidence and keep confidence conservative.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          ...boundedCompletionOptions(this.baseUrl),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: this.maxTokens,
        } as LLMRequest),
      });

      if (!response.ok) {
        return httpFailure(response.status);
      }

      let data: LLMResponse;
      try {
        data = await response.json() as LLMResponse;
      } catch {
        return classifierError('INVALID_JSON_RESPONSE', 'CLASSIFIER_OUTPUT_ERROR');
      }
      if (data.error) {
        return data.error.status ? httpFailure(data.error.status) : classifierError('PROVIDER_RESPONSE_ERROR', 'TRANSIENT_PROVIDER_ERROR');
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return classifierError('EMPTY_RESPONSE', 'CLASSIFIER_OUTPUT_ERROR');
      }

      const result = this.parseResult(content, post);
      return result;

    } catch (err) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return classifierError('TIMEOUT', 'TRANSIENT_PROVIDER_ERROR');
      }
      return classifierError('NETWORK_ERROR', 'TRANSIENT_PROVIDER_ERROR');
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResult(content: string, post: SourcePost): ClassificationOutcome {
    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      if (typeof parsed.relevant !== 'boolean') throw new Error('relevant must be boolean');
      if (!EVENT_CATEGORIES.includes(parsed.category)) throw new Error(`Invalid category: ${parsed.category}`);
      if (!PRODUCT_SCOPES.includes(parsed.product_scope)) {
        throw new Error(`Invalid product_scope: ${parsed.product_scope}`);
      }
      if (!STATEMENT_NATURES.includes(parsed.statement_nature)) {
        throw new Error(`Invalid statement_nature: ${parsed.statement_nature}`);
      }

      if (parsed.relevant && parsed.category === 'IRRELEVANT') {
        parsed.relevant = false;
      }
      if (!parsed.relevant && parsed.category !== 'IRRELEVANT') {
        parsed.category = 'IRRELEVANT';
      }

      if ((parsed.category === 'CODEX_UPDATE' || parsed.category === 'RESET_COMPLETED')
        && parsed.statement_nature !== 'FACT') {
        throw new Error(`${parsed.category} requires statement_nature=FACT`);
      }

      if (typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence)) {
        throw new Error('confidence must be a finite number');
      }
      if (parsed.relevant) {
        for (const field of ['title_en', 'title_zh', 'summary_en', 'summary_zh', 'reason']) {
          if (typeof parsed[field] !== 'string' || parsed[field].trim().length === 0) {
            throw new Error(`${field} is required for relevant events`);
          }
        }
      }

      return {
        status: "SUCCESS",
        result: {
          relevant: parsed.relevant,
          category: parsed.category,
          product_scope: parsed.product_scope as ProductScope,
          statement_nature: parsed.statement_nature as StatementNature,
          confidence: post.source_quality === 'INDEXED'
            ? Math.min(0.85, Math.max(0, parsed.confidence))
            : Math.min(1, Math.max(0, parsed.confidence)),
          title_en: String(parsed.title_en ?? ''),
          title_zh: String(parsed.title_zh ?? ''),
          summary_en: String(parsed.summary_en ?? ''),
          summary_zh: String(parsed.summary_zh ?? ''),
          effective_time: this.validateSourceTime(parsed.effective_time, post.text),
          reset_time: this.validateSourceTime(parsed.reset_time, post.text),
          reason: String(parsed.reason ?? ''),
        }
      };
    } catch {
      // Do not log or persist model output. The caller only needs a bounded
      // code to select the normal classifier-output retry path.
      return classifierError('INVALID_STRUCTURED_OUTPUT', 'CLASSIFIER_OUTPUT_ERROR');
    }
  }

  private validateTime(value: string | null | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  private validateSourceTime(value: string | null | undefined, sourceText: string): string | null {
    if (!EXPLICIT_CALENDAR_DATE_PATTERN.test(sourceText)) return null;
    return this.validateTime(value);
  }
}

function classifierError(errorCode: string, failureKind: ClassificationFailureKind): ClassificationOutcome {
  return {
    status: 'ERROR',
    error: errorCode,
    errorCode,
    failureKind,
    category: 'ERROR',
  };
}

function httpFailure(status: number): ClassificationOutcome {
  const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  if (safeStatus === 408 || safeStatus === 425 || safeStatus === 429 || safeStatus >= 500) {
    return classifierError(safeStatus ? `HTTP_${safeStatus}` : 'PROVIDER_RESPONSE_ERROR', 'TRANSIENT_PROVIDER_ERROR');
  }
  if (safeStatus >= 400 && safeStatus < 500) {
    return classifierError(`HTTP_${safeStatus}`, 'PERMANENT_OR_CONFIGURATION_ERROR');
  }
  return classifierError('PROVIDER_RESPONSE_ERROR', 'TRANSIENT_PROVIDER_ERROR');
}
