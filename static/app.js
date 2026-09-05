// ============================================================
// Tibo Codex Monitor - Frontend Dashboard (Complete Five-Locale)
// ============================================================

const API_BASE = '/api';
const SITE_URL = 'https://tibo.modelyard.dev';
const TIME_API = window.TiboLocaleTime;

// --- Complete i18n Dictionary ---
const messages = {
  en: {
    // Site
    // Fallbacks mirror the SSR metadata. On the homepage the injected
    // window.__SSR_META__ object is authoritative, so hydration cannot
    // silently replace the server title or description.
    siteTitle: 'ModelYard · Tibo Codex Reset Tracker | Usage Limits & Policy Updates',
    siteDescription: 'ModelYard’s Tibo Codex Monitor tracks public OpenAI Codex usage-limit resets, ChatGPT Work limits, GPT/Codex rate-limit changes, and policy updates with source and verification status.',
    intro: 'ModelYard’s Tibo Codex Monitor tracks public Codex reset signals, usage limits, and policy updates; every event includes its source and verification status.',
    monitoring: 'Monitoring',
    toggleLanguage: 'Choose language',

    // Status badges
    live: 'LIVE',
    notConfigured: 'NOT CONFIGURED',
    sourceNotConfigured: 'SOURCE NOT CONFIGURED',
    classifierNotConfigured: 'CLASSIFIER NOT CONFIGURED',
    degraded: 'DEGRADED',
    stale: 'STALE',
    unknown: 'UNKNOWN',
    statusUnknown: 'Unknown',
    awaitingFirstRun: 'AWAITING FIRST RUN',

    // Status cards
    lastReset: 'Last Reset',
    currentPolicy: 'Latest Policy Change',
    latestChange: 'Latest Change',
    lastChecked: 'Last Checked',
    sourceStatus: 'Information Source',
    xDirectSource: 'X Direct',
    webIndexedSource: 'Web Indexed',
    lastNewPost: 'last new post',
    lastCheckedUnavailable: 'No successful check yet',
    latestEventTitle: 'Latest event',
    statusAnswerTitle: 'Current reset status',
    statusAnswerLead: 'See the latest known reset state first, then open an event for its source and verification details.',
    lastConfirmedReset: 'Last confirmed reset',
    lastRecordedReset: 'Last recorded reset',
    nextKnownReset: 'Next known reset',
    checkingLiveStatus: 'Checking live reset status…',
    viewResetHistory: 'View reset history',
    viewLatestEvent: 'View latest event',

    // Search and export
    searchEvents: 'Search events',
    searchPlaceholder: 'Search titles, summaries or source text',
    fromDate: 'From',
    toDate: 'To',
    clearFilters: 'Clear',
    export: 'Export',
    exporting: 'Preparing download...',
    exportReady: 'Download ready',
    exportFailed: 'Export failed',
    // System-monitored reset report
    manualResetReportedTitle: 'Server reset report',
    manualResetReported: 'Server reported a usage reset.',
    manualResetSource: 'Server monitoring',
    manualResetDisclaimer: 'Automated report.',
    manualResetConfirmed: 'RESET REPORTED',
    manualResetTimeLabel: 'Report time',

    // Reset history reference
    daysSinceLastReset: 'Days since last public reset: {days}',
    averageResetInterval: 'Average completed-reset interval: about {days} days ({count} records)',
    noHistoricalReset: 'No historical reset records yet.',
    historyReferenceDisclaimer: 'Historical reference',

    // Countdown
    resetCountdown: 'Reset Countdown',
    noResetScheduled: 'No reset currently scheduled.',
    expectedReset: 'Expected reset',
    yourLocalTime: 'Displayed time',
    announcedBy: 'Announced by',
    viewSource: 'View source',
    resetTimeReached: 'Expected reset time reached.',
    waitingForConfirmation: 'Waiting for confirmation...',
    lastConfirmationCheck: 'Last confirmation check',
    minutesAgo: 'minutes ago',
    resetConfirmed: 'RESET CONFIRMED',
    confirmedBy: 'Confirmed by',
    resetLikelyCompleted: 'RESET LIKELY COMPLETED',
    multipleReports: 'Multiple public reports indicate a reset.',
    noOfficialConfirmation: 'Official confirmation pending.',
    indexedSource: 'Web Search Index',
    directSource: 'Direct X API',
    officialSource: 'Official source',
    directlyVerified: 'Directly verified',
    officiallyVerified: 'Officially verified',
    indexedOnly: 'Indexed only',
    discoveredViaSearch: 'Discovered via web search',
    awaitingDirectVerification: 'Awaiting direct source verification',
    pendingVerification: 'Pending verification',
    unknownSourceType: 'Unknown source type',
    indexedResetSchedule: 'Reset schedule found · direct source pending',
    directResetSchedule: 'Reset schedule verified',
    resetTimeChanged: 'Reset time changed',
    previously: 'Previously',
    now: 'Now',
    exactTimeNotAnnounced: 'time not announced',

    // Timeline
    timeline: 'Timeline',
    all: 'All',
    resetPlanned: 'Reset Planned',
    resetCompleted: 'Reset Completed',
    resetTimeChanged: 'Time Changed',
    policyChange: 'Policy',
    codexUpdate: 'Codex Update',
    roadmapHint: 'Roadmap Hint',
    featureDiscussion: 'Feature Discussion',

    // Latest decision
    latestDecision: 'Latest Decision',
    noEvents: 'No events to display.',
    noEventsDetail: 'No events recorded yet. Monitoring will begin once configured.',
    loading: 'Loading events...',
    failedToLoad: 'Unable to load monitoring data.',

    // Modal
    type: 'Type',
    title: 'Title',
    summary: 'Summary',
    chineseTitle: 'Chinese Title',
    englishSummary: 'English Summary',
    chineseSummary: 'Chinese Summary',
    aiSummary: 'AI summary',
    originalSource: 'Original Source',
    source: 'Source',
    published: 'Published',
    beijingTime: 'Displayed time',
    resetTime: 'Reset Time',
    effectiveTime: 'Effective Time',
    confidence: 'Confidence',
    publishedTimeUnavailable: 'Published time unavailable',
    viewOriginal: 'View original post',
    verificationStatus: 'Verification status',
    firstDiscoveredVia: 'First discovered via',
    lastVerifiedVia: 'Last verified via',

    // Empty state
    sourceNotConfiguredTitle: 'No public source is connected yet.',
    aiClassifierReady: 'AI classifier ready:',
    monitoringWillBegin: 'Monitoring starts when a public source is connected.',

    // Footer
    footer: 'Independent monitor · Not affiliated with OpenAI.',

    // Category labels
    categoryPlanned: 'Reset Planned',
    categoryCompleted: 'Reset Completed',
    categoryTimeChanged: 'Time Changed',
    categoryPolicy: 'Policy Change',

    // Confirmation
    resetExpected: 'Reset expected',
    notAnnounced: 'not announced',
    resetDue: 'Reset due',
    checking: 'Checking',
    ago: 'ago',
    secondsAgo: 's ago',
    minutesAgoShort: 'min ago',
    hoursAgoShort: 'h ago',
    daysAgoShort: 'd ago',
  },
  'zh-CN': {
    // Site
    siteTitle: 'ModelYard · Tibo Codex 重置追踪｜额度与政策更新',
    siteDescription: 'ModelYard 的 Tibo Codex 监控记录公开的 Codex 额度重置、ChatGPT Work 限额、GPT/Codex 限速与政策更新；每条记录附来源和验证状态。',
    intro: 'ModelYard 的 Tibo Codex 监控记录公开的 Codex 重置信号、额度和政策更新；每条事件都附来源和验证状态。',
    monitoring: '正在监控',
    toggleLanguage: '选择语言',

    // Status badges
    live: '正常监控',
    notConfigured: '尚未配置',
    sourceNotConfigured: '数据源未配置',
    classifierNotConfigured: '分类器未配置',
    degraded: '服务降级',
    stale: '数据过期',
    unknown: '未知',
    statusUnknown: '未知',
    awaitingFirstRun: '等待首次运行',

    // Status cards
    lastReset: '最近重置',
    currentPolicy: '最新政策变更',
    latestChange: '最新动态',
    lastChecked: '最近检查',
    sourceStatus: '信息源',
    xDirectSource: 'X 直接源',
    webIndexedSource: '网页索引',
    lastNewPost: '最近新帖',
    lastCheckedUnavailable: '尚无成功检查',
    latestEventTitle: '最新事件',
    statusAnswerTitle: '当前重置状态',
    statusAnswerLead: '先查看已知的最新重置状态，再打开事件查看来源和验证详情。',
    lastConfirmedReset: '最近一次已确认重置',
    lastRecordedReset: '最近记录的重置',
    nextKnownReset: '下一次已知重置',
    checkingLiveStatus: '正在检查实时重置状态……',
    viewResetHistory: '查看重置历史',
    viewLatestEvent: '查看最新事件',

    // Search and export
    searchEvents: '搜索事件',
    searchPlaceholder: '搜索标题、摘要或来源文本',
    fromDate: '从',
    toDate: '至',
    clearFilters: '清除',
    export: '导出',
    exporting: '正在准备下载……',
    exportReady: '下载已准备好',
    exportFailed: '导出失败',
    // 系统重置报告
    manualResetReportedTitle: '服务器重置报告',
    manualResetReported: '服务器报告额度已重置。',
    manualResetSource: '服务器监控',
    manualResetDisclaimer: '系统自动报告。',
    manualResetConfirmed: '服务器报告重置',
    manualResetTimeLabel: '报告时间',

    // Reset history reference
    daysSinceLastReset: '距最近一次公开重置已过 {days} 天',
    averageResetInterval: '历史已完成重置平均间隔约 {days} 天（基于 {count} 次记录）',
    noHistoricalReset: '暂无历史重置记录。',
    historyReferenceDisclaimer: '历史参考',

    // Countdown
    resetCountdown: '重置倒计时',
    noResetScheduled: '目前没有已知的重置计划。',
    expectedReset: '预计重置',
    yourLocalTime: '显示时间',
    announcedBy: '发布者',
    viewSource: '查看原帖',
    resetTimeReached: '预计重置时间已到',
    waitingForConfirmation: '正在等待确认……',
    lastConfirmationCheck: '最近一次确认检查',
    minutesAgo: '分钟前',
    resetConfirmed: '重置已确认',
    confirmedBy: '确认来源',
    resetLikelyCompleted: '重置很可能已完成',
    multipleReports: '多条公开报告显示额度已重置。',
    noOfficialConfirmation: '官方确认待定。',
    indexedSource: '网页搜索索引',
    directSource: 'X API 直接来源',
    officialSource: '官方来源',
    directlyVerified: '已直接验证',
    officiallyVerified: '已官方验证',
    indexedOnly: '仅索引证据',
    discoveredViaSearch: '通过网页搜索发现',
    awaitingDirectVerification: '等待直接来源验证',
    pendingVerification: '待验证',
    unknownSourceType: '来源类型未知',
    indexedResetSchedule: '已发现重置计划 · 等待直接来源',
    directResetSchedule: '重置计划已验证',
    resetTimeChanged: '重置时间已变更',
    previously: '原计划',
    now: '现计划',
    exactTimeNotAnnounced: '具体时间未公布',

    // Timeline
    timeline: '时间线',
    all: '全部',
    resetPlanned: '计划重置',
    resetCompleted: '重置完成',
    resetTimeChanged: '时间变更',
    policyChange: '政策',
    codexUpdate: 'Codex 产品更新',
    roadmapHint: '路线图线索',
    featureDiscussion: '功能讨论',

    // Latest decision
    latestDecision: '最新动态',
    noEvents: '暂无可显示事件。',
    noEventsDetail: '暂无监控事件。',
    loading: '正在加载事件...',
    failedToLoad: '无法加载监控数据。',

    // Modal
    type: '类型',
    title: '标题',
    summary: '摘要',
    chineseTitle: '中文标题',
    englishSummary: '英文摘要',
    chineseSummary: '中文摘要',
    aiSummary: 'AI 摘要',
    originalSource: '原始来源',
    source: '来源',
    published: '发布时间',
    beijingTime: '显示时间',
    resetTime: '重置时间',
    effectiveTime: '生效时间',
    confidence: '置信度',
    publishedTimeUnavailable: '发布时间未知',
    viewOriginal: '查看原帖',
    verificationStatus: '验证状态',
    firstDiscoveredVia: '首次发现来源',
    lastVerifiedVia: '最近验证来源',

    // Empty state
    sourceNotConfiguredTitle: '尚未接入公开数据源。',
    aiClassifierReady: 'AI 分类器已就绪：',
    monitoringWillBegin: '接入公开数据源后开始监控。',

    // Footer
    footer: '非官方监控站 · 与 OpenAI 无隶属关系。',

    // Category labels
    categoryPlanned: '计划重置',
    categoryCompleted: '重置完成',
    categoryTimeChanged: '时间变更',
    categoryPolicy: '政策变更',

    // Confirmation
    resetExpected: '预计重置',
    notAnnounced: '未公布具体时间',
    resetDue: '重置到期',
    checking: '检查中',
    ago: '前',
    secondsAgo: '秒前',
    minutesAgoShort: '分钟前',
    hoursAgoShort: '小时前',
    daysAgoShort: '天前',
  }
};

