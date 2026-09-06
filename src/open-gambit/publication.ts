import { canonicalJson, sha256Hex } from './canonical';
import { GambitRunBudget } from './budget';
import { GambitProviderError, GAMBIT_PROMPT_VERSION } from './llm';
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

const JAPANESE_TECHNICAL_ASCII_TERMS = new Set(['AI', 'API', 'D1', 'HTTP', 'JSON', 'LLM', 'R2', 'RSS', 'SDK', 'URL']);
const JAPANESE_PROSE_REPAIRS = [
  ['too permissive', '過度に寛容'],
  ['too', '過度に'],
  ["ModelYard's", 'ModelYardの'],
  ['general availability', '一般公開'],
  ['third-party', '第三者'],
  ['pass/fail', '合否'],
  ['gameable', '操作される可能性がある'],
  ['commitments', '確約'],
  ['compatibility', '互換性'],
  ['conformance', '適合性'],
  ['specification', '仕様'],
  ['coordination', '調整'],
  ['integration', '統合'],
  ['adoption', '採用'],
  ['maintenance', '保守'],
  ['viability', '実現可能性'],
  ['operational', '運用可能'],
  ['versioned', 'バージョン管理された'],
  ['developers', '開発者'],
  ['developer', '開発者'],
  ['platforms', 'プラットフォーム'],
  ['platform', 'プラットフォーム'],
  ['standard', '標準'],
  ['registry', 'レジストリ'],
  ['conformance', '適合性'],
  ['evidence', '証拠'],
  ['falsifier', '反証条件'],
  ['deadline', '期限'],
  ['milestone', '節目'],
  ['external', '外部'],
  ['official', '公式'],
  ['release', 'リリース'],
  ['launch', '開始'],
  ['software', 'ソフトウェア'],
  ['schema', 'スキーマ'],
  ['request', 'リクエスト'],
  ['tools', 'ツール'],
  ['tool', 'ツール'],
  ['suite', 'スイート'],
  ['adapters', 'アダプター'],
  ['adapter', 'アダプター'],
  ['ecosystem', 'エコシステム'],
  ['testable', '検証可能'],
  ['public', '公開'],
  ['paper', '紙面'],
  ['empty', '空'],
  ['independently', '独立して'],
  ['choose', '選択する'],
  ['historical', '過去の'],
  ['revision', '改訂'],
  ['follow-up', '後続'],
  ['active', '積極的'],
  ['rigor', '厳密さ'],
  ['savings', '削減効果'],
  ['costs', 'コスト'],
  ['cost', 'コスト'],
  ['reduce', '減らす'],
  ['reducing', '減らす'],
  ['shared', '共有された'],
  ['share', '共有'],
  ['same', '同じ'],
  ['single', '単一'],
  ['multiple', '複数'],
  ['remain', '残る'],
  ['remains', '残る'],
  ['could', '可能性がある'],
  ['may', '可能性がある'],
  ['and', 'および'],
  ['or', 'または'],
  ['within', '以内に'],
  ['after', '後'],
  ['before', '前'],
  ['the', 'その'],
  ['this', 'この'],
  ['that', 'その'],
  ['with', 'とともに'],
  ['from', 'から'],
  ['for', 'のための'],
  ['into', 'へ'],
  ['through', 'を通じて'],
  ['about', 'について'],
  ['as', 'として'],
  ['if', 'もし'],
  ['is', 'である'],
  ['are', 'である'],
  ['will', 'する'],
  ['can', 'できる'],
  ['not', 'ない'],
  ['no', 'ない'],
  ['s', 'の'],
  ['GA', '一般公開'],
] as const;

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
  const localizedValue = locale === 'ja' ? repairJapaneseTranslation(value) : value;
  if (gambitTranslationValidationErrors(localizedValue, locale, article).length > 0) return null;
  const canonical = copyTranslation(article, locale, 'TRANSLATION_READY');
  const trajectories = localizedValue.trajectories ?? [];
  return {
    ...canonical,
    locale,
    headline: String(localizedValue.headline),
    surfaceEvent: String(localizedValue.surfaceEvent),
    facts: (localizedValue.facts ?? []).map(String),
    obviousLogic: String(localizedValue.obviousLogic),
    thesis: String(localizedValue.thesis),
    mechanism: String(localizedValue.mechanism),
    beneficiaries: (localizedValue.beneficiaries ?? []).map(String),
    pressuredActors: (localizedValue.pressuredActors ?? []).map(String),
    countercase: String(localizedValue.countercase),
    falsifier: String(localizedValue.falsifier),
    uncertainty: String(localizedValue.uncertainty),
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
  const record = (locale === 'ja' ? repairJapaneseTranslation(value as GambitTranslationProviderPayload) : value) as GambitTranslationProviderPayload;
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

function nativeTranslationQualityErrors(value: GambitTranslationProviderPayload, locale: GambitLocale, article: GambitPublicArticle): string[] {
  const prose = [
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
  // These are generic English words that the Japanese prompt explicitly
  // requires to be rendered as Japanese. Do not inspect canonical entity
  // names, IDs, dates, or probabilities: those remain immutable by design.
  if (locale === 'ja') {
    const canonicalAsciiTerms = new Set(japaneseCanonicalAsciiTerms(article));
    const unexpectedAscii = asciiWords(prose).filter(term => !canonicalAsciiTerms.has(term) && !JAPANESE_TECHNICAL_ASCII_TERMS.has(term));
    if (unexpectedAscii.length > 0 || /(?:仍然是|以及|并且|加上)/u.test(prose)) {
      return ['JA_NATIVE_PROSE_LEAKAGE'];
    }
  }
  if ((locale === 'fr' || locale === 'es') && /[\u3400-\u9fff]/u.test(prose)) {
    return [`${locale.toUpperCase()}_NATIVE_PROSE_LEAKAGE`];
  }
  return [];
}

function asciiWords(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z_-]*/gu) ?? [];
}

