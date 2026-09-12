import { canonicalJson, sha256Hex } from './canonical';
import { GambitRunBudget } from './budget';
import { GambitProviderError } from './llm';
import { gambitPromptVersion } from './prompts';
import { GambitRepository } from './repository';
import type {
  GambitDraft,
  GambitLLMProvider,
  GambitLocale,
  GambitModelRoleConfig,
  GambitPublicArticle,
  GambitTrajectory,
  GambitTranslation,
  GambitTranslationState,
} from './types';

export type GambitTranslationStatus = 'TRANSLATED' | 'FAILED' | 'SKIPPED' | 'CANONICAL_FALLBACK';

export interface GambitTranslationRunResult {
  status: 'TRANSLATION_READY' | 'TRANSLATION_FAILED' | 'CANONICAL_FALLBACK';
  localeStates: Record<GambitLocale, GambitTranslationState>;
  errors: Partial<Record<GambitLocale, string>>;
}

const TRANSLATION_LOCALES = ['zh', 'ja', 'fr', 'es'] as const;

type GambitTranslationProviderPayload = Partial<Omit<GambitTranslation, 'trajectories'>> & {
  trajectories?: Array<Partial<GambitTrajectory>>;
};

/**
 * These are structural language checks, not a vocabulary repair list.  A
 * technical token is allowed to remain in any locale when it is part of the
 * canonical record or a conventional identifier/acronym.
 */
const TECHNICAL_ASCII_TERMS = new Set([
  'AI', 'API', 'D1', 'GA', 'GitHub', 'HTTP', 'JSON', 'LLM', 'OpenAI', 'R2', 'RSS', 'SDK', 'URL',
]);

export interface GambitTranslationLanguageQuality {
  targetLanguageDominance: 'PASS' | 'FAIL';
  crossLanguageSentenceContamination: 'PASS' | 'FAIL';
  naturalness: 'PASS' | 'FAIL';
  canonicalEntityPreservation: 'PASS' | 'FAIL';
  errors: string[];
}

export function copyTranslation(
  article: GambitPublicArticle,
  locale: GambitLocale,
  translationState: GambitTranslationState = 'TRANSLATION_READY',
): GambitTranslation {
  return {
    locale,
    headline: article.headline,
    surfaceEvent: article.surfaceEvent,
    facts: [...article.facts],
    obviousLogic: article.obviousLogic,
    thesis: article.thesis,
    mechanism: article.mechanism,
    beneficiaries: [...article.beneficiaries],
    pressuredActors: [...article.pressuredActors],
    countercase: article.countercase,
    trajectories: article.trajectories.map(trajectory => ({ ...trajectory })),
    falsifier: article.falsifier,
    uncertainty: article.uncertainty,
    status: translationState === 'TRANSLATION_READY' ? 'TRANSLATED' : 'FAILED',
    provider: null,
    translatedAt: null,
    translationState,
    sourceIds: canonicalSourceIds(article),
    evidenceIds: canonicalEvidenceIds(article),
  };
}

export function normalizeGambitTranslation(value: GambitTranslationProviderPayload, locale: GambitLocale, article: GambitPublicArticle): GambitTranslation | null {
  if (gambitTranslationValidationErrors(value, locale, article).length > 0) return null;
  const canonical = copyTranslation(article, locale, 'TRANSLATION_READY');
  const trajectories = value.trajectories ?? [];
  return {
    ...canonical,
    locale,
    headline: String(value.headline),
    surfaceEvent: String(value.surfaceEvent),
    facts: (value.facts ?? []).map(String),
    obviousLogic: String(value.obviousLogic),
    thesis: String(value.thesis),
    mechanism: String(value.mechanism),
    beneficiaries: (value.beneficiaries ?? []).map(String),
    pressuredActors: (value.pressuredActors ?? []).map(String),
    countercase: String(value.countercase),
    falsifier: String(value.falsifier),
    uncertainty: String(value.uncertainty),
    sourceIds: canonical.sourceIds,
    evidenceIds: canonical.evidenceIds,
    trajectories: trajectories.map((trajectory, index) => ({
      ...article.trajectories[index],
      ...trajectory,
      // Entity identity, prediction ID, probability, deadline, and status
      // belong to the canonical record and cannot be translated away.
      targetEntity: article.trajectories[index].targetEntity,
      probability: article.trajectories[index].probability,
      deadline: article.trajectories[index].deadline,
      id: article.trajectories[index].id,
      status: article.trajectories[index].status,
    })),
    status: 'TRANSLATED',
    translationState: 'TRANSLATION_READY',
    provider: null,
    translatedAt: null,
  };
}