// The header language menu exposes all supported locales. Each dictionary is
// explicit so a missing translation cannot silently inherit English.
messages.ja = {
  siteTitle: 'ModelYard · Tibo Codex リセット追跡 | 使用量制限とポリシー更新',
  siteDescription: 'ModelYard の Tibo Codex Monitor が公開された Codex のリセット、ChatGPT Work の使用量制限、GPT/Codex のレート制限とポリシー更新を、出典と確認状態付きで追跡します。',
  intro: 'ModelYard の Tibo Codex Monitor が公開された Codex のリセット、使用量制限、ポリシー更新を追跡します。各イベントに出典と確認状態を表示します。',
  monitoring: '監視中', toggleLanguage: '言語を選択', live: '稼働中', notConfigured: '未設定', sourceNotConfigured: 'ソース未設定', classifierNotConfigured: '分類器未設定', degraded: '低下', stale: '古いデータ', unknown: '不明', statusUnknown: '不明', awaitingFirstRun: '初回実行待ち',
  lastReset: '最近のリセット', currentPolicy: '最新ポリシー変更', latestChange: '最新の更新', lastChecked: '最終確認', sourceStatus: '情報源',
  statusAnswerTitle: '現在のリセット状態', statusAnswerLead: 'まず既知の最新リセット状態を確認し、イベントを開いて出典と確認の詳細をご覧ください。', lastConfirmedReset: '最後に確認されたリセット', lastRecordedReset: '最後に記録されたリセット', nextKnownReset: '次に予定されているリセット', checkingLiveStatus: 'リセットの状態を確認中…', viewResetHistory: 'リセット履歴を見る', viewLatestEvent: '最新イベントを見る',
  xDirectSource: 'X 直接ソース', webIndexedSource: 'ウェブ検索インデックス', lastNewPost: '最新の投稿', lastCheckedUnavailable: '確認済みの実行はまだありません', latestEventTitle: '最新イベント',
  searchEvents: 'イベントを検索', searchPlaceholder: 'タイトル、概要、ソースを検索', fromDate: '開始', toDate: '終了', clearFilters: 'クリア', export: 'エクスポート', exporting: 'ダウンロードを準備中…', exportReady: 'ダウンロードの準備ができました', exportFailed: 'エクスポートに失敗しました',
  manualResetReportedTitle: 'サーバーのリセット報告', manualResetReported: 'サーバーが使用量のリセットを報告しました。', manualResetSource: 'サーバー監視', manualResetDisclaimer: '自動報告です。', manualResetConfirmed: 'リセット報告', manualResetTimeLabel: '報告時刻',
  daysSinceLastReset: '公開された最後のリセットから {days} 日', averageResetInterval: '完了したリセットの平均間隔：約 {days} 日（{count} 件）', noHistoricalReset: '履歴はまだありません。', historyReferenceDisclaimer: '履歴の参考値',
  resetCountdown: 'リセットまでのカウントダウン', noResetScheduled: '現在予定されているリセットはありません。', expectedReset: '予定されるリセット', yourLocalTime: 'ニューヨーク時間', announcedBy: '発表者', viewSource: 'ソースを見る', resetTimeReached: '予定時刻に到達しました。', waitingForConfirmation: '確認を待っています…', lastConfirmationCheck: '最終確認', minutesAgo: '分前', resetConfirmed: 'リセット確認済み', confirmedBy: '確認元', resetLikelyCompleted: 'リセット完了の可能性', multipleReports: '複数の公開報告がリセットを示しています。', noOfficialConfirmation: '公式確認待ちです。', indexedSource: 'ウェブ検索インデックス', directSource: 'X API 直接ソース', officialSource: '公式ソース', directlyVerified: '直接確認済み', officiallyVerified: '公式確認済み', indexedOnly: 'インデックスのみ', discoveredViaSearch: 'ウェブ検索で発見', awaitingDirectVerification: '直接ソースの確認待ち', pendingVerification: '確認待ち', unknownSourceType: '不明なソース種別', indexedResetSchedule: 'リセット予定を発見 · 直接ソース待ち', directResetSchedule: 'リセット予定を確認済み', resetTimeChanged: 'リセット時刻が変更されました', previously: '以前', now: '現在', exactTimeNotAnnounced: '時刻は未発表',
  timeline: 'タイムライン', all: 'すべて', resetPlanned: 'リセット予定', resetCompleted: 'リセット完了', resetTimeChanged: '時刻変更', policyChange: 'ポリシー', codexUpdate: 'Codex 更新', roadmapHint: 'ロードマップのヒント', featureDiscussion: '機能ディスカッション', latestDecision: '最新の判断', noEvents: '表示できるイベントはありません。', noEventsDetail: 'イベントはまだ記録されていません。', loading: 'イベントを読み込み中…', failedToLoad: '監視データを読み込めません。',
  type: '種類', title: 'タイトル', summary: '概要', chineseTitle: '中国語タイトル', englishSummary: '英語の概要', chineseSummary: '中国語の概要', aiSummary: 'AI 概要', originalSource: '元のソース', source: 'ソース', published: '公開日時', beijingTime: 'ニューヨーク時間', resetTime: 'リセット時刻', effectiveTime: '適用時刻', confidence: '信頼度', publishedTimeUnavailable: '公開時刻は不明です', viewOriginal: '元の投稿を見る', verificationStatus: '確認ステータス', firstDiscoveredVia: '最初の発見元', lastVerifiedVia: '最後の確認元',
  sourceNotConfiguredTitle: '公開ソースはまだ接続されていません。', aiClassifierReady: 'AI 分類器の準備完了：', monitoringWillBegin: '公開ソースを接続すると監視が始まります。', footer: '非公式モニター · OpenAI とは提携していません。',
  categoryPlanned: 'リセット予定', categoryCompleted: 'リセット完了', categoryTimeChanged: '時刻変更', categoryPolicy: 'ポリシー変更', resetExpected: 'リセット予定', notAnnounced: '未発表', resetDue: 'リセット時刻', checking: '確認中', ago: '前', secondsAgo: '秒前', minutesAgoShort: '分前', hoursAgoShort: '時間前', daysAgoShort: '日前',
};
messages.es = {
  siteTitle: 'ModelYard · Rastreador de restablecimientos de Tibo Codex | Límites y políticas',
  siteDescription: 'El Monitor Tibo Codex de ModelYard sigue los restablecimientos públicos, los límites de ChatGPT Work y las actualizaciones de GPT/Codex con fuentes y estado de verificación.',
  intro: 'El Monitor Tibo Codex de ModelYard sigue los restablecimientos, límites y políticas públicas; cada evento incluye su fuente y estado de verificación.',
  monitoring: 'Supervisando', toggleLanguage: 'Elegir idioma', live: 'EN DIRECTO', notConfigured: 'NO CONFIGURADO', sourceNotConfigured: 'FUENTE NO CONFIGURADA', classifierNotConfigured: 'CLASIFICADOR NO CONFIGURADO', degraded: 'DEGRADADO', stale: 'DESACTUALIZADO', unknown: 'DESCONOCIDO', statusUnknown: 'Desconocido', awaitingFirstRun: 'A LA ESPERA DE LA PRIMERA EJECUCIÓN',
  lastReset: 'Último restablecimiento', currentPolicy: 'Último cambio de política', latestChange: 'Última actualización', lastChecked: 'Última comprobación', sourceStatus: 'Fuente de información',
  statusAnswerTitle: 'Estado actual del restablecimiento', statusAnswerLead: 'Consulta primero el estado conocido más reciente y abre un evento para ver su fuente y verificación.', lastConfirmedReset: 'Último restablecimiento confirmado', lastRecordedReset: 'Último restablecimiento registrado', nextKnownReset: 'Próximo restablecimiento conocido', checkingLiveStatus: 'Comprobando el estado del restablecimiento…', viewResetHistory: 'Ver historial de restablecimientos', viewLatestEvent: 'Ver el último evento',
  xDirectSource: 'X directo', webIndexedSource: 'Índice web', lastNewPost: 'última publicación', lastCheckedUnavailable: 'Aún no hay comprobaciones correctas', latestEventTitle: 'Último evento',
  searchEvents: 'Buscar eventos', searchPlaceholder: 'Buscar títulos, resúmenes o texto de fuente', fromDate: 'Desde', toDate: 'Hasta', clearFilters: 'Limpiar', export: 'Exportar', exporting: 'Preparando la descarga…', exportReady: 'Descarga preparada', exportFailed: 'Error al exportar',
  manualResetReportedTitle: 'Informe de restablecimiento del servidor', manualResetReported: 'El servidor informó de un restablecimiento del uso.', manualResetSource: 'Supervisión del servidor', manualResetDisclaimer: 'Informe automático.', manualResetConfirmed: 'RESTABLECIMIENTO INFORMADO', manualResetTimeLabel: 'Hora del informe',
  daysSinceLastReset: 'Días desde el último restablecimiento público: {days}', averageResetInterval: 'Intervalo medio de restablecimientos completados: unos {days} días ({count} registros)', noHistoricalReset: 'Aún no hay historial.', historyReferenceDisclaimer: 'Referencia histórica',
  resetCountdown: 'Cuenta atrás para el restablecimiento', noResetScheduled: 'No hay ningún restablecimiento programado.', expectedReset: 'Restablecimiento previsto', yourLocalTime: 'Hora de Nueva York', announcedBy: 'Anunciado por', viewSource: 'Ver fuente', resetTimeReached: 'Se alcanzó la hora prevista.', waitingForConfirmation: 'Esperando confirmación…', lastConfirmationCheck: 'Última comprobación', minutesAgo: 'minutos', resetConfirmed: 'RESTABLECIMIENTO CONFIRMADO', confirmedBy: 'Confirmado por', resetLikelyCompleted: 'RESTABLECIMIENTO PROBABLEMENTE COMPLETADO', multipleReports: 'Varios informes públicos indican un restablecimiento.', noOfficialConfirmation: 'Pendiente de confirmación oficial.', indexedSource: 'Índice de búsqueda web', directSource: 'API directa de X', officialSource: 'Fuente oficial', directlyVerified: 'Verificado directamente', officiallyVerified: 'Verificado oficialmente', indexedOnly: 'Solo indexado', discoveredViaSearch: 'Descubierto mediante búsqueda web', awaitingDirectVerification: 'Esperando verificación de la fuente directa', pendingVerification: 'Verificación pendiente', unknownSourceType: 'Tipo de fuente desconocido', indexedResetSchedule: 'Horario de restablecimiento encontrado · fuente directa pendiente', directResetSchedule: 'Horario de restablecimiento verificado', resetTimeChanged: 'Hora del restablecimiento modificada', previously: 'Antes', now: 'Ahora', exactTimeNotAnnounced: 'hora no anunciada',
  timeline: 'Línea temporal', all: 'Todos', resetPlanned: 'Restablecimiento previsto', resetCompleted: 'Restablecimiento completado', resetTimeChanged: 'Hora modificada', policyChange: 'Política', codexUpdate: 'Actualización de Codex', roadmapHint: 'Pista de hoja de ruta', featureDiscussion: 'Debate de funciones', latestDecision: 'Última decisión', noEvents: 'No hay eventos que mostrar.', noEventsDetail: 'Aún no se han registrado eventos.', loading: 'Cargando eventos…', failedToLoad: 'No se pueden cargar los datos de supervisión.',
  type: 'Tipo', title: 'Título', summary: 'Resumen', chineseTitle: 'Título en chino', englishSummary: 'Resumen en inglés', chineseSummary: 'Resumen en chino', aiSummary: 'Resumen de IA', originalSource: 'Fuente original', source: 'Fuente', published: 'Publicado', beijingTime: 'Hora de Nueva York', resetTime: 'Hora del restablecimiento', effectiveTime: 'Hora efectiva', confidence: 'Confianza', publishedTimeUnavailable: 'Hora de publicación no disponible', viewOriginal: 'Ver publicación original', verificationStatus: 'Estado de verificación', firstDiscoveredVia: 'Descubierto inicialmente mediante', lastVerifiedVia: 'Verificado por última vez mediante',
  sourceNotConfiguredTitle: 'Aún no hay una fuente pública conectada.', aiClassifierReady: 'Clasificador de IA listo:', monitoringWillBegin: 'La supervisión comenzará al conectar una fuente pública.', footer: 'Monitor independiente · No afiliado a OpenAI.',
  categoryPlanned: 'Restablecimiento previsto', categoryCompleted: 'Restablecimiento completado', categoryTimeChanged: 'Hora modificada', categoryPolicy: 'Cambio de política', resetExpected: 'Restablecimiento previsto', notAnnounced: 'no anunciado', resetDue: 'restablecimiento pendiente', checking: 'Comprobando', ago: 'hace', secondsAgo: 's', minutesAgoShort: 'min', hoursAgoShort: 'h', daysAgoShort: 'd',
};
messages.fr = {
  siteTitle: 'ModelYard · Suivi des réinitialisations Tibo Codex | Limites et politiques',
  siteDescription: 'Le Tibo Codex Monitor de ModelYard suit les réinitialisations publiques, les limites ChatGPT Work et les mises à jour GPT/Codex, avec leurs sources et leur état de vérification.',
  intro: 'Le Tibo Codex Monitor de ModelYard suit les réinitialisations, limites et politiques publiques ; chaque événement inclut sa source et son état de vérification.',
  monitoring: 'Surveillance en cours', toggleLanguage: 'Choisir la langue', live: 'EN DIRECT', notConfigured: 'NON CONFIGURÉ', sourceNotConfigured: 'SOURCE NON CONFIGURÉE', classifierNotConfigured: 'CLASSIFICATEUR NON CONFIGURÉ', degraded: 'DÉGRADÉ', stale: 'OBSOLÈTE', unknown: 'INCONNU', statusUnknown: 'Inconnu', awaitingFirstRun: 'EN ATTENTE DE LA PREMIÈRE EXÉCUTION',
  lastReset: 'Dernière réinitialisation', currentPolicy: 'Dernier changement de politique', latestChange: 'Dernière mise à jour', lastChecked: 'Dernière vérification', sourceStatus: 'Source d’information',
  statusAnswerTitle: 'État actuel de la réinitialisation', statusAnswerLead: 'Consultez d’abord le dernier état connu, puis ouvrez un événement pour voir sa source et sa vérification.', lastConfirmedReset: 'Dernière réinitialisation confirmée', lastRecordedReset: 'Dernière réinitialisation enregistrée', nextKnownReset: 'Prochaine réinitialisation connue', checkingLiveStatus: 'Vérification de l’état de la réinitialisation…', viewResetHistory: 'Voir l’historique des réinitialisations', viewLatestEvent: 'Voir le dernier événement',
  xDirectSource: 'X direct', webIndexedSource: 'Index web', lastNewPost: 'dernier post', lastCheckedUnavailable: 'Aucune vérification réussie pour le moment', latestEventTitle: 'Dernier événement',
  searchEvents: 'Rechercher des événements', searchPlaceholder: 'Rechercher des titres, résumés ou sources', fromDate: 'Du', toDate: 'Au', clearFilters: 'Effacer', export: 'Exporter', exporting: 'Préparation du téléchargement…', exportReady: 'Téléchargement prêt', exportFailed: 'Échec de l’export',
  manualResetReportedTitle: 'Rapport de réinitialisation du serveur', manualResetReported: 'Le serveur a signalé une réinitialisation de l’utilisation.', manualResetSource: 'Surveillance du serveur', manualResetDisclaimer: 'Rapport automatique.', manualResetConfirmed: 'RÉINITIALISATION SIGNALÉE', manualResetTimeLabel: 'Heure du rapport',
  daysSinceLastReset: 'Jours depuis la dernière réinitialisation publique : {days}', averageResetInterval: 'Intervalle moyen des réinitialisations terminées : environ {days} jours ({count} enregistrements)', noHistoricalReset: 'Aucun historique pour le moment.', historyReferenceDisclaimer: 'Référence historique',
  resetCountdown: 'Compte à rebours de la réinitialisation', noResetScheduled: 'Aucune réinitialisation n’est actuellement prévue.', expectedReset: 'Réinitialisation prévue', yourLocalTime: 'Heure de New York', announcedBy: 'Annoncé par', viewSource: 'Voir la source', resetTimeReached: 'L’heure prévue est atteinte.', waitingForConfirmation: 'En attente de confirmation…', lastConfirmationCheck: 'Dernière vérification', minutesAgo: 'minutes', resetConfirmed: 'RÉINITIALISATION CONFIRMÉE', confirmedBy: 'Confirmé par', resetLikelyCompleted: 'RÉINITIALISATION PROBABLEMENT TERMINÉE', multipleReports: 'Plusieurs signalements publics indiquent une réinitialisation.', noOfficialConfirmation: 'Confirmation officielle en attente.', indexedSource: 'Index de recherche web', directSource: 'API X directe', officialSource: 'Source officielle', directlyVerified: 'Vérifié directement', officiallyVerified: 'Vérifié officiellement', indexedOnly: 'Index uniquement', discoveredViaSearch: 'Trouvé via une recherche web', awaitingDirectVerification: 'En attente de vérification par la source directe', pendingVerification: 'Vérification en attente', unknownSourceType: 'Type de source inconnu', indexedResetSchedule: 'Horaire trouvé · source directe en attente', directResetSchedule: 'Horaire vérifié', resetTimeChanged: 'Heure de réinitialisation modifiée', previously: 'Avant', now: 'Maintenant', exactTimeNotAnnounced: 'heure non annoncée',
  timeline: 'Chronologie', all: 'Tous', resetPlanned: 'Réinitialisation prévue', resetCompleted: 'Réinitialisation terminée', resetTimeChanged: 'Heure modifiée', policyChange: 'Politique', codexUpdate: 'Mise à jour Codex', roadmapHint: 'Indice de feuille de route', featureDiscussion: 'Discussion de fonctionnalité', latestDecision: 'Dernière décision', noEvents: 'Aucun événement à afficher.', noEventsDetail: 'Aucun événement n’est encore enregistré.', loading: 'Chargement des événements…', failedToLoad: 'Impossible de charger les données de surveillance.',
  type: 'Type', title: 'Titre', summary: 'Résumé', chineseTitle: 'Titre chinois', englishSummary: 'Résumé anglais', chineseSummary: 'Résumé chinois', aiSummary: 'Résumé IA', originalSource: 'Source originale', source: 'Source', published: 'Publié', beijingTime: 'Heure de New York', resetTime: 'Heure de réinitialisation', effectiveTime: 'Heure d’effet', confidence: 'Confiance', publishedTimeUnavailable: 'Heure de publication indisponible', viewOriginal: 'Voir le post original', verificationStatus: 'État de vérification', firstDiscoveredVia: 'Première découverte via', lastVerifiedVia: 'Dernière vérification via',
  sourceNotConfiguredTitle: 'Aucune source publique n’est encore connectée.', aiClassifierReady: 'Classificateur IA prêt :', monitoringWillBegin: 'La surveillance commencera après la connexion d’une source publique.', footer: 'Moniteur indépendant · Non affilié à OpenAI.',
  categoryPlanned: 'Réinitialisation prévue', categoryCompleted: 'Réinitialisation terminée', categoryTimeChanged: 'Heure modifiée', categoryPolicy: 'Changement de politique', resetExpected: 'Réinitialisation prévue', notAnnounced: 'non annoncée', resetDue: 'réinitialisation due', checking: 'Vérification', ago: 'il y a', secondsAgo: 's', minutesAgoShort: 'min', hoursAgoShort: 'h', daysAgoShort: 'j',
};

