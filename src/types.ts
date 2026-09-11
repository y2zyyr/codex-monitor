// ============================================================
// Codex Usage Monitor - Core Type Definitions
// ============================================================

// --- Event Categories ---
export const EVENT_CATEGORIES = [
  'RESET_PLANNED',
  'RESET_COMPLETED', 
  'RESET_TIME_CHANGED',
  'POLICY_CHANGE',
  'CODEX_UPDATE',
  'ROADMAP_HINT',
  'FEATURE_DISCUSSION',
  'IRRELEVANT',
] as const;

export type EventCategory = typeof EVENT_CATEGORIES[number];

/** Internal classifier scope used to prevent non-Codex product chatter from
 * entering the public Codex timeline. It is intentionally not persisted. */
export const PRODUCT_SCOPES = [
  'CODEX',
  'CHATGPT_WORK',
  'CHATGPT',
  'OPENAI_GENERAL',
  'OTHER',
  'AMBIGUOUS',
] as const;

export type ProductScope = typeof PRODUCT_SCOPES[number];

/**
 * Statement nature is intentionally separate from event category. A roadmap
 * question can be relevant without being a product fact, a feature discussion
 * must never be rendered as a confirmed release, and an adoption observation
 * does not by itself establish a product change.
 */
export const STATEMENT_NATURES = [
  'FACT',
  'OBSERVATION',
  'INTENTION',
  'HINT',
  'QUESTION',
  'SPECULATION',
] as const;

export type StatementNature = typeof STATEMENT_NATURES[number];

// The interface uses a stable editorial timezone per language so the same
// page does not change meaning based on the visitor's device timezone.
export const DISPLAY_TIME_ZONES = [
  'America/New_York',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Europe/Paris',
] as const;
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
  classification_failure_kind?: ClassificationFailureKind | null;
  classification_label?: string | null;
  classification_decision?: ClassificationDecision | null;
  classification_reason_code?: ClassificationReasonCode | null;
  classification_source_context?: ClassificationSourceContext | null;
  classification_event_created?: boolean;
  classifier_version?: string | null;
  created_at?: string;
}

export const EVENT_TRANSLATION_LOCALES = ['ja', 'es', 'fr'] as const;
export type EventTranslationLocale = typeof EVENT_TRANSLATION_LOCALES[number];
export type EventTranslationStatus = 'translated' | 'failed' | 'pending';

export interface MonitorEventTranslation {
  language: EventTranslationLocale;
  title: string | null;
  summary: string | null;
  status: EventTranslationStatus;
  provider: string | null;
  translated_at: string | null;
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
  /** Cached derived translations; original source and en/zh fields remain authoritative. */
  translations?: Partial<Record<EventTranslationLocale, MonitorEventTranslation>>;
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
  /** Derived from persisted started_at/finished_at; wall time, not CPU. */
  duration_ms?: number | null;
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
  product_scope: ProductScope;
  statement_nature: StatementNature;
  confidence: number;
  title_en: string;
  title_zh: string;
  summary_en: string;
  summary_zh: string;
  effective_time: string | null;  // ISO 8601 or null
  reset_time: string | null;      // ISO 8601 or null
  reason: string;
}

/**
 * Bounded, operator-facing classification audit fields. These values are
 * deliberately enums/codes rather than model reasoning or source text.
 */
export const CLASSIFICATION_DECISIONS = ['EVENT_CREATED', 'NO_EVENT', 'RETRY', 'REVIEW'] as const;
export type ClassificationDecision = typeof CLASSIFICATION_DECISIONS[number];

export const CLASSIFICATION_REASON_CODES = [
  'EVENT_CREATED',
  'DETERMINISTIC_COMPLETED_RESET',
  'DETERMINISTIC_SOFT_RESET_HINT',
  'TRUSTED_SOURCE_CONTEXT_APPLIED',
  'DUPLICATE_EVENT',
  'NO_PUBLIC_EVENT',
  'NON_CODEX_PRODUCT_SCOPE',
  'AMBIGUOUS_PRODUCT_SCOPE',
  'MISSING_PRODUCT_CONTEXT',
  'OBSERVATION_NOT_ADMITTED',
  'UNTRUSTED_SOURCE_CONTEXT',
  'WEAK_RESET_SIGNAL',
  'CLASSIFIER_ERROR',
  'NEEDS_REVIEW',
  'OPERATOR_REJECTED',
  'REVIEW_PUBLISHED',
] as const;
export type ClassificationReasonCode = typeof CLASSIFICATION_REASON_CODES[number];

