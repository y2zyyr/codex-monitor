import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../src/types';
import { getCommunityConfig, type CommunityConfig } from '../src/community/config';
import {
  assessSpam,
  deriveSourceHash,
  isAllowedCommunityOrigin,
  isCommunityAgentRequest,
  isCommunityAdminRequest,
  isReservedCommunityNickname,
  normalizeCommunityContent,
  validateCommunityInput,
  verifyTurnstile,
} from '../src/community/security';
import { COMMUNITY_AGENT_IDENTITIES, findCommunityAgent } from '../src/community/identity';
import {
  detectLanguage,
  OpenAICompatibleTranslationProvider,
  protectTechnicalContent,
  restoreTechnicalContent,
  translationTargets,
} from '../src/community/translation';
import {
  canonicalizeGitHubRepositoryUrl,
  extractGitHubRepositories,
  fetchGitHubRepository,
} from '../src/community/github';
import { CommunityRepository } from '../src/community/repository';
import { readCommunityFilters } from '../src/community/filters';
import { processCommunityEmbeds, processCommunityTranslation } from '../src/community/service';
import type { CommunityEmbed, CommunityPost, PublicCommunityPost } from '../src/community/types';
import community from '../src/routes/community';
import adminCommunity from '../src/routes/admin-community';
import { renderAdminCommunityPage, renderCommunityPage, renderSitemap } from '../src/renderer';

const baseEnv = {
  DB: {} as D1Database,
  ASSETS: {} as Fetcher,
  SITE_URL: 'https://tibo.modelyard.dev',
};

function env(overrides: Partial<Env> = {}): Env {
  return { ...baseEnv, ...overrides } as Env;
}

function config(overrides: Partial<Env> = {}): CommunityConfig {
  return getCommunityConfig(env(overrides));
}

function post(overrides: Partial<CommunityPost> = {}): CommunityPost {
  return {
    id: 7,
    nickname: 'kyho',
    authorRole: 'member',
    isAnnouncement: false,
    originalContent: '今日は `wrangler.toml` を試しました。https://github.com/openai/codex',
    originalLanguage: 'ja',
    contentEn: 'I tried `wrangler.toml` today. https://github.com/openai/codex',
    contentZh: '今天试了 `wrangler.toml`。https://github.com/openai/codex',
    translationStatus: 'translated',
    translationProvider: 'test-provider',
    translatedAt: '2026-08-31T10:00:00.000Z',
    status: 'approved',
    createdAt: '2026-08-31T09:00:00.000Z',
    updatedAt: '2026-08-31T10:00:00.000Z',
    sourceHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    moderationReason: null,
    topic: 'ai-coding',
    isPinned: false,
    isFeatured: false,
    embeds: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Community schema and configuration', () => {
  it('adds additive post, embed, ban, and rate-limit tables with original source fields', () => {
    const migration = readFileSync(new URL('../migrations/0013_community.sql', import.meta.url), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_posts');
    expect(migration).toContain('original_content TEXT NOT NULL');
    expect(migration).toContain('source_hash TEXT NOT NULL');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_embeds');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_bans');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_rate_limits');
    expect(migration).toContain('UNIQUE(post_id, type, canonical_url)');
  });

  it('fails closed for anonymous posting until Turnstile and hash secrets exist', () => {
    expect(config().postingEnabled).toBe(false);
    expect(config({
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }).postingEnabled).toBe(true);
    expect(config({ COMMUNITY_MAX_CONTENT_LENGTH: '999999' }).maxContentLength).toBe(10000);
    expect(config({ COMMUNITY_RATE_MINUTE: '0' }).ratePerMinute).toBe(1);
  });

  it('keeps the enhancement migration additive and indexed for feed ordering', () => {
    const migration = readFileSync(new URL('../migrations/0014_community_enhancements.sql', import.meta.url), 'utf8');
    expect(migration).toContain("ADD COLUMN topic TEXT NOT NULL DEFAULT 'general'");
    expect(migration).toContain('ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('idx_community_posts_feed_order');
    expect(migration).toContain('idx_community_posts_topic');
  });

  it('keeps administrator identity fields additive and constrained', () => {
    const migration = readFileSync(new URL('../migrations/0015_community_admin_posts.sql', import.meta.url), 'utf8');
    expect(migration).toContain("ADD COLUMN author_role TEXT NOT NULL DEFAULT 'member'");
    expect(migration).toContain("CHECK(author_role IN ('member', 'admin'))");
    expect(migration).toContain('ADD COLUMN is_announcement INTEGER NOT NULL DEFAULT 0');
    expect(migration).toContain('idx_community_posts_author_role');
  });

  it('adds a normalized five-language translation cache and backfills legacy fields', () => {
    const migration = readFileSync(new URL('../migrations/0016_community_translations.sql', import.meta.url), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_post_translations');
    expect(migration).toContain("CHECK(language IN ('en', 'zh', 'ja', 'es', 'fr'))");
    expect(migration).toContain('UNIQUE(post_id, language)');
    expect(migration).toContain("SELECT id, 'en', content_en");
    expect(migration).toContain("SELECT id, 'zh', content_zh");
    expect(config().translationLocales).toEqual(['en', 'zh', 'ja', 'es', 'fr']);
    expect(config({ COMMUNITY_TRANSLATION_LOCALES: 'ja,es' }).translationLocales).toEqual(['en', 'zh', 'ja', 'es']);
  });
});

describe('Community validation and abuse controls', () => {
  it('validates Unicode by code points and rejects controls', () => {
    const communityConfig = config({ COMMUNITY_MAX_CONTENT_LENGTH: '100', COMMUNITY_MAX_NICKNAME_LENGTH: '4' });
    expect(validateCommunityInput({ nickname: '', content: 'hello' }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: 'name', content: '' }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: 'abcde', content: 'hello' }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: '🙂🙂', content: '你好🙂' }, communityConfig)).toMatchObject({ ok: true });
    expect(validateCommunityInput({ nickname: 'ok\nname', content: 'hello' }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: 'name', content: '🙂'.repeat(101) }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: 'name', content: 'x'.repeat(101) }, communityConfig)).toMatchObject({ ok: false });
    expect(validateCommunityInput({ nickname: 'name', content: 'hello', topic: 'ai-coding' }, communityConfig)).toMatchObject({ ok: true, value: { topic: 'ai-coding' } });
    expect(validateCommunityInput({ nickname: 'name', content: 'hello', topic: 'not-a-topic' }, communityConfig)).toMatchObject({ ok: false });
    expect(isReservedCommunityNickname('admin')).toBe(true);
    expect(isReservedCommunityNickname(' A-D-M-I-N ')).toBe(true);
    expect(isReservedCommunityNickname('administrator2')).toBe(true);
    expect(isReservedCommunityNickname('ai-admin-notes')).toBe(false);
    expect(validateCommunityInput({ nickname: 'admin', content: 'hello' }, config())).toMatchObject({ ok: false, code: 'RESERVED_NICKNAME' });
    expect(validateCommunityInput({ nickname: 'admin', content: 'hello' }, config(), { allowReservedNickname: true })).toMatchObject({ ok: true });
    expect(normalizeCommunityContent('  a\r\n\r\n\r\nb  ')).toBe('a\n\nb');
    expect(normalizeCommunityContent('  same   content  ')).toBe('same content');
  });

  it('routes deterministic spam signals to pending moderation', () => {
    expect(assessSpam('https://a.test https://b.test https://c.test https://d.test').pending).toBe(true);
    expect(assessSpam('free crypto bonus claim your prize').reasons).toContain('known_spam_pattern');
    expect(assessSpam('hello\nhello\nhello').reasons).toContain('repeated_lines');
    expect(assessSpam('a'.repeat(40)).reasons).toContain('repeated_characters');
  });

  it('uses an HMAC source hash and never returns the raw source address', async () => {
    const request = new Request('https://tibo.modelyard.dev/api/community/posts', {
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    });
    const hash = await deriveSourceHash(request, 'server-secret');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain('203.0.113.10');
  });

  it('accepts only the configured site origin for browser-originated writes', () => {
    expect(isAllowedCommunityOrigin(
      new Request('https://tibo.modelyard.dev/api/community/posts', { headers: { Origin: 'https://tibo.modelyard.dev' } }),
      'https://tibo.modelyard.dev',
    )).toBe(true);
    expect(isAllowedCommunityOrigin(
      new Request('https://tibo.modelyard.dev/api/community/posts', { headers: { Origin: 'https://evil.example' } }),
      'https://tibo.modelyard.dev',
    )).toBe(false);
  });
});