// These legacy keys are retained for compatibility with older render paths;
// their value must follow the page's locale-neutral displayed-time wording.
messages.ja.yourLocalTime = '表示時刻';
messages.ja.beijingTime = '表示時刻';
messages.es.yourLocalTime = 'Hora mostrada';
messages.es.beijingTime = 'Hora mostrada';
messages.fr.yourLocalTime = 'Heure affichée';
messages.fr.beijingTime = 'Heure affichée';

// --- Category Config ---
const CATEGORY_ICONS = {
  RESET_PLANNED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  RESET_COMPLETED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  RESET_TIME_CHANGED: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/><line x1="3" y1="3" x2="21" y2="21"/></svg>',
  POLICY_CHANGE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
  CODEX_UPDATE: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="9"/></svg>',
  ROADMAP_HINT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5M4 6c4-3 8 3 16 0v9c-8 3-12-3-16 0"/></svg>',
  FEATURE_DISCUSSION: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H7l-4 3v-10.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>',
};

const VALID_EVENT_FILTERS = ['ALL', 'RESET_PLANNED', 'RESET_COMPLETED', 'RESET_TIME_CHANGED', 'POLICY_CHANGE', 'CODEX_UPDATE', 'ROADMAP_HINT', 'FEATURE_DISCUSSION'];
// --- State ---
let currentFilter = 'ALL';
let currentQuery = { q: '', startDate: '', endDate: '' };
let events = [];
let eventsState = 'LOADING';
let lang = 'en';
let resetStatus = null;
let countdownTimer = null;
let resetHistoryEvents = [];
let resetHistoryState = 'LOADING';
let resetHistoryRequestId = 0;
let searchDebounceTimer = null;
let eventsRequestId = 0;
let ssrHydrated = false;
let initStarted = false;
let dataRefreshTimer = null;
let dataRefreshInFlight = false;
const DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// --- DOM References (cached) ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- i18n Core ---
function t(key) {
  const dict = messages[lang] || messages.en;
  return dict[key] !== undefined ? dict[key] : key;
}

function formatMessage(key, values) {
  let message = t(key);
  Object.keys(values || {}).forEach(function(name) {
    message = message.replace(new RegExp('\\{' + name + '\\}', 'g'), String(values[name]));
  });
  return message;
}

