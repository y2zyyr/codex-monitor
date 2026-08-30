// ============================================================
// Codex Usage Monitor - Core Type Definitions
// ============================================================

// --- Event Categories ---
export const EVENT_CATEGORIES = [
  'RESET_PLANNED',
  'RESET_COMPLETED', 
  'RESET_TIME_CHANGED',
  'POLICY_CHANGE',
  'IRRELEVANT',
] as const;

export type EventCategory = typeof EVENT_CATEGORIES[number];

// The interface uses a stable editorial timezone per language so the same
// page does not change meaning based on the visitor's device timezone.
export const DISPLAY_TIME_ZONES = ['America/New_York', 'Asia/Shanghai'] as const;
export type DisplayTimeZone = typeof DISPLAY_TIME_ZONES[number];

// --- Evidence and verification ---
export const SOURCE_QUALITIES = ['INDEXED', 'DIRECT', 'OFFICIAL'] as const;
export type SourceQuality = typeof SOURCE_QUALITIES[number];

export const VERIFICATION_STATUSES = [
  'INDEXED_ONLY',
  'DIRECT_VERIFIED',
  'OFFICIAL_VERIFIED',
  'REJECTED',
] as const;
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];

// --- Source Post ---
export interface SourcePost {
  id?: number;
  source: string;
  source_account: string;
  source_post_id: string;
  source_url: string;
  text: string;
  published_at: string | null; // ISO 8601 UTC or null if unknown
  fetched_at: string;   // ISO 8601 UTC
  raw_json: string;     // JSON string
  content_hash: string;
  classification_pending?: boolean;
  canonical_platform?: string;
  canonical_post_id?: string;
  source_quality?: SourceQuality;
  first_discovered_via?: string | null;
  last_verified_via?: string | null;
  verified_at?: string | null;
  indexed_at?: string | null;
  verification_status?: VerificationStatus;
  classification_attempts?: number;
  last_classification_attempt_at?: string | null;
  classification_error?: string | null;
  created_at?: string;
}

// --- Monitor Event ---
export interface MonitorEvent {
  id?: number;
  source_post_id: number;
  source_account?: string;
  category: EventCategory;
  title_en: string;
  title_zh: string;
  summary_en: string;
  summary_zh: string;
  confidence: number;
  published_at: string | null;   // ISO 8601 UTC, or null when the source did not expose it
  effective_at: string | null;
  reset_at: string | null;
  source_url: string;
  source_text?: string;   // Joined from source_post
  /** When the joined source post was fetched by the monitor. */
  observed_at?: string | null;
  source_quality?: SourceQuality;
  evidence_quality?: SourceQuality;
  verification_status?: VerificationStatus;
  first_discovered_via?: string | null;
  last_verified_via?: string | null;
  verified_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

// --- Operator-reported reset ---
// Manual reports intentionally live outside monitor_events. They are an
// operator assertion, not an X/official source event, so the provenance model
// must not present them as direct or official evidence.
export type ManualResetReportStatus = 'ACTIVE' | 'REVOKED';

export interface ManualResetReport {
  id?: number;
  telegram_update_id: number;
  telegram_message_id: number | null;
  telegram_user_id: string;
  telegram_username: string | null;
  telegram_display_name: string | null;
  telegram_chat_id: string;
  reported_at: string;
  reset_at: string;
  note: string | null;
  status: ManualResetReportStatus;
  created_at?: string;
  updated_at?: string;
}

export interface ManualResetReportPublic {
  id: number;
  resetAt: string;
  reportedAt: string;
  note: string | null;
  source: 'telegram_manual';
}

// --- Monitor Run ---
export interface MonitorRun {
  id?: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'completed' | 'failed';
  posts_checked: number;
  candidates_found: number;
  events_created: number;
  x_api_calls: number;
  web_search_calls: number;
  llm_classifications: number;
  error_message: string | null;
}

// --- Setting ---
export interface Setting {
  key: string;
  value: string;
  updated_at: string;
}

// --- Source Provider ---
export interface SocialSourceProvider {
  name: string;
  fetchLatestPosts(): Promise<SourcePost[]>;
}

// --- Classification Result ---
export interface ClassificationResult {
  relevant: boolean;
  category: EventCategory;
  confidence: number;
  title_en: string;
  title_zh: string;
  summary_en: string;
  summary_zh: string;
  effective_time: string | null;  // ISO 8601 or null
  reset_time: string | null;      // ISO 8601 or null
  reason: string;
}

// --- Classification Outcome (distinguishes SUCCESS vs ERROR) ---
export type ClassificationOutcome =
  | { status: "SUCCESS"; result: ClassificationResult }
  | { status: "ERROR"; error: string; category: "ERROR" };

// --- Classification Provider ---
export interface ClassificationProvider {
  classify(post: SourcePost): Promise<ClassificationOutcome>;
}

// --- API Response Types ---
export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  total: number;
}

export interface EventQueryOptions {
  limit?: number;
  cursor?: { sortValue: string; id: number } | null;
  category?: string;
  categories?: string[];
  q?: string;
  /** Inclusive calendar date in timeZone, formatted as YYYY-MM-DD. */
  startDate?: string;
  /** Inclusive calendar date in timeZone, formatted as YYYY-MM-DD. */
  endDate?: string;
  timeZone?: DisplayTimeZone;
}

export interface EventHistoryPoint {
  date: string;
  total: number;
  categories: Record<string, number>;
}