/** Privacy-safe schema diagnostics used by the staging provider probe. */
export function gambitTranslationValidationErrors(value: unknown, locale: GambitLocale, article: GambitPublicArticle): string[] {
  if (!value || typeof value !== 'object') return ['OBJECT_REQUIRED'];
  const record = value as GambitTranslationProviderPayload;
  const articleFacts = Array.isArray(article.facts) ? article.facts : [];
  const articleBeneficiaries = Array.isArray(article.beneficiaries) ? article.beneficiaries : [];
  const articlePressuredActors = Array.isArray(article.pressuredActors) ? article.pressuredActors : [];
  const articleTrajectories = Array.isArray(article.trajectories) ? article.trajectories : [];
  const errors: string[] = [];
  for (const field of ['headline', 'surfaceEvent', 'obviousLogic', 'thesis', 'mechanism', 'countercase', 'falsifier', 'uncertainty'] as const) {
    if (!nonEmpty(record[field])) errors.push(`${field.toUpperCase()}_MISSING`);
  }
  if (!textArray(record.facts, articleFacts.length)) errors.push('FACTS_COUNT_OR_TYPE');
  if (!textArray(record.beneficiaries, articleBeneficiaries.length)) errors.push('BENEFICIARIES_COUNT_OR_TYPE');
  if (!textArray(record.pressuredActors, articlePressuredActors.length)) errors.push('PRESSURED_ACTORS_COUNT_OR_TYPE');
  errors.push(...nativeTranslationQualityErrors(record, locale, article));
  if (!Array.isArray(record.trajectories)) errors.push('TRAJECTORIES_NOT_ARRAY');
  else if (record.trajectories.length !== articleTrajectories.length) errors.push('TRAJECTORY_COUNT');
  else {
    for (const [index, trajectory] of record.trajectories.entries()) {
      const original = articleTrajectories[index];
      if (!original) {
        errors.push(`TRAJECTORY_${index + 1}_ORIGINAL_MISSING`);
        continue;
      }
      if (!trajectory) {
        errors.push(`TRAJECTORY_${index + 1}_OBJECT`);
        continue;
      }
      if (!nonEmpty(trajectory.predictionStatement)) errors.push(`TRAJECTORY_${index + 1}_PREDICTION`);
      if (!nonEmpty(trajectory.reasoning)) errors.push(`TRAJECTORY_${index + 1}_REASONING`);
      if (!nonEmpty(trajectory.evidenceCriteria)) errors.push(`TRAJECTORY_${index + 1}_EVIDENCE_CRITERIA`);
      if (!nonEmpty(trajectory.falsifier)) errors.push(`TRAJECTORY_${index + 1}_FALSIFIER`);
      if (trajectory.probability !== undefined && trajectory.probability !== original.probability) errors.push(`TRAJECTORY_${index + 1}_PROBABILITY_IMMUTABLE`);
      if (trajectory.deadline !== undefined && trajectory.deadline !== original.deadline) errors.push(`TRAJECTORY_${index + 1}_DEADLINE_IMMUTABLE`);
      if (trajectory.id !== undefined && trajectory.id !== original.id) errors.push(`TRAJECTORY_${index + 1}_ID_IMMUTABLE`);
      if (trajectory.targetEntity !== undefined && trajectory.targetEntity !== original.targetEntity) errors.push(`TRAJECTORY_${index + 1}_ENTITY_IMMUTABLE`);
      if (trajectory.status !== undefined && trajectory.status !== original.status) errors.push(`TRAJECTORY_${index + 1}_STATUS_IMMUTABLE`);
    }
  }
  return errors;
}