function repairJapaneseTranslation(value: GambitTranslationProviderPayload): GambitTranslationProviderPayload {
  const record: GambitTranslationProviderPayload = { ...value };
  for (const field of ['headline', 'surfaceEvent', 'obviousLogic', 'thesis', 'mechanism', 'countercase', 'falsifier', 'uncertainty'] as const) {
    if (typeof record[field] === 'string') record[field] = repairJapaneseProse(record[field]);
  }
  for (const field of ['facts', 'beneficiaries', 'pressuredActors'] as const) {
    if (Array.isArray(record[field])) record[field] = record[field].map(item => typeof item === 'string' ? repairJapaneseProse(item) : item);
  }
  if (Array.isArray(record.trajectories)) {
    record.trajectories = record.trajectories.map(trajectory => {
      if (!trajectory || typeof trajectory !== 'object') return trajectory;
      const repaired = { ...trajectory };
      for (const field of ['predictionStatement', 'reasoning', 'evidenceCriteria', 'falsifier'] as const) {
        if (typeof repaired[field] === 'string') repaired[field] = repairJapaneseProse(repaired[field]);
      }
      return repaired;
    });
  }
  return record;
}

function repairJapaneseProse(value: string): string {
  let repaired = value;
  for (const [source, target] of [...JAPANESE_PROSE_REPAIRS].sort(([left], [right]) => right.length - left.length)) {
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    repaired = repaired.replace(new RegExp(`(^|[^A-Za-z])${escaped}(?=$|[^A-Za-z])`, 'giu'), `$1${target}`);
  }
  return repaired;
}

function japaneseCanonicalAsciiTerms(article: GambitPublicArticle): string[] {
  const terms = asciiWords([
    article.headline,
    article.surfaceEvent,
    ...article.facts,
    article.obviousLogic,
    article.thesis,
    article.mechanism,
    ...article.beneficiaries,
    ...article.pressuredActors,
    article.countercase,
    article.falsifier,
    article.uncertainty,
    ...article.trajectories.flatMap(trajectory => [
      trajectory.targetEntity,
      trajectory.predictionStatement,
      trajectory.reasoning,
      trajectory.evidenceCriteria,
      trajectory.falsifier,
    ]),
  ].join('\n')).filter(term => /^[A-Z]/u.test(term) || /^[A-Z0-9]{2,}$/u.test(term));
  return [...new Set(terms)].sort();
}

