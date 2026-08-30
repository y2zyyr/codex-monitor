// ============================================================
// Codex Usage Monitor - LLM Classification Provider
// ============================================================
import type { ClassificationProvider, ClassificationOutcome, SourcePost, Env } from '../types';
import { EVENT_CATEGORIES } from '../types';

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
  };
}

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

  constructor(env: Env) {
    if (!env.LLM_API_KEY) {
      throw new Error('LLM_API_KEY is required for LLMClassifier');
    }
    this.apiKey = env.LLM_API_KEY;
    this.baseUrl = (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.model = env.LLM_MODEL || 'gpt-4o-mini';
    this.maxTokens = Number(env.LLM_MAX_TOKENS) || 2000;
  }

  async classify(post: SourcePost): Promise<ClassificationOutcome> {
    const systemPrompt = `You are a specialized classifier for Codex (an AI coding agent by OpenAI) usage policy updates.

Analyze the tweet/post below and determine if it announces a meaningful change to Codex usage policies, reset schedules, rate limits, or subscription terms.

You must return a JSON object with these exact fields:
{
  "relevant": true/false,
  "category": "RESET_PLANNED" | "RESET_COMPLETED" | "RESET_TIME_CHANGED" | "POLICY_CHANGE" | "IRRELEVANT",
  "confidence": 0.0-1.0,
  "title_en": "Short English title (max 10 words)",
  "title_zh": "简短中文标题",
  "summary_en": "1-2 sentence English summary",
  "summary_zh": "1-2 句中文摘要",
  "effective_time": null or ISO 8601 UTC string (ONLY if explicitly stated in the post),
  "reset_time": null or ISO 8601 UTC string (ONLY if explicitly stated),
  "reason": "Why this classification was chosen"
}

IMPORTANT RULES:
1. Only set relevant=true if the post is about Codex usage reset, rate limits, subscription policy, or usage policy changes.
2. Do NOT classify generic Codex performance discussions, caching, model speed, or unrelated product updates as events.
3. You must NEVER invent or guess times. If the post says "tomorrow", set effective_time/reset_time to null - do not convert relative dates.
4. If the post is not relevant, set category to "IRRELEVANT" and relevant to false.
5. Confidence should reflect how certain you are about the classification. This is model classification confidence, not proof that the source is authoritative.
6. Titles must be concise and factual. Do not add information not present in the post.
7. Always distinguish between:
   - RESET_PLANNED: A reset is announced but not yet happened
   - RESET_COMPLETED: A reset has been completed/propagated
   - RESET_TIME_CHANGED: The time of an upcoming reset has changed
   - POLICY_CHANGE: A usage policy, limit, or subscription term has changed
8. When a direct Tibo post uses a future-looking "reset button" phrase (for
   example, "find it tomorrow and dust it up") but gives no precise product
   or time, treat it as a low-confidence RESET_PLANNED soft hint. Use
   approximate/disclaimer wording and keep effective_time/reset_time null.
   Never classify that wording as RESET_COMPLETED.
9. When a direct Tibo post uses completed-state language such as "feeling
   reseted/resetted", "brand new usage", "usage has been reset", or "the
   reset propagated", classify it as RESET_COMPLETED unless the same post
   clearly negates or postpones that statement. Do not turn completed-state
   wording into RESET_PLANNED merely because it also uses a reset-button
   metaphor. Keep effective_time/reset_time null unless an exact time is
   explicitly stated.
10. Tibo often uses indirect milestone language. When a direct Tibo post
    combines Codex/ChatGPT Work/usage context with future timing such as
    "tomorrow" or "soon" and milestone/celebration language such as
    "milestone", "celebrate", "dashboard", or "hold on to your Codex",
    classify it as a low-confidence RESET_PLANNED soft hint. Explain that it
    is an indirect signal, keep effective_time/reset_time null, and never
    classify it as RESET_COMPLETED. A generic milestone without Codex/usage
    context is not relevant.

IMPORTANT AUTHOR CONTEXT:
The post was written by the account whose username is provided in the "Source" field.
- If the source is "https://x.com/thsottiaux/status/...", the author is Tibo (@thsottiaux).
- Do NOT describe the author generically as "a user" or "the user" when the source identity is known.
- Use the author's name in summaries and titles where appropriate.
- Examples of correct wording: "Tibo announced...", "Tibo confirmed...", "@thsottiaux stated..."
- Examples of INCORRECT wording: "A user announced...", "The user stated...", "Someone said..."`;

    const userMessage = `Post text: "${post.text}"
Published at: ${post.published_at}
Source: ${post.source_url}
Source account: @${post.source_account}
Evidence quality: ${post.source_quality ?? 'DIRECT'}
Verification status: ${post.verification_status ?? 'DIRECT_VERIFIED'}
If evidence quality is INDEXED, treat the snippet as provisional evidence and keep confidence conservative.`;

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
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
        const errText = await response.text();
        console.error(`[LLMClassifier] API error: ${response.status} ${errText}`);
        return { status: "ERROR", error: `LLM API error: ${response.status}`, category: "ERROR" };
      }

      const data = await response.json() as LLMResponse;
      if (data.error) {
        console.error(`[LLMClassifier] API error: ${data.error.message}`);
        return { status: "ERROR", error: `LLM API error: ${data.error.message}`, category: "ERROR" };
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return { status: "ERROR", error: 'Empty LLM response', category: "ERROR" };
      }

      const result = this.parseResult(content, post);
      return result;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LLMClassifier] Request failed: ${msg}`);
      return { status: "ERROR", error: `LLM request failed: ${msg}`, category: "ERROR" };
    }
  }

  private parseResult(content: string, post: SourcePost): ClassificationOutcome {
    try {
      const parsed = JSON.parse(content);

      // Validate required fields
      if (typeof parsed.relevant !== 'boolean') throw new Error('relevant must be boolean');
      if (!EVENT_CATEGORIES.includes(parsed.category)) throw new Error(`Invalid category: ${parsed.category}`);

      if (parsed.relevant && parsed.category === 'IRRELEVANT') {
        parsed.relevant = false;
      }
      if (!parsed.relevant && parsed.category !== 'IRRELEVANT') {
        parsed.category = 'IRRELEVANT';
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
          confidence: post.source_quality === 'INDEXED'
            ? Math.min(0.85, Math.max(0, parsed.confidence))
            : Math.min(1, Math.max(0, parsed.confidence)),
          title_en: String(parsed.title_en ?? ''),
          title_zh: String(parsed.title_zh ?? ''),
          summary_en: String(parsed.summary_en ?? ''),
          summary_zh: String(parsed.summary_zh ?? ''),
          effective_time: this.validateTime(parsed.effective_time),
          reset_time: this.validateTime(parsed.reset_time),
          reason: String(parsed.reason ?? ''),
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[LLMClassifier] Parse error: ${msg}, content: ${content.substring(0, 200)}`);
      return { status: "ERROR", error: `Parse error: ${msg}`, category: "ERROR" };
    }
  }

  private validateTime(value: string | null | undefined): string | null {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
}