export const CLASSIFICATION_SOURCE_CONTEXTS = [
  'NONE',
  'TRUSTED_CODEX_SOURCE_AVAILABLE',
  'TRUSTED_CODEX_SOURCE_APPLIED',
  'UNTRUSTED_SOURCE',
] as const;
export type ClassificationSourceContext = typeof CLASSIFICATION_SOURCE_CONTEXTS[number];

/**
 * Failure taxonomy for the automatic classifier queue. Provider failures are
 * deliberately separate from invalid/low-quality classifier output so an
 * external outage cannot consume the same terminal budget as a bad result.
 */
export const CLASSIFICATION_FAILURE_KINDS = [
  'TRANSIENT_PROVIDER_ERROR',
  'PERMANENT_OR_CONFIGURATION_ERROR',
  'CLASSIFIER_OUTPUT_ERROR',
] as const;
export type ClassificationFailureKind = typeof CLASSIFICATION_FAILURE_KINDS[number];

export interface ClassificationDecisionTrace {
  classification_label: string;
  classification_decision: ClassificationDecision;
  classification_reason_code: ClassificationReasonCode;
  classification_source_context: ClassificationSourceContext;
  classification_event_created: boolean;
  classifier_version: string;
}

// --- Classification Outcome (distinguishes SUCCESS vs ERROR) ---
export type ClassificationOutcome =
  | { status: "SUCCESS"; result: ClassificationResult }
  | {
    status: "ERROR";
    /** A bounded, non-secret diagnostic code. */
    error: string;
    category: "ERROR";
    failureKind?: ClassificationFailureKind;
    errorCode?: string;
  };

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
  classification_failure_kind?: string | null;
  classification_label?: string | null;
  classification_decision?: string | null;
  classification_reason_code?: string | null;
  classification_source_context?: string | null;
  classification_event_created?: number | null;
  classifier_version?: string | null;
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