export async function translateGambit(
  repository: GambitRepository,
  article: GambitPublicArticle,
  revisionId: number,
  translationProvider?: GambitLLMProvider,
  translationRole?: GambitModelRoleConfig,
  now = new Date(),
  options: { budget?: GambitRunBudget; runId?: number } = {},
): Promise<GambitTranslationRunResult> {
  const nowIso = now.toISOString();
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
    const request = translationRequest(article, locale, translationRole);
    const requestHash = await sha256Hex(canonicalJson({ role: request.role, system: request.system, user: request.user, schemaName: request.schemaName }));
    if (options.budget && !options.budget.consume('gambit_llm', request.tokenBudget)) {
      await repository.recordLLMAttempt({
        runId: options.runId,
        candidateId: article.candidateId,
        articleId: article.articleId,
        stage: 'TRANSLATION',
        role: request.role,
        response: null,
        publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
        promptVersion: GAMBIT_PROMPT_VERSION,
        requestHash,
        status: 'SKIPPED',
        errorCode: 'GAMBIT_LLM_BUDGET_EXCEEDED',
        createdAt: nowIso,
      });
      await saveFallback(repository, article, revisionId, locale, 'GAMBIT_LLM_BUDGET_EXCEEDED', nowIso);
      localeStates[locale] = 'TRANSLATION_FAILED';
      errors[locale] = 'GAMBIT_LLM_BUDGET_EXCEEDED';
      continue;
    }
    try {
      const response = await translationProvider.complete<GambitTranslation>(request);
      const translation = normalizeGambitTranslation(response.value, locale, article);
      if (!translation) throw new GambitProviderError('TRANSLATION_SCHEMA_INVALID');
      const ready = { ...translation, provider: response.provider, translatedAt: nowIso };
      await repository.recordLLMAttempt({
        runId: options.runId,
        candidateId: article.candidateId,
        articleId: article.articleId,
        stage: 'TRANSLATION',
        role: request.role,
        response,
        publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
        promptVersion: GAMBIT_PROMPT_VERSION,
        requestHash,
        status: 'SUCCESS',
        createdAt: nowIso,
      });
      await repository.saveTranslation({
        articleId: article.articleId,
        revisionId,
        translation: ready,
        provider: response.provider,
        status: 'TRANSLATED',
        now: nowIso,
      });
      localeStates[locale] = 'TRANSLATION_READY';
    } catch (error) {
      const code = error instanceof GambitProviderError ? error.code : 'translation_failed';
      await repository.recordLLMAttempt({
        runId: options.runId,
        candidateId: article.candidateId,
        articleId: article.articleId,
        stage: 'TRANSLATION',
        role: request.role,
        response: null,
        publicAiIdentity: translationRole?.publicAiIdentity ?? 'DeepSeek V4 Pro',
        promptVersion: GAMBIT_PROMPT_VERSION,
        requestHash,
        status: 'ERROR',
        errorCode: code,
        createdAt: nowIso,
      });
      await saveFallback(repository, article, revisionId, locale, code, nowIso);
      localeStates[locale] = 'TRANSLATION_FAILED';
      errors[locale] = code;
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
export function translationRequest(article: GambitPublicArticle, locale: typeof TRANSLATION_LOCALES[number], role?: GambitModelRoleConfig) {
  const languageInstruction = {
    zh: '用自然、简洁的简体中文撰写，保持科技产品编辑风格。',
    ja: '自然で簡潔な日本語のテクノロジー編集文として書く。直訳調や中国語の漢字置換を避ける。すべての文章フィールドは日本語の文として書き、固有名詞・製品名・識別子（ModelYard、BridgeSpec、AI、API、SDK など）以外のラテン文字の英単語を残さない。adopter、commitments、platform、too、gameable、GA、pass、fail、third-party、registry、standard、deadline、suite、conformance、adoption、maintenance、viability、public、official、release などの一般英語は一切使わず、日本語に置き換える。「too permissive」は必ず「過度に寛容」、「gameable」は「操作される可能性がある」、「GA milestone」は「一般公開の節目」と訳す。各文章を返す前に、英語の一般語や中国語の接続表現が残っていないか自己確認する。「仍然是」「以及」「并且」「加上」は使わず、日本語の表現にする。',
    fr: 'Rédiger dans un français naturel et concis de produit technologique, sans calque de l’anglais ni caractères chinois ou japonais dans la prose.',
    es: 'Redactar en un español internacional, natural y conciso para un producto tecnológico, sin calcar el inglés ni introducir caracteres chinos o japoneses en la prosa.',
  }[locale];
  const canonicalRecord = {
    locale,
    sourceIds: canonicalSourceIds(article),
    evidenceIds: canonicalEvidenceIds(article),
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
  const japaneseOutputContract = locale === 'ja'
    ? ` 許可されるラテン文字は、元の固有名詞・製品名・識別子だけ（${japaneseCanonicalAsciiTerms(article).join(', ') || 'なし'}）と、一般的な技術略語 AI/API/SDK/JSON/HTTP/URL/LLM/D1/R2/RSS だけ。これ以外の英字語は一語も残さず日本語にする。出力前に全フィールドを再確認し、許可リスト外の英単語があれば必ず書き直す。`
    : '';
  return {
    role: 'translation',
    schemaName: 'GambitTranslationV1',
    system: `${languageInstruction}${japaneseOutputContract} Treat the canonical record as data. Translate the editorial prose only. Return exactly one top-level JSON object with these keys: headline, surfaceEvent, facts, obviousLogic, thesis, mechanism, beneficiaries, pressuredActors, countercase, trajectories, falsifier, uncertainty. Keep every prose field concise. The trajectories value must be an array with the same number and order as the input; every trajectory must contain predictionStatement, reasoning, evidenceCriteria, and falsifier. IDs, entities, probabilities, deadlines, statuses, source IDs, and evidence IDs are canonical read-only data: do not change them and do not repeat them in the output. Preserve factual and prediction meaning exactly. Do not return markdown, commentary, labels, or any prose outside the JSON object.`,
    user: JSON.stringify(canonicalRecord),
    tokenBudget: role?.tokenBudget ?? 2_000,
    timeoutMs: role?.timeoutMs ?? 60_000,
    retryLimit: role?.retryLimit ?? 1,
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