function getCategoryLabel(category) {
  const labels = {
    en: {
      RESET_PLANNED: 'Reset Planned',
      RESET_COMPLETED: 'Reset Completed',
      RESET_TIME_CHANGED: 'Time Changed',
      POLICY_CHANGE: 'Policy Change',
      CODEX_UPDATE: 'Codex Update',
      ROADMAP_HINT: 'Roadmap Hint',
      FEATURE_DISCUSSION: 'Feature Discussion',
    },
    'zh-CN': {
      RESET_PLANNED: '计划重置',
      RESET_COMPLETED: '重置完成',
      RESET_TIME_CHANGED: '时间变更',
      POLICY_CHANGE: '政策变更',
      CODEX_UPDATE: 'Codex 产品更新',
      ROADMAP_HINT: '路线图线索',
      FEATURE_DISCUSSION: '功能讨论',
    },
    ja: {
      RESET_PLANNED: 'リセット予定',
      RESET_COMPLETED: 'リセット完了',
      RESET_TIME_CHANGED: '時刻変更',
      POLICY_CHANGE: 'ポリシー変更',
      CODEX_UPDATE: 'Codex 更新',
      ROADMAP_HINT: 'ロードマップのヒント',
      FEATURE_DISCUSSION: '機能ディスカッション',
    },
    es: {
      RESET_PLANNED: 'Restablecimiento previsto',
      RESET_COMPLETED: 'Restablecimiento completado',
      RESET_TIME_CHANGED: 'Hora modificada',
      POLICY_CHANGE: 'Cambio de política',
      CODEX_UPDATE: 'Actualización de Codex',
      ROADMAP_HINT: 'Pista de hoja de ruta',
      FEATURE_DISCUSSION: 'Debate de funciones',
    },
    fr: {
      RESET_PLANNED: 'Réinitialisation prévue',
      RESET_COMPLETED: 'Réinitialisation terminée',
      RESET_TIME_CHANGED: 'Heure modifiée',
      POLICY_CHANGE: 'Changement de politique',
      CODEX_UPDATE: 'Mise à jour Codex',
      ROADMAP_HINT: 'Indice de feuille de route',
      FEATURE_DISCUSSION: 'Discussion de fonctionnalité',
    }
  };
  const dict = labels[lang] || labels.en;
  return dict[category] || category;
}

// --- Language Management ---
function getInitialLanguage() {
  const path = window.location.pathname;
  if (path === '/zh' || path.startsWith('/zh/')) return 'zh-CN';
  if (path === '/ja' || path.startsWith('/ja/')) return 'ja';
  if (path === '/es' || path.startsWith('/es/')) return 'es';
  if (path === '/fr' || path.startsWith('/fr/')) return 'fr';
  return 'en';
}

function stripLocalePrefix(pathname) {
  if (/^\/(?:zh|ja|es|fr)\/?$/u.test(pathname)) return '/';
  const match = pathname.match(/^\/(?:zh|ja|es|fr)(\/.*)$/u);
  if (match) return match[1] || '/';
  return pathname || '/';
}

function localePrefix(targetLanguage) {
  return targetLanguage === 'en' ? '' : targetLanguage === 'zh-CN' ? '/zh' : '/' + targetLanguage;
}

function localizedPath(targetLanguage) {
  const basePath = stripLocalePrefix(window.location.pathname);
  const prefix = localePrefix(targetLanguage);
  return prefix + (basePath === '/' ? '/' : basePath);
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return date.getUTCFullYear() === parts[0]
    && date.getUTCMonth() === parts[1] - 1
    && date.getUTCDate() === parts[2];
}

function readUrlFilters() {
  const params = new URLSearchParams(window.location.search);
  const category = VALID_EVENT_FILTERS.indexOf(params.get('category')) >= 0
    ? params.get('category')
    : 'ALL';
  const rawStartDate = (params.get('startDate') || '').trim();
  const rawEndDate = (params.get('endDate') || '').trim();
  return {
    category: category || 'ALL',
    q: (params.get('q') || '').trim().slice(0, 120),
    startDate: isValidDateOnly(rawStartDate) ? rawStartDate : '',
    endDate: isValidDateOnly(rawEndDate) ? rawEndDate : '',
  };
}

function syncFiltersFromUrl() {
  const filters = readUrlFilters();
  currentFilter = filters.category;
  currentQuery = {
    q: filters.q,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
  syncFilterControls();
}

function syncFilterControls() {
  const filterButtons = document.querySelectorAll('.filter-btn');
  for (let i = 0; i < filterButtons.length; i++) {
    filterButtons[i].classList.toggle('active', filterButtons[i].dataset.filter === currentFilter);
  }
  const searchInput = document.getElementById('eventSearchInput');
  if (searchInput && searchInput.value !== currentQuery.q) searchInput.value = currentQuery.q;
  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput && startDateInput.value !== currentQuery.startDate) startDateInput.value = currentQuery.startDate;
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput && endDateInput.value !== currentQuery.endDate) endDateInput.value = currentQuery.endDate;
}

function updateFilterUrl(patch) {
  const current = readUrlFilters();
  const next = Object.assign({}, current, patch || {});
  next.category = VALID_EVENT_FILTERS.indexOf(next.category) >= 0 ? next.category : 'ALL';
  next.q = String(next.q || '').trim().slice(0, 120);
  next.startDate = isValidDateOnly(next.startDate) ? next.startDate : '';
  next.endDate = isValidDateOnly(next.endDate) ? next.endDate : '';

  const url = new URL(window.location.href);
  const setOrDelete = function(key, value) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  };
  setOrDelete('category', next.category === 'ALL' ? '' : next.category);
  setOrDelete('q', next.q);
  setOrDelete('startDate', next.startDate);
  setOrDelete('endDate', next.endDate);
  const nextUrl = url.pathname + (url.search ? url.search : '') + (url.hash || '');
  const currentUrl = window.location.pathname + window.location.search + window.location.hash;
  if (nextUrl !== currentUrl) window.history.pushState({}, '', nextUrl);

  currentFilter = next.category;
  currentQuery = { q: next.q, startDate: next.startDate, endDate: next.endDate };
  syncFilterControls();
}

function eventFilterQueryString() {
  const params = new URLSearchParams();
  if (currentFilter !== 'ALL') params.set('category', currentFilter);
  if (currentQuery.q) params.set('q', currentQuery.q);
  if (currentQuery.startDate) params.set('startDate', currentQuery.startDate);
  if (currentQuery.endDate) params.set('endDate', currentQuery.endDate);
  return params.toString();
}

function eventQueryString(limit) {
  const params = new URLSearchParams(eventFilterQueryString());
  if (limit !== undefined && limit !== null) params.set('limit', String(limit));
  if (currentQuery.startDate || currentQuery.endDate) {
    params.set('timeZone', getDisplayTimezone());
  }
  return params.toString();
}

function setLanguage(targetLanguage) {
  const targetPath = localizedPath(targetLanguage);
  const targetUrl = targetPath + window.location.search + window.location.hash;
  if (targetUrl !== window.location.pathname + window.location.search + window.location.hash) {
    window.location.assign(targetUrl);
    return;
  }
  lang = targetLanguage;
  applyLanguage();
}

function getEventPath(id) {
  return localePrefix(lang) + '/events/' + id;
}

function applyLanguage() {
  updateHtmlLang();
  translateAllUI();
  updateLanguageSwitcher();
  syncFilterControls();
  renderEventState();
  renderStatusCards(statusData);
  renderResetCountdown();
}

function updateHtmlLang() {
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : lang;
  const serverMeta = window.__SSR_META__ && window.__SSR_META__.lang === lang
    ? window.__SSR_META__
    : null;
  const pageTitle = serverMeta && serverMeta.title ? serverMeta.title : t('siteTitle');
  const pageDescription = serverMeta && serverMeta.description ? serverMeta.description : t('siteDescription');
  document.title = pageTitle;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = pageDescription;
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) ogTitle.content = pageTitle;
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc) ogDesc.content = pageDescription;
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) twitterTitle.content = pageTitle;
  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if (twitterDescription) twitterDescription.content = pageDescription;
}

function updateLanguageSwitcher() {
  const btn = document.getElementById('langSwitch');
  if (btn) {
    const labels = { en: 'English', 'zh-CN': '中文', ja: '日本語', es: 'Español', fr: 'Français' };
    btn.textContent = labels[lang] || labels.en;
    btn.setAttribute('aria-label', t('toggleLanguage'));
  }
}

// --- Translate All Static UI ---
function translateAllUI() {
  // Use ID-based translation for all static elements
  const idMap = {
    monitoringLabel: 'monitoring',
    introLede: 'intro',
    cardLabelLastReset: 'lastReset',
    cardLabelCurrentPolicy: 'currentPolicy',
    cardLabelLatestChange: 'latestChange',
    cardLabelLastChecked: 'lastChecked',
    cardLabelSourceStatus: 'sourceStatus',
    timelineTitle: 'timeline',
    filterAll: 'all',
    filterResetPlanned: 'resetPlanned',
    filterResetCompleted: 'resetCompleted',
    filterTimeChanged: 'resetTimeChanged',
    filterPolicyChange: 'policyChange',
    filterCodexUpdate: 'codexUpdate',
    filterRoadmapHint: 'roadmapHint',
    filterFeatureDiscussion: 'featureDiscussion',
    timelineEmptyText: 'noEvents',
    emptyStateText: 'noEventsDetail',
    loadingText: 'loading',
    footerText: 'footer',
    countdownTitle: 'resetCountdown',
    countdownEmptyText: 'noResetScheduled',
    latestEventTitle: 'latestEventTitle',
    statusAnswerTitle: 'statusAnswerTitle',
    statusAnswerLead: 'statusAnswerLead',
    lastConfirmedResetLabel: 'lastConfirmedReset',
    nextKnownResetLabel: 'nextKnownReset',
    statusAnswerResetHistory: 'viewResetHistory',
    eventSearchLabel: 'searchEvents',
    startDateLabel: 'fromDate',
    endDateLabel: 'toDate',
    clearFilters: 'clearFilters',
    exportLabel: 'export',
  };

  for (const [elId, msgKey] of Object.entries(idMap)) {
    const el = document.getElementById(elId);
    if (el) el.textContent = t(msgKey);
  }

  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) {
    const serverMeta = window.__SSR_META__ && window.__SSR_META__.lang === lang ? window.__SSR_META__ : null;
    pageTitle.textContent = serverMeta && serverMeta.title ? serverMeta.title : t('siteTitle');
  }

  const searchInput = document.getElementById('eventSearchInput');
  if (searchInput) {
    searchInput.placeholder = t('searchPlaceholder');
    searchInput.setAttribute('aria-label', t('searchEvents'));
  }
  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput) startDateInput.setAttribute('aria-label', t('fromDate'));
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput) endDateInput.setAttribute('aria-label', t('toDate'));
}

// --- API Calls ---
let statusData = null;

async function fetchAPI(path) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}

// --- Render Functions ---
function renderAll() {
  renderTimeline();
  renderEventHighlight(getVisibleEvents()[0] || null);
}

// The homepage ItemList is rendered from the same SSR event array as the
// initial timeline. If a later API refresh changes that array, update the
// JSON-LD too so the hydrated DOM cannot describe a stale list.
function syncItemListStructuredData() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  const visibleEvents = getVisibleEvents();
  for (let i = 0; i < scripts.length; i++) {
    try {
      const parsed = JSON.parse(scripts[i].textContent || '');
      if (parsed && parsed['@type'] === 'ItemList') {
        parsed.itemListElement = visibleEvents.map(function(event, index) {
          return {
            '@type': 'ListItem',
            position: index + 1,
            url: SITE_URL + getEventPath(event.id),
            name: getTitle(event),
          };
        });
        scripts[i].textContent = JSON.stringify(parsed);
      }
    } catch (_err) {
      // A malformed unrelated JSON-LD block must not stop the dashboard.
    }
  }
}

