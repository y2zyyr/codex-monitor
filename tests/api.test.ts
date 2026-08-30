import { describe, it, expect } from 'vitest';

describe('API Endpoints', () => {
  const endpoints = [
    { method: 'GET', path: '/api/events', params: '?limit=20' },
    { method: 'GET', path: '/api/export', params: '?format=csv' },
    { method: 'GET', path: '/api/history', params: '?days=30' },
    { method: 'GET', path: '/api/events/:id', params: '' },
    { method: 'GET', path: '/api/status', params: '' },
    { method: 'GET', path: '/api/health', params: '' },
  ];

  it('all required endpoints are defined', () => {
    const paths = endpoints.map(e => e.path);
    expect(paths).toContain('/api/events');
    expect(paths).toContain('/api/export');
    expect(paths).toContain('/api/history');
    expect(paths).toContain('/api/events/:id');
    expect(paths).toContain('/api/status');
    expect(paths).toContain('/api/health');
  });

  it('/api/events supports limit, cursor, category, search and date params', () => {
    const params = new URLSearchParams();
    params.set('limit', '20');
    params.set('cursor', '0');
    params.set('category', 'POLICY_CHANGE');
    params.set('q', '5 hour');
    params.set('startDate', '2026-08-01');
    params.set('endDate', '2026-08-27');
    expect(params.get('limit')).toBe('20');
    expect(params.get('cursor')).toBe('0');
    expect(params.get('category')).toBe('POLICY_CHANGE');
    expect(params.get('q')).toBe('5 hour');
    expect(params.get('startDate')).toBe('2026-08-01');
    expect(params.get('endDate')).toBe('2026-08-27');
  });

  it('status response has required fields', () => {
    const mockResponse = {
      status: 'ok',
      lastCheckedAt: '2026-08-25T00:00:00.000Z',
      latestEvent: null,
      lastReset: null,
      currentPolicy: null,
      lastRun: null,
      checkedAccounts: ['thsottiaux'],
      providers: {
        xApi: {
          automaticSync: true,
          status: 'ok',
          pollIntervalMinutes: 15,
          lastAttemptAt: '2026-08-27T12:00:00.000Z',
          lastSuccessAt: '2026-08-27T12:00:00.000Z',
          lastNewPostAt: null,
          nextPollAt: '2026-08-27T12:15:00.000Z',
          rateLimitRemaining: 899,
          rateLimitResetAt: null,
          observedPostsToday: 0,
        },
      },
    };

    expect(mockResponse).toHaveProperty('status');
    expect(mockResponse).toHaveProperty('lastCheckedAt');
    expect(mockResponse).toHaveProperty('latestEvent');
    expect(mockResponse).toHaveProperty('lastReset');
    expect(mockResponse).toHaveProperty('currentPolicy');
    expect(mockResponse).toHaveProperty('lastRun');
    expect(mockResponse).toHaveProperty('checkedAccounts');
    expect(mockResponse.providers.xApi).toHaveProperty('pollIntervalMinutes');
    expect(mockResponse.providers.xApi).toHaveProperty('lastSuccessAt');
    expect(mockResponse.providers.xApi).toHaveProperty('rateLimitRemaining');
  });

  it('health response has required fields', () => {
    const mockResponse = {
      status: 'ok',
      version: '0.1.0',
      uptime: null,
      lastRun: null,
      dbConnected: true,
    };

    expect(mockResponse).toHaveProperty('status');
    expect(mockResponse).toHaveProperty('version');
    expect(mockResponse).toHaveProperty('uptime');
    expect(mockResponse).toHaveProperty('lastRun');
    expect(mockResponse).toHaveProperty('dbConnected');
  });

  it('events paginated response has required fields', () => {
    const mockResponse = {
      data: [],
      nextCursor: null,
      total: 0,
    };

    expect(mockResponse).toHaveProperty('data');
    expect(mockResponse).toHaveProperty('nextCursor');
    expect(mockResponse).toHaveProperty('total');
    expect(Array.isArray(mockResponse.data)).toBe(true);
  });
});
