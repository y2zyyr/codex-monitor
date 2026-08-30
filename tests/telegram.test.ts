import { describe, expect, it } from 'vitest';
import {
  isAuthorizedTelegramUpdate,
  parseManualResetAt,
  parseTelegramCommand,
  type TelegramUpdate,
} from '../src/telegram';

const now = new Date('2026-08-28T06:35:00.000Z');

function update(userId = 123456789, chatId: number | string = 987): TelegramUpdate {
  return {
    update_id: 42,
    message: {
      from: { id: userId, username: 'y2zyyr', first_name: 'yy22' },
      chat: { id: chatId, type: 'private' },
      text: '/reset_done',
    },
  };
}

describe('Telegram manual reset reports', () => {
  it('parses commands and optional bot usernames', () => {
    expect(parseTelegramCommand('/reset_done@TiboMonitorBot 2026-08-28 14:30 | after deploy')).toEqual({
      command: 'reset_done',
      argumentText: '2026-08-28 14:30 | after deploy',
    });
    expect(parseTelegramCommand('hello world')).toBeNull();
  });

  it('authorizes the exact numeric Telegram user id', () => {
    expect(isAuthorizedTelegramUpdate(update(), { TELEGRAM_ADMIN_USER_ID: '123456789' })).toBe(true);
    expect(isAuthorizedTelegramUpdate(update(123456790), { TELEGRAM_ADMIN_USER_ID: '123456789' })).toBe(false);
    // Username is not an authentication factor and may change.
    expect(isAuthorizedTelegramUpdate(update(), { TELEGRAM_ADMIN_USER_ID: '123456789' })).toBe(true);
    expect(isAuthorizedTelegramUpdate(update(), {
      TELEGRAM_ADMIN_USER_ID: '123456789',
      TELEGRAM_ADMIN_CHAT_ID: '987',
    })).toBe(true);
    expect(isAuthorizedTelegramUpdate(update(), {
      TELEGRAM_ADMIN_USER_ID: '123456789',
      TELEGRAM_ADMIN_CHAT_ID: '988',
    })).toBe(false);
  });

  it('defaults to now and parses plain times as Asia/Shanghai', () => {
    expect(parseManualResetAt('', now)).toEqual({
      resetAt: now.toISOString(),
      note: null,
    });
    expect(parseManualResetAt('2026-08-28 14:30 | quota reset', now)).toEqual({
      resetAt: '2026-08-28T06:30:00.000Z',
      note: 'quota reset',
    });
    expect(parseManualResetAt('2026-08-28T06:30:00Z', now)).toEqual({
      resetAt: '2026-08-28T06:30:00.000Z',
      note: null,
    });
  });

  it('rejects invalid dates, distant future dates and oversized notes', () => {
    expect(parseManualResetAt('2026-02-30 14:30', now)).toEqual({
      error: expect.stringContaining('时间格式不正确'),
    });
    expect(parseManualResetAt('2026-08-28 15:00', now)).toEqual({
      error: expect.stringContaining('不能晚于当前时间'),
    });
    expect(parseManualResetAt(`2026-08-28 14:00 | ${'x'.repeat(501)}`, now)).toEqual({
      error: expect.stringContaining('500'),
    });
  });
});
