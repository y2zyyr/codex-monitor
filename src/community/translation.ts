import { boundedCompletionOptions } from '../utils/llm-request';
import type { Env } from '../types';
import type { CommunityConfig } from './config';
import { SITE_LOCALES, type SiteLocale } from '../i18n';

export type DetectedLanguage =
  | 'en'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt'
  | 'it'
  | 'ru'
  | 'ar'
  | 'und';

export type TranslationTarget = SiteLocale;

export interface TranslationRequest {
  text: string;
  sourceLanguage: DetectedLanguage;
  targetLanguage: TranslationTarget;
}

export interface TranslationProvider {
  readonly name: string;
  translate(request: TranslationRequest): Promise<string>;
}

interface ProtectedToken {
  placeholder: string;
  value: string;
}

export interface ProtectedText {
  text: string;
  tokens: ProtectedToken[];
}

const LANGUAGE_LABELS: Record<DetectedLanguage, string> = {
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
  ar: 'Arabic',
  und: 'unknown language',
};

const LATIN_MARKERS: Record<Exclude<DetectedLanguage, 'en' | 'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'und'>, string[]> = {
  fr: ['bonjour', 'avec', 'pour', 'dans', 'une', 'des', 'les', 'est', 'tout', 'monde'],
  de: ['hallo', 'und', 'mit', 'für', 'eine', 'der', 'die', 'das', 'nicht', 'ist'],
  es: ['hola', 'para', 'con', 'una', 'los', 'las', 'que', 'está', 'este', 'mundo'],
  pt: ['olá', 'para', 'com', 'uma', 'dos', 'das', 'que', 'está', 'não', 'mundo'],
  it: ['ciao', 'con', 'per', 'una', 'gli', 'che', 'della', 'questo', 'mondo'],
};

function addToken(tokens: ProtectedToken[], value: string, kind: string): string {
  const placeholder = `__TIBO_${kind}_${tokens.length + 1}__`;
  tokens.push({ placeholder, value });
  return placeholder;
}

function trimUrlPunctuation(value: string): { url: string; suffix: string } {
  let url = value;
  let suffix = '';
  while (/[.,!?;:]$/u.test(url)) suffix = url.slice(-1) + suffix, url = url.slice(0, -1);
  while (/[\])}]/u.test(url)) suffix = url.slice(-1) + suffix, url = url.slice(0, -1);
  return { url, suffix };
}

/**
 * Protect technical spans before calling a language model. The restore pass
 * is deliberately exact: if a provider drops a placeholder, the caller can
 * reject that derived translation instead of publishing a damaged URL/code
 * sample.
 */
export function protectTechnicalContent(value: string): ProtectedText {
  const tokens: ProtectedToken[] = [];
  let text = value;

  // Internal section markers are also protected so a provider cannot rewrite
  // or drop the delimiters used by event-title/summary translation. This also
  // keeps user-supplied placeholder-looking text literal and harmless.
  text = text.replace(/__TIBO_[A-Z0-9_-]+__/gu, match => addToken(tokens, match, 'LITERAL'));
  text = text.replace(/```[\s\S]*?```/gu, match => addToken(tokens, match, 'CODE'));
  text = text.replace(/`(?:\\.|[^`])*`/gu, match => addToken(tokens, match, 'CODE'));
  text = text.replace(/https?:\/\/[^\s<>"'`]+/giu, match => {
    const trimmed = trimUrlPunctuation(match);
    return addToken(tokens, trimmed.url, 'URL') + trimmed.suffix;
  });
  text = text.replace(/^\s*(?:\$\s*)?(?:npm|pnpm|yarn|npx|bun|git|wrangler|cargo|go|python3?|node)\b[^\n]*$/gimu,
    match => addToken(tokens, match, 'COMMAND'));
  text = text.replace(/@[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}/gu, match => addToken(tokens, match, 'MENTION'));
  text = text.replace(/#[0-9]{1,7}\b/gu, match => addToken(tokens, match, 'NUMBER'));

  return { text, tokens };
}