function displayDateOnly(iso) {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  if (isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: getDisplayTimezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = function(type) {
    return (parts.find(function(part) { return part.type === type; }) || {}).value || '';
  };
  return value('year') + '-' + value('month') + '-' + value('day');
}

function eventMatchesCurrentQuery(event) {
  if (currentQuery.q) {
    const translatedText = event.translations ? Object.keys(event.translations).map(function(key) {
      const translation = event.translations[key];
      return translation && (translation.title || translation.summary) || '';
    }) : [];
    const haystack = [event.title_en, event.title_zh, event.summary_en, event.summary_zh].concat(translatedText, [event.source_text])
      .map(function(value) { return String(value || '').toLowerCase(); })
      .join(' ');
    if (haystack.indexOf(currentQuery.q.toLowerCase()) < 0) return false;
  }

  if (currentQuery.startDate || currentQuery.endDate) {
    const eventDate = displayDateOnly(event.published_at || event.created_at);
    if (!eventDate) return false;
    if (currentQuery.startDate && eventDate < currentQuery.startDate) return false;
    if (currentQuery.endDate && eventDate > currentQuery.endDate) return false;
  }
  return true;
}

function getVisibleEvents() {
  return events.filter(function(event) {
    return (currentFilter === 'ALL' || event.category === currentFilter) && eventMatchesCurrentQuery(event);
  });
}

function renderEventHighlight(event) {
  const container = document.getElementById('eventHighlight');
  if (!container) return;
  if (!event) {
    const message = eventsState === 'ERROR'
      ? t('failedToLoad')
      : eventsState === 'LOADED_EMPTY'
        ? t('noEventsDetail')
        : t('loading');
    container.innerHTML = '<div class="highlight-empty"><p>' + message + '</p></div>';
    return;
  }

  const title = getEventTitle(event);
  const summary = getEventSummary(event);
  const sourceBadge = renderSourceBadge(event);

  container.innerHTML = [
    '<div class="event-highlight-card" onclick="window.openModal&&openModal(' + event.id + ')">',
    '  <div class="event-highlight-top">',
    '    <div>',
    '      <span class="category-badge category-' + event.category + '">',
    '        ' + (CATEGORY_ICONS[event.category] || ''),
    '        ' + getCategoryLabel(event.category),
    '      </span>',
    '      ' + sourceBadge,
    '    </div>',
    '    <div class="event-highlight-meta">',
    '      <span>' + formatDate(event.published_at, lang) + '</span>',
    event.source_url ? '      <a href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(getAnalyticsEvidenceSource(event)) + '" onclick="event.stopPropagation()">' + t('viewOriginal') + ' →</a>' : '',
    '    </div>',
    '  </div>',
    '  <a href="' + getEventPath(event.id) + '" class="event-highlight-title-link">',
    '    <h3 class="event-highlight-title">' + escapeHtml(title) + '</h3>',
    '  </a>',
    '  <div class="event-highlight-summary">' + escapeHtml(summary) + '</div>',
    '</div>'
  ].join('\n');
}

function renderEventState() {
  const loading = document.getElementById('timelineLoading');
  if (loading) loading.style.display = eventsState === 'LOADING' ? 'flex' : 'none';

  if (eventsState === 'LOADED_DATA' && events.length > 0) {
    renderAll();
    syncItemListStructuredData();
    return;
  }

  renderTimeline();
  renderEventHighlight(null);
  syncItemListStructuredData();
}

function renderTimeline() {
  const container = document.getElementById('timeline');
  if (!container) return;

  if (eventsState === 'LOADING') {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('loading') + '</p></li>';
    return;
  }

  if (eventsState === 'ERROR') {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('failedToLoad') + '</p></li>';
    return;
  }

  const filtered = getVisibleEvents();

  if (filtered.length === 0) {
    container.innerHTML = '<li class="timeline-empty"><p>' + t('noEvents') + '</p></li>';
    return;
  }

  let html = '';
  let lastDate = '';

  for (let i = 0; i < filtered.length; i++) {
    const event = filtered[i];
    const dateStr = formatDateShort(event.published_at, lang);
    const showDate = dateStr !== lastDate;
    lastDate = dateStr;
    const title = getEventTitle(event);
    const summary = getEventSummary(event);
    const sourceBadge = renderSourceBadge(event);

    html += [
      '<li class="timeline-item ' + event.category + '" onclick="window.openModal&&openModal(' + event.id + ')">',
      '  <div class="timeline-dot">',
      '    <div class="timeline-dot-marker"></div>',
      '  </div>',
      '  <div class="timeline-content">',
      (showDate ? '    <div class="timeline-date">' + dateStr + '</div>' : ''),
      '    <div style="margin-bottom:0.375rem">',
      '      <span class="category-badge category-' + event.category + '">',
      '        ' + (CATEGORY_ICONS[event.category] || ''),
      '        ' + getCategoryLabel(event.category),
      '      </span>',
      '      ' + sourceBadge,
      '    </div>',
      '    <a href="' + getEventPath(event.id) + '" class="timeline-title-link">',
      '      <h3 class="timeline-title">' + escapeHtml(title) + '</h3>',
      '    </a>',
      '    <div class="timeline-summary">' + escapeHtml(summary) + '</div>',
      '  </div>',
      '</li>'
    ].join('\n');
  }

  container.innerHTML = html;
}

function renderStatusCards(data) {
  statusData = data;
  if (!data) return;

  renderManualResetNotice(data);

  const resetEvent = data.latestDirectReset || data.lastReset || null;
  const reportedResetAt = data.manualReset && data.manualReset.resetAt
    ? data.manualReset.resetAt
    : resetEvent
      ? (resetEvent.reset_at || resetEvent.effective_at || resetEvent.published_at)
      : null;
  const resetText = reportedResetAt
    ? (data.manualReset && data.manualReset.resetAt
      ? formatManualResetTime(reportedResetAt, lang)
      : formatDate(reportedResetAt, lang))
    : t('statusUnknown');

  setStatusEventLink(
    'lastResetValue',
    data.manualReset && data.manualReset.resetAt ? null : resetEvent,
    resetText,
    'status_card',
  );
  setStatusEventLink(
    'currentPolicyValue',
    data.currentPolicy || null,
    data.currentPolicy ? getTitle(data.currentPolicy) : t('statusUnknown'),
    'status_card',
  );
  setStatusEventLink(
    'latestChangeValue',
    data.latestEvent || null,
    data.latestEvent ? getTitle(data.latestEvent) : t('statusUnknown'),
    'status_card',
  );

  const checkedAt = data.lastCheckedAt || data.lastSuccessfulCron || null;
  const lastCheckedValue = document.getElementById('lastCheckedValue');
  if (lastCheckedValue) lastCheckedValue.textContent = checkedAt ? timeAgo(checkedAt, lang) : t('lastCheckedUnavailable');
  const answerLastUpdated = document.getElementById('statusAnswerLastUpdated');
  if (answerLastUpdated) answerLastUpdated.textContent = checkedAt ? timeAgo(checkedAt, lang) : t('lastCheckedUnavailable');

  const sourceValue = document.getElementById('sourceStatusValue');
  if (sourceValue) {
    const providers = data.providers || {};
    const xApi = providers.xApi;
    const directPrimary = !!(xApi && xApi.automaticSync) || data.sourceMode === 'x_direct';
    const source = directPrimary ? xApi : (providers.webSearch || providers.source);
    let sourceLabel = directPrimary ? t('xDirectSource') : t('webIndexedSource');
    if (!source && !data.sourceMode) sourceLabel = t('unknown');
    else if (source && source.status === 'stale') sourceLabel += ' · ' + t('stale');
    else if (source && (source.status === 'degraded' || source.status === 'down')) sourceLabel += ' · ' + t('degraded');
    const lastNewPostAt = (xApi && xApi.lastNewPostAt) || data.sourceLastNewPostAt;
    if (directPrimary && lastNewPostAt) {
      sourceLabel += ' · ' + t('lastNewPost') + ': ' + timeAgo(lastNewPostAt, lang);
    }
    sourceValue.textContent = sourceLabel;
  }

  renderStatusAnswer(data, resetEvent, reportedResetAt, checkedAt);
  updateLiveBadge(data);
  updateMonitoredAccounts(data);
}

function setStatusEventLink(elementId, event, text, placement) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.replaceChildren();
  if (!event || !event.id) {
    container.textContent = text || t('statusUnknown');
    return;
  }

  const link = document.createElement('a');
  link.className = 'status-card-link';
  link.href = getEventPath(event.id);
  link.textContent = text || t('statusUnknown');
  link.setAttribute('data-analytics-placement', placement || 'status_card');
  link.setAttribute('data-analytics-event-id', String(event.id));
  if (event.category) link.setAttribute('data-analytics-event-category', event.category);
  link.setAttribute('data-analytics-evidence-source', getAnalyticsEvidenceSource(event));
  container.appendChild(link);
}

function renderStatusAnswer(data, resetEvent, reportedResetAt, checkedAt) {
  const resetLabel = document.getElementById('lastConfirmedResetLabel');
  const resetValue = document.getElementById('lastConfirmedResetValue');
  if (resetLabel) resetLabel.textContent = data && (data.latestDirectReset || (data.manualReset && data.manualReset.resetAt))
    ? t('lastConfirmedReset')
    : t('lastRecordedReset');
  if (resetValue) {
    const resetText = reportedResetAt
      ? (data.manualReset && data.manualReset.resetAt
        ? formatManualResetTime(reportedResetAt, lang)
        : formatDate(reportedResetAt, lang))
      : t('statusUnknown');
    setStatusEventLink(
      'lastConfirmedResetValue',
      data.manualReset && data.manualReset.resetAt ? null : resetEvent,
      resetText,
      'status_answer',
    );
  }
  const answerLastUpdated = document.getElementById('statusAnswerLastUpdated');
  if (answerLastUpdated) answerLastUpdated.textContent = checkedAt ? timeAgo(checkedAt, lang) : t('lastCheckedUnavailable');
  renderResetAnswerValue();
}

function renderManualResetNotice(data) {
  const notice = document.getElementById('manualResetNotice');
  if (!notice) return;
  const report = data && data.manualReset;
  if (!report || !report.resetAt) {
    notice.style.display = 'none';
    notice.innerHTML = '';
    return;
  }

  const note = report.note
    ? '<div class="manual-reset-notice-note">' + (lang === 'zh-CN' ? '备注：' : 'Note: ') + escapeHtml(report.note) + '</div>'
    : '';
  notice.style.display = 'block';
  notice.innerHTML = [
    '<div class="manual-reset-notice-title">' + t('manualResetReportedTitle') + '</div>',
    '<div class="manual-reset-notice-body">' + t('manualResetReported') + ' <time class="manual-reset-time">' + escapeHtml(formatManualResetTime(report.resetAt, lang)) + '</time></div>',
    note,
    '<div class="manual-reset-notice-meta">' + t('manualResetDisclaimer') + '</div>',
  ].filter(Boolean).join('\n');
}

function eventLocaleKey() {
  return lang === 'zh-CN' ? 'zh' : lang;
}

function getEventTitle(event) {
  const locale = eventLocaleKey();
  if (locale === 'zh') return event.title_zh || event.title_en;
  if (locale === 'en') return event.title_en || event.title_zh;
  const translation = event.translations && event.translations[locale];
  return translation && translation.status === 'translated' && translation.title
    ? translation.title
    : (event.title_en || event.title_zh);
}

function getEventSummary(event) {
  const locale = eventLocaleKey();
  if (locale === 'zh') return event.summary_zh || event.summary_en;
  if (locale === 'en') return event.summary_en || event.summary_zh;
  const translation = event.translations && event.translations[locale];
  return translation && translation.status === 'translated' && translation.summary
    ? translation.summary
    : (event.summary_en || event.summary_zh);
}

function getTitle(event) {
  return getEventTitle(event);
}

function renderSourceBadge(event) {
  return '<span class="source-quality-badge ' + sourceQualityClass(event) + '">' + getSourceQualityLabel(event) + '</span>';
}

function isOfficialEvent(event) {
  return event && (event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'OFFICIAL');
}

function isIndexedEvent(event) {
  return event && (event.verification_status === 'INDEXED_ONLY'
    || event.source_quality === 'INDEXED'
    || event.evidence_quality === 'INDEXED');
}

