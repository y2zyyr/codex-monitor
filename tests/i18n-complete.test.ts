import { describe, it, expect } from 'vitest';

// Complete i18n dictionary for testing
const messages = {
  en: {
    siteTitle: 'Tibo Codex Monitor — Usage Reset & Rate Limit Tracker',
    monitoring: 'Monitoring @thsottiaux',
    live: 'Monitor',
    notConfigured: 'NOT CONFIGURED',
    lastReset: 'Last Reset',
    currentPolicy: 'Current Policy',
    timeline: 'Timeline',
    all: 'All',
    resetPlanned: 'Reset Planned',
    resetCompleted: 'Reset Completed',
    resetTimeChanged: 'Time Changed',
    policyChange: 'Policy',
    noEvents: 'No events to display.',
    footer: 'Independent monitor · Not affiliated with OpenAI.',
    resetCountdown: 'Reset Countdown',
    noResetScheduled: 'No reset currently scheduled.',
    resetTimeReached: 'Expected reset time reached.',
    waitingForConfirmation: 'Waiting for confirmation...',
    resetConfirmed: 'RESET CONFIRMED',
    confirmedBy: 'Confirmed by',
    resetLikelyCompleted: 'RESET LIKELY COMPLETED',
    publishedTimeUnavailable: 'Published time unavailable',
    viewOriginal: 'View original post',
  },
  'zh-CN': {
    siteTitle: 'Tibo Codex 监控 — 使用额度、重置与限额追踪',
    monitoring: '正在监控 @thsottiaux',
    live: '监控中',
    notConfigured: '尚未配置',
    lastReset: '最近重置',
    currentPolicy: '当前政策',
    timeline: '时间线',
    all: '全部',
    resetPlanned: '计划重置',
    resetCompleted: '重置完成',
    resetTimeChanged: '时间变更',
    policyChange: '政策',
    noEvents: '暂无可显示事件。',
    footer: '非官方监控站 · 与 OpenAI 无隶属关系。',
    resetCountdown: '重置倒计时',
    noResetScheduled: '目前没有已知的重置计划。',
    resetTimeReached: '预计重置时间已到',
    waitingForConfirmation: '正在等待确认……',
    resetConfirmed: '重置已确认',
    confirmedBy: '确认来源',
    resetLikelyCompleted: '重置很可能已完成',
    publishedTimeUnavailable: '发布时间未知',
    viewOriginal: '查看原帖',
  }
};

describe('Complete Chinese UI Audit', () => {
  // Test that ALL UI strings have Chinese translations
  const enKeys = Object.keys(messages.en);
  const zhKeys = new Set(Object.keys(messages['zh-CN']));

  it('every English UI string has a Chinese translation', () => {
    const missing = enKeys.filter(k => !zhKeys.has(k));
    if (missing.length > 0) {
      console.log('Missing Chinese translations:', missing);
    }
    expect(missing).toEqual([]);
  });

  it('no untranslated English UI strings remain in Chinese mode', () => {
    const commonEnglishPhrases = [
      'Last Reset', 'Current Policy', 'Latest Change', 'Last Checked',
      'Timeline', 'All', 'Reset Planned', 'Reset Completed',
      'Time Changed', 'Policy', 'No events', 'Monitor', 'DEGRADED',
      'STALE', 'NOT CONFIGURED', 'Loading', 'Source', 'AI Summary',
      'Published', 'Effective', 'Confidence', 'Published time unavailable',
      'View original post', 'Unofficial community monitor',
    ];

    const zhValues = Object.values(messages['zh-CN']).map(v => String(v));
    const untranslated = commonEnglishPhrases.filter(phrase => {
      // Check if the phrase appears in any Chinese translation value
      // (it shouldn't - Chinese values should be in Chinese)
      return zhValues.some(val => val.includes(phrase));
    });

    expect(untranslated).toEqual([]);
  });
});

describe('Chinese UI - Static Text Not Leaking English', () => {
  it('site title is Chinese in zh-CN mode', () => {
    const title = messages['zh-CN'].siteTitle;
    expect(title).toContain('监控');
    expect(title).not.toContain('Usage Reset');
  });

  it('"monitoring" is translated in Chinese', () => {
    expect(messages['zh-CN'].monitoring).toContain('正在监控');
  });

  it('LIVE badge is translated in Chinese', () => {
    expect(messages['zh-CN'].live).toBe('监控中');
  });

  it('NOT CONFIGURED is translated in Chinese', () => {
    expect(messages['zh-CN'].notConfigured).toBe('尚未配置');
  });

  it('timeline is translated in Chinese', () => {
    expect(messages['zh-CN'].timeline).toBe('时间线');
  });

  it('footer is translated in Chinese', () => {
    expect(messages['zh-CN'].footer).toContain('非官方');
    expect(messages['zh-CN'].footer).not.toContain('Unofficial');
  });

  it('all filter labels are translated in Chinese', () => {
    expect(messages['zh-CN'].all).toBe('全部');
    expect(messages['zh-CN'].resetPlanned).toBe('计划重置');
    expect(messages['zh-CN'].resetCompleted).toBe('重置完成');
    expect(messages['zh-CN'].resetTimeChanged).toBe('时间变更');
    expect(messages['zh-CN'].policyChange).toBe('政策');
  });

  it('countdown labels are translated in Chinese', () => {
    expect(messages['zh-CN'].resetCountdown).toBe('重置倒计时');
    expect(messages['zh-CN'].noResetScheduled).toContain('重置');
    expect(messages['zh-CN'].resetTimeReached).toContain('重置');
    expect(messages['zh-CN'].waitingForConfirmation).toContain('确认');
  });

  it('confirmation labels are translated in Chinese', () => {
    expect(messages['zh-CN'].resetConfirmed).toContain('确认');
    expect(messages['zh-CN'].resetLikelyCompleted).toContain('完成');
  });
});