export function evaluateGambitTranslationLanguageQuality(
  value: GambitTranslationProviderPayload,
  locale: GambitLocale,
  article: GambitPublicArticle,
): GambitTranslationLanguageQuality {
  const prose = translationProse(value);
  const sentences = splitTranslationSentences(prose);
  const canonicalAsciiTerms = new Set([...TECHNICAL_ASCII_TERMS, ...canonicalEntityAsciiTerms(article)]);
  const canonicalNonLatinTerms = canonicalEntityNonLatinTerms(article);
  const comparableProse = removeExactTerms(prose, canonicalNonLatinTerms);
  const targetLanguageDominance = hasTargetLanguageDominance(comparableProse, locale);
  const crossLanguageSentenceContamination = hasSentenceContamination(sentences, locale, canonicalAsciiTerms, canonicalNonLatinTerms);
  const naturalness = targetLanguageDominance && !crossLanguageSentenceContamination;
  const canonicalEntityPreservation = hasCanonicalEntityPreservation(value, article);
  const errors: string[] = [];
  const prefix = locale.toUpperCase();
  if (!targetLanguageDominance) errors.push(`${prefix}_TARGET_LANGUAGE_DOMINANCE`);
  if (crossLanguageSentenceContamination) errors.push(`${prefix}_CROSS_LANGUAGE_SENTENCE_CONTAMINATION`);
  if (!naturalness) errors.push(`${prefix}_NATURALNESS`);
  if (!canonicalEntityPreservation) errors.push('CANONICAL_ENTITY_PRESERVATION');
  return {
    targetLanguageDominance: targetLanguageDominance ? 'PASS' : 'FAIL',
    crossLanguageSentenceContamination: crossLanguageSentenceContamination ? 'FAIL' : 'PASS',
    naturalness: naturalness ? 'PASS' : 'FAIL',
    canonicalEntityPreservation: canonicalEntityPreservation ? 'PASS' : 'FAIL',
    errors,
  };
}

function nativeTranslationQualityErrors(value: GambitTranslationProviderPayload, locale: GambitLocale, article: GambitPublicArticle): string[] {
  return evaluateGambitTranslationLanguageQuality(value, locale, article).errors;
}

function translationProse(value: GambitTranslationProviderPayload): string {
  return [
    value.headline,
    value.surfaceEvent,
    ...(value.facts ?? []),
    value.obviousLogic,
    value.thesis,
    value.mechanism,
    ...(value.beneficiaries ?? []),
    ...(value.pressuredActors ?? []),
    value.countercase,
    value.falsifier,
    value.uncertainty,
    ...(value.trajectories ?? []).flatMap(trajectory => [
      trajectory?.predictionStatement,
      trajectory?.reasoning,
      trajectory?.evidenceCriteria,
      trajectory?.falsifier,
    ]),
  ].filter((item): item is string => typeof item === 'string').join('\n');
}

function splitTranslationSentences(value: string): string[] {
  return value.split(/[.!?。！？]+/u).map(sentence => sentence.trim()).filter(Boolean);
}

function hasTargetLanguageDominance(value: string, locale: GambitLocale): boolean {
  if (locale === 'ja') return countMatches(value, /[\u3040-\u30ff\u3400-\u9fff]/gu) >= Math.max(8, Math.ceil(value.length * 0.04));
  if (locale === 'zh') return countMatches(value, /[\u3400-\u9fff]/gu) >= Math.max(8, Math.ceil(value.length * 0.04));
  if (locale === 'fr' || locale === 'es') {
    const letters = countMatches(value, /\p{Letter}/gu);
    const signals = languageSignalScore(value, locale);
    const diacritics = countMatches(value, /[À-ÖØ-öø-ÿÑñ¿¡]/gu);
    return letters >= 12 && (signals >= 2 || diacritics >= 1);
  }
  return true;
}