function sourceQualityClass(event) {
  return isOfficialEvent(event) ? 'official' : isIndexedEvent(event) ? 'indexed' : 'direct';
}

function getSourceQualityLabel(event) {
  if (isOfficialEvent(event)) return t('officialSource');
  if (isIndexedEvent(event)) return t('indexedSource');
  if (event && (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT')) return t('directSource');
  return t('unknownSourceType');
}

function getAnalyticsEvidenceSource(event) {
  if (isOfficialEvent(event)) return 'official';
  if (isIndexedEvent(event)) return 'web_indexed';
  if (event && (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT')) return 'x_direct';
  return 'unknown';
}

function getVerificationLabel(event) {
  if (event && event.verification_status === 'OFFICIAL_VERIFIED') return t('officiallyVerified');
  if (event && event.verification_status === 'INDEXED_ONLY') return t('awaitingDirectVerification');
  if (event && event.verification_status === 'DIRECT_VERIFIED') return t('directlyVerified');
  return t('pendingVerification');
}

function getLastVerifiedLabel(event) {
  if (event && event.last_verified_via === 'x_api') {
    return isOfficialEvent(event) ? t('officialSource') : t('directSource');
  }
  if (event && event.last_verified_via) return event.last_verified_via;
  return event && event.verification_status === 'INDEXED_ONLY'
    ? t('awaitingDirectVerification')
    : t('pendingVerification');
}

function getDiscoveredViaLabel(event) {
  if (!event || !event.first_discovered_via) return t('unknown');
  if (event.first_discovered_via === 'web_search') return t('discoveredViaSearch');
  if (event.first_discovered_via === 'x_api') return t('directSource');
  return event.first_discovered_via;
}

function updateLiveBadge(data) {
  const badge = document.getElementById('liveBadge');
  const dot = badge.querySelector('.live-dot');
  const label = document.getElementById('lastCheckedLabel');

  if (!data) {
    dot.style.background = '#606070';
    label.textContent = t('unknown');
    return;
  }

  var providers = data.providers;
  var lastRun = data.lastRun;

  // SSR provides event/freshness data before the status API resolves. Do not
  // infer configured providers or a LIVE state from that partial payload.
  if (!providers) {
    dot.style.background = '#606070';
    label.textContent = data.lastCheckedAt ? t('monitoring') : t('awaitingFirstRun');
    return;
  }

  var xApi = providers && providers.xApi;
  var directPrimary = !!(xApi && xApi.automaticSync);
  var discovery = directPrimary ? xApi : (providers && (providers.webSearch || providers.source));
  var sourceConfigured = discovery && discovery.configured;
  var classifierConfigured = providers && providers.classifier && providers.classifier.configured;

  if (!sourceConfigured && !classifierConfigured) {
    dot.style.background = '#ef4444';
    label.textContent = t('notConfigured');
    return;
  }

  if (!sourceConfigured) {
    dot.style.background = '#eab308';
    label.textContent = t('sourceNotConfigured');
    return;
  }

  if (!classifierConfigured) {
    dot.style.background = '#eab308';
    label.textContent = t('classifierNotConfigured');
    return;
  }

  if ((lastRun && lastRun.status === 'failed') || data.status === 'degraded'
    || (directPrimary && xApi && ['down', 'degraded', 'stale'].indexOf(xApi.status) !== -1)) {
    dot.style.background = '#ef4444';
    label.textContent = t('degraded');
    return;
  }

  var discoveryLastSuccess = directPrimary
    ? xApi.lastSuccessAt
    : (providers && providers.webSearch && providers.webSearch.lastSuccessAt);
  var monitorLastSuccess = data.lastCheckedAt || data.lastSuccessfulCron;
  if (discoveryLastSuccess || monitorLastSuccess) {
    var freshnessAt = discoveryLastSuccess || monitorLastSuccess;
    var diff = Date.now() - parseStoredUtc(freshnessAt).getTime();
    var hours = diff / 3600000;

    if (hours > 2) {
      dot.style.background = '#eab308';
      label.textContent = t('stale');
      return;
    }

    dot.style.background = '#22c55e';
    label.textContent = t('live');
    return;
  }

  dot.style.background = '#606070';
  label.textContent = t('awaitingFirstRun');
}

function updateMonitoredAccounts(data) {
  if (data.checkedAccounts && data.checkedAccounts.length > 0) {
    document.getElementById('monitoredAccounts').textContent =
      data.checkedAccounts.map(function(a) { return '@' + a; }).join(', ');
  }
}

// --- Reset Countdown ---
const RESET_DAY_MS = 24 * 60 * 60 * 1000;
const SQLITE_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

function parseStoredUtc(value) {
  if (TIME_API && typeof TIME_API.parseStoredUtc === 'function') return TIME_API.parseStoredUtc(value);
  if (value === null || value === undefined || value === '') return new Date(NaN);
  const stringValue = String(value);
  const sqliteMatch = stringValue.match(SQLITE_UTC_TIMESTAMP_PATTERN);
  return new Date(sqliteMatch ? sqliteMatch[1] + 'T' + sqliteMatch[2] + 'Z' : stringValue);
}

function resetEventTimestamp(event) {
  if (!event) return null;
  const values = [event.published_at, event.created_at];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value) continue;
    const timestamp = parseStoredUtc(value).getTime();
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return null;
}

function calculateAverageResetIntervalDays(resetEvents, limit) {
  const requestedLimit = Number.isInteger(limit) ? Math.max(2, limit) : 5;
  const timestamps = (Array.isArray(resetEvents) ? resetEvents : [])
    .map(resetEventTimestamp)
    .filter(function(timestamp) { return timestamp !== null; })
    .sort(function(left, right) { return left - right; })
    .slice(-requestedLimit);

  if (timestamps.length < 2) {
    return { averageDays: null, count: timestamps.length };
  }

  let totalIntervalMs = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    totalIntervalMs += timestamps[index] - timestamps[index - 1];
  }
  return {
    averageDays: totalIntervalMs / (timestamps.length - 1) / RESET_DAY_MS,
    count: timestamps.length,
  };
}

function daysSinceResetTimestamp(timestamp) {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / RESET_DAY_MS));
}

function renderResetHistoryReference() {
  const reference = document.getElementById('countdownHistoryReference');
  const daysLine = document.getElementById('countdownDaysSinceLastReset');
  const averageLine = document.getElementById('countdownAverageResetInterval');
  const disclaimer = document.getElementById('countdownHistoryDisclaimer');
  if (!reference || !daysLine || !averageLine || !disclaimer) return;

  reference.style.display = 'none';
  daysLine.textContent = '';
  daysLine.style.display = 'none';
  averageLine.textContent = '';
  averageLine.style.display = 'none';
  disclaimer.textContent = t('historyReferenceDisclaimer');
  disclaimer.style.display = 'none';

  if (resetHistoryState === 'LOADING') return;

  const statusLastReset = statusData && (statusData.latestDirectReset || statusData.lastReset)
    ? (statusData.latestDirectReset || statusData.lastReset)
    : null;
  const lastResetEvent = statusLastReset && resetEventTimestamp(statusLastReset) !== null
    ? statusLastReset
    : resetHistoryEvents.find(function(event) { return resetEventTimestamp(event) !== null; }) || null;
  const daysSince = daysSinceResetTimestamp(resetEventTimestamp(lastResetEvent));
  const intervalStats = calculateAverageResetIntervalDays(resetHistoryEvents, 5);
  const hasHistory = daysSince !== null || intervalStats.averageDays !== null;
  const hasValidHistoryEvent = resetHistoryEvents.some(function(event) {
    return resetEventTimestamp(event) !== null;
  });
  const hasNoHistory = resetHistoryState === 'LOADED' && !hasValidHistoryEvent && daysSince === null;

  if (daysSince !== null) {
    daysLine.textContent = formatMessage('daysSinceLastReset', { days: daysSince });
    daysLine.style.display = 'block';
  } else if (resetHistoryState === 'LOADED' && !hasValidHistoryEvent) {
    daysLine.textContent = t('noHistoricalReset');
    daysLine.style.display = 'block';
  } else {
    daysLine.style.display = 'none';
  }

  if (intervalStats.averageDays !== null) {
    averageLine.textContent = formatMessage('averageResetInterval', {
      days: Math.round(intervalStats.averageDays),
      count: intervalStats.count,
    });
    averageLine.style.display = 'block';
  } else {
    averageLine.style.display = 'none';
  }

  if (hasHistory) {
    disclaimer.style.display = 'block';
  }
  if (hasHistory || hasNoHistory) {
    reference.style.display = 'block';
  }
}

function renderResetAnswerValue() {
  const value = document.getElementById('nextKnownResetValue');
  if (!value) return;
  if (!resetStatus) {
    value.textContent = t('checkingLiveStatus');
    return;
  }
  if (resetStatus.status === 'ERROR') {
    value.textContent = t('failedToLoad');
    return;
  }
  if (resetStatus.status === 'NONE') {
    value.textContent = t('noResetScheduled');
    return;
  }
  if (resetStatus.status === 'CONFIRMED') {
    const confirmation = resetStatus.confirmation || {};
    const confirmedAt = confirmation.confirmedAt
      ? formatDateTime(parseStoredUtc(confirmation.confirmedAt), lang, getDisplayTimezone())
      : '';
    value.textContent = t('resetConfirmed') + (confirmedAt ? ' · ' + confirmedAt : '');
    return;
  }
  if (resetStatus.expectedResetAt) {
    value.textContent = formatDateTime(parseStoredUtc(resetStatus.expectedResetAt), lang, getDisplayTimezone());
    return;
  }
  value.textContent = getApproximateResetText(resetStatus);
}

function renderResetCountdown() {
  const section = document.getElementById('countdownSection');
  const display = document.getElementById('countdownDisplay');
  const empty = document.getElementById('countdownEmpty');

  renderResetAnswerValue();

  if (resetStatus && resetStatus.status === 'ERROR') {
    section.style.display = 'block';
    display.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('countdownEmptyText').textContent = t('failedToLoad');
    const historyReference = document.getElementById('countdownHistoryReference');
    if (historyReference) historyReference.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }

  if (!resetStatus) {
    section.style.display = 'block';
    display.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('countdownEmptyText').textContent = t('checkingLiveStatus');
    const historyReference = document.getElementById('countdownHistoryReference');
    if (historyReference) historyReference.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }

  if (resetStatus.status === 'NONE') {
    section.style.display = 'block';
    display.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('countdownEmptyText').textContent = t('noResetScheduled');
    renderResetHistoryReference();
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }

  section.style.display = 'block';
  display.style.display = 'block';
  empty.style.display = 'none';
  const historyReference = document.getElementById('countdownHistoryReference');
  if (historyReference) historyReference.style.display = 'none';

  // Update status badge
  updateCountdownStatus(resetStatus);

  // Start countdown ticker
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(function() {
    updateCountdownDisplay(resetStatus);
  }, 1000);
  updateCountdownDisplay(resetStatus);
}

function updateCountdownStatus(status) {
  const badge = document.getElementById('countdownStatusBadge');
  if (!badge) return;

  var statusMap = {
    en: {
      NONE: '',
      SCHEDULED: 'SCHEDULED',
      DUE: 'DUE',
      CONFIRMING: 'CONFIRMING',
      CONFIRMED: 'CONFIRMED',
      TIME_CHANGED: 'TIME CHANGED',
      EXPIRED_UNCONFIRMED: 'EXPIRED',
    },
    'zh-CN': {
      NONE: '',
      SCHEDULED: '已计划',
      DUE: '已到期',
      CONFIRMING: '确认中',
      CONFIRMED: '已确认',
      TIME_CHANGED: '时间已变更',
      EXPIRED_UNCONFIRMED: '已过期',
    }
  };

  var dict = statusMap[lang] || statusMap.en;
  var label = dict[status.status] || status.status;
  badge.textContent = label;
  badge.className = 'countdown-status-badge status-' + status.status.toLowerCase();
}