describe('Turnstile and admin authentication', () => {
  it('verifies Turnstile server-side and does not send an IP address', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyTurnstile('widget-token', 'server-secret')).resolves.toEqual({ success: true, errorCodes: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain('secret=server-secret');
    expect(body).toContain('response=widget-token');
    expect(body).not.toContain('remoteip');
  });

  it('rejects invalid Turnstile results and admin tokens without exposing the expected token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] }), { status: 200 })));
    await expect(verifyTurnstile('bad-token', 'server-secret')).resolves.toEqual({ success: false, errorCodes: ['timeout-or-duplicate'] });
    const request = new Request('https://tibo.modelyard.dev/api/admin/community/posts', { headers: { Authorization: 'Bearer right-token' } });
    await expect(isCommunityAdminRequest(request, 'right-token')).resolves.toBe(true);
    await expect(isCommunityAdminRequest(new Request(request.url, { headers: { Authorization: 'Bearer wrong-token' } }), 'right-token')).resolves.toBe(false);
  });
});

describe('Community translation', () => {
  it('detects supported scripts and avoids same-language translation calls', () => {
    expect(detectLanguage('This project works well')).toBe('en');
    expect(detectLanguage('这是一个项目')).toBe('zh');
    expect(detectLanguage('今日は面白いです')).toBe('ja');
    expect(detectLanguage('이 프로젝트는 좋습니다')).toBe('ko');
    expect(translationTargets('en', true)).toEqual(['zh', 'ja', 'es', 'fr']);
    expect(translationTargets('zh', true)).toEqual(['en', 'ja', 'es', 'fr']);
    expect(translationTargets('ja', true)).toEqual(['en', 'zh', 'es', 'fr']);
  });

  it('protects and restores code, URLs, commands, mentions, and issue numbers exactly', () => {
    const original = 'Run `wrangler.toml` with npm run deploy\nhttps://github.com/openai/codex @openai #123';
    const protectedText = protectTechnicalContent(original);
    expect(protectedText.text).not.toContain('https://github.com/openai/codex');
    expect(protectedText.text).not.toContain('wrangler.toml');
    expect(protectedText.text).toContain('__TIBO_');
    expect(restoreTechnicalContent(protectedText.text, protectedText)).toEqual({ text: original, missing: [] });
    const fenced = '```sh\nnpm run deploy\n```';
    const fencedProtected = protectTechnicalContent(fenced);
    expect(restoreTechnicalContent(fencedProtected.text, fencedProtected)).toEqual({ text: fenced, missing: [] });
    const commandWithUrl = 'npm run deploy https://github.com/openai/codex';
    const commandProtected = protectTechnicalContent(commandWithUrl);
    expect(restoreTechnicalContent(commandProtected.text, commandProtected)).toEqual({ text: commandWithUrl, missing: [] });
    const urlToken = protectedText.tokens.find(token => token.value.startsWith('https://'))!.placeholder;
    const missing = restoreTechnicalContent(protectedText.text.replace(urlToken, ''), protectedText);
    expect(missing.missing).toContain(urlToken);
  });

  it('uses the server-side provider and preserves protected content in its output', async () => {
    const providerConfig = config({ TRANSLATION_API_KEY: 'translation-secret', TRANSLATION_BASE_URL: 'https://translator.example/v1', TRANSLATION_MODEL: 'test-model' });
    const original = 'I changed `wrangler.toml` and ran npm run deploy https://github.com/openai/codex';
    const protectedText = protectTechnicalContent(original);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: protectedText.text } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const translated = await new OpenAICompatibleTranslationProvider(providerConfig).translate({ text: original, sourceLanguage: 'en', targetLanguage: 'zh' });
    expect(translated).toContain('`wrangler.toml`');
    expect(translated).toContain('npm run deploy');
    expect(translated).toContain('https://github.com/openai/codex');
    expect(fetchMock.mock.calls[0][0]).toBe('https://translator.example/v1/chat/completions');
    expect(String(fetchMock.mock.calls[0][1].body)).not.toContain('translation-secret');
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('__TIBO_');
  });

  it('records provider failure without deleting the durable original post', async () => {
    const providerConfig = config({ TRANSLATION_API_KEY: 'translation-secret', COMMUNITY_TRANSLATION_LOCALES: 'en,zh' });
    const updates: unknown[] = [];
    const repository = { updateTranslation: vi.fn(async (_id: number, update: unknown) => { updates.push(update); }) } as unknown as CommunityRepository;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('provider unavailable')));
    const result = await processCommunityTranslation(post({ originalContent: '今日は面白いです', contentEn: null, contentZh: null }), env(), repository, providerConfig, new Date('2026-08-31T12:00:00.000Z'));
    expect(result.status).toBe('failed');
    expect(updates[0]).toMatchObject({ originalLanguage: 'ja', contentEn: null, contentZh: null, translationStatus: 'failed' });
  });

  it('records partial translation when one target succeeds and one provider call fails', async () => {
    const providerConfig = config({ TRANSLATION_API_KEY: 'translation-secret', COMMUNITY_TRANSLATION_LOCALES: 'en,zh' });
    const updates: unknown[] = [];
    const repository = { updateTranslation: vi.fn(async (_id: number, update: unknown) => { updates.push(update); }) } as unknown as CommunityRepository;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'English translation' } }] }), { status: 200 }))
      .mockRejectedValueOnce(new Error('provider unavailable')));
    const result = await processCommunityTranslation(post({ originalContent: '今日は面白いです', contentEn: null, contentZh: null }), env(), repository, providerConfig, new Date('2026-08-31T12:00:00.000Z'));
    expect(result.status).toBe('partial');
    expect(updates[0]).toMatchObject({ contentEn: 'English translation', contentZh: null, translationStatus: 'partial' });
  });
});

