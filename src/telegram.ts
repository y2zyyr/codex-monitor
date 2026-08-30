import { Repository } from './db/repository';
import type { Env, ManualResetReport } from './types';

const TELEGRAM_SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';
const SHANGHAI_OFFSET = '+08:00';
const MAX_NOTE_LENGTH = 500;

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number | string;
  type?: string;
}

export interface TelegramMessage {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  date?: number;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramCommand {
  command: string;
  argumentText: string;
}

export interface ParsedManualReset {
  resetAt: string;
  note: string | null;
}

export function parseTelegramCommand(text: string | null | undefined): TelegramCommand | null {
  if (!text) return null;
  const match = text.match(/^\s*\/([a-z][a-z0-9_]*)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*?))?\s*$/i);
  if (!match) return null;
  return {
    command: match[1].toLowerCase(),
    argumentText: (match[2] ?? '').trim(),
  };
}

function isValidCalendarParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return check.getUTCFullYear() === year
    && check.getUTCMonth() === month - 1
    && check.getUTCDate() === day
    && check.getUTCHours() === hour
    && check.getUTCMinutes() === minute
    && check.getUTCSeconds() === second;
}

function parseBeijingDateTime(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? '0');
  const minute = Number(match[5] ?? '0');
  const second = Number(match[6] ?? '0');
  if (!isValidCalendarParts(year, month, day, hour, minute, second)) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${SHANGHAI_OFFSET}`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function parseResetDate(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) return null;

  // Date.parse normalizes impossible calendar dates such as February 30th.
  // Reject those before allowing the ISO fallback to handle explicit offsets.
  const dateParts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateParts) {
    const year = Number(dateParts[1]);
    const month = Number(dateParts[2]);
    const day = Number(dateParts[3]);
    const calendarCheck = new Date(Date.UTC(year, month - 1, day));
    if (calendarCheck.getUTCFullYear() !== year
      || calendarCheck.getUTCMonth() !== month - 1
      || calendarCheck.getUTCDate() !== day) return null;
  }

  // A timezone-less ISO/date-time value is explicitly treated as Beijing
  // time. Values with Z or an explicit offset retain their stated timezone.
  const shanghaiDate = parseBeijingDateTime(normalized);
  if (shanghaiDate) return shanghaiDate;

  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const isoCandidate = hasTimezone ? normalized : normalized.replace(' ', 'T') + SHANGHAI_OFFSET;
  const parsed = new Date(isoCandidate);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * Parse `/reset_done [YYYY-MM-DD HH:mm | note]`.
 * Plain dates/times use Asia/Shanghai; ISO values with a timezone keep it.
 */
export function parseManualResetAt(
  argumentText: string | null | undefined,
  now = new Date(),
): ParsedManualReset | { error: string } {
  const raw = (argumentText ?? '').trim();
  const separator = raw.indexOf('|');
  const dateText = (separator >= 0 ? raw.slice(0, separator) : raw).trim();
  const noteText = separator >= 0 ? raw.slice(separator + 1).trim() : '';
  if (noteText.length > MAX_NOTE_LENGTH) {
    return { error: `备注不能超过 ${MAX_NOTE_LENGTH} 个字符。` };
  }

  const resetAt = dateText ? parseResetDate(dateText) : new Date(now.getTime());
  if (!resetAt) {
    return { error: '时间格式不正确。请使用 YYYY-MM-DD HH:mm，或带时区的 ISO 时间。' };
  }

  const maximumFuture = now.getTime() + 5 * 60 * 1000;
  if (resetAt.getTime() > maximumFuture) {
    return { error: '人工重置时间不能晚于当前时间超过 5 分钟。' };
  }

  return {
    resetAt: resetAt.toISOString(),
    note: noteText || null,
  };
}

export function isAuthorizedTelegramUpdate(
  update: TelegramUpdate,
  config: Pick<Env, 'TELEGRAM_ADMIN_USER_ID' | 'TELEGRAM_ADMIN_CHAT_ID'>,
): boolean {
  const configuredUserId = config.TELEGRAM_ADMIN_USER_ID?.trim();
  const userId = update.message?.from?.id;
  if (!configuredUserId || userId === undefined || String(userId) !== configuredUserId) return false;

  const configuredChatId = config.TELEGRAM_ADMIN_CHAT_ID?.trim();
  if (configuredChatId) {
    const chatId = update.message?.chat?.id;
    if (chatId === undefined || String(chatId) !== configuredChatId) return false;
  }
  return true;
}

function displayName(user: TelegramUser | undefined): string | null {
  if (!user) return null;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return (name || user.username || '').slice(0, 120) || null;
}

function bounded(value: string | undefined, maxLength = 120): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function formatShanghaiTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date) + '（北京时间）';
}

function reportReply(report: ManualResetReport, created: boolean): string {
  return created
    ? `✅ 已记录人工重置\n重置时间：${formatShanghaiTime(report.reset_at)}\n来源：Telegram 管理员报告\n网页和 RSS 将显示为“人工报告”，不会伪装成 Tibo/X 官方确认。`
    : `ℹ️ 这条 Telegram 消息已经处理过。\n重置时间：${formatShanghaiTime(report.reset_at)}`;
}

function helpText(): string {
  return [
    'Tibo Monitor 管理命令：',
    '/reset_done —— 记录现在已经完成重置',
    '/reset_done 2026-08-28 14:30 —— 记录指定的北京时间',
    '/reset_done 2026-08-28 14:30 | 备注 —— 同时保存备注',
    '/reset_status —— 查看当前人工报告',
    '/reset_undo —— 撤销最近一条人工报告',
  ].join('\n');
}

async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  const payload = await response.json() as { ok?: boolean };
  if (!payload.ok) throw new Error('Telegram sendMessage returned ok=false');
}

function okResponse(): Response {
  return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function errorResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** Handle Telegram's HTTPS webhook. Unauthorized updates are acknowledged
 * silently so the bot does not retry messages from other users forever. */
export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  const configuredSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!configuredSecret) return errorResponse(503, 'Telegram webhook is not configured');
  if (request.headers.get(TELEGRAM_SECRET_HEADER) !== configuredSecret) {
    return errorResponse(401, 'Unauthorized');
  }

  let update: TelegramUpdate;
  try {
    update = await request.json() as TelegramUpdate;
  } catch {
    return errorResponse(400, 'Invalid JSON');
  }

  if (!Number.isInteger(update?.update_id) || !update.message) return okResponse();
  if (!isAuthorizedTelegramUpdate(update, env)) return okResponse();

  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = update.message.chat?.id;
  if (!token || chatId === undefined) return errorResponse(503, 'Telegram bot is not configured');

  const command = parseTelegramCommand(update.message.text);
  if (!command) {
    try {
      await sendTelegramMessage(token, String(chatId), helpText());
      return okResponse();
    } catch (error) {
      console.error('[Telegram] Help reply failed:', error instanceof Error ? error.message : String(error));
      return errorResponse(502, 'Unable to reply to Telegram');
    }
  }

  const repo = new Repository(env.DB);
  try {
    let reply: string;
    if (command.command === 'help' || command.command === 'start') {
      reply = helpText();
    } else if (command.command === 'reset_done' || command.command === 'reset') {
      const parsed = parseManualResetAt(command.argumentText);
      if ('error' in parsed) {
        reply = `❌ ${parsed.error}\n\n${helpText()}`;
      } else {
        const result = await repo.insertManualResetReport({
          telegram_update_id: update.update_id,
          telegram_message_id: update.message.message_id ?? null,
          telegram_user_id: String(update.message.from!.id),
          telegram_username: bounded(update.message.from!.username),
          telegram_display_name: displayName(update.message.from),
          telegram_chat_id: String(chatId),
          reported_at: new Date().toISOString(),
          reset_at: parsed.resetAt,
          note: parsed.note,
        });
        reply = reportReply(result.report, result.created);
      }
    } else if (command.command === 'reset_status') {
      const report = await repo.getLatestManualResetReport();
      reply = report
        ? `当前人工报告：\n重置时间：${formatShanghaiTime(report.reset_at)}\n报告时间：${formatShanghaiTime(report.reported_at)}${report.note ? `\n备注：${report.note}` : ''}`
        : '目前没有有效的人工重置报告。';
    } else if (command.command === 'reset_undo') {
      const revoked = await repo.revokeLatestManualResetReport();
      reply = revoked
        ? `✅ 已撤销最近一条人工重置报告（${formatShanghaiTime(revoked.reset_at)}）。`
        : '目前没有可撤销的人工重置报告。';
    } else {
      reply = `未知命令：/${command.command}\n\n${helpText()}`;
    }

    await sendTelegramMessage(token, String(chatId), reply);
    return okResponse();
  } catch (error) {
    // Returning 5xx asks Telegram to retry. The report insert is idempotent by
    // update_id, so a retry cannot create a second reset report.
    console.error('[Telegram] Webhook failed:', error instanceof Error ? error.message : String(error));
    return errorResponse(500, 'Unable to process Telegram update');
  }
}