function updateCountdownDisplay(status) {
  const timeEl = document.getElementById('countdownTime');
  const infoEl = document.getElementById('countdownInfo');
  if (!timeEl || !infoEl) return;

  var now = Date.now();
  var targetTime = status.expectedResetAt ? parseStoredUtc(status.expectedResetAt).getTime() : null;

  if (status.status === 'CONFIRMED') {
    // Show confirmed state
    timeEl.innerHTML = '';
    infoEl.innerHTML = buildConfirmedInfo(status);
    return;
  }

  if (status.status === 'DUE' || status.status === 'CONFIRMING') {
    // Show due state
    timeEl.innerHTML = '<span class="countdown-due">' + t('resetTimeReached') + '</span>';
    infoEl.innerHTML = buildDueInfo(status);
    return;
  }

  if (!targetTime) {
    // Show approximate time
    timeEl.innerHTML = '<span class="countdown-approx">' + escapeHtml(getApproximateResetText(status)) + '</span>';
    infoEl.innerHTML = buildCountdownInfo(status);
    return;
  }

  var diff = targetTime - now;
  if (diff <= 0) {
    // Time has passed but status not updated
    timeEl.innerHTML = '<span class="countdown-due">' + t('resetTimeReached') + '</span>';
    infoEl.innerHTML = buildDueInfo(status);
    return;
  }

  // Show countdown
  var seconds = Math.floor(diff / 1000);
  var days = Math.floor(seconds / 86400);
  var hours = Math.floor((seconds % 86400) / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var secs = seconds % 60;

  if (lang === 'zh-CN') {
    if (days > 0) {
      timeEl.textContent = days + '天 ' + String(hours).padStart(2, '0') + '时 ' + String(minutes).padStart(2, '0') + '分 ' + String(secs).padStart(2, '0') + '秒';
    } else {
      timeEl.textContent = String(hours).padStart(2, '0') + '时 ' + String(minutes).padStart(2, '0') + '分 ' + String(secs).padStart(2, '0') + '秒';
    }
  } else {
    if (days > 0) {
      timeEl.textContent = days + 'd ' + String(hours).padStart(2, '0') + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(secs).padStart(2, '0') + 's';
    } else {
      timeEl.textContent = String(hours).padStart(2, '0') + 'h ' + String(minutes).padStart(2, '0') + 'm ' + String(secs).padStart(2, '0') + 's';
    }
  }

  infoEl.innerHTML = buildCountdownInfo(status);
}

function buildCountdownInfo(status) {
  var parts = [];
  var userTz = getUserTimezone();

  // Expected reset time
  if (status.expectedResetAt) {
    var d = parseStoredUtc(status.expectedResetAt);
    var expectedStr = formatDateTime(d, lang, userTz);
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('expectedReset') + '</span><span class="countdown-info-value">' + expectedStr + '</span></div>');
  } else {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('expectedReset') + '</span><span class="countdown-info-value">' + escapeHtml(getApproximateResetText(status)) + '</span></div>');
  }

  // Source
  if (status.resetSource) {
    var sourceName = status.resetSource === 'thsottiaux' ? 'Tibo' : status.resetSource;
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('announcedBy') + '</span><span class="countdown-info-value">' + escapeHtml(sourceName));
    if (status.resetSourceUrl) {
      parts.push(' <a href="' + escapeHtml(status.resetSourceUrl) + '" target="_blank" class="countdown-link">' + t('viewSource') + ' →</a>');
    }
    parts.push('</span></div>');
  }

  if (status.verificationStatus === 'INDEXED_ONLY') {
    parts.push('<div class="countdown-provenance">' + t('indexedResetSchedule') + '</div>');
  } else if (status.verificationStatus) {
    parts.push('<div class="countdown-provenance direct">' + t('directResetSchedule') + '</div>');
  }

  return parts.join('\n');
}

// Indexed search results can contain an entire rendered social page. Never
// expose that raw evidence as the approximate reset-time label. The backend
// now leaves this field empty; the guard also protects users while old rows
// are being cleaned up and prevents unsafe HTML from reaching innerHTML.
function getApproximateResetText(status) {
  var raw = typeof status.expectedResetTimeText === 'string'
    ? status.expectedResetTimeText.replace(/\s+/g, ' ').trim()
    : '';

  if (!raw || raw.length > 160 || /(?:user avatar|log in|sign up|views|## post|\/ x\b)/i.test(raw)) {
    return t('exactTimeNotAnnounced');
  }

  return raw;
}

function buildDueInfo(status) {
  var parts = [];
  parts.push('<div class="countdown-due-text">' + t('waitingForConfirmation') + '</div>');

  if (status.confirmation && status.confirmation.lastCheckedAt) {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('lastConfirmationCheck') + '</span><span class="countdown-info-value">' + timeAgo(status.confirmation.lastCheckedAt, lang) + '</span></div>');
  }

  return parts.join('\n');
}

function buildConfirmedInfo(status) {
  var parts = [];
  var confirmation = status.confirmation || {};

  if (confirmation.type === 'DIRECT' || confirmation.type === 'OFFICIAL') {
    parts.push('<div class="countdown-confirmed-badge direct">' + t('resetConfirmed') + '</div>');
    var confirmedBy = status.resetSource || confirmation.sourceAccount || (confirmation.type === 'OFFICIAL' ? 'OpenAI' : t('directSource'));
    if (confirmedBy === 'thsottiaux') confirmedBy = 'Tibo (@thsottiaux)';
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('confirmedBy') + '</span><span class="countdown-info-value">' + escapeHtml(confirmedBy) + '</span></div>');
  } else if (confirmation.type === 'COMMUNITY') {
    parts.push('<div class="countdown-confirmed-badge community">' + t('resetLikelyCompleted') + '</div>');
    parts.push('<div class="countdown-due-text">' + t('multipleReports') + '</div>');
    parts.push('<div class="countdown-due-text dim">' + t('noOfficialConfirmation') + '</div>');
  } else if (confirmation.type === 'MANUAL') {
    parts.push('<div class="countdown-confirmed-badge manual">' + t('manualResetConfirmed') + '</div>');
    parts.push('<div class="countdown-due-text">' + t('manualResetReported') + '</div>');
    parts.push('<div class="countdown-due-text dim">' + t('manualResetDisclaimer') + '</div>');
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('confirmedBy') + '</span><span class="countdown-info-value">' + escapeHtml(t('manualResetSource')) + '</span></div>');
  }

  if (confirmation.confirmedAt) {
    var d = parseStoredUtc(confirmation.confirmedAt);
    var confirmedTime = confirmation.type === 'MANUAL'
      ? formatManualResetTime(confirmation.confirmedAt, lang)
      : formatDateTime(d, lang, getUserTimezone());
    var confirmedTimeLabel = confirmation.type === 'MANUAL' ? t('manualResetTimeLabel') : displayedTimeLabel(lang);
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + confirmedTimeLabel + '</span><span class="countdown-info-value">' + confirmedTime + '</span></div>');
  }

  if (confirmation.sourceUrl) {
    parts.push('<div class="countdown-info-row"><span class="countdown-info-label">' + t('source') + '</span><span class="countdown-info-value"><a href="' + escapeHtml(confirmation.sourceUrl) + '" target="_blank" class="countdown-link">' + t('viewSource') + ' →</a></span></div>');
  }

  return parts.join('\n');
}

function getUserTimezone() {
  return getDisplayTimezone();
}

function getDisplayTimezoneForLanguage(l) {
  if (TIME_API) return TIME_API.timeZone(l);
  return 'UTC';
}

function getDisplayTimezone() {
  return getDisplayTimezoneForLanguage(lang);
}

function displayedTimeLabel(l) {
  const key = TIME_API ? TIME_API.localeKey(l) : (l === 'zh-CN' ? 'zh' : l);
  return {
    en: 'Displayed time',
    zh: '显示时间',
    ja: '表示時刻',
    es: 'Hora mostrada',
    fr: 'Heure affichée',
  }[key] || 'Displayed time';
}

function formatDateTime(d, l, tz) {
  var locale = TIME_API ? TIME_API.intlLocale(l) : (l === 'zh-CN' ? 'zh-CN' : l === 'ja' ? 'ja-JP' : l === 'es' ? 'es-ES' : l === 'fr' ? 'fr-FR' : 'en-US');
  var key = TIME_API ? TIME_API.localeKey(l) : (l === 'zh-CN' ? 'zh' : l);
  var f = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: 'numeric',
    month: key === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: key === 'en',
    timeZoneName: 'short',
  });
  return f.format(d);
}

