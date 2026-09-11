import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Repository } from '../src/db/repository';
import { recordReviewAlert, resolveReview } from '../src/review';
import { backfillHistoricalXTimeline, getClassificationBudgetPerRun, prioritizeCandidates, probeXIngestionCompleteness, recordRunDuration } from '../src/cron';
import { isNeedsReviewStrongResetSignal } from '../src/classifier/types';
import type { ClassificationResult, Env, SourcePost } from '../src/types';
vi.mock('../src/open-gambit/workflow-entrypoint', () => ({ OpenGambitAnalysisWorkflow: class {} }));
import worker from '../src/index';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const now = new Date('2026-09-11T00:00:00.000Z');
const env = (overrides = {}) => ({ DB: {}, X_API_BEARER_TOKEN: 'test', X_API_USER_ID: '123', MONITORED_ACCOUNTS: 'thsottiaux', ...overrides } as Env);
const post = (overrides: Partial<SourcePost> = {}): SourcePost => ({ id: 1, source: 'x_api', source_account: 'thsottiaux', source_post_id: '2097837455569846272', canonical_post_id: '2097837455569846272', canonical_platform: 'x',
  source_url: 'https://x.com/thsottiaux/status/2097837455569846272', source_quality: 'DIRECT', verification_status: 'DIRECT_VERIFIED', text: 'Codex limits lifted for everyone.',
  published_at: '2026-09-10T00:00:00.000Z', fetched_at: '2026-09-10T00:01:00.000Z', raw_json: '{}', content_hash: 'h', classification_decision: 'REVIEW', classification_reason_code: 'NEEDS_REVIEW', ...overrides });
const result = (overrides = {}): ClassificationResult => ({ relevant: true, category: 'RESET_COMPLETED', product_scope: 'CODEX', statement_nature: 'FACT', confidence: 0.95, title_en: 'Codex limits restored', title_zh: 'Codex 配额恢复', summary_en: 'Usage limits restored for Codex users.', summary_zh: 'Codex 用户配额恢复。', effective_time: null, reset_time: null, reason: '', ...overrides });
function reviewRepo(source = post()) {
  let event: any = null;
  return { acquireLock: vi.fn(async () => 'lock'), releaseLock: vi.fn(async () => {}), getSourcePostById: vi.fn(async () => source), getReviewEvent: vi.fn(async () => event), reserveProviderUsage: vi.fn(async () => true), getActiveResetCycle: vi.fn(async () => null),
    insertEvent: vi.fn(async (value: any) => { event = { ...value, id: 10 }; return 10; }), handleResetEvent: vi.fn(async () => {}), markClassified: vi.fn(async () => {}), recordClassificationDecision: vi.fn(async () => {}), rejectReview: vi.fn(async () => true) };
}
const classifier = (value = result()) => ({ classify: vi.fn(async () => ({ status: 'SUCCESS' as const, result: value })) });

