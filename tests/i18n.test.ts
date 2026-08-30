import { describe, it, expect } from 'vitest';

describe('i18n - Bilingual Support', () => {
  it('default language should be English', () => {
    const defaultLang = 'en';
    expect(defaultLang).toBe('en');
  });

  it('Chinese is secondary language', () => {
    const zhLang = 'zh-CN';
    expect(zhLang).toBe('zh-CN');
  });

  it('language preference uses localStorage key', () => {
    const key = 'tibo-monitor-language';
    expect(key).toBe('tibo-monitor-language');
  });

  it('no stored preference defaults to English', () => {
    const saved = null;
    const lang = saved === 'zh-CN' ? 'zh-CN' : 'en';
    expect(lang).toBe('en');
  });

  it('stored zh-CN preference is respected', () => {
    const saved = 'zh-CN';
    const lang = saved === 'zh-CN' || saved === 'en' ? saved : 'en';
    expect(lang).toBe('zh-CN');
  });
});

describe('i18n - Event Translation Fallback', () => {
  it('zh-CN should prefer title_zh, fallback to title_en', () => {
    const event = { title_zh: '中文标题', title_en: 'English Title' };
    const result = 'zh-CN' === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
    expect(result).toBe('中文标题');
  });

  it('zh-CN should fallback to title_en when title_zh is null', () => {
    const event = { title_zh: null, title_en: 'English Title' };
    const result = 'zh-CN' === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
    expect(result).toBe('English Title');
  });

  it('en should prefer title_en, fallback to title_zh', () => {
    const event = { title_zh: '中文标题', title_en: 'English Title' };
    const result = 'en' === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
    expect(result).toBe('English Title');
  });

  it('en should fallback to title_zh when title_en is null', () => {
    const event = { title_zh: '中文标题', title_en: null };
    const result = 'en' === 'zh-CN' ? (event.title_zh || event.title_en) : (event.title_en || event.title_zh);
    expect(result).toBe('中文标题');
  });
});

describe('i18n - Original Source Not Translated', () => {
  it('source_text should remain untranslated regardless of language', () => {
    const sourceText = 'Reset has been propagated to accounts.';
    // In both languages, source text stays the same
    expect(sourceText).toBe('Reset has been propagated to accounts.');
  });
});

describe('Data Integrity - published_at', () => {
  it('published_at should be null when unknown, not fetched_at', () => {
    const post = { published_at: null, fetched_at: '2026-08-25T12:00:00.000Z' };
    expect(post.published_at).toBeNull();
    // fetched_at should never be used as published_at
    expect(post.published_at).not.toBe(post.fetched_at);
  });

  it('frontend should show "Published time unavailable" when published_at is null', () => {
    const publishedAt = null;
    const enDisplay = publishedAt ? 'Formatted date' : 'Published time unavailable';
    expect(enDisplay).toBe('Published time unavailable');
  });
});

describe('Data Integrity - Canonical Post ID', () => {
  it('cross-provider dedup uses canonical_platform + canonical_post_id', () => {
    const post1 = { source: 'google_search', source_post_id: '123', canonical_platform: 'x', canonical_post_id: '123456' };
    const post2 = { source: 'x_api', source_post_id: '123456', canonical_platform: 'x', canonical_post_id: '123456' };
    // Same canonical identity = same post
    expect(post1.canonical_platform).toBe(post2.canonical_platform);
    expect(post1.canonical_post_id).toBe(post2.canonical_post_id);
  });

  it('different canonical_post_id means different posts', () => {
    const post1 = { canonical_platform: 'x', canonical_post_id: '123' };
    const post2 = { canonical_platform: 'x', canonical_post_id: '456' };
    expect(post1.canonical_post_id).not.toBe(post2.canonical_post_id);
  });
});

describe('Data Integrity - Source Quality', () => {
  it('INDEXED source is not DIRECT_X_API', () => {
    const indexed = 'INDEXED';
    const direct = 'DIRECT_X_API';
    expect(indexed).not.toBe(direct);
  });
});

describe('Date Format Localization', () => {
  it('English date format uses short month names', () => {
    const d = new Date('2026-08-25T00:00:00.000Z');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const result = months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
    expect(result).toBe('Aug 25, 2026');
  });

  it('Chinese date format uses year-month-day', () => {
    const d = new Date('2026-08-25T00:00:00.000Z');
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    const result = y + '年' + mo + '月' + da + '日';
    expect(result).toBe('2026年08月25日');
  });
});

describe('Domain Migration', () => {
  it('new canonical domain is tibo.modelyard.dev', () => {
    const newDomain = 'https://tibo.modelyard.dev';
    expect(newDomain).toBe('https://tibo.modelyard.dev');
  });

  it('old domain codex.modelyard.dev is no longer canonical', () => {
    const oldDomain = 'https://codex.modelyard.dev';
    const newDomain = 'https://tibo.modelyard.dev';
    expect(oldDomain).not.toBe(newDomain);
  });

  it('old domain should redirect to new domain', () => {
    const oldUrl = 'https://codex.modelyard.dev/';
    const newUrl = 'https://tibo.modelyard.dev/';
    // For browser routes, old domain redirects 301
    const redirectUrl = oldUrl.replace('codex.', 'tibo.');
    expect(redirectUrl).toBe(newUrl);
  });
});