// --- Render Modal ---
function renderModal(event) {
  const content = document.getElementById('modalContent');
  if (!content) return;
  const confidencePercent = Math.round(event.confidence * 100);
  let confidenceClass = '';
  if (confidencePercent < 50) confidenceClass = 'low';
  else if (confidencePercent < 80) confidenceClass = 'medium';

  const title = getEventTitle(event);
  const summary = getEventSummary(event);

  var parts = [
    '<div class="modal-section"><div class="modal-label">' + t('type') + '</div><div>',
    '  <span class="category-badge category-' + event.category + '">',
    '    ' + (CATEGORY_ICONS[event.category] || ''),
    '    ' + getCategoryLabel(event.category),
    '  </span>',
    '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('title') + '</div>',
    '<div class="modal-value">' + escapeHtml(title) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('summary') + ' <span class="modal-tag ai">' + t('aiSummary') + '</span></div>',
    '<div class="modal-value ai-summary">' + escapeHtml(summary) + '</div></div>',
  ];

  if (event.source_text) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('originalSource') + ' <span class="modal-tag source">' + t('source') + '</span></div>',
      '<div class="modal-value source-text">' + escapeHtml(event.source_text) + '</div></div>'
    );
  }

  var pubTime = '';
  if (event.published_at) {
    pubTime = formatDate(event.published_at, lang);
  } else {
    pubTime = t('publishedTimeUnavailable');
  }

  parts.push(
    '<div class="modal-section"><div class="modal-label">' + t('published') + '</div>',
    '<div class="modal-value">' + pubTime + '</div></div>'
  );

  if (event.reset_at) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('resetTime') + '</div>',
      '<div class="modal-value">' + formatDate(event.reset_at, lang) + '</div></div>'
    );
  }

  if (event.effective_at) {
    parts.push(
      '<div class="modal-section"><div class="modal-label">' + t('effectiveTime') + '</div>',
      '<div class="modal-value">' + formatDate(event.effective_at, lang) + '</div></div>'
    );
  }

  parts.push(
    '<div class="modal-section"><div class="modal-label">' + t('confidence') + '</div>',
    '  <div class="confidence-bar">',
    '    <span class="modal-value">' + confidencePercent + '%</span>',
    '    <div class="confidence-track">',
    '      <div class="confidence-fill ' + confidenceClass + '" style="width:' + confidencePercent + '%"></div>',
    '    </div>',
    '  </div>',
    '</div>',

    '<div class="modal-section"><div class="modal-label">' + t('source') + '</div>',
    '<div class="modal-value">' + escapeHtml(getSourceQualityLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('verificationStatus') + '</div>',
    '<div class="modal-value">' + escapeHtml(getVerificationLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('firstDiscoveredVia') + '</div>',
    '<div class="modal-value">' + escapeHtml(getDiscoveredViaLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('lastVerifiedVia') + '</div>',
    '<div class="modal-value">' + escapeHtml(getLastVerifiedLabel(event)) + '</div></div>',

    '<div class="modal-section"><div class="modal-label">' + t('source') + '</div>',
    '<a class="modal-link" href="' + escapeHtml(event.source_url) + '" target="_blank">' + escapeHtml(event.source_url) + ' →</a></div>'
  );

  content.innerHTML = parts.join('\n');
  document.getElementById('eventModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// --- Utility Functions ---
function formatDate(iso, l) {
  if (!iso) return t('publishedTimeUnavailable');
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return iso;
  return formatDateTime(d, l, getUserTimezone());
}

function manualResetTimezone(l) {
  return getDisplayTimezoneForLanguage(l);
}

function formatManualResetTime(iso, l) {
  if (!iso) return '';
  var d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return iso;
  return formatDateTime(d, l, manualResetTimezone(l));
}

function formatDateShort(iso, l) {
  if (!iso) return '';
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return '';
  var locale = TIME_API ? TIME_API.intlLocale(l) : (l === 'zh-CN' ? 'zh-CN' : l === 'ja' ? 'ja-JP' : l === 'es' ? 'es-ES' : l === 'fr' ? 'fr-FR' : 'en-US');
  var key = TIME_API ? TIME_API.localeKey(l) : (l === 'zh-CN' ? 'zh' : l);
  var options = {
    timeZone: getUserTimezone(),
    month: key === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
  };
  if (key === 'zh') options.year = 'numeric';
  const formatter = new Intl.DateTimeFormat(locale, options);
  return formatter.format(d);
}

function localTime(iso, l) {
  if (!iso) return '';
  const d = parseStoredUtc(iso);
  if (isNaN(d.getTime())) return '';
  return formatDateTime(d, l, getUserTimezone());
}

function timeAgo(iso, l) {
  if (!iso) return '';
  const now = Date.now();
  const then = parseStoredUtc(iso).getTime();
  if (isNaN(then)) return '';
  const diff = Math.floor((now - then) / 1000);
  
  if (l === 'zh-CN') {
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
  }
  if (l === 'ja') {
    if (diff < 60) return diff + '秒前';
    if (diff < 3600) return Math.floor(diff / 60) + '分前';
    if (diff < 86400) return Math.floor(diff / 3600) + '時間前';
    return Math.floor(diff / 86400) + '日前';
  }
  if (l === 'es') {
    if (diff < 60) return 'hace ' + diff + ' s';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'hace ' + Math.floor(diff / 3600) + ' h';
    return 'hace ' + Math.floor(diff / 86400) + ' d';
  }
  if (l === 'fr') {
    if (diff < 60) return 'il y a ' + diff + ' s';
    if (diff < 3600) return 'il y a ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return 'il y a ' + Math.floor(diff / 3600) + ' h';
    return 'il y a ' + Math.floor(diff / 86400) + ' j';
  }
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Modal Controls ---
function openModal(id) {
  const event = events.find(function(e) { return e.id === id; });
  if (event) {
    if (window.tiboAnalytics && typeof window.tiboAnalytics.track === 'function') {
      window.tiboAnalytics.track('view_event_detail', {
        event_id: String(event.id),
        event_category: event.category,
        evidence_source: getAnalyticsEvidenceSource(event),
        verification_status: event.verification_status || 'PENDING',
        view_method: 'modal',
      });
    }
    renderModal(event);
  }
}
function closeModal() {
  const modal = document.getElementById('eventModal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function bindStaticEvents() {
  window.openModal = openModal;

  const modal = document.getElementById('eventModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
  }

  const modalClose = document.getElementById('modalClose');
  if (modalClose) modalClose.addEventListener('click', closeModal);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeModal();
  });

  const filterButtons = document.querySelectorAll('.filter-btn');
  for (let i = 0; i < filterButtons.length; i++) {
    filterButtons[i].addEventListener('click', function() {
      updateFilterUrl({ category: this.dataset.filter || 'ALL' });
      renderEventState();
      void loadEvents();
    });
  }

  const searchForm = document.getElementById('eventSearchForm');
  const searchInput = document.getElementById('eventSearchInput');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', function(event) {
      event.preventDefault();
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      updateFilterUrl({ q: searchInput.value });
      renderEventState();
      void loadEvents();
    });
    searchInput.addEventListener('input', function() {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      const value = searchInput.value;
      searchDebounceTimer = window.setTimeout(function() {
        updateFilterUrl({ q: value });
        renderEventState();
        void loadEvents();
      }, 300);
    });
  }

  const startDateInput = document.getElementById('startDateInput');
  if (startDateInput) {
    startDateInput.addEventListener('change', function() {
      updateFilterUrl({ startDate: startDateInput.value });
      renderEventState();
      void loadEvents();
    });
  }
  const endDateInput = document.getElementById('endDateInput');
  if (endDateInput) {
    endDateInput.addEventListener('change', function() {
      updateFilterUrl({ endDate: endDateInput.value });
      renderEventState();
      void loadEvents();
    });
  }

  const clearFiltersButton = document.getElementById('clearFilters');
  if (clearFiltersButton) {
    clearFiltersButton.addEventListener('click', function() {
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      updateFilterUrl({ category: 'ALL', q: '', startDate: '', endDate: '' });
      renderEventState();
      void loadEvents();
    });
  }

  const exportButtons = document.querySelectorAll('[data-export-format]');
  for (let i = 0; i < exportButtons.length; i++) {
    exportButtons[i].addEventListener('click', function() {
      void exportEvents(this.dataset.exportFormat || 'json');
    });
  }

  window.addEventListener('popstate', function() {
    syncFiltersFromUrl();
    renderEventState();
    void loadEvents();
  });

}

async function exportEvents(format) {
  const buttons = document.querySelectorAll('[data-export-format]');
  const status = document.getElementById('exportStatus');
  for (let i = 0; i < buttons.length; i++) buttons[i].disabled = true;
  if (status) status.textContent = t('exporting');

  try {
    const params = new URLSearchParams(eventFilterQueryString());
    params.set('format', format === 'csv' ? 'csv' : 'json');
    const response = await fetch(API_BASE + '/export?' + params.toString(), {
      headers: { 'Accept': format === 'csv' ? 'text/csv' : 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'tibo-codex-events.' + (format === 'csv' ? 'csv' : 'json');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(function() { URL.revokeObjectURL(objectUrl); }, 1000);
    if (status) status.textContent = t('exportReady');
  } catch (err) {
    if (status) status.textContent = t('exportFailed');
    reportApiFailure('/export', err);
  } finally {
    for (let i = 0; i < buttons.length; i++) buttons[i].disabled = false;
  }
}

// --- API-backed modules ---
function reportApiFailure(path, error) {
  console.warn('[Tibo Monitor] API request failed: ' + path, error);
}

async function loadStatus() {
  try {
    const data = await fetchAPI('/status');
    renderStatusCards(data);
    renderResetCountdown();
    return data;
  } catch (err) {
    reportApiFailure('/status', err);
    return null;
  }
}

async function loadResetHistory() {
  const requestId = ++resetHistoryRequestId;
  try {
    const payload = await fetchAPI('/events?category=RESET_COMPLETED&limit=100');
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error('Invalid reset history response');
    }
    if (requestId !== resetHistoryRequestId) return null;
    resetHistoryEvents = payload.data;
    resetHistoryState = 'LOADED';
    renderResetCountdown();
    return payload;
  } catch (err) {
    if (requestId !== resetHistoryRequestId) return null;
    // Preserve the last successful reset-history snapshot when a refresh fails.
    resetHistoryState = 'ERROR';
    reportApiFailure('/events?category=RESET_COMPLETED&limit=100', err);
    renderResetCountdown();
    return null;
  }
}

async function loadEvents() {
  const requestId = ++eventsRequestId;
  try {
    const payload = await fetchAPI('/events?' + eventQueryString(50));
    if (!payload || !Array.isArray(payload.data)) {
      throw new Error('Invalid events response');
    }
    if (requestId !== eventsRequestId) return null;
    events = payload.data;
    eventsState = events.length > 0 ? 'LOADED_DATA' : 'LOADED_EMPTY';
    return payload;
  } catch (err) {
    if (requestId !== eventsRequestId) return null;
    // Keep already-rendered SSR/API data visible when a refresh fails. Only
    // show the error state when there is no usable event data at all.
    if (events.length === 0) {
      events = [];
      eventsState = 'ERROR';
    } else {
      eventsState = 'LOADED_DATA';
    }
    reportApiFailure('/events', err);
    return null;
  } finally {
    if (requestId === eventsRequestId) renderEventState();
  }
}

async function loadResetState() {
  try {
    resetStatus = await fetchAPI('/reset/current');
    return resetStatus;
  } catch (err) {
    // A failed refresh is not evidence that no reset exists. Keep an explicit
    // error state so the UI cannot turn a transient API failure into a false
    // "no reset scheduled" message.
    resetStatus = { status: 'ERROR' };
    reportApiFailure('/reset/current', err);
    return null;
  } finally {
    renderResetCountdown();
  }
}

async function loadData() {
  // Use SSR data if available to avoid replacing SSR content with loading state
  if (!ssrHydrated) {
    if (window.__SSR_EVENTS__ && Array.isArray(window.__SSR_EVENTS__) && window.__SSR_EVENTS__.length > 0) {
      events = window.__SSR_EVENTS__;
      eventsState = 'LOADED_DATA';
      renderAll();
      syncItemListStructuredData();

      // Update status cards from SSR data
      if (window.__SSR_LAST_RESET__ || window.__SSR_MANUAL_RESET__ || window.__SSR_LAST_POLICY__ || window.__SSR_LATEST_EVENT__) {
        var ssrStatus = {
          lastReset: window.__SSR_LAST_RESET__ || null,
          latestDirectReset: window.__SSR_LATEST_DIRECT_RESET__ || null,
          manualReset: window.__SSR_MANUAL_RESET__ || null,
          currentPolicy: window.__SSR_LAST_POLICY__ || null,
          latestEvent: window.__SSR_LATEST_EVENT__ || null,
          lastCheckedAt: window.__SSR_LAST_CHECKED__ || null,
          sourceLastNewPostAt: window.__SSR_SOURCE_LAST_NEW_POST__ || null,
          sourceMode: window.__SSR_SOURCE_MODE__ || null,
          checkedAccounts: Array.isArray(window.__SSR_ACCOUNTS__) && window.__SSR_ACCOUNTS__.length > 0
            ? window.__SSR_ACCOUNTS__
            : ['thsottiaux'],
        };
        renderStatusCards(ssrStatus);
      }
    } else {
      eventsState = 'LOADING';
      renderEventState();
    }
    ssrHydrated = true;
  }

  await Promise.allSettled([
    loadStatus(),
    loadEvents(),
    loadResetHistory(),
    loadResetState(),
  ]);
}

async function refreshDataOnce() {
  if (dataRefreshInFlight) return;
  dataRefreshInFlight = true;
  try {
    await loadData();
  } finally {
    dataRefreshInFlight = false;
  }
}

function stopDataRefresh() {
  if (dataRefreshTimer !== null) {
    window.clearTimeout(dataRefreshTimer);
    dataRefreshTimer = null;
  }
}

function scheduleDataRefresh() {
  stopDataRefresh();
  if (document.hidden) return;
  dataRefreshTimer = window.setTimeout(function() {
    dataRefreshTimer = null;
    refreshDataOnce().then(scheduleDataRefresh, scheduleDataRefresh);
  }, DATA_REFRESH_INTERVAL_MS);
}

function handleDataVisibilityChange() {
  if (document.hidden) {
    stopDataRefresh();
    return;
  }
  void refreshDataOnce();
  scheduleDataRefresh();
}

// --- Initialize ---
async function init() {
  if (initStarted) return;
  initStarted = true;

  try {
    lang = getInitialLanguage();
    syncFiltersFromUrl();
    bindStaticEvents();
    document.addEventListener('visibilitychange', handleDataVisibilityChange);
    applyLanguage();
    await loadData();
    scheduleDataRefresh();
  } catch (err) {
    console.error('[Tibo Monitor] Frontend initialization failed', err);
    eventsState = 'ERROR';
    renderEventState();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { void init(); }, { once: true });
} else {
  void init();
}