describe('G1 explicit review closure', () => {
  it('publishes direct admissible evidence through insertEvent and lifecycle, then closes trace', async () => {
    const repo = reviewRepo();
    expect(await resolveReview(repo as any, classifier(), { id: 1, action: 'publish' }, now)).toMatchObject({ eventId: 10 });
    expect(repo.insertEvent).toHaveBeenCalledWith(expect.objectContaining({ verification_status: 'DIRECT_VERIFIED', verified_at: now.toISOString() }), true);
    expect(repo.handleResetEvent).toHaveBeenCalledTimes(1);
    expect(repo.recordClassificationDecision).toHaveBeenCalledWith(1, expect.objectContaining({ classification_reason_code: 'REVIEW_PUBLISHED' }));
  });
  it.each([
    ['observation', {}, { statement_nature: 'OBSERVATION' }], ['no anchor', { text: 'Limits lifted for everyone.' }, {}],
    ['indexed', { source_quality: 'INDEXED', verification_status: 'INDEXED_ONLY' }, {}], ['rejected', { verification_status: 'REJECTED' }, {}],
    ['operator rejected', { classification_reason_code: 'OPERATOR_REJECTED' }, {}], ['non Codex', {}, { product_scope: 'OTHER' }],
    ['untrusted', { source_account: 'other' }, {}], ['not queued', { classification_decision: 'NO_EVENT' }, {}],
  ])('blocks %s without insertion', async (_label, source, classified) => {
    const repo = reviewRepo(post(source as any));
    await expect(resolveReview(repo as any, classifier(result(classified)), { id: 1, action: 'publish' }, now)).rejects.toThrow();
    expect(repo.insertEvent).not.toHaveBeenCalled();
  });
  it('cannot force category or bypass exhausted classification budget', async () => {
    const repo = reviewRepo(); const llm = classifier();
    await expect(resolveReview(repo as any, llm, { id: 1, action: 'publish', category: 'POLICY_CHANGE' }, now)).rejects.toThrow('CATEGORY_EVIDENCE_MISMATCH');
    repo.reserveProviderUsage.mockResolvedValue(false);
    llm.classify.mockClear();
    await expect(resolveReview(repo as any, llm, { id: 1, action: 'publish' }, now)).rejects.toThrow('BUDGET');
    expect(llm.classify).not.toHaveBeenCalled();
  });
  it('rejects with bounded reason without any LLM calls', async () => {
    const repo = reviewRepo(); const llm = classifier();
    await resolveReview(repo as any, llm, { id: 1, action: 'reject', reason: 'NON_RESET_CONTEXT' }, now);
    expect(repo.rejectReview).toHaveBeenCalledWith(1, 'NON_RESET_CONTEXT'); expect(llm.classify).not.toHaveBeenCalled();
  });
  it('leaves review open on lifecycle failure and repairs on replay without duplicate event or LLM', async () => {
    const repo = reviewRepo(); const llm = classifier();
    repo.handleResetEvent.mockRejectedValueOnce(new Error('D1 failure'));
    await expect(resolveReview(repo as any, llm, { id: 1, action: 'publish' }, now)).rejects.toThrow('D1 failure');
    expect(repo.recordClassificationDecision).not.toHaveBeenCalled();
    await resolveReview(repo as any, llm, { id: 1, action: 'publish' }, now);
    expect(repo.insertEvent).toHaveBeenCalledTimes(1); expect(llm.classify).toHaveBeenCalledTimes(1);
  });
  it('alerts at threshold with settings only by default, supports provider opt-in and clears', async () => {
    const repo = { getReviewQueueStats: vi.fn(async () => ({ count: 1, oldestAt: '2026-09-10T18:00:00Z' })), setSetting: vi.fn(), recordProviderStatus: vi.fn() };
    expect((await recordReviewAlert(repo as any, env(), now)).overdue).toBe(true);
    expect(repo.recordProviderStatus).not.toHaveBeenCalled();
    await recordReviewAlert(repo as any, env({ REVIEW_ALERT_PROVIDER_STATUS: 'true' }), now);
    expect(repo.recordProviderStatus).toHaveBeenCalledWith('review-queue', 'degraded', null, 'REVIEW_QUEUE_OVERDUE');
    repo.getReviewQueueStats.mockResolvedValue({ count: 0, oldestAt: null } as any);
    expect((await recordReviewAlert(repo as any, env(), now)).overdue).toBe(false);
  });
});

describe('authenticated routes and G2 health warning', () => {
  const fetchRoute = (path: string, init = {}, overrides = {}) => worker.fetch(new Request(`https://local.test${path}`, init), env(overrides), {} as any);
  it('fails closed for missing config, missing secret, invalid JSON and invalid inputs', async () => {
    expect((await fetchRoute('/__cron/review-resolve', { method: 'POST' })).status).toBe(503);
    expect((await fetchRoute('/__cron/review-resolve', { method: 'POST' }, { CRON_SECRET: 'test' })).status).toBe(401);
    expect((await fetchRoute('/__cron/review-queue', {}, { CRON_SECRET: 'test' })).status).toBe(401);
    expect((await fetchRoute('/__cron/review-resolve', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{' }, { CRON_SECRET: 'test' })).status).toBe(400);
    expect((await fetchRoute('/__cron/review-resolve', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: '{}' }, { CRON_SECRET: 'test' })).status).toBe(400);
  });
  it('reject route works without configured LLM', async () => {
    vi.spyOn(Repository.prototype, 'getSourcePostById').mockResolvedValue(post());
    vi.spyOn(Repository.prototype, 'rejectReview').mockResolvedValue(true);
    vi.spyOn(Repository.prototype, 'acquireLock').mockResolvedValue('lock');
    vi.spyOn(Repository.prototype, 'releaseLock').mockResolvedValue(undefined);
    const response = await fetchRoute('/__cron/review-resolve', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ id: 1, action: 'reject' }) }, { CRON_SECRET: 'test' });
    expect(response.status).toBe(200);
  });
  it('health includes a top-level disabled warning even when DB diagnostics fail', async () => {
    const response = await fetchRoute('/api/health');
    expect((await response.json() as any).warnings).toContain('ingestion probe disabled');
  });
  it('sample endpoint rejects unauthenticated and invalid reasons; returns bounded fields', async () => {
    expect((await fetchRoute('/__cron/rejection-samples?reason=NEEDS_REVIEW', {}, { CRON_SECRET: 'test' })).status).toBe(401);
    expect((await fetchRoute('/__cron/rejection-samples?reason=arbitrary', { headers: { Authorization: 'Bearer test' } }, { CRON_SECRET: 'test' })).status).toBe(400);
    vi.spyOn(Repository.prototype, 'getRejectionSamples').mockResolvedValue([{ id: 1, url: post().source_url }]);
    const response = await fetchRoute('/__cron/rejection-samples?reason=NEEDS_REVIEW', { headers: { Authorization: 'Bearer test' } }, { CRON_SECRET: 'test' });
    expect(await response.json()).toEqual({ reason: 'NEEDS_REVIEW', samples: [{ id: 1, url: post().source_url }] });
  });
});