export function restoreTechnicalContent(value: string, protectedText: ProtectedText): { text: string; missing: string[] } {
  let restored = value;
  // A command token can contain a URL token after the first protection pass.
  // Treat nested tokens as present when their parent survived provider output.
  const present = new Set(protectedText.tokens
    .filter(token => value.includes(token.placeholder))
    .map(token => token.placeholder));
  let discoveredNested = true;
  while (discoveredNested) {
    discoveredNested = false;
    for (const parent of protectedText.tokens) {
      if (!present.has(parent.placeholder)) continue;
      for (const child of protectedText.tokens) {
        if (!present.has(child.placeholder) && parent.value.includes(child.placeholder)) {
          present.add(child.placeholder);
          discoveredNested = true;
        }
      }
    }
  }
  const missing = protectedText.tokens
    .filter(token => !present.has(token.placeholder))
    .map(token => token.placeholder);

  // Commands may contain a URL placeholder, so restore until nested tokens
  // are resolved. The upper bound keeps malformed provider output bounded.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const token of protectedText.tokens) {
      if (restored.includes(token.placeholder)) {
        restored = restored.split(token.placeholder).join(token.value);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { text: restored.trim(), missing };
}

function languageByLatinMarkers(value: string): DetectedLanguage {
  const matches = value.toLocaleLowerCase().match(/[\p{L}’'-]+/gu);
  const words: string[] = matches ? Array.from(matches) : [];
  if (words.length === 0) return 'und';
  const scores: Array<{ language: DetectedLanguage; score: number }> = [
    ...(Object.entries(LATIN_MARKERS) as Array<[DetectedLanguage, string[]]>).map(([language, markers]) => ({
      language: language as DetectedLanguage,
      score: markers.reduce((total, marker) => total + (words.includes(marker) ? 1 : 0), 0),
    })),
    { language: 'en', score: (['the', 'and', 'with', 'for', 'this', 'that', 'is', 'are', 'project', 'works', 'hello'] as string[]).reduce((total, marker) => total + (words.includes(marker) ? 1 : 0), 0) },
  ];
  scores.sort((left, right) => right.score - left.score);
  if (scores[0].score > 0) return scores[0].language;
  // Short Latin-only technical messages are most often English, while a
  // non-Latin script without a reliable signal remains undetermined.
  return /^[\p{ASCII}\s\p{P}\p{N}]+$/u.test(value) ? 'en' : 'und';
}

/** Lightweight deterministic language detection; no network call is needed. */
export function detectLanguage(value: string): DetectedLanguage {
  const protectedText = protectTechnicalContent(value).text
    .replace(/__TIBO_[A-Z]+_\d+__/gu, ' ');
  if (!/[\p{L}]/u.test(protectedText)) return 'und';
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u.test(protectedText)) return 'ko';
  if (/[\u3040-\u30FF\u31F0-\u31FF]/u.test(protectedText)) return 'ja';
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/u.test(protectedText)) return 'zh';
  if (/[\u0600-\u06FF\u0750-\u077F]/u.test(protectedText)) return 'ar';
  if (/[\u0400-\u04FF]/u.test(protectedText)) return 'ru';
  return languageByLatinMarkers(protectedText);
}

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language as DetectedLanguage] || language || LANGUAGE_LABELS.und;
}

export function translationTargets(
  sourceLanguage: DetectedLanguage,
  enabled: boolean,
  locales: readonly SiteLocale[] = SITE_LOCALES,
): TranslationTarget[] {
  if (!enabled) return [];
  return locales.filter(locale => locale !== sourceLanguage);
}

interface OpenAICompatibleResponse {
  choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  error?: { message?: string };
}

export class OpenAICompatibleTranslationProvider implements TranslationProvider {
  readonly name = 'llm-openai-compatible';

  constructor(private readonly config: CommunityConfig) {
    if (!config.translationApiKey) throw new Error('Translation provider is not configured');
  }

  async translate(request: TranslationRequest): Promise<string> {
    const protectedText = protectTechnicalContent(request.text);
    const systemPrompt = [
      'You are a precise translator for a technical developer community.',
      `Translate from ${languageLabel(request.sourceLanguage)} to ${languageLabel(request.targetLanguage)}.`,
      'Return only the translated text. Do not add explanations, quotes, headings, or markdown fences.',
      'Preserve every placeholder beginning with __TIBO_ exactly, including spelling, case, underscores, and number.',
      'Do not translate URLs, code, shell commands, file paths, package names, repository names, usernames, or issue numbers.',
    ].join(' ');
    const response = await this.requestCompletion({
      model: this.config.translationModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: protectedText.text },
      ],
      temperature: 0.1,
      max_tokens: this.config.translationMaxTokens,
    });
    const restored = restoreTechnicalContent(response, protectedText);
    if (restored.missing.length > 0) {
      throw new Error('Translation provider did not preserve technical placeholders');
    }
    if (!restored.text) throw new Error('Translation provider returned empty text');
    return restored.text;
  }

  private async requestCompletion(body: Record<string, unknown>): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.translationTimeoutMs);
    try {
      const response = await fetch(`${this.config.translationBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.translationApiKey}`,
        },
        body: JSON.stringify({ ...body, ...boundedCompletionOptions(this.config.translationBaseUrl) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Translation provider HTTP ${response.status}`);
      const payload = await response.json() as OpenAICompatibleResponse;
      // Provider error bodies are intentionally not copied into Worker logs;
      // some gateways echo request details or credentials in diagnostics.
      if (payload.error?.message) throw new Error(`translation_provider_error_${response.status}`);
      const content = payload.choices?.[0]?.message?.content;
      if (Array.isArray(content)) return content.map(part => part.text || '').join('');
      if (typeof content !== 'string') throw new Error('Translation provider returned no content');
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createTranslationProvider(config: CommunityConfig): TranslationProvider | null {
  if (!config.translationEnabled) return null;
  try {
    return new OpenAICompatibleTranslationProvider(config);
  } catch {
    return null;
  }
}

// Keep this helper explicit for callers/tests that want to assert the
// existing LLM secret is the default translation credential.
export function translationConfigFromEnv(env: Env, config: CommunityConfig): Pick<CommunityConfig, 'translationApiKey' | 'translationBaseUrl' | 'translationModel'> {
  return {
    translationApiKey: config.translationApiKey,
    translationBaseUrl: config.translationBaseUrl,
    translationModel: config.translationModel,
  };
}