export interface D1MonitorEventTranslationRow {
  id: number;
  event_id: number;
  language: string;
  title: string | null;
  summary: string | null;
  status: string;
  provider: string | null;
  translated_at: string | null;
  last_error: string | null;
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
  /** Separate daily budget for active reset modes (WATCHING/CONFIRMING). */
  WEB_SEARCH_ACTIVE_MODE_DAILY_LIMIT?: string;
  /** Cooldown between reply-supplement searches (hours, default 1). */
  WEB_SEARCH_SUPPLEMENT_INTERVAL_HOURS?: string;
  /** Small daily pool for the reply-supplement search channel (default 2). */
  WEB_SEARCH_SUPPLEMENT_DAILY_LIMIT?: string;
  /** NORMAL-mode stale window between the last regular search and a supplement (default 2h). */
  WEB_SEARCH_SUPPLEMENT_NORMAL_STALE_HOURS?: string;
  /** Per-run classifier budget override (default/hard cap 8, 0 disables). */
  CLASSIFICATIONS_PER_RUN?: string;
  /** Page depth cap for the one-shot historical X backfill (default 5). */
  X_API_BACKFILL_MAX_PAGES?: string;
  /** Oldest allowed `since` bound for backfill without force (default 14 days). */
  X_BACKFILL_MAX_LOOKBACK_DAYS?: string;
  /** Opt-in ingestion-completeness probe ('true' enables; default off). */
  REVIEW_ALERT_AFTER_HOURS?: string;
  REVIEW_ALERT_PROVIDER_STATUS?: string;
  MONITOR_RUN_WARN_MS?: string;
  X_INGESTION_PROBE_ENABLED?: string;
  /** How often the completeness probe runs (hours, default 24). */
  X_INGESTION_PROBE_INTERVAL_HOURS?: string;
  /** Time window the probe compares (hours, default 24). */
  X_INGESTION_PROBE_WINDOW_HOURS?: string;
  /** Max timeline pages per probe run (default 2, capped 5). */
  X_INGESTION_PROBE_MAX_PAGES?: string;
  /** Retry backoff after a failed probe attempt (hours, default 4). */
  X_INGESTION_PROBE_RETRY_HOURS?: string;
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
  COMMUNITY_POSTING_ENABLED?: string;
  COMMUNITY_MAX_CONTENT_LENGTH?: string;
  COMMUNITY_MAX_NICKNAME_LENGTH?: string;
  COMMUNITY_RATE_MINUTE?: string;
  COMMUNITY_RATE_HOUR?: string;
  COMMUNITY_RATE_DAY?: string;
  /** Comma-separated cached community translation locales, e.g. en,zh,ja,es,fr. */
  COMMUNITY_TRANSLATION_LOCALES?: string;
  GITHUB_CARD_ENABLED?: string;
  GITHUB_TOKEN?: string;
  COMMUNITY_GITHUB_CACHE_TTL_HOURS?: string;
  TRANSLATION_ENABLED?: string;
  TRANSLATION_API_KEY?: string;
  TRANSLATION_BASE_URL?: string;
  TRANSLATION_MODEL?: string;
  TRANSLATION_MAX_TOKENS?: string;
  TRANSLATION_TIMEOUT_MS?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ABUSE_HASH_SECRET?: string;
  COMMUNITY_ADMIN_TOKEN?: string;
  /**
   * Server-side secret for first-party Community agents. Never exposed to
   * the browser bundle and never returned by any API response.
   */
  COMMUNITY_AGENT_SECRET?: string;
  COMMUNITY_AGENT_ENABLED?: string;
  COMMUNITY_AGENT_MAX_PER_RUN?: string;
  COMMUNITY_AGENT_MAX_PER_DAY?: string;
  // Open Gambit V1 bindings/configuration. These are optional so the existing
  // Tibo monitor remains runnable before the additive Gambit migration and
  // Cloudflare resources are deliberately provisioned.
  GAMBIT_SNAPSHOTS?: R2Bucket;
  GAMBIT_ANALYSIS_WORKFLOW?: {
    create(options: { id: string; params: Record<string, unknown> }): Promise<unknown>;
  };
  GAMBIT_SOURCE_REGISTRY_JSON?: string;
  GAMBIT_MODEL_ROLES_JSON?: string;
  GAMBIT_LLM_API_KEY?: string;
  GAMBIT_LLM_BASE_URL?: string;
  /** Non-secret actual provider label for runtime provenance; never a public AI identity. */
  GAMBIT_LLM_PROVIDER?: string;
  GAMBIT_LLM_MODEL?: string;
  /**
   * Stable operational label for the `x-opencode-session` header the Gambit
   * provider client sends. Not a secret: it is a routing/attribution label.
   * Defaults to `gambit-open-gambit` in code, so an unset variable can never
   * reproduce the missing-session rejection.
   */
  GAMBIT_LLM_SESSION_ID?: string;
  GAMBIT_CRON_WINDOWS?: string;
  GAMBIT_SCHEDULE_ENABLED?: string;
  GAMBIT_LOCAL_MEMORY_SNAPSHOTS?: string;
  GAMBIT_MAX_SOURCES_PER_RUN?: string;
  /** Global analysis cap: how many cross-source candidates may enter the expensive LLM Workflow per discovery run. */
  GAMBIT_MAX_ANALYSIS_CANDIDATES_PER_RUN?: string;
  /** Bounded fetch parallelism for the broad daily source scan. */
  GAMBIT_FETCH_CONCURRENCY?: string;
  GAMBIT_MAX_LLM_CALLS_PER_RUN?: string;
  GAMBIT_MAX_LLM_TOKENS_PER_RUN?: string;
  GAMBIT_MAX_SEARCH_REQUESTS_PER_RUN?: string;
  GAMBIT_MAX_X_REQUESTS_PER_RUN?: string;
  GAMBIT_MAX_GITHUB_REQUESTS_PER_RUN?: string;
  GAMBIT_MAX_HTTP_REQUESTS_PER_RUN?: string;
  GAMBIT_MAX_SOURCE_BYTES?: string;
  /**
   * Byte cap for a fetched FEED document (a source with a `feedUrl`), separate
   * from `GAMBIT_MAX_SOURCE_BYTES`, which caps HTML pages. Atom/RSS `<content>`
   * may embed fully rendered HTML, which inflated one measured release note from
   * 19,880 characters to 172,048 bytes. Defaults to 512000 in code, so an unset
   * variable cannot re-create the SOURCE_TOO_LARGE drop.
   */
  GAMBIT_MAX_FEED_BYTES?: string;
  GAMBIT_HTTP_TIMEOUT_MS?: string;
  GAMBIT_MAX_ITEMS_PER_SOURCE?: string;
  GAMBIT_MAX_ITEM_AGE_DAYS?: string;
  GAMBIT_ADMIN_TOKEN?: string;
  BUILD_ENVIRONMENT?: string;
  BUILD_VERSION?: string;
  BUILD_SHA?: string;
  BUILD_TIMESTAMP?: string;
  GAMBIT_CONFIG_VERSION?: string;
}