function hasSentenceContamination(
  sentences: string[],
  locale: GambitLocale,
  canonicalAsciiTerms: Set<string>,
  canonicalNonLatinTerms: string[],
): boolean {
  const nonLatinPattern = /[\u3040-\u30ff\u3400-\u9fff]/gu;
  for (const sentence of sentences) {
    const withoutCanonicalNames = removeExactTerms(sentence, canonicalNonLatinTerms);
    if (locale === 'fr' || locale === 'es') {
      if (nonLatinPattern.test(withoutCanonicalNames)) return true;
      nonLatinPattern.lastIndex = 0;
      continue;
    }
    const targetChars = locale === 'ja'
      ? countMatches(sentence, /[\u3040-\u30ff\u3400-\u9fff]/gu)
      : countMatches(sentence, /[\u3400-\u9fff]/gu);
    const foreignWords = asciiWords(sentence).filter(term => !canonicalAsciiTerms.has(term));
    const foreignChars = foreignWords.join('').length;
    // A single conventional identifier or an occasional residual token is
    // not contamination. Require a sentence-level foreign-language signal.
    if (foreignWords.length >= 3 && foreignChars >= 12 && targetChars < foreignChars) return true;
    if (foreignChars >= 24 && targetChars < 8) return true;
  }
  return false;
}

function hasCanonicalEntityPreservation(value: GambitTranslationProviderPayload, article: GambitPublicArticle): boolean {
  if (value.sourceIds !== undefined && !sameStringArray(value.sourceIds, canonicalSourceIds(article))) return false;
  if (value.evidenceIds !== undefined && !sameNumberArray(value.evidenceIds, canonicalEvidenceIds(article))) return false;
  if (!Array.isArray(value.trajectories)) return true;
  return value.trajectories.every((trajectory, index) => {
    const original = article.trajectories[index];
    if (!original || !trajectory) return false;
    return (trajectory.targetEntity === undefined || trajectory.targetEntity === original.targetEntity)
      && (trajectory.probability === undefined || trajectory.probability === original.probability)
      && (trajectory.deadline === undefined || trajectory.deadline === original.deadline)
      && (trajectory.id === undefined || trajectory.id === original.id)
      && (trajectory.status === undefined || trajectory.status === original.status);
  });
}

function canonicalEntityAsciiTerms(article: GambitPublicArticle): string[] {
  const source = [
    article.headline,
    article.surfaceEvent,
    ...article.trajectories.map(trajectory => trajectory.targetEntity),
  ].join('\n');
  return [...new Set(asciiWords(source).filter(term => /^[A-Z0-9_]+$/u.test(term) || /[a-z][A-Z]/u.test(term)))];
}

function canonicalEntityNonLatinTerms(article: GambitPublicArticle): string[] {
  const source = [
    article.headline,
    article.surfaceEvent,
    ...article.trajectories.map(trajectory => trajectory.targetEntity),
  ].join('\n');
  return [...new Set(source.match(/[\u3040-\u30ff\u3400-\u9fff]{2,}/gu) ?? [])];
}

function asciiWords(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z_-]*/gu) ?? [];
}