describe('GitHub repository cards', () => {
  it('canonicalizes only repository roots and strips trailing variants', () => {
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/openai/codex/')).toMatchObject({ canonicalUrl: 'https://github.com/openai/codex' });
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/openai/codex.git?tab=readme#x')).toMatchObject({ canonicalUrl: 'https://github.com/openai/codex' });
    expect(canonicalizeGitHubRepositoryUrl('github.com/openai/codex')).toMatchObject({ canonicalUrl: 'https://github.com/openai/codex' });
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/openai/codex/issues/1')).toBeNull();
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/openai')).toBeNull();
    expect(canonicalizeGitHubRepositoryUrl('https://github.com/settings')).toBeNull();
    expect(canonicalizeGitHubRepositoryUrl('javascript:alert(1)')).toBeNull();
    expect(extractGitHubRepositories('https://www.github.com/openai/codex https://github.com/openai/codex')).toHaveLength(1);
  });

  it('fetches validated metadata from the fixed server-side API endpoint', async () => {
    const reference = canonicalizeGitHubRepositoryUrl('https://github.com/openai/codex')!;
    const githubPayload = JSON.stringify({
      name: 'codex',
      html_url: 'https://github.com/openai/codex',
      description: 'A coding agent',
      stargazers_count: 123,
      forks_count: 45,
      language: 'Rust',
      license: { spdx_id: 'Apache-2.0' },
      owner: { login: 'openai', avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4' },
    });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(githubPayload, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchGitHubRepository(reference, config({ GITHUB_TOKEN: 'github-secret' }));
    expect(result.metadata).toMatchObject({ owner: 'openai', repo: 'codex', stars: 123, forks: 45, language: 'Rust', license: 'Apache-2.0' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/openai/codex');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer github-secret');
    await expect(fetchGitHubRepository(reference, config())).resolves.toMatchObject({ owner: 'openai' });
  });

  it('maps GitHub not-found and rate-limit responses to safe retryable errors', async () => {
    const reference = canonicalizeGitHubRepositoryUrl('https://github.com/openai/codex')!;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(fetchGitHubRepository(reference, config())).rejects.toMatchObject({ code: 'not_found' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(fetchGitHubRepository(reference, config())).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('uses a fresh D1 embed cache without calling GitHub again', async () => {
    const cached: CommunityEmbed = {
      id: 3,
      postId: 4,
      type: 'repository',
      provider: 'github',
      url: 'https://github.com/openai/codex?tab=readme',
      canonicalUrl: 'https://github.com/openai/codex',
      title: 'openai / codex',
      description: 'cached',
      imageUrl: null,
      metadata: { owner: 'openai', repo: 'codex', stars: 1, forks: 2, language: 'Rust', license: null },
      fetchedAt: '2026-08-31T11:59:00.000Z',
      createdAt: '2026-08-31T11:00:00.000Z',
      updatedAt: '2026-08-31T11:59:00.000Z',
      fetchStatus: 'success',
      lastError: null,
      retryCount: 0,
    };
    const repository = {
      getEmbed: vi.fn().mockResolvedValue(null),
      getFreshEmbed: vi.fn().mockResolvedValue(cached),
      upsertEmbed: vi.fn().mockResolvedValue(undefined),
      markEmbedFailure: vi.fn(),
    } as unknown as CommunityRepository;
    const fetchMock = vi.fn().mockRejectedValue(new Error('GitHub must not be called on cache hit'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await processCommunityEmbeds(post({ id: 4 }), env(), repository, config({ GITHUB_CARD_ENABLED: 'true' }), new Date('2026-08-31T12:00:00.000Z'));
    expect(result).toEqual({ success: 1, failures: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repository.upsertEmbed).toHaveBeenCalledWith(expect.objectContaining({ canonicalUrl: 'https://github.com/openai/codex', fetchStatus: 'success' }));
  });
});

describe('Community repository pagination and rate limits', () => {
  it('round-trips a bounded cursor and rejects malformed values', () => {
    const cursor = CommunityRepository.encodeCursor('2026-08-31T12:00:00.000Z', 15);
    expect(CommunityRepository.decodeCursor(cursor)).toEqual({ createdAt: '2026-08-31T12:00:00.000Z', id: 15, isPinned: 0, isFeatured: 0 });
    const prioritized = CommunityRepository.encodeCursor('2026-08-31T12:00:00.000Z', 15, true, true);
    expect(CommunityRepository.decodeCursor(prioritized)).toMatchObject({ isPinned: 1, isFeatured: 1 });
    expect(CommunityRepository.decodeCursor('bad')).toBeNull();
    expect(CommunityRepository.decodeCursor(CommunityRepository.encodeCursor('bad-date', 15))).toBeNull();
  });

  it('normalizes safe feed filters and rejects unknown topics', () => {
    const parsed = readCommunityFilters(new URL('https://tibo.modelyard.dev/community/?q=  RAG%20cache%20  &topic=rag&featured=1&github=true'));
    expect(parsed.invalidTopic).toBe(false);
    expect(parsed.filters).toEqual({ query: 'RAG cache', topic: 'rag', featuredOnly: true, githubOnly: true });
    expect(readCommunityFilters(new URL('https://tibo.modelyard.dev/community/?topic=secret'))).toMatchObject({ invalidTopic: true, filters: { topic: null } });
  });

  it('uses bound parameters for search filters and keeps prioritized feed ordering', async () => {
    const row = {
      id: 7,
      nickname: 'kyho',
      original_content: 'wrangler_ notes',
      original_language: 'en',
      content_en: 'wrangler_ notes',
      content_zh: null,
      translation_status: 'translated',
      translation_provider: null,
      translated_at: null,
      status: 'approved',
      created_at: '2026-08-31T12:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
      source_hash: 'a'.repeat(64),
      content_hash: 'b'.repeat(64),
      moderation_reason: null,
      topic: 'rag',
      is_pinned: 0,
      is_featured: 1,
    };
    const queries: string[] = [];
    const binds: unknown[][] = [];
    const db = {
      prepare: vi.fn((query: string) => {
        queries.push(query);
        const statement = {
          bind: vi.fn((...values: unknown[]) => { binds.push(values); return statement; }),
          all: vi.fn().mockResolvedValue(query.includes('SELECT * FROM community_posts') ? { results: [row] } : { results: [] }),
          first: vi.fn().mockResolvedValue(query.includes('COUNT(*)') ? { count: 1 } : null),
        };
        return statement;
      }),
    } as unknown as D1Database;
    const result = await new CommunityRepository(db).getPublicPosts({
      limit: 20,
      cursor: null,
      filters: { query: 'wrangler_', topic: 'rag', featuredOnly: true, githubOnly: true },
    });
    expect(result.total).toBe(1);
    expect(queries[0]).toContain("LIKE ? ESCAPE '\\'");
    expect(queries[0]).toContain('topic = ?');
    expect(queries[0]).toContain('is_featured = 1');
    expect(queries[0]).toContain('EXISTS (SELECT 1 FROM community_embeds');
    expect(queries[0]).toContain('ORDER BY is_pinned DESC, is_featured DESC');
    expect(binds[0]).toContain('%wrangler\\_%');
    expect(binds[0]).toContain('rag');
  });

  function rateDb(updateChanges: number, row: Record<string, number>) {
    const statements: Array<{ bind: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn>; first: ReturnType<typeof vi.fn> }> = [];
    const db = {
      prepare: vi.fn((query: string) => {
        const statement = {
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockResolvedValue({ meta: { changes: query.includes('UPDATE community_rate_limits') ? updateChanges : 0 } }),
          first: vi.fn().mockResolvedValue(query.includes('SELECT * FROM community_rate_limits') ? row : null),
        };
        statements.push(statement);
        return statement;
      }),
    } as unknown as D1Database;
    return { db, statements };
  }

  it('allows a source inside all windows and blocks minute, hour, and day exhaustion', async () => {
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    const limits = { perMinute: 1, perHour: 5, perDay: 15 };
    const allowedDb = rateDb(1, {});
    await expect(new CommunityRepository(allowedDb.db).reserveRateLimit('a'.repeat(64), now, limits)).resolves.toMatchObject({ allowed: true });

    const minuteDb = rateDb(0, { source_hash: 'a'.repeat(64), minute_started_ms: now - 1_000, minute_count: 1, hour_started_ms: now - 1_000, hour_count: 1, day_started_ms: now - 1_000, day_count: 1 });
    await expect(new CommunityRepository(minuteDb.db).reserveRateLimit('a'.repeat(64), now, limits)).resolves.toMatchObject({ allowed: false, blockedWindow: 'minute' });
    const hourDb = rateDb(0, { source_hash: 'a'.repeat(64), minute_started_ms: now - 61_000, minute_count: 1, hour_started_ms: now - 1_000, hour_count: 5, day_started_ms: now - 1_000, day_count: 1 });
    await expect(new CommunityRepository(hourDb.db).reserveRateLimit('a'.repeat(64), now, limits)).resolves.toMatchObject({ allowed: false, blockedWindow: 'hour' });
    const dayDb = rateDb(0, { source_hash: 'a'.repeat(64), minute_started_ms: now - 61_000, minute_count: 1, hour_started_ms: now - 3_601_000, hour_count: 5, day_started_ms: now - 1_000, day_count: 15 });
    await expect(new CommunityRepository(dayDb.db).reserveRateLimit('a'.repeat(64), now, limits)).resolves.toMatchObject({ allowed: false, blockedWindow: 'day' });
  });
});

describe('Community routes and safe rendering', () => {
  it('creates a valid anonymous post after server-side Turnstile verification', async () => {
    const row = {
      id: 42,
      nickname: 'kyho',
      original_content: 'hello from the community',
      original_language: 'en',
      content_en: 'hello from the community',
      content_zh: null,
      translation_status: 'partial',
      translation_provider: null,
      translated_at: null,
      status: 'approved',
      created_at: '2026-08-31T12:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
      source_hash: 'a'.repeat(64),
      content_hash: 'b'.repeat(64),
      moderation_reason: null,
    };
    const db = {
      prepare: vi.fn((query: string) => {
        const statement = {
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockImplementation(() => ({ meta: {
            changes: query.includes('UPDATE community_rate_limits') ? 1 : 1,
            last_row_id: query.includes('INSERT INTO community_posts') ? 42 : 0,
          } })),
          first: vi.fn().mockResolvedValue(query.includes('community_bans') || query.includes('SELECT id, status') ? null : row),
          all: vi.fn().mockResolvedValue({ results: [] }),
        };
        return statement;
      }),
    } as unknown as D1Database;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://tibo.modelyard.dev',
        'CF-Connecting-IP': '203.0.113.11',
      },
      body: JSON.stringify({ nickname: 'kyho', content: 'hello from the community', turnstileToken: 'valid-widget-token' }),
    }), env({
      DB: db,
      COMMUNITY_POSTING_ENABLED: 'true',
      TRANSLATION_ENABLED: 'false',
      GITHUB_CARD_ENABLED: 'false',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: { id: number; originalContent: string; sourceHash?: string }; message: string };
    expect(payload.data).toMatchObject({ id: 42, originalContent: 'hello from the community' });
    expect(payload.data.sourceHash).toBeUndefined();
    expect(payload.message).toBe('Your message was posted.');
  });

  it('requires a real Turnstile token before touching the database', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'kyho', content: 'hello' }),
    }), env({
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'TURNSTILE_REQUIRED' });
  });

  it('blocks a normalized duplicate before inserting another row', async () => {
    const db = {
      prepare: vi.fn((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ meta: { changes: query.includes('UPDATE community_rate_limits') ? 1 : 0, last_row_id: 0 } }),
        first: vi.fn().mockResolvedValue(query.includes('community_bans') ? null : query.includes('SELECT id, status') ? { id: 9, status: 'approved' } : null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
    } as unknown as D1Database;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.12' },
      body: JSON.stringify({ nickname: 'kyho', content: 'same content', turnstileToken: 'valid-widget-token' }),
    }), env({
      DB: db,
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'DUPLICATE_POST' });
  });

  it('renders bilingual SSR pages, per-post original toggles, safe links, and stable sitemap URLs', () => {
    const unsafePost = post({
      authorRole: 'admin',
      isAnnouncement: true,
      originalContent: '<script>alert(1)</script> javascript:alert(2)',
      contentEn: 'safe translation',
      contentZh: null,
      embeds: [{
        id: 1,
        postId: 7,
        type: 'repository',
        provider: 'github',
        url: 'https://github.com/openai/codex',
        canonicalUrl: 'https://github.com/openai/codex',
        title: 'openai / codex',
        description: 'A coding agent',
        imageUrl: null,
        metadata: { owner: 'openai', repo: 'codex', stars: 123, forks: 4, language: 'Rust', license: 'Apache-2.0' },
        fetchedAt: '2026-08-31T10:00:00.000Z',
        createdAt: '2026-08-31T10:00:00.000Z',
        updatedAt: '2026-08-31T10:00:00.000Z',
        fetchStatus: 'success',
        lastError: null,
        retryCount: 0,
      }],
    });
    const html = renderCommunityPage({ posts: [unsafePost as PublicCommunityPost], nextCursor: null, total: 1, postingEnabled: false, turnstileSiteKey: null, maxNicknameLength: 32, maxContentLength: 2000 }, 'en');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('href="/community/">ModelYard Community');
    expect(html).toContain('<a class="logo logo-home-link" href="/" aria-label="Go to homepage">');
    expect(html).toContain('ModelYard Community');
    expect(html).toContain('class="header-community-link" href="/community/">ModelYard Community');
    expect(html).not.toContain('<nav class="site-nav"');
    expect(html).toContain('Show original');
    expect(html).toContain('AI coding');
    expect(html).toContain('community-verified-badge');
    expect(html).toContain('Announcement');
    expect(html).toContain('openai / codex');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="/api/events"');
    expect(html).not.toContain('href="/api/health"');
    expect(html).not.toContain('href="/api/status"');
    expect(html).not.toContain('href="/robots.txt"');
    expect(html).not.toContain('href="/sitemap.xml"');
    expect(html).not.toContain('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(html).not.toContain('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    const zhHtml = renderCommunityPage({ posts: [post({ contentEn: 'English', contentZh: '中文翻译' }) as PublicCommunityPost], nextCursor: null, total: 1, postingEnabled: false, turnstileSiteKey: null, maxNicknameLength: 32, maxContentLength: 2000 }, 'zh');
    expect(zhHtml).toContain('ModelYard 社区');
    expect(zhHtml).toContain('<a class="logo logo-home-link" href="/zh/" aria-label="返回首页">');
    expect(zhHtml).toContain('class="header-community-link" href="/zh/community/">ModelYard 社区');
    expect(zhHtml).not.toContain('<nav class="site-nav"');
    expect(zhHtml).toContain('译自日文');
    expect(zhHtml).toContain('显示原文');
    expect(renderAdminCommunityPage()).toContain('noindex, nofollow, noarchive');
    const clientCode = readFileSync(new URL('../static/community.js', import.meta.url), 'utf8');
    expect(clientCode).not.toContain('TURNSTILE_SECRET_KEY');
    expect(clientCode).not.toContain('GITHUB_TOKEN');
    expect(clientCode).not.toContain('TRANSLATION_API_KEY');
    expect(clientCode).toContain('communityFeedFilters');
    const adminCode = readFileSync(new URL('../static/community-admin.js', import.meta.url), 'utf8');
    expect(adminCode).toContain("'Restore'");
    expect(adminCode).toContain("action === 'restore'");
    expect(adminCode).toContain('communityAdminAnnouncementForm');
    expect(adminCode).toContain("'/api/admin/community/posts'");
    const sitemap = renderSitemap([], null);
    expect(sitemap).toContain('https://tibo.modelyard.dev/community/');
    expect(sitemap).toContain('https://tibo.modelyard.dev/zh/community/');
    expect(sitemap).not.toContain('/community/7');
  });

  it('renders Japanese, Spanish, and French Community shells with cached locale content', () => {
    const multilingual = post({
      originalContent: '今日は面白いです。',
      originalLanguage: 'ja',
      contentEn: 'This is interesting.',
      contentZh: '这很有意思。',
      translations: {
        en: 'This is interesting.',
        zh: '这很有意思。',
        ja: '今日は面白いです。',
        es: 'Esto es interesante.',
        fr: 'C’est intéressant.',
      },
    }) as PublicCommunityPost;
    for (const [locale, expectedTitle, expectedText] of [
      ['ja', 'ModelYard コミュニティ', '今日は面白いです。'],
      ['es', 'Comunidad de ModelYard', 'Esto es interesante.'],
      ['fr', 'Communauté ModelYard', 'C’est intéressant.'],
    ] as const) {
      const html = renderCommunityPage({
        posts: [multilingual],
        nextCursor: null,
        total: 1,
        postingEnabled: false,
        turnstileSiteKey: null,
        maxNicknameLength: 32,
        maxContentLength: 2000,
      }, locale);
      expect(html).toContain('<html lang="' + locale + '">');
      expect(html).toContain(expectedTitle);
      expect(html).toContain(expectedText);
      expect(html).toContain('hreflang="ja"');
      expect(html).toContain('hreflang="es"');
      expect(html).toContain('hreflang="fr"');
    }
  });

  it('does not allow unauthenticated moderation access', async () => {
    const response = await adminCommunity.fetch(new Request('https://tibo.modelyard.dev/api/admin/community/posts'), env({ COMMUNITY_ADMIN_TOKEN: 'admin-secret' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('rejects reserved public nicknames before Turnstile or database work', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'zh-CN' },
      body: JSON.stringify({ nickname: 'admin', content: 'impersonation attempt' }),
    }), env({
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'RESERVED_NICKNAME', message: '此昵称为官方账号保留。' });
  });

  it('allows only the authenticated admin route to create a verified announcement', async () => {
    const officialPost = post({
      id: 42,
      nickname: 'admin',
      authorRole: 'admin',
      isAnnouncement: true,
      originalContent: 'A maintenance announcement',
      contentEn: 'A maintenance announcement',
      contentZh: null,
    });
    const insertPost = vi.spyOn(CommunityRepository.prototype, 'insertPost').mockResolvedValue(42);
    vi.spyOn(CommunityRepository.prototype, 'getPostById').mockResolvedValue(officialPost);
    vi.spyOn(CommunityRepository.prototype, 'updateTranslation').mockResolvedValue(undefined);
    const response = await adminCommunity.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { Authorization: 'Bearer admin-secret', Origin: 'https://tibo.modelyard.dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'A maintenance announcement', topic: 'general', pin: true }),
    }), env({
      COMMUNITY_ADMIN_TOKEN: 'admin-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
      TRANSLATION_ENABLED: 'false',
      GITHUB_CARD_ENABLED: 'false',
    }));
    expect(response.status).toBe(201);
    expect(insertPost).toHaveBeenCalledWith(expect.objectContaining({
      nickname: 'admin',
      authorRole: 'admin',
      isAnnouncement: true,
      isPinned: true,
      status: 'approved',
      topic: 'general',
    }));
    expect(await response.json()).toMatchObject({ data: { nickname: 'admin', authorRole: 'admin', isAnnouncement: true } });
  });

  it('restores deleted posts explicitly and supports feed flags through admin actions', async () => {
    const deleted = post({ status: 'deleted' });
    const getPost = vi.spyOn(CommunityRepository.prototype, 'getPostById').mockResolvedValue(deleted);
    const updateStatus = vi.spyOn(CommunityRepository.prototype, 'updatePostStatus').mockResolvedValue(true);
    const restoreResponse = await adminCommunity.fetch(new Request('https://tibo.modelyard.dev/posts/7', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-secret', Origin: 'https://tibo.modelyard.dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    }), env({ COMMUNITY_ADMIN_TOKEN: 'admin-secret' }));
    expect(restoreResponse.status).toBe(200);
    expect(updateStatus).toHaveBeenCalledWith(7, 'approved', 'restored_by_admin', expect.any(String));
    expect(getPost).toHaveBeenCalled();

    const updateFlags = vi.spyOn(CommunityRepository.prototype, 'updatePostFlags').mockResolvedValue(true);
    const flagResponse = await adminCommunity.fetch(new Request('https://tibo.modelyard.dev/posts/7', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer admin-secret', Origin: 'https://tibo.modelyard.dev', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'feature' }),
    }), env({ COMMUNITY_ADMIN_TOKEN: 'admin-secret' }));
    expect(flagResponse.status).toBe(200);
    expect(updateFlags).toHaveBeenCalledWith(7, { isFeatured: true }, expect.any(String));
  });

  it('exposes admin statistics only behind the admin token', async () => {
    vi.spyOn(CommunityRepository.prototype, 'getCommunityStats').mockResolvedValue({
      total: 3,
      pinned: 1,
      featured: 1,
      translationFailed: 0,
      embedFailed: 0,
      byStatus: { approved: 2, pending: 1, hidden: 0, deleted: 0 },
      byTopic: { general: 1, 'ai-coding': 1, llm: 1, rag: 0, agents: 0, prompts: 0, 'ai-tools': 0, 'open-source': 0 },
    });
    const response = await adminCommunity.fetch(new Request('https://tibo.modelyard.dev/stats', {
      headers: { Authorization: 'Bearer admin-secret', Origin: 'https://tibo.modelyard.dev' },
    }), env({ COMMUNITY_ADMIN_TOKEN: 'admin-secret' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { total: 3, pinned: 1, featured: 1 } });
  });
});

describe('Agent publishing: configuration, identity, and authentication', () => {
  it('enables agent posting only with the server-side secret and abuse hash', () => {
    expect(config().agentPostingEnabled).toBe(false);
    expect(config({
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }).agentPostingEnabled).toBe(true);
    // Turnstile is irrelevant to agents: its absence must not disable agent posting.
    expect(config({
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
      TURNSTILE_SITE_KEY: '',
      TURNSTILE_SECRET_KEY: '',
    }).agentPostingEnabled).toBe(true);
  });

  it('parses conservative per-run and per-day agent caps from the environment', () => {
    expect(config({ COMMUNITY_AGENT_SECRET: 's', ABUSE_HASH_SECRET: 'h' }).agentMaxPerRun).toBe(3);
    expect(config({ COMMUNITY_AGENT_SECRET: 's', ABUSE_HASH_SECRET: 'h' }).agentMaxPerDay).toBe(8);
    expect(config({
      COMMUNITY_AGENT_SECRET: 's',
      ABUSE_HASH_SECRET: 'h',
      COMMUNITY_AGENT_MAX_PER_RUN: '2',
      COMMUNITY_AGENT_MAX_PER_DAY: '5',
    }).agentMaxPerRun).toBe(2);
    expect(config({
      COMMUNITY_AGENT_SECRET: 's',
      ABUSE_HASH_SECRET: 'h',
      COMMUNITY_AGENT_MAX_PER_RUN: '0',
      COMMUNITY_AGENT_MAX_PER_DAY: '0',
    }).agentMaxPerRun).toBe(1);
  });

  it('resolves each first-party agent from id or nickname and rejects unknowns', () => {
    for (const agent of COMMUNITY_AGENT_IDENTITIES) {
      expect(findCommunityAgent(agent.id)).toMatchObject({ id: agent.id });
      expect(findCommunityAgent(agent.nickname)).toMatchObject({ id: agent.id });
    }
    expect(findCommunityAgent('skill-hunter')?.nickname).toBe('Skill Hunter');
    expect(findCommunityAgent('SKILL  HUNTER')?.id).toBe('skill-hunter');
    expect(findCommunityAgent('bogus-agent')).toBeNull();
  });

  it('authenticates a valid agent secret and rejects missing or invalid ones', async () => {
    const request = new Request('https://tibo.modelyard.dev/agent', { headers: { Authorization: 'Bearer right-secret' } });
    await expect(isCommunityAgentRequest(request, 'right-secret')).resolves.toBe(true);
    await expect(isCommunityAgentRequest(new Request(request.url, { headers: { Authorization: 'Bearer wrong-secret' } }), 'right-secret')).resolves.toBe(false);
    await expect(isCommunityAgentRequest(new Request(request.url), 'right-secret')).resolves.toBe(false);
    await expect(isCommunityAgentRequest(request, '')).resolves.toBe(false);
    await expect(isCommunityAgentRequest(request, null)).resolves.toBe(false);
    const headerRequest = new Request('https://tibo.modelyard.dev/agent', { headers: { 'X-Community-Agent-Secret': 'right-secret' } });
    await expect(isCommunityAgentRequest(headerRequest, 'right-secret')).resolves.toBe(true);
  });

  it('reserves first-party agent nicknames so anonymous users cannot impersonate them', () => {
    expect(isReservedCommunityNickname('Skill Hunter')).toBe(true);
    expect(isReservedCommunityNickname('skill hunter AI')).toBe(true);
    expect(isReservedCommunityNickname('Tibo Scout')).toBe(true);
    expect(isReservedCommunityNickname('Codex Watch')).toBe(true);
    expect(validateCommunityInput({ nickname: 'Skill Hunter', content: 'hello' }, config()).ok).toBe(false);
    expect(validateCommunityInput({ nickname: 'kyho', content: 'hello' }, config()).ok).toBe(true);
  });

  it('rejects an unknown agent identity before any database work', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer agent-secret' },
      body: JSON.stringify({ identity: 'does-not-exist', content: 'hello', topic: 'general' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'UNKNOWN_AGENT_IDENTITY' });
  });

  it('blocks agent authentication when the server secret is missing (posting disabled)', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer agent-secret' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'hello', topic: 'general' }),
    }), env({ DB: {} as D1Database, ABUSE_HASH_SECRET: 'hash-secret' }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'AGENT_POSTING_DISABLED' });
  });

  it('rejects a missing agent secret with 401 rather than creating a post', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'hello', topic: 'general' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'AGENT_AUTH_REQUIRED' });
  });

  it('rejects an invalid agent secret with 401', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'hello', topic: 'general' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'AGENT_AUTH_REQUIRED' });
  });

  it('prevents a public client from submitting an agent author type or identity', async () => {
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'kyho', content: 'hello', authorType: 'agent' }),
    }), env({
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'AGENT_FIELD_FORBIDDEN' });

    const withAgentId = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: 'kyho', content: 'hello', agentId: 'skill-hunter' }),
    }), env({
      COMMUNITY_POSTING_ENABLED: 'true',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(withAgentId.status).toBe(400);
    expect(await withAgentId.json()).toMatchObject({ error: 'AGENT_FIELD_FORBIDDEN' });
  });

  it('creates an Agent post with a server-assigned author type and identity', async () => {
    const agentPost = post({
      id: 100,
      nickname: 'Skill Hunter',
      authorRole: 'member',
      originalContent: 'Found a useful skill for Codex.',
      contentEn: 'Found a useful skill for Codex.',
      contentZh: null,
      authorType: 'agent',
      agentId: 'skill-hunter',
    });
    vi.spyOn(CommunityRepository.prototype, 'reserveAgentQuota').mockResolvedValue(true);
    vi.spyOn(CommunityRepository.prototype, 'findRecentDuplicate').mockResolvedValue(null);
    vi.spyOn(CommunityRepository.prototype, 'insertPost').mockResolvedValue(100);
    vi.spyOn(CommunityRepository.prototype, 'getPostById').mockResolvedValue(agentPost);
    vi.spyOn(CommunityRepository.prototype, 'updateTranslation').mockResolvedValue(undefined);
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer agent-secret' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'Found a useful skill for Codex.', topic: 'ai-coding' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
      TRANSLATION_ENABLED: 'false',
      GITHUB_CARD_ENABLED: 'false',
    }));
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: PublicCommunityPost };
    expect(payload.data.authorType).toBe('agent');
    expect(payload.data.agentId).toBe('skill-hunter');
    expect(payload.data.nickname).toBe('Skill Hunter');
    expect(payload.data.status).toBe('approved');
  });

  it('runs the same translation pipeline for agent posts', async () => {
    const agentPost = post({
      id: 200,
      authorType: 'agent',
      agentId: 'codex-watch',
      originalContent: '今日は面白いです',
      contentEn: null,
      contentZh: null,
    });
    const providerConfig = config({ TRANSLATION_API_KEY: 't', COMMUNITY_TRANSLATION_LOCALES: 'en,zh' });
    const updates: unknown[] = [];
    const repository = { updateTranslation: vi.fn(async (_id: number, update: unknown) => { updates.push(update); }) } as unknown as CommunityRepository;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'English translation' } }] }), { status: 200 }))));
    const result = await processCommunityTranslation(agentPost, env(), repository, providerConfig, new Date('2026-08-31T12:00:00.000Z'));
    expect(result.status).toBe('translated');
    expect(updates[0]).toMatchObject({ contentEn: 'English translation' });
  });

  it('runs the same GitHub card pipeline for agent posts', async () => {
    const cached: CommunityEmbed = {
      id: 3,
      postId: 4,
      type: 'repository',
      provider: 'github',
      url: 'https://github.com/openai/codex?tab=readme',
      canonicalUrl: 'https://github.com/openai/codex',
      title: 'openai / codex',
      description: 'cached',
      imageUrl: null,
      metadata: { owner: 'openai', repo: 'codex', stars: 1, forks: 2, language: 'Rust', license: null },
      fetchedAt: '2026-08-31T11:59:00.000Z',
      createdAt: '2026-08-31T11:00:00.000Z',
      updatedAt: '2026-08-31T11:59:00.000Z',
      fetchStatus: 'success',
      lastError: null,
      retryCount: 0,
    };
    const agentPost = post({
      id: 4,
      authorType: 'agent',
      agentId: 'repo-hunter',
      originalContent: 'https://github.com/openai/codex',
      contentEn: 'https://github.com/openai/codex',
      contentZh: null,
    });
    const repository = {
      getEmbed: vi.fn().mockResolvedValue(null),
      getFreshEmbed: vi.fn().mockResolvedValue(cached),
      upsertEmbed: vi.fn().mockResolvedValue(undefined),
      markEmbedFailure: vi.fn(),
    } as unknown as CommunityRepository;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('GitHub must not be called on cache hit')));
    const result = await processCommunityEmbeds(agentPost, env(), repository, config({ GITHUB_CARD_ENABLED: 'true' }), new Date('2026-08-31T12:00:00.000Z'));
    expect(result).toEqual({ success: 1, failures: 0 });
    expect(repository.upsertEmbed).toHaveBeenCalledWith(expect.objectContaining({ canonicalUrl: 'https://github.com/openai/codex', fetchStatus: 'success' }));
  });

  it('renders a subtle AI badge for agent posts and nothing for humans', () => {
    const agentPost = post({
      nickname: 'Skill Hunter',
      authorRole: 'member',
      authorType: 'agent',
      agentId: 'skill-hunter',
      originalContent: 'hello',
      contentEn: 'hello',
    }) as PublicCommunityPost;
    const html = renderCommunityPage({
      posts: [agentPost],
      nextCursor: null,
      total: 1,
      postingEnabled: false,
      turnstileSiteKey: null,
      maxNicknameLength: 32,
      maxContentLength: 2000,
    }, 'en');
    expect(html).toContain('community-ai-badge');
    expect(html).toContain('>AI<');
    const humanHtml = renderCommunityPage({
      posts: [post({ originalContent: 'hello', contentEn: 'hello' }) as PublicCommunityPost],
      nextCursor: null,
      total: 1,
      postingEnabled: false,
      turnstileSiteKey: null,
      maxNicknameLength: 32,
      maxContentLength: 2000,
    }, 'en');
    expect(humanHtml).not.toContain('community-ai-badge');
    const clientCode = readFileSync(new URL('../static/community.js', import.meta.url), 'utf8');
    expect(clientCode).toContain('appendAiBadge');
    expect(clientCode).toContain('aiAccount');
    expect(clientCode).toContain('community-ai-badge');
  });

  it('still publishes anonymous human posts behind Turnstile', async () => {
    const row = {
      id: 77,
      nickname: 'kyho',
      original_content: 'hello from a human',
      original_language: 'en',
      content_en: 'hello from a human',
      content_zh: null,
      translation_status: 'pending',
      translation_provider: null,
      translated_at: null,
      status: 'approved',
      created_at: '2026-08-31T12:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
      source_hash: 'a'.repeat(64),
      content_hash: 'b'.repeat(64),
      moderation_reason: null,
    };
    const db = {
      prepare: vi.fn((query: string) => ({
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockImplementation(() => ({ meta: { changes: query.includes('UPDATE community_rate_limits') ? 1 : 1, last_row_id: query.includes('INSERT INTO community_posts') ? 77 : 0 } })),
        first: vi.fn().mockResolvedValue(query.includes('community_bans') || query.includes('SELECT id, status') ? null : row),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
    } as unknown as D1Database;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 })));
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://tibo.modelyard.dev', 'CF-Connecting-IP': '203.0.113.20' },
      body: JSON.stringify({ nickname: 'kyho', content: 'hello from a human', turnstileToken: 'valid-widget-token' }),
    }), env({
      DB: db,
      COMMUNITY_POSTING_ENABLED: 'true',
      TRANSLATION_ENABLED: 'false',
      GITHUB_CARD_ENABLED: 'false',
      TURNSTILE_SITE_KEY: 'site-key',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(201);
    const payload = await response.json() as { data: { originalContent: string; authorType?: string } };
    expect(payload.data.originalContent).toBe('hello from a human');
    expect(payload.data.authorType).toBe('human');
  });

  it('enforces the per-run agent cap server-side', async () => {
    vi.spyOn(CommunityRepository.prototype, 'reserveAgentQuota').mockResolvedValue(false);
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer agent-secret' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'hello', topic: 'general' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: 'AGENT_RUN_CAP' });
  });

  it('enforces the per-day global agent cap and rolls back the run reservation', async () => {
    const order: string[] = [];
    vi.spyOn(CommunityRepository.prototype, 'reserveAgentQuota').mockImplementation(async (bucketKey: string) => {
      order.push(bucketKey);
      // run bucket first (succeeds), day bucket second (full)
      return bucketKey.startsWith('run:') ? true : false;
    });
    const release = vi.spyOn(CommunityRepository.prototype, 'releaseAgentQuota').mockResolvedValue(undefined);
    const response = await community.fetch(new Request('https://tibo.modelyard.dev/agent/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer agent-secret' },
      body: JSON.stringify({ identity: 'skill-hunter', content: 'hello', topic: 'general' }),
    }), env({
      DB: {} as D1Database,
      COMMUNITY_AGENT_SECRET: 'agent-secret',
      ABUSE_HASH_SECRET: 'hash-secret',
    }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: 'AGENT_DAY_CAP' });
    expect(order[0]).toMatch(/^run:/);
    expect(order[1]).toBe('day:agent');
    expect(release).toHaveBeenCalled();
  });

  it('keeps existing posts readable and derives a default author type', async () => {
    function postDb(row: Record<string, unknown>) {
      const db = {
        prepare: vi.fn((query: string) => ({
          bind: vi.fn().mockReturnThis(),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1, last_row_id: 0 } }),
          first: vi.fn().mockResolvedValue(query.includes('SELECT * FROM community_posts') ? row : null),
          all: vi.fn().mockResolvedValue({ results: query.includes('community_posts') ? [row] : [] }),
        })),
      } as unknown as D1Database;
      return db;
    }
    const base = {
      id: 1,
      nickname: 'kyho',
      original_content: 'hi',
      original_language: 'en',
      content_en: 'hi',
      content_zh: null,
      translation_status: 'pending',
      translation_provider: null,
      translated_at: null,
      status: 'approved',
      created_at: '2026-08-31T12:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
      source_hash: 'a'.repeat(64),
      content_hash: 'b'.repeat(64),
      moderation_reason: null,
      topic: 'general',
      is_announcement: 0,
      is_pinned: 0,
      is_featured: 0,
    };
    const legacy = await new CommunityRepository(postDb({ ...base, author_role: 'member' })).getPostById(1);
    expect(legacy?.authorType).toBe('human');
    const admin = await new CommunityRepository(postDb({ ...base, author_role: 'admin' })).getPostById(1);
    expect(admin?.authorType).toBe('admin');
  });

  it('adds agent columns and the quota table without destroying existing data', () => {
    const migration = readFileSync(new URL('../migrations/0018_community_agent_posts.sql', import.meta.url), 'utf8');
    expect(migration).toContain("ADD COLUMN author_type TEXT NOT NULL DEFAULT 'human'");
    expect(migration).toContain("CHECK(author_type IN ('human', 'agent', 'admin'))");
    expect(migration).toContain('ADD COLUMN agent_id TEXT');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS community_agent_quotas');
    expect(migration).toContain("UPDATE community_posts SET author_type = 'admin' WHERE author_role = 'admin'");
    expect(migration).not.toContain('DROP TABLE');
  });
});