describe('G3-G5 bounded classification and noise', () => {
  it('keeps all realtime posts before backfill, and reset hints first within each group', () => {
    const values = [post({ id: 1, text: 'Random life update', first_discovered_via: 'backfill' }), post({ id: 2, text: 'Codex resets applied', first_discovered_via: 'backfill' }), post({ id: 3, text: 'Random life update' }), post({ id: 4, text: 'Codex resets applied' })];
    expect(prioritizeCandidates(values).map(p => p.id)).toEqual([4, 3, 2, 1]);
  });
  it('caps at eight, defaults eight, honors zero and clamps negatives', () => {
    expect(getClassificationBudgetPerRun(env())).toBe(8);
    expect(getClassificationBudgetPerRun(env({ CLASSIFICATIONS_PER_RUN: '50' }))).toBe(8);
    expect(getClassificationBudgetPerRun(env({ CLASSIFICATIONS_PER_RUN: '0' }))).toBe(0);
    expect(getClassificationBudgetPerRun(env({ CLASSIFICATIONS_PER_RUN: '-1' }))).toBe(0);
  });
  it('records elapsed wall time and slow-run alert', async () => {
    const repo = { setSetting: vi.fn(), recordProviderStatus: vi.fn() };
    await recordRunDuration(repo as any, env({ MONITOR_RUN_WARN_MS: '10' }), '2026-09-11T00:00:00Z', '2026-09-11T00:00:01Z');
    expect(JSON.parse(repo.setSetting.mock.calls[0][1]).elapsedMs).toBe(1000);
    expect(repo.recordProviderStatus).toHaveBeenCalledWith('monitor-runtime', 'degraded', expect.any(String), 'MONITOR_RUN_SLOW');
  });
  it.each(['Fixed a bug everyone reported', 'Done for today, everyone', 'Feature rolling out for everyone', 'PR done for all users', 'Deploy fixed for everyone', 'Limits are not lifted for everyone', "Limits aren't lifted for everyone"] )('excludes noise: %s', text => expect(isNeedsReviewStrongResetSignal(post({ text }))).toBe(false));
  it.each(['Limits lifted for everyone', 'Done. Everyone should be good now.', 'Usage restored for all users'])('keeps reset: %s', text => expect(isNeedsReviewStrongResetSignal(post({ text }))).toBe(true));
});