export interface EventHistoryResponse {
  startDate: string;
  endDate: string;
  timeZone: DisplayTimeZone;
  total: number;
  categoryTotals: Record<string, number>;
  points: EventHistoryPoint[];
}

export interface StatusResponse {
  status: 'ok' | 'degraded' | 'error';
  lastCheckedAt: string | null;
  /** Last completed monitor run; distinct from provider/source freshness. */
  lastSuccessfulCron?: string | null;
  lastSourceFetch?: string | null;
  lastEventVerifiedAt?: string | null;
  latestEvent: MonitorEvent | null;
  lastReset: MonitorEvent | null;
  manualReset?: ManualResetReportPublic | null;
  currentPolicy: MonitorEvent | null;
  lastRun: MonitorRun | null;
  checkedAccounts: string[];
  providers?: {
    xApi?: ProviderUsageStatus;
    webSearch?: ProviderUsageStatus;
    [key: string]: unknown;
  };
}

export interface ProviderUsageStatus {
  dailyLimit: number;
  usedToday: number;
  lastFetchAt: string | null;
  lastSuccessAt?: string | null;
  status?: string;
  pollIntervalMinutes?: number;
  lastAttemptAt?: string | null;
  lastNewPostAt?: string | null;
  nextPollAt?: string | null;
  rateLimitRemaining?: number | null;
  rateLimitResetAt?: string | null;
  observedPostsToday?: number;
  automaticSync?: boolean;
  sourceRole?: 'primary' | 'fallback' | 'classifier';
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number | null;
  lastRun: MonitorRun | null;
  dbConnected: boolean;
  xApi?: ProviderUsageStatus;
  webSearch?: ProviderUsageStatus;
  providers?: {
    xApi?: ProviderUsageStatus;
    webSearch?: ProviderUsageStatus;
    [key: string]: unknown;
  };
  lastSuccessfulCron?: string | null;
  lastSourceFetch?: string | null;
  lastEventAt?: string | null;
  checkedAt?: string;
}

// --- D1 Row Types (for database operations) ---
export interface D1SourcePostRow {
  id: number;
  source: string;
  source_account: string;
  source_post_id: string;
  source_url: string;
  text: string;
  published_at: string | null;
  fetched_at: string;
  raw_json: string;
  content_hash: string;
  classification_pending: number;
  classification_attempts?: number;
  last_classification_attempt_at?: string | null;
  classification_error?: string | null;
  canonical_platform: string | null;
  canonical_post_id: string | null;
  source_quality: string | null;
  first_discovered_via: string | null;
  last_verified_via: string | null;
  verified_at: string | null;
  indexed_at: string | null;
  verification_status: string | null;
  updated_at?: string | null;
  created_at: string;
}

export interface D1MonitorEventRow {
  id: number;
  source_post_id: number;
  source_account?: string;
  category: string;
  title_en: string;
  title_zh: string;
  summary_en: string;
  summary_zh: string;
  confidence: number;
  published_at: string | null;
  effective_at: string | null;
  reset_at: string | null;
  source_url: string;
  evidence_quality: string | null;
  verification_status: string | null;
  verified_at: string | null;
  source_quality?: string | null;
  first_discovered_via?: string | null;
  last_verified_via?: string | null;
  observed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1ManualResetReportRow {
  id: number;
  telegram_update_id: number;
  telegram_message_id: number | null;
  telegram_user_id: string;
  telegram_username: string | null;
  telegram_display_name: string | null;
  telegram_chat_id: string;
  reported_at: string;
  reset_at: string;
  note: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface D1MonitorRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  posts_checked: number;
  candidates_found: number;
  events_created: number;
  x_api_calls: number;
  web_search_calls: number;
  llm_classifications: number;
  error_message: string | null;
}

export interface D1ProviderUsageRow {
  id: number;
  provider: string;
  usage_date: string;
  request_count: number;
  last_request_at: string | null;
  last_request_slot: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface D1SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

// --- Env Bindings ---
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  X_API_BEARER_TOKEN?: string;
  LLM_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  LLM_MAX_TOKENS?: string;
  MONITORED_ACCOUNTS?: string;
  SITE_URL?: string;
  GOOGLE_ANALYTICS_ID?: string;
  GOOGLE_SITE_VERIFICATION?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_CSE_ID?: string;
  BRAVE_SEARCH_API_KEY?: string;
  TAVILY_API_KEY?: string;
  WEB_SEARCH_ENABLED?: string;
  MAX_WEB_SEARCH_REQUESTS_PER_DAY?: string;
  NORMAL_SEARCH_INTERVAL_HOURS?: string;
  BRAVE_SEARCH_PRICE_PER_1000_USD?: string;
  BRAVE_MONTHLY_CREDIT_USD?: string;
  X_API_AUTOMATIC_SYNC?: string;
  X_API_POLL_INTERVAL_MINUTES?: string;
  X_API_STALE_AFTER_MINUTES?: string;
  X_API_MAX_SYNC_ATTEMPTS_PER_DAY?: string;
  /** Deprecated compatibility aliases; interval scheduling takes priority. */
  X_API_DAILY_LIMIT?: string;
  X_API_SYNC_HOURS?: string;
  X_API_MAX_PAGES_PER_SYNC?: string;
  X_API_MAX_RESULTS_PER_PAGE?: string;
  X_API_USER_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_ADMIN_USER_ID?: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  CRON_SECRET?: string;
  SITE_NAME?: string;
}