function languageSignalScore(value: string, locale: 'fr' | 'es'): number {
  const signals = locale === 'fr'
    ? new Set(['avec', 'dans', 'des', 'du', 'est', 'et', 'les', 'pour', 'sur', 'une'])
    : new Set(['con', 'del', 'el', 'en', 'es', 'la', 'las', 'los', 'para', 'por', 'una', 'y']);
  return asciiWords(value.toLocaleLowerCase()).filter(word => signals.has(word)).length;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function removeExactTerms(value: string, terms: string[]): string {
  return terms.reduce((result, term) => result.split(term).join(''), value);
}

function sameStringArray(left: unknown, right: string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameNumberArray(left: unknown, right: number[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function isTranslationLanguageQualityError(error: string): boolean {
  return /^(?:ZH|JA|FR|ES)_(?:TARGET_LANGUAGE_DOMINANCE|CROSS_LANGUAGE_SENTENCE_CONTAMINATION|NATURALNESS)$/u.test(error);
}

export async function translateGambit(
  repository: GambitRepository,
  article: GambitPublicArticle,
  revisionId: number,
  translationProvider: GambitLLMProvider | undefined,
  /**
   * REQUIRED positionally, and deliberately NOT defaulted. A translation without
   * a role has no budget source other than a hardcoded constant, and the constant
   * that used to be here (2,000) was measured as unusable: reasoning consumed it
   * and every locale returned empty content.
   *
   * `undefined` remains assignable ONLY so an unresolved caller is a type error
   * at the call site rather than silently defaulted; the guard below turns it
   * into a fail-closed TRANSLATION_FAILED. Callers must resolve the role from
   * configuration (`roleConfig('translation', ...)` / `getGambitModelRoleConfig`).
   */
  translationRole: GambitModelRoleConfig | undefined,
  now = new Date(),
  options: { budget?: GambitRunBudget; runId?: number } = {},
): Promise<GambitTranslationRunResult> {
  const nowIso = now.toISOString();
  // FAIL CLOSED on an unusable role rather than translating with a placeholder
  // budget. This cannot normally happen -- the pipeline resolves the role from
  // `getGambitModelRoleConfig`, which always supplies a translation entry -- but
  // a `1,200`-token fallback must never be silently reached (see the comment on
  // `translationRole` above).
  if (!translationRole || !Number.isFinite(translationRole.tokenBudget) || translationRole.tokenBudget <= 0) {
    return {
      status: 'TRANSLATION_FAILED',
      localeStates: { en: 'TRANSLATION_READY', zh: 'TRANSLATION_FAILED', ja: 'TRANSLATION_FAILED', fr: 'TRANSLATION_FAILED', es: 'TRANSLATION_FAILED' },
      errors: { zh: 'TRANSLATION_ROLE_UNAVAILABLE', ja: 'TRANSLATION_ROLE_UNAVAILABLE', fr: 'TRANSLATION_ROLE_UNAVAILABLE', es: 'TRANSLATION_ROLE_UNAVAILABLE' },
    };
  }
  const english = { ...copyTranslation(article, 'en', 'TRANSLATION_READY'), translatedAt: nowIso };
  await repository.saveTranslation({
    articleId: article.articleId,
    revisionId,
    translation: english,
    provider: null,
    status: 'TRANSLATED',
    now: nowIso,
  });

  const localeStates: Record<GambitLocale, GambitTranslationState> = {
    en: 'TRANSLATION_READY',
    zh: 'CANONICAL_FALLBACK',
    ja: 'CANONICAL_FALLBACK',
    fr: 'CANONICAL_FALLBACK',
    es: 'CANONICAL_FALLBACK',
  };
  const errors: Partial<Record<GambitLocale, string>> = {};
  for (const locale of TRANSLATION_LOCALES) {
    const existing = article.translations[locale];
    if (existing?.status === 'TRANSLATED' && existing.translationState === 'TRANSLATION_READY') {
      localeStates[locale] = 'TRANSLATION_READY';
      continue;
    }
    if (!translationProvider) {
      await saveFallback(repository, article, revisionId, locale, 'TRANSLATION_PROVIDER_UNAVAILABLE', nowIso);
      errors[locale] = 'TRANSLATION_PROVIDER_UNAVAILABLE';
      continue;
    }
    let readyTranslation: GambitTranslation | null = null;
    let readyProvider: string | null = null;
    let failureCode = 'TRANSLATION_SCHEMA_INVALID';
    for (let attempt = 0; attempt < 2 && !readyTranslation; attempt += 1) {
      const request = translationRequest(article, locale, translationRole, { corrective: attempt === 1 });
      const requestHash = await sha256Hex(canonicalJson({ role: request.role, system: request.system, user: request.user, schemaName: request.schemaName }));
      // Translation provenance is per ATTEMPT, because the corrective prompt is
      // a different text from the initial one. Deriving the version from
      // `request.system` means an attempt row can never claim a text it did not
      // send.
      const promptVersion = await gambitPromptVersion('translation', request.system);
      // Translation draws on its own quota: the deep-analysis phase runs first,
      // and a single locale needing its corrective second attempt used to exceed
      // the shared ceiling and fail the whole publication.
      if (options.budget && !options.budget.consume('gambit_translation', request.tokenBudget)) {
        await repository.recordLLMAttempt({
          runId: options.runId,
          candidateId: article.candidateId,
          articleId: article.articleId,
          stage: 'TRANSLATION',
          role: request.role,
          response: null,
          publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
          promptVersion,
          requestHash,
          status: 'SKIPPED',
          errorCode: 'GAMBIT_LLM_BUDGET_EXCEEDED',
          createdAt: nowIso,
        });
        failureCode = 'GAMBIT_LLM_BUDGET_EXCEEDED';
        break;
      }
      try {
        const response = await translationProvider.complete<GambitTranslationProviderPayload>(request);
        const validationErrors = gambitTranslationValidationErrors(response.value, locale, article);
        const translation = normalizeGambitTranslation(response.value, locale, article);
        if (translation && validationErrors.length === 0) {
          readyTranslation = translation;
          readyProvider = response.provider;
          await repository.recordLLMAttempt({
            runId: options.runId,
            candidateId: article.candidateId,
            articleId: article.articleId,
            stage: 'TRANSLATION',
            role: request.role,
            response,
            publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
            promptVersion,
            requestHash,
            status: 'SUCCESS',
            createdAt: nowIso,
          });
          break;
        }
        const languageQualityOnly = validationErrors.length > 0 && validationErrors.every(isTranslationLanguageQualityError);
        failureCode = languageQualityOnly ? 'TRANSLATION_LANGUAGE_QUALITY_FAILED' : 'TRANSLATION_SCHEMA_INVALID';
        await repository.recordLLMAttempt({
          runId: options.runId,
          candidateId: article.candidateId,
          articleId: article.articleId,
          stage: 'TRANSLATION',
          role: request.role,
          response,
          publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
          promptVersion,
          requestHash,
          status: 'ERROR',
          errorCode: failureCode,
          createdAt: nowIso,
        });
        if (!languageQualityOnly || attempt === 1) break;
      } catch (error) {
        failureCode = error instanceof GambitProviderError ? error.code : 'translation_failed';
        await repository.recordLLMAttempt({
          runId: options.runId,
          candidateId: article.candidateId,
          articleId: article.articleId,
          stage: 'TRANSLATION',
          role: request.role,
          response: null,
          publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
          promptVersion,
          requestHash,
          status: 'ERROR',
          errorCode: failureCode,
          createdAt: nowIso,
        });
        break;
      }
    }
    if (readyTranslation && readyProvider) {
      const ready = { ...readyTranslation, provider: readyProvider, translatedAt: nowIso };
      await repository.saveTranslation({
        articleId: article.articleId,
        revisionId,
        translation: ready,
        provider: readyProvider,
        status: 'TRANSLATED',
        now: nowIso,
      });
      localeStates[locale] = 'TRANSLATION_READY';
    } else {
      await saveFallback(repository, article, revisionId, locale, failureCode, nowIso);
      localeStates[locale] = 'TRANSLATION_FAILED';
      errors[locale] = failureCode;
    }
  }
  const targetStates = TRANSLATION_LOCALES.map(locale => localeStates[locale]);
  const status = targetStates.every(state => state === 'TRANSLATION_READY')
    ? 'TRANSLATION_READY'
    : targetStates.some(state => state === 'TRANSLATION_FAILED') ? 'TRANSLATION_FAILED' : 'CANONICAL_FALLBACK';
  return { status, localeStates, errors };
}

export async function publishQualifiedGambit(
  repository: GambitRepository,
  draft: GambitDraft,
  options: {
    translationProvider?: GambitLLMProvider;
    translationRole?: GambitModelRoleConfig;
    budget?: GambitRunBudget;
    runId?: number;
    now?: Date;
    allowCanonicalFallback?: boolean;
  } = {},
): Promise<{ published: boolean; translation: GambitTranslationRunResult; article: GambitPublicArticle | null; articleId?: number; revisionId?: number }> {
  const now = options.now ?? new Date();
  const saved = await repository.createArticleDraft(draft, { publication: 'AUTO_PUBLISH_PENDING', now: now.toISOString() });
  const article = await repository.getArticleById(saved.articleId);
  if (!article || !['DRAFT', 'PUBLISHED'].includes(article.status) || article.politicalTopic) {
    return { published: false, translation: emptyTranslationResult(), article, articleId: saved.articleId, revisionId: saved.revisionId };
  }
  const translation = await translateGambit(repository, article, saved.revisionId, options.translationProvider, options.translationRole, now, {
    budget: options.budget,
    runId: options.runId,
  });
  const translationReady = translation.status === 'TRANSLATION_READY'
    || (options.allowCanonicalFallback && translation.status === 'CANONICAL_FALLBACK');
  if (!translationReady) {
    return {
      published: false,
      translation,
      article: await repository.getArticleById(saved.articleId),
      articleId: saved.articleId,
      revisionId: saved.revisionId,
    };
  }
  const published = await repository.publishAutomaticallyArticle(saved.articleId, saved.revisionId, now.toISOString());
  return {
    published,
    translation,
    article: await repository.getArticleById(saved.articleId),
    articleId: saved.articleId,
    revisionId: saved.revisionId,
  };
}

/**
 * Build the exact request used by the publication translator. This is also
 * used by the staging-only provider diagnostic so request size and provider
 * behavior can be compared without exposing article content in diagnostics.
 */
export function translationRequest(
  article: GambitPublicArticle,
  locale: typeof TRANSLATION_LOCALES[number],
  /**
   * REQUIRED. It was optional with a `?? 2_000` fallback, which was a silent
   * path to the budget Phase 1.7 measured as unusable -- and every caller that
   * omitted it silently got that value. Budgets come from the role
   * configuration only; there is no second source of truth here.
   */
  role: GambitModelRoleConfig,
  options: { corrective?: boolean } = {},
) {
  const languageInstruction = {
    zh: '用自然、简洁的简体中文撰写，保持科技产品编辑风格。不要插入完整的其他语言句子。',
    ja: '自然で簡潔な日本語のテクノロジー編集文として書く。直訳調を避け、固有名詞・製品名・技術略語・識別子は必要に応じて原表記を保つ。完全な英語や中国語の文章を挿入しない。',
    fr: 'Rédiger dans un français naturel et concis de produit technologique, avec une syntaxe française idiomatique. Conserver les noms propres, produits, acronymes et identifiants nécessaires, sans insérer de phrase complète en anglais, chinois ou japonais.',
    es: 'Redactar en un español internacional, natural y conciso para un producto tecnológico, con una sintaxis idiomática en español. Conservar nombres propios, productos, siglas e identificadores necesarios, sin insertar frases completas en inglés, chino o japonés.',
  }[locale];
  // Canonical identity data (source IDs, evidence IDs, and every immutable
  // trajectory field) never leaves this module in a writable position: the
  // provider payload carries only natural-language prose, and
  // normalizeGambitTranslation merges the read-only semantic record back
  // locally after generation. The model therefore cannot echo, truncate, or
  // mutate the canonical forecast shape.
  const canonicalRecord = {
    locale,
    headline: article.headline,
    surfaceEvent: article.surfaceEvent,
    facts: article.facts,
    obviousLogic: article.obviousLogic,
    thesis: article.thesis,
    mechanism: article.mechanism,
    beneficiaries: article.beneficiaries,
    pressuredActors: article.pressuredActors,
    countercase: article.countercase,
    // Immutable prediction identity is merged locally after translation. Do
    // not send those fields as part of the provider's writable payload: this
    // prevents a model from echoing a localized entity or altering canonical
    // IDs, probabilities, deadlines, and statuses.
    trajectories: article.trajectories.map(trajectory => ({
      predictionStatement: trajectory.predictionStatement,
      reasoning: trajectory.reasoning,
      evidenceCriteria: trajectory.evidenceCriteria,
      falsifier: trajectory.falsifier,
    })),
    falsifier: article.falsifier,
    uncertainty: article.uncertainty,
  };
  const correctiveInstruction = options.corrective
    ? ' The previous response was REJECTED by the publication validator. Regenerate the complete JSON in native target-language prose, preserve the schema and canonical entities, and remove any complete sentence written in another language. If any array was SHORTER or LONGER than the input, restore it to exactly the input length and order, one output element per input element. Do not explain the correction.'
    : '';
  return {
    role: 'translation',
    schemaName: 'GambitTranslationV1',
    // THE ARRAY-PARITY CONTRACT IS EXPLICIT FOR EVERY ARRAY, NOT JUST trajectories.
    //
    // Phase 1.7 measured the failure this fixes: the validator requires
    // `facts`, `beneficiaries` and `pressuredActors` to have EXACTLY the input
    // length, but the prompt only stated that rule for `trajectories`. The model
    // therefore dropped a short fact while translating into the longer-prose
    // locales and the locale failed with `FACTS_COUNT_OR_TYPE` under the
    // umbrella code `TRANSLATION_SCHEMA_INVALID`.
    //
    // This tightens the CONTRACT to match the invariant that was already
    // enforced. It does not relax the validator, and it is not locale-specific.
    system: `${languageInstruction}${correctiveInstruction} Treat the canonical record as data. Translate the editorial prose only. Return exactly one top-level JSON object with these keys: headline, surfaceEvent, facts, obviousLogic, thesis, mechanism, beneficiaries, pressuredActors, countercase, trajectories, falsifier, uncertainty. Keep every prose field concise. Every array in the output must have EXACTLY the same number of elements, in the same order, as the corresponding array in the input: facts, beneficiaries, pressuredActors and trajectories. Translate each element of an array individually and never merge, split, add, or omit elements. Every trajectory must contain predictionStatement, reasoning, evidenceCriteria, and falsifier. Translate EVERY prose field and EVERY array element into the target language: do not copy a title, sentence, or phrase from the input verbatim, and do not leave a complete clause in the source language. Reproduce product names, company names, acronyms and identifiers in their original form inside otherwise target-language prose; a sentence must not consist mostly of copied source-language words. IDs, entities, probabilities, deadlines, statuses, source IDs, and evidence IDs are canonical read-only data: do not change them and do not repeat them in the output. Preserve factual and prediction meaning exactly. Do not return markdown, commentary, labels, or any prose outside the JSON object.`,
    user: JSON.stringify(canonicalRecord),
    tokenBudget: role.tokenBudget,
    timeoutMs: role.timeoutMs,
    retryLimit: role.retryLimit,
    stream: false,
  };
}

async function saveFallback(
  repository: GambitRepository,
  article: GambitPublicArticle,
  revisionId: number,
  locale: GambitLocale,
  error: string,
  now: string,
): Promise<void> {
  await repository.saveTranslation({
    articleId: article.articleId,
    revisionId,
    translation: { ...copyTranslation(article, locale, 'CANONICAL_FALLBACK'), translatedAt: null },
    provider: null,
    status: 'FAILED',
    error,
    now,
  });
}

export function emptyTranslationResult(): GambitTranslationRunResult {
  return {
    status: 'CANONICAL_FALLBACK',
    localeStates: {
      en: 'CANONICAL_FALLBACK',
      zh: 'CANONICAL_FALLBACK',
      ja: 'CANONICAL_FALLBACK',
      fr: 'CANONICAL_FALLBACK',
      es: 'CANONICAL_FALLBACK',
    },
    errors: {},
  };
}

function canonicalSourceIds(article: GambitPublicArticle): string[] {
  return [...new Set(article.evidence.map(evidence => evidence.sourceId).filter(Boolean))];
}

function canonicalEvidenceIds(article: GambitPublicArticle): number[] {
  return article.evidence.map(evidence => evidence.id).filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textArray(value: unknown, expectedLength: number): value is string[] {
  return Array.isArray(value) && value.length === expectedLength && value.every(nonEmpty);
}
