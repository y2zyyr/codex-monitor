import type { Env } from '../types';
import { getCommunityConfig, type CommunityConfig } from './config';
import { canonicalizeGitHubRepositoryUrl, extractGitHubRepositories, fetchGitHubRepository, githubMetadataJson, type GitHubRepositoryReference } from './github';
import { CommunityRepository } from './repository';
import type { CommunityPost } from './types';
import { createTranslationProvider, detectLanguage, translationTargets, type DetectedLanguage, type TranslationProvider } from './translation';
import { SITE_LOCALES, type SiteLocale } from '../i18n';

export interface DerivativeResult {
  translationStatus: CommunityPost['translationStatus'];
  translatedTargets: string[];
  githubEmbeds: number;
  githubFailures: number;
}

function validTranslatedText(value: string, original: string, maxLength: number): boolean {
  const length = Array.from(value).length;
  return length > 0 && length <= Math.max(maxLength * 2, 4000) && (value !== original || original.length > 0);
}

export async function processCommunityTranslation(
  post: CommunityPost,
  env: Env,
  repository: CommunityRepository,
  config = getCommunityConfig(env),
  now = new Date(),
): Promise<{ status: CommunityPost['translationStatus']; targets: string[] }> {
  const sourceLanguage = detectLanguage(post.originalContent);
  const locales = config.translationLocales.length > 0 ? config.translationLocales : [...SITE_LOCALES];
  const targets = translationTargets(sourceLanguage, config.translationEnabled, locales);
  const translations: Partial<Record<SiteLocale, string>> = { ...(post.translations || {}) };
  if (post.contentEn && !translations.en) translations.en = post.contentEn;
  if (post.contentZh && !translations.zh) translations.zh = post.contentZh;
  if (sourceLanguage !== 'und' && locales.includes(sourceLanguage as SiteLocale)) {
    translations[sourceLanguage as SiteLocale] = post.originalContent;
  }
  let providerName: string | null = post.translationProvider;
  let successCount = 0;
  const provider: TranslationProvider | null = createTranslationProvider(config);
  providerName = provider?.name ?? providerName;

  // New locales are generated on publish/retry only. Running the missing
  // target calls together keeps a multilingual post inside the Worker request
  // budget without adding a queue solely for this lightweight feature.
  const missingTargets = targets.filter(target => !translations[target]);
  const results = await Promise.allSettled(missingTargets.map(async targetLanguage => {
    if (!provider) throw new Error('translation_provider_unavailable');
    const translated = await provider.translate({
      text: post.originalContent,
      sourceLanguage,
      targetLanguage,
    });
    if (!validTranslatedText(translated, post.originalContent, Array.from(post.originalContent).length)) {
      throw new Error('translation_result_invalid');
    }
    return { targetLanguage, translated };
  }));
  results.forEach((result, index) => {
    const targetLanguage = missingTargets[index];
    if (result.status === 'fulfilled') {
      translations[targetLanguage] = result.value.translated;
      successCount += 1;
      return;
    }
    // The original post is already durable. Provider errors are recorded in
    // status only; raw content, credentials, and provider response bodies
    // are intentionally absent from logs.
    console.warn('[Community] translation_failed', {
      postId: post.id,
      targetLanguage,
      error: result.reason instanceof Error ? result.reason.message.slice(0, 120) : 'unknown',
    });
  });

  // The source-language copy is useful for the feed, but it is not a
  // translated target. Status therefore reflects the requested target
  // locales, so a Japanese post whose four translations all fail is reported
  // as failed rather than looking partially translated merely because the
  // original Japanese text is present.
  const completedTargets = targets.filter(target => Boolean(translations[target])).length;
  const status: CommunityPost['translationStatus'] = !config.translationEnabled
    ? (completedTargets > 0 ? 'partial' : 'failed')
    : targets.length === 0
      ? 'translated'
      : completedTargets === targets.length
        ? 'translated'
        : completedTargets > 0
          ? 'partial'
          : 'failed';

  await repository.updateTranslation(post.id, {
    originalLanguage: sourceLanguage,
    contentEn: translations.en ?? null,
    contentZh: translations.zh ?? null,
    translationStatus: status,
    translationProvider: providerName,
    translatedAt: (successCount > 0 || completedTargets > 0) ? (post.translatedAt || now.toISOString()) : null,
    updatedAt: now.toISOString(),
    translations,
  });
  return { status, targets: locales.filter(locale => Boolean(translations[locale])) };
}

function languageFromStoredValue(value: string): DetectedLanguage {
  const supported: DetectedLanguage[] = ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'und'];
  return supported.includes(value as DetectedLanguage) ? value as DetectedLanguage : 'und';
}