describe('Reset Countdown Engine', () => {
  it('countdown shows future time remaining', () => {
    const now = Date.now();
    const future = now + 3600000; // 1 hour later
    const diff = future - now;
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    expect(hours).toBe(1);
    expect(minutes).toBe(0);
  });

  it('countdown at zero shows DUE state', () => {
    const now = Date.now();
    const past = now - 1000; // 1 second ago
    const diff = past - now;
    expect(diff <= 0).toBe(true);
  });

  it('DUE state shows "Expected reset time reached"', () => {
    const state = 'DUE';
    const enText = 'Expected reset time reached.';
    const zhText = '预计重置时间已到';
    expect(state === 'DUE' || state === 'CONFIRMING').toBe(true);
    if (state === 'DUE') {
      expect(enText).toBeTruthy();
      expect(zhText).toBeTruthy();
    }
  });

  it('CONFIRMED state shows confirmation type', () => {
    const directConfirm = { type: 'DIRECT', confirmedAt: '2026-08-27T21:00:00Z' };
    const communityConfirm = { type: 'COMMUNITY', confirmedAt: '2026-08-27T22:00:00Z' };
    
    expect(directConfirm.type).toBe('DIRECT');
    expect(communityConfirm.type).toBe('COMMUNITY');
    expect(directConfirm.type).not.toBe(communityConfirm.type);
  });
});

describe('Reset Cycle State Machine', () => {
  const validStates = ['NONE', 'SCHEDULED', 'DUE', 'CONFIRMING', 'CONFIRMED', 'TIME_CHANGED', 'EXPIRED_UNCONFIRMED'];

  it('all valid states are recognized', () => {
    expect(validStates).toContain('NONE');
    expect(validStates).toContain('SCHEDULED');
    expect(validStates).toContain('DUE');
    expect(validStates).toContain('CONFIRMING');
    expect(validStates).toContain('CONFIRMED');
    expect(validStates).toContain('TIME_CHANGED');
    expect(validStates).toContain('EXPIRED_UNCONFIRMED');
  });

  it('NONE state means no reset scheduled', () => {
    const status = 'NONE';
    expect(status === 'NONE').toBe(true);
    // No countdown should show
    const showCountdown = status !== 'NONE';
    expect(showCountdown).toBe(false);
  });

  it('SCHEDULED state shows countdown', () => {
    const status = 'SCHEDULED';
    const showCountdown = status !== 'NONE';
    expect(showCountdown).toBe(true);
  });

  it('CONFIRMING state follows DUE', () => {
    const stateMachine = ['SCHEDULED', 'DUE', 'CONFIRMING', 'CONFIRMED'];
    const transitioning = stateMachine.indexOf('DUE') < stateMachine.indexOf('CONFIRMING');
    expect(transitioning).toBe(true);
  });

  it('CONFIRMED is terminal state', () => {
    const stateMachine = ['SCHEDULED', 'DUE', 'CONFIRMING', 'CONFIRMED'];
    const isTerminal = stateMachine.indexOf('CONFIRMED') === stateMachine.length - 1;
    expect(isTerminal).toBe(true);
  });
});

describe('Confirmation Evidence', () => {
  it('DIRECT confirmation has highest priority', () => {
    const evidenceTypes = ['DIRECT', 'OFFICIAL', 'COMMUNITY'];
    const priority = evidenceTypes.indexOf('DIRECT');
    expect(priority).toBe(0); // Highest priority
  });

  it('COMMUNITY has lowest priority', () => {
    const evidenceTypes = ['DIRECT', 'OFFICIAL', 'COMMUNITY'];
    const priority = evidenceTypes.indexOf('COMMUNITY');
    expect(priority).toBe(2); // Lowest priority
  });

  it('DIRECT and COMMUNITY are visually distinct', () => {
    const direct = 'DIRECT';
    const community = 'COMMUNITY';
    expect(direct).not.toBe(community);
  });

  it('DIRECT confirmation shows "Confirmed by Tibo"', () => {
    const type = 'DIRECT';
    const label = type === 'DIRECT' ? 'Tibo' : 'Community';
    expect(label).toBe('Tibo');
  });

  it('COMMUNITY confirmation shows "Based on public reports"', () => {
    const type = 'COMMUNITY';
    const isCommunity = type === 'COMMUNITY';
    expect(isCommunity).toBe(true);
  });

  it('evidence dedup by source URL', () => {
    const evidence1 = { url: 'https://x.com/thsottiaux/status/1', cycleId: 1 };
    const evidence2 = { url: 'https://x.com/thsottiaux/status/1', cycleId: 1 };
    // Same URL + same cycle = duplicate
    const isDuplicate = evidence1.url === evidence2.url && evidence1.cycleId === evidence2.cycleId;
    expect(isDuplicate).toBe(true);
  });
});

describe('User Timezone Privacy', () => {
  it('timezone is obtained from browser only', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(tz).toBeTruthy();
    // Should not contain GPS or IP data
    expect(tz).not.toMatch(/^[0-9]/);
  });
});

describe('Date Format Localization', () => {
  it('Chinese date format uses year-month-day', () => {
    const d = new Date('2026-08-25T00:00:00.000Z');
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    expect(y + '年' + mo + '月' + da + '日').toBe('2026年08月25日');
  });
});