function mockX() {
  vi.spyOn(Repository.prototype, 'getSetting').mockResolvedValue(null);
  vi.spyOn(Repository.prototype, 'setSetting').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'getOldestDirectXSourcePostId').mockResolvedValue(null);
  vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(true);
  vi.spyOn(Repository.prototype, 'recordProviderStatus').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'recordProviderUsageSuccess').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'upsertSourcePost').mockResolvedValue({ id: 1, isNew: true, upgraded: false });
  vi.spyOn(Repository.prototype, 'advanceXApiCursor').mockResolvedValue(true);
}
describe('G6 window boundaries and G8 real request accounting', () => {
  it('uses inclusive start, exclusive end and reports both windows plus discrepancy', async () => {
    mockX(); vi.spyOn(Repository.prototype, 'countIngestedDirectXPostsWithin').mockResolvedValue(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: '1', text: 'at start', created_at: '2026-09-10T00:00:00Z' }, { id: '2', text: 'inside', created_at: '2026-09-10T23:59:59Z' },
      { id: '2', text: 'duplicate inside', created_at: '2026-09-10T23:59:59Z' },
      { id: '3', text: 'at end', created_at: '2026-09-11T00:00:00Z' }, { id: '4', text: 'before', created_at: '2026-09-09T23:59:59Z' },
    ], meta: {} }))));
    const value = await probeXIngestionCompleteness(env({ X_INGESTION_PROBE_ENABLED: 'true' }), { now });
    expect(value).toMatchObject({ timelineCount: 2, storedCount: 1, timelineWindowStart: '2026-09-10T00:00:00.000Z', storedWindowEnd: now.toISOString(), discrepancyRatio: 0.5, warning: 'INGESTION_COUNT_DISCREPANCY' });
    expect(Repository.prototype.countIngestedDirectXPostsWithin).toHaveBeenCalledWith(value.timelineWindowStart, now, ['thsottiaux']);
    expect(Repository.prototype.upsertSourcePost).not.toHaveBeenCalled();
  });
  it('counts lookup + pages, retains capped pages as backfill without advancing cursor', async () => {
    mockX();
    const fetch = vi.fn(async (url: any) => new Response(JSON.stringify(String(url).includes('/by/username/') ? { data: { id: '123' } } : { data: [{ id: '2097837455569846272', text: 'Codex resets applied', created_at: '2026-09-10T00:00:00Z' }], meta: { next_token: 'more' } })));
    vi.stubGlobal('fetch', fetch);
    const value = await backfillHistoricalXTimeline(env({ X_API_USER_ID: undefined }), { now, maxPages: 2 });
    expect(value).toMatchObject({ httpRequestsUsed: 3, pagesFetched: 2, reservationsUsed: 1, cursorAdvanced: false });
    expect(Repository.prototype.upsertSourcePost).toHaveBeenCalledWith(expect.objectContaining({ first_discovered_via: 'backfill' }), now.toISOString());
    expect(Repository.prototype.advanceXApiCursor).not.toHaveBeenCalled();
  });
  it('429 stops all accounts and fails closed with warning and attempted request counts', async () => {
    mockX(); const fetch = vi.fn(async (url: any) => String(url).includes('/by/username/') ? new Response(JSON.stringify({ data: { id: '123' } })) : new Response('', { status: 429, headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(now.getTime() / 1000 + 900) } }));
    vi.stubGlobal('fetch', fetch);
    const value = await backfillHistoricalXTimeline(env({ MONITORED_ACCOUNTS: 'thsottiaux,other' }), { now, maxPages: 20 });
    expect(value).toMatchObject({ httpRequestsUsed: 2, reservationsUsed: 1, newPosts: 0, errors: ['X_BACKFILL_RATE_LIMITED'] });
    expect(fetch).toHaveBeenCalledTimes(2); expect(Repository.prototype.upsertSourcePost).not.toHaveBeenCalled();
    expect(Repository.prototype.recordProviderStatus).toHaveBeenCalledWith('x-backfill', 'degraded', null, 'X_BACKFILL_RATE_LIMITED');
  });
  it('exhausted reservation makes zero HTTP requests', async () => {
    mockX(); vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockResolvedValue(false);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await backfillHistoricalXTimeline(env(), { now })).toMatchObject({ reservationsUsed: 0, httpRequestsUsed: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});

// Execute the repository's actual SQL against SQLite, not mocked result rows.
function captureRepo() {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const db = { prepare(sql: string) { const call = { sql, args: [] as unknown[] }; calls.push(call); return { bind(...args: unknown[]) { call.args = args; return this; }, async run() { return { meta: { changes: 1, last_row_id: 1 } }; }, async first() { return null; }, async all() { return { results: [] }; } }; } };
  return { repo: new Repository(db as any), calls };
}
it('SQLite: reject/publish ordering, dedup and terminal guard; bounded window SQL and real-time queue', async () => {
  const { repo, calls } = captureRepo();
  await repo.insertEvent({ source_post_id: 1, category: 'RESET_COMPLETED', title_en: 'reset', title_zh: '重置', summary_en: 'reset', summary_zh: '重置', confidence: 0.95, published_at: null, effective_at: null, reset_at: null, source_url: post().source_url, source_quality: 'DIRECT', verification_status: 'DIRECT_VERIFIED', verified_at: now.toISOString() }, true);
  await repo.rejectReview(1, 'NON_RESET_CONTEXT');
  await repo.countIngestedDirectXPostsWithin('2026-09-10T00:00:00Z', now, ['thsottiaux']);
  await repo.getUnclassifiedPosts(1, now);
  await repo.getRejectionSamples('MISSING_PRODUCT_CONTEXT', now);
  await repo.recordClassificationDecision(1, { classification_label: 'RESET_COMPLETED', classification_decision: 'REVIEW', classification_reason_code: 'NEEDS_REVIEW', classification_source_context: 'NONE', classification_event_created: false, classifier_version: 'test' });
  const script = `import sqlite3,json,sys
calls=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript('''CREATE TABLE source_posts(id INTEGER PRIMARY KEY, source TEXT DEFAULT 'x_api', canonical_platform TEXT DEFAULT 'x', canonical_post_id TEXT DEFAULT '2097837455569846272', source_account TEXT DEFAULT 'thsottiaux', source_quality TEXT DEFAULT 'DIRECT', verification_status TEXT DEFAULT 'DIRECT_VERIFIED', classification_decision TEXT DEFAULT 'REVIEW', classification_reason_code TEXT DEFAULT 'NEEDS_REVIEW', classification_label TEXT, classification_source_context TEXT, classification_event_created INTEGER, classifier_version TEXT, classification_pending INTEGER DEFAULT 0, published_at TEXT, fetched_at TEXT, first_discovered_via TEXT, classification_failure_kind TEXT, classification_error TEXT, classification_attempts INTEGER, last_classification_attempt_at TEXT);
CREATE TABLE monitor_events(id INTEGER PRIMARY KEY, source_post_id INTEGER UNIQUE, category TEXT, title_en TEXT,title_zh TEXT,summary_en TEXT,summary_zh TEXT,confidence REAL,published_at TEXT,effective_at TEXT,reset_at TEXT,source_url TEXT,evidence_quality TEXT,verification_status TEXT,verified_at TEXT); INSERT INTO source_posts(id) VALUES(1);''')
def run(n): return db.execute(calls[n]['sql'],calls[n]['args'])
assert run(1).rowcount==1
assert run(0).rowcount==0
assert run(5).rowcount==0
assert db.execute('SELECT classification_reason_code FROM source_posts').fetchone()[0]=='OPERATOR_REJECTED'
db.execute("UPDATE source_posts SET classification_decision='REVIEW',classification_reason_code='NEEDS_REVIEW'")
assert run(0).rowcount==1
assert run(0).rowcount==0
assert run(1).rowcount==0
for i,t,a in [(2,'2026-09-10T00:00:00Z','thsottiaux'),(3,'2026-09-10 12:00:00','thsottiaux'),(4,'2026-09-11T00:00:00Z','thsottiaux'),(5,'2026-09-10T00:00:00Z','other')]: db.execute('INSERT INTO source_posts(id,published_at,source_account) VALUES(?,?,?)',(i,t,a))
assert run(2).fetchone()[0]==2
db.execute("UPDATE source_posts SET classification_pending=1,classification_decision='NO_EVENT',classification_reason_code=NULL,first_discovered_via='backfill' WHERE id=2")
db.execute("UPDATE source_posts SET classification_pending=1,classification_decision='NO_EVENT',classification_reason_code=NULL,first_discovered_via='x_api' WHERE id=3")
assert run(3).fetchone()[0]==3
for i in range(10,20): db.execute("INSERT INTO source_posts(id,classification_reason_code,fetched_at) VALUES(?,'MISSING_PRODUCT_CONTEXT','2026-09-10T00:00:00Z')",(i,))
assert len(run(4).fetchall())==3
print('ok')`;
  expect(execFileSync('python3', ['-c', script], { input: JSON.stringify(calls), encoding: 'utf8' }).trim()).toBe('ok');
});

it('G2 healthy 15-minute intake cannot starve a due probe; next slot resumes intake', async () => {
  const { executeCron } = await import('../src/cron');
  mockX();
  const settings = new Map<string, string>();
  let usage: any = null;
  vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async key => settings.get(key) ?? null);
  vi.spyOn(Repository.prototype, 'setSetting').mockImplementation(async (key, value) => { settings.set(key, value); });
  vi.spyOn(Repository.prototype, 'getProviderUsage').mockImplementation(async provider => provider === 'x_api' ? usage : null);
  vi.spyOn(Repository.prototype, 'reserveProviderUsage').mockImplementation(async (_p, _d, limit, at, slot) => {
    if (usage?.last_request_slot === slot || (usage?.request_count ?? 0) >= limit) return false;
    usage = { request_count: (usage?.request_count ?? 0) + 1, last_request_slot: slot, last_request_at: at }; return true;
  });
  vi.spyOn(Repository.prototype, 'insertRun').mockResolvedValue(1);
  vi.spyOn(Repository.prototype, 'updateRun').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'advanceResetCycleState').mockResolvedValue(undefined);
  vi.spyOn(Repository.prototype, 'getActiveResetCycle').mockResolvedValue(null);
  vi.spyOn(Repository.prototype, 'hasRecentTrustedResetPlan').mockResolvedValue(false);
  vi.spyOn(Repository.prototype, 'getUnclassifiedPosts').mockResolvedValue([]);
  vi.spyOn(Repository.prototype, 'getDirectPostsWithoutEvents').mockResolvedValue([]);
  vi.spyOn(Repository.prototype, 'getReviewQueueStats').mockResolvedValue({ count: 0, oldestAt: null });
  vi.spyOn(Repository.prototype, 'countIngestedDirectXPostsWithin').mockResolvedValue(0);
  vi.spyOn(Repository.prototype, 'acquireLock').mockResolvedValue('lock');
  vi.spyOn(Repository.prototype, 'releaseLock').mockResolvedValue(undefined);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [], meta: {} })));
  vi.stubGlobal('fetch', fetch);
  const intake = { fetchIncremental: vi.fn(async () => ({ accounts: [], fetchedAt: now.toISOString() })) };
  const config = env({ X_INGESTION_PROBE_ENABLED: 'true', X_API_AUTOMATIC_SYNC: 'true' });
  const first = await executeCron(config, null, classifier(), { now, xApiProvider: intake as any });
  expect(first.xIngestionProbe?.probeRun).toBe(true);
  expect(first.xApiCalls).toBe(1);
  expect(intake.fetchIncremental).not.toHaveBeenCalled();
  await executeCron(config, null, classifier(), { now: new Date(now.getTime() + 900000), xApiProvider: intake as any });
  expect(intake.fetchIncremental).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('G2 health warns on the normal response and honors enabled config', async () => {
  const db = { prepare: () => ({ bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; } }) };
  const response = await worker.fetch(new Request('https://local.test/api/health'), env({ DB: db }), {} as any);
  expect(response.status).toBe(200);
  expect((await response.json() as any).warnings).toContain('ingestion probe disabled');
  const enabled = await worker.fetch(new Request('https://local.test/api/health'), env({ DB: db, X_INGESTION_PROBE_ENABLED: 'true' }), {} as any);
  expect((await enabled.json() as any).warnings).not.toContain('ingestion probe disabled');
});

