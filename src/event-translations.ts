import { Repository } from './db/repository';
import { getCommunityConfig, type CommunityConfig } from './community/config';
import { createTranslationProvider, type TranslationProvider } from './community/translation';
import type { Env, EventTranslationLocale, MonitorEvent } from './types';
import { EVENT_TRANSLATION_LOCALES } from './types';

const EVENT_TITLE_MARKER = '__TIBO_EVENT_TITLE__';
const EVENT_SUMMARY_MARKER = '__TIBO_EVENT_SUMMARY__';
const MAX_TRANSLATED_TITLE_LENGTH = 1000;
const MAX_TRANSLATED_SUMMARY_LENGTH = 8000;

export interface EventTranslationResult {
  translated: number;
  failed: number;
  targets: EventTranslationLocale[];
}

export interface EventTranslationBackfillResult extends EventTranslationResult {
  processed: number;
  remaining: number;
}

function parseEventTranslation(value: string): { title: string; summary: string } {
  const titleMarker = value.indexOf(EVENT_TITLE_MARKER);
  const summaryMarker = value.indexOf(EVENT_SUMMARY_MARKER);
  if (titleMarker < 0 || summaryMarker < 0 || summaryMarker <= titleMarker) {
    throw new Error('translation_event_markers_missing');
  }

  const title = value.slice(titleMarker + EVENT_TITLE_MARKER.length, summaryMarker).trim();
  const summary = value.slice(summaryMarker + EVENT_SUMMARY_MARKER.length).trim();
  if (!title || !summary) throw new Error('translation_event_content_missing');
  if (title.includes('__TIBO_') || summary.includes('__TIBO_')) {
    throw new Error('translation_event_placeholder_leaked');
  }
  if (Array.from(title).length > MAX_TRANSLATED_TITLE_LENGTH) throw new Error('translation_event_title_too_long');
  if (Array.from(summary).length > MAX_TRANSLATED_SUMMARY_LENGTH) throw new Error('translation_event_summary_too_long');
  return { title, summary };
}

async function translateEventContent(
  provider: TranslationProvider,
  event: MonitorEvent,
  targetLanguage: EventTranslationLocale,
): Promise<{ title: string; summary: string }> {
  const translated = await provider.translate({
    text: [
      EVENT_TITLE_MARKER,
      event.title_en,
      EVENT_SUMMARY_MARKER,
      event.summary_en,
    ].join('\n'),
    sourceLanguage: 'en',
    targetLanguage,
  });
  return parseEventTranslation(translated);
}

function failureReason(value: unknown): string {
  if (!(value instanceof Error)) return 'translation_failed';
  const message = value.message.trim();
  // Keep only a bounded operational code/message. Provider response bodies,
  // credentials, and original event content are never copied to D1.
  return message ? message.slice(0, 160) : 'translation_failed';
}

export async function processMonitorEventTranslations(
  event: MonitorEvent,
  env: Env,
  repository = new Repository(env.DB),
  config: CommunityConfig = getCommunityConfig(env),
  now = new Date(),
): Promise<EventTranslationResult> {
  const existing = event.translations || {};
  const targets = EVENT_TRANSLATION_LOCALES.filter(language => {
    const translation = existing[language];
    return translation?.status !== 'translated' || !translation.title || !translation.summary;
  });

  if (targets.length === 0) return { translated: 0, failed: 0, targets: [] };

  const provider = createTranslationProvider(config);
  const providerName = provider?.name ?? null;
  const results = await Promise.allSettled(targets.map(target => {
    if (!provider) return Promise.reject(new Error('translation_provider_unavailable'));
    return translateEventContent(provider, event, target);
  }));

  let translated = 0;
  let failed = 0;
  for (const [index, result] of results.entries()) {
    const language = targets[index];
    if (result.status === 'fulfilled') {
      await repository.upsertEventTranslation({
        eventId: event.id!,
        language,
        title: result.value.title,
        summary: result.value.summary,
        status: 'translated',
        provider: providerName,
        translatedAt: now.toISOString(),
        lastError: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      translated += 1;
      continue;
    }

    failed += 1;
    const reason = failureReason(result.reason);
    console.warn('[Event Translation] translation_failed', {
      eventId: event.id,
      targetLanguage: language,
      error: reason,
    });
    await repository.upsertEventTranslation({
      eventId: event.id!,
      language,
      title: null,
      summary: null,
      status: 'failed',
      provider: providerName,
      translatedAt: null,
      lastError: reason,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  return { translated, failed, targets };
}

/** Translate the oldest incomplete events in small bounded batches. */
export async function backfillMonitorEventTranslations(
  env: Env,
  limit = 1,
  repository = new Repository(env.DB),
  config: CommunityConfig = getCommunityConfig(env),
): Promise<EventTranslationBackfillResult> {
  const events = await repository.getEventsNeedingTranslations(limit);
  let translated = 0;
  let failed = 0;
  const targets: EventTranslationLocale[] = [];
  for (const event of events) {
    const result = await processMonitorEventTranslations(event, env, repository, config);
    translated += result.translated;
    failed += result.failed;
    for (const target of result.targets) {
      if (!targets.includes(target)) targets.push(target);
    }
  }
  return {
    processed: events.length,
    translated,
    failed,
    targets,
    remaining: await repository.countEventsNeedingTranslations(),
  };
}

export { parseEventTranslation, translateEventContent };