export async function processCommunityEmbeds(
  post: CommunityPost,
  env: Env,
  repository: CommunityRepository,
  config = getCommunityConfig(env),
  now = new Date(),
): Promise<{ success: number; failures: number }> {
  if (!config.githubCardEnabled) return { success: 0, failures: 0 };
  const references = extractGitHubRepositories(post.originalContent).slice(0, 5);
  let success = 0;
  let failures = 0;
  const cutoff = new Date(now.getTime() - config.githubCacheTtlMs).toISOString();

  for (const reference of references) {
    const existing = await repository.getEmbed(post.id, reference.canonicalUrl);
    if (existing?.fetchStatus === 'success' && existing.fetchedAt && existing.fetchedAt >= cutoff) {
      success += 1;
      continue;
    }

    try {
      const cached = await repository.getFreshEmbed(reference.canonicalUrl, cutoff);
      if (cached) {
        await repository.upsertEmbed({
          postId: post.id,
          type: 'repository',
          provider: 'github',
          url: reference.originalUrl,
          canonicalUrl: reference.canonicalUrl,
          title: cached.title,
          description: cached.description,
          imageUrl: cached.imageUrl,
          metadata: cached.metadata,
          fetchedAt: cached.fetchedAt,
          fetchStatus: 'success',
          lastError: null,
          retryCount: existing?.retryCount ?? 0,
          updatedAt: now.toISOString(),
        });
        success += 1;
        continue;
      }

      const metadata = await fetchGitHubRepository(reference, config);
      // The metadata object has already been validated against the requested
      // owner/repository and only the fixed api.github.com endpoint is used.
      await repository.upsertEmbed({
        postId: post.id,
        type: 'repository',
        provider: 'github',
        url: reference.originalUrl,
        canonicalUrl: metadata.canonicalUrl,
        title: metadata.title,
        description: metadata.description,
        imageUrl: metadata.imageUrl,
        metadata: JSON.parse(githubMetadataJson(metadata.metadata)),
        fetchedAt: now.toISOString(),
        fetchStatus: 'success',
        lastError: null,
        retryCount: existing?.retryCount ?? 0,
        updatedAt: now.toISOString(),
      });
      success += 1;
    } catch (error) {
      failures += 1;
      const code = error instanceof Error && 'code' in error
        ? String((error as { code?: unknown }).code || 'unavailable')
        : 'unavailable';
      await repository.markEmbedFailure(post.id, {
        type: 'repository',
        provider: 'github',
        url: reference.originalUrl,
        canonicalUrl: reference.canonicalUrl,
      }, code, now.toISOString());
      console.warn('[Community] github_embed_failed', {
        postId: post.id,
        canonicalUrl: reference.canonicalUrl,
        code,
      });
    }
  }
  return { success, failures };
}

export async function processCommunityPost(
  postId: number,
  env: Env,
  repository = new CommunityRepository(env.DB),
  config = getCommunityConfig(env),
  now = new Date(),
): Promise<DerivativeResult> {
  const post = await repository.getPostById(postId);
  if (!post) throw new Error('Community post not found');
  const translation = await processCommunityTranslation(post, env, repository, config, now);
  const refreshed = await repository.getPostById(postId);
  const embeds = await processCommunityEmbeds(refreshed ?? post, env, repository, config, now);
  return {
    translationStatus: translation.status,
    translatedTargets: translation.targets,
    githubEmbeds: embeds.success,
    githubFailures: embeds.failures,
  };
}

export async function retryCommunityTranslation(
  postId: number,
  env: Env,
  repository = new CommunityRepository(env.DB),
  config = getCommunityConfig(env),
): Promise<CommunityPost | null> {
  const post = await repository.getPostById(postId);
  if (!post) return null;
  await processCommunityTranslation(post, env, repository, config);
  return repository.getPostById(postId);
}

export async function retryCommunityEmbeds(
  postId: number,
  env: Env,
  repository = new CommunityRepository(env.DB),
  config = getCommunityConfig(env),
): Promise<CommunityPost | null> {
  const post = await repository.getPostById(postId);
  if (!post) return null;
  const references = extractGitHubRepositories(post.originalContent);
  // A retry explicitly invalidates the per-post success rows while retaining
  // the global fresh-cache path for the same canonical repository.
  for (const reference of references) {
    const existing = await repository.getEmbed(post.id, reference.canonicalUrl);
    if (existing?.fetchStatus === 'success') {
      await repository.markEmbedFailure(post.id, {
        type: 'repository',
        provider: 'github',
        url: reference.originalUrl,
        canonicalUrl: reference.canonicalUrl,
      }, 'admin_retry', new Date().toISOString());
    }
  }
  await processCommunityEmbeds(post, env, repository, config);
  return repository.getPostById(postId);
}

/** Validate and normalize a repository URL supplied by future callers. */
export function normalizeCommunityGitHubUrl(value: string): GitHubRepositoryReference | null {
  return canonicalizeGitHubRepositoryUrl(value);
}

export function sourceLanguageForPost(post: CommunityPost): DetectedLanguage {
  return languageFromStoredValue(post.originalLanguage);
}