it('G8 honors persisted 429 cooldown before even reserving another request', async () => {
  mockX();
  vi.spyOn(Repository.prototype, 'getSetting').mockImplementation(async key => key === 'x_api_rate_limit_remaining' ? '0' : key === 'x_api_rate_limit_reset_at' ? '2026-09-11T00:15:00Z' : null);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await backfillHistoricalXTimeline(env(), { now, force: true })).toMatchObject({ reservationsUsed: 0, httpRequestsUsed: 0 });
  expect(Repository.prototype.reserveProviderUsage).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('G1 serializes review resolution before lifecycle writes', async () => {
  const repo = reviewRepo(); repo.acquireLock.mockResolvedValue(null as any);
  await expect(resolveReview(repo as any, classifier(), { id: 1, action: 'publish' }, now)).rejects.toThrow('REVIEW_BUSY');
  expect(repo.getSourcePostById).not.toHaveBeenCalled();
  expect(repo.insertEvent).not.toHaveBeenCalled();
});

it('G4 derives actual run duration from persisted monitor_runs timestamps', async () => {
  const db = { prepare: () => ({ async first() { return { id: 1, started_at: '2026-09-11T00:00:00Z', finished_at: '2026-09-11T00:00:02Z' }; } }) };
  expect((await new Repository(db as any).getLatestRun())?.duration_ms).toBe(2000);
});
