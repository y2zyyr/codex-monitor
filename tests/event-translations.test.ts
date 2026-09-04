import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env, MonitorEvent } from '../src/types';
import { getCommunityConfig } from '../src/community/config';
import type { CommunityConfig } from '../src/community/config';
import { backfillMonitorEventTranslations, parseEventTranslation, processMonitorEventTranslations } from '../src/event-translations';
import type { Repository } from '../src/db/repository';

function event(overrides: Partial<MonitorEvent> = {}): MonitorEvent {
  return {
    id: 54,
    source_post_id: 100,
    source_account: 'thsottiaux',
    category: 'POLICY_CHANGE',
    title_en: 'Codex policy update preserves `wrangler.toml`',
    title_zh: 'Codex 政策更新保留 `wrangler.toml`',
    summary_en: 'The update clarifies:\nnpm run deploy\nand links https://github.com/openai/codex for developers.',
    summary_zh: '这项更新说明了开发者使用的命令和链接。',
    confidence: 0.9,
    published_at: '2026-08-31T00:00:00.000Z',
    effective_at: null,
    reset_at: null,
    source_url: 'https://x.com/thsottiaux/status/54',
    ...overrides,
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ASSETS: {} as Fetcher,
    SITE_URL: 'https://tibo.modelyard.dev',
    TRANSLATION_ENABLED: 'true',
    TRANSLATION_API_KEY: 'translation-secret',
    TRANSLATION_BASE_URL: 'https://translator.example/v1',
    TRANSLATION_MODEL: 'test-model',
    ...overrides,
  } as Env;
}

function config(overrides: Partial<Env> = {}): CommunityConfig {
  return getCommunityConfig(env(overrides));
}

function fakeRepository() {
  return {
    upsertEventTranslation: vi.fn(async () => undefined),
    getEventsNeedingTranslations: vi.fn(async () => []),
    countEventsNeedingTranslations: vi.fn(async () => 0),
  } as unknown as Repository & {
    upsertEventTranslation: ReturnType<typeof vi.fn>;
    getEventsNeedingTranslations: ReturnType<typeof vi.fn>;
    countEventsNeedingTranslations: ReturnType<typeof vi.fn>;
  };
}

function providerReply(init: RequestInit | undefined, failFrench = false): Response {
  const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ role: string; content: string }> };
  const system = body.messages?.find(message => message.role === 'system')?.content || '';
  const user = body.messages?.find(message => message.role === 'user')?.content || '';
  const markers = user.match(/__TIBO_[A-Z]+_\d+__/gu) || [];
  const literalMarkers = markers.filter(marker => marker.includes('_LITERAL_'));
  const titleMarker = literalMarkers[0];
  const summaryMarker = literalMarkers[1];
  const codeMarker = markers.find(marker => marker.includes('_CODE_')) || '';
  const commandMarker = markers.find(marker => marker.includes('_COMMAND_')) || '';
  const urlMarker = markers.find(marker => marker.includes('_URL_')) || '';
  if (!titleMarker || !summaryMarker) throw new Error('test provider markers missing');
  if (failFrench && system.includes('French')) return new Response('unavailable', { status: 503 });
  const title = system.includes('Japanese')
    ? `日本語の Codex ポリシー更新 ${codeMarker}`
    : system.includes('Spanish')
      ? `Actualización de la política de Codex ${codeMarker}`
      : `Mise à jour de la politique Codex ${codeMarker}`;
  const summary = system.includes('Japanese')
    ? `この更新では、開発者向けの ${commandMarker} と ${urlMarker} を説明します。`
    : system.includes('Spanish')
      ? `La actualización aclara ${commandMarker} y ${urlMarker} para desarrolladores.`
      : `La mise à jour précise ${commandMarker} et ${urlMarker} pour les développeurs.`;
  return new Response(JSON.stringify({
    choices: [{ message: { content: `${titleMarker}\n${title}\n${summaryMarker}\n${summary}` } }],
  }), { status: 200 });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Monitor event translations', () => {
  it('adds an additive normalized cache with retry status', () => {
    const migration = readFileSync(new URL('../migrations/0017_monitor_event_translations.sql', import.meta.url), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS monitor_event_translations');
    expect(migration).toContain("CHECK(language IN ('ja', 'es', 'fr'))");
    expect(migration).toContain("CHECK(status IN ('translated', 'failed', 'pending'))");
    expect(migration).toContain('UNIQUE(event_id, language)');
    expect(migration).toContain('last_error TEXT');
  });

  it('parses only the two protected event sections', () => {
    expect(parseEventTranslation('__TIBO_EVENT_TITLE__\nTitre\n__TIBO_EVENT_SUMMARY__\nRésumé')).toEqual({
      title: 'Titre',
      summary: 'Résumé',
    });
    expect(() => parseEventTranslation('Titre\nRésumé')).toThrow('translation_event_markers_missing');
  });

  it('translates Japanese, Spanish, and French once while preserving technical spans', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => providerReply(init));
    vi.stubGlobal('fetch', fetchMock);
    const repository = fakeRepository();
    const result = await processMonitorEventTranslations(event(), env(), repository, config(), new Date('2026-08-31T01:00:00.000Z'));

    expect(result).toMatchObject({ translated: 3, failed: 0, targets: ['ja', 'es', 'fr'] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(repository.upsertEventTranslation).toHaveBeenCalledTimes(3);
    expect(repository.upsertEventTranslation).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ja',
      status: 'translated',
      title: '日本語の Codex ポリシー更新 `wrangler.toml`',
    }));
    expect(repository.upsertEventTranslation).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ja',
      summary: expect.stringContaining('npm run deploy'),
    }));
    const requestBodies = fetchMock.mock.calls.map(call => JSON.parse(String(call[1].body)));
    expect(requestBodies.every(body => String(body.messages[1].content).includes('__TIBO_'))).toBe(true);
  });

  it('records a partial failure and leaves the event eligible for retry', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => providerReply(init, true)));
    const repository = fakeRepository();
    const result = await processMonitorEventTranslations(event(), env(), repository, config());

    expect(result.translated).toBe(2);
    expect(result.failed).toBe(1);
    expect(repository.upsertEventTranslation).toHaveBeenCalledWith(expect.objectContaining({
      language: 'fr',
      status: 'failed',
      title: null,
      summary: null,
    }));
  });

  it('backfills oldest incomplete events in a bounded, repeatable pass', async () => {
    const repository = fakeRepository();
    repository.getEventsNeedingTranslations.mockResolvedValue([event({ id: 1 })]);
    repository.countEventsNeedingTranslations.mockResolvedValue(0);
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => providerReply(init)));

    const result = await backfillMonitorEventTranslations(env(), 1, repository, config());
    expect(result).toMatchObject({ processed: 1, translated: 3, failed: 0, remaining: 0 });
    expect(repository.getEventsNeedingTranslations).toHaveBeenCalledWith(1);
    expect(repository.countEventsNeedingTranslations).toHaveBeenCalledTimes(1);
  });
});
