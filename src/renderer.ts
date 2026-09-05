// ============================================================
// Tibo Codex Monitor - SEO SSR Renderer
// ============================================================
// Generates complete HTML pages with server-rendered content
// for search engines and non-JS clients.

import type { ManualResetReportPublic, MonitorEvent } from './types';
import type { GambitPublicArticle } from './open-gambit/types';
import type { CommunityEmbed, CommunityPageData, CommunityPostFilters, PublicCommunityPost } from './community/types';
import { EMPTY_COMMUNITY_FILTERS, communityFiltersQuery } from './community/filters';
import { COMMUNITY_TOPICS, COMMUNITY_TOPIC_LABELS, type CommunityTopic } from './community/topics';
import { languageLabel } from './community/translation';
import { SITE_HTML_LANG, SITE_LOCALES, localePath, type SiteLocale } from './i18n';
import { staticAssetUrl } from './assets';
import { isEventIndexEligible } from './utils/index-policy';
import { MODELYARD_BRAND, renderSharedFooter, renderSharedHeader, SITE_BRAND_COPY as SHARED_SITE_BRAND_COPY, PRIMARY_NAV_LABELS as SHARED_PRIMARY_NAV_LABELS } from './site-shell';
import {
  datePartsInTimeZone,
  displayTimeZoneForLanguage,
  formatDateShortForLocale,
  formatDateTimeForLocale,
  parseStoredUtc,
  DEFAULT_TIMEZONE_BY_LOCALE,
} from './utils/timezone';

// ── Constants ──

const SITE_URL = 'https://tibo.modelyard.dev';
const SITE_NAME = MODELYARD_BRAND;

export type LandingPageKey = 'latest' | 'reset-history' | 'rate-limit-updates' | 'faq' | 'methodology';

const LANDING_PAGE_PATHS: Record<LandingPageKey, string> = {
  latest: '/latest/',
  'reset-history': '/reset-history/',
  'rate-limit-updates': '/rate-limit-updates/',
  faq: '/faq/',
  methodology: '/methodology/',
};

const COMMUNITY_PATHS: Record<SiteLocale, string> = {
  en: '/community/',
  zh: '/zh/community/',
  ja: '/ja/community/',
  es: '/es/community/',
  fr: '/fr/community/',
};

const OPEN_GAMBIT_PATHS: Record<'en' | 'zh', string> = {
  en: '/open-gambit/',
  zh: '/zh/open-gambit/',
};

const AI_DISCLOSURE_PATHS: Record<'en' | 'zh', string> = {
  en: '/about/ai/',
  zh: '/zh/about/ai/',
};

const HOMEPAGE_COPY: Record<SiteLocale, { title: string; description: string }> = {
  en: {
    title: 'ModelYard · Tibo Codex Reset Tracker | Usage Limits & Policy Updates',
    description: 'ModelYard’s Tibo Codex Monitor tracks public OpenAI Codex usage-limit resets, ChatGPT Work limits, GPT/Codex rate-limit changes, and policy updates with source and verification status.',
  },
  zh: {
    title: 'ModelYard · Tibo Codex 重置追踪｜额度与政策更新',
    description: 'ModelYard 的 Tibo Codex 监控记录公开的 Codex 额度重置、ChatGPT Work 限额、GPT/Codex 限速与政策更新；每条记录附来源和验证状态。',
  },
  ja: {
    title: 'ModelYard · Tibo Codex リセット追跡 | 使用量制限とポリシー更新',
    description: 'ModelYard の Tibo Codex Monitor が公開された Codex のリセット、ChatGPT Work の使用量制限、GPT/Codex のレート制限とポリシー更新を、出典と確認状態付きで追跡します。',
  },
  es: {
    title: 'ModelYard · Rastreador de restablecimientos de Tibo Codex | Límites y políticas',
    description: 'El Monitor Tibo Codex de ModelYard sigue los restablecimientos públicos, los límites de ChatGPT Work y las actualizaciones de GPT/Codex con fuentes y estado de verificación.',
  },
  fr: {
    title: 'ModelYard · Suivi des réinitialisations Tibo Codex | Limites et politiques',
    description: 'Le Tibo Codex Monitor de ModelYard suit les réinitialisations publiques, les limites ChatGPT Work et les mises à jour GPT/Codex, avec leurs sources et leur état de vérification.',
  },
};

const SITE_BRAND_COPY = SHARED_SITE_BRAND_COPY;

const HOMEPAGE_UI_COPY: Record<SiteLocale, {
  account: string;
  accountDescription: string;
  unknownChecked: string;
  statusAnswerTitle: string;
  statusAnswerLead: string;
  lastConfirmedReset: string;
  lastRecordedReset: string;
  nextKnownReset: string;
  checkingLiveStatus: string;
  statusUnknown: string;
  viewResetHistory: string;
  viewLatestEvent: string;
  lastReset: string;
  currentPolicy: string;
  latestChange: string;
  lastChecked: string;
  sourceStatus: string;
  xDirect: string;
  webIndexed: string;
  noEvents: string;
  noRecentEvents: string;
  intro: string;
  source: string;
  resetReportTitle: string;
  resetReportBody: string;
  note: string;
  automatedReport: string;
  resetCountdown: string;
  noResetScheduled: string;
  historicalReference: string;
  latestEvent: string;
  timeline: string;
  all: string;
  resetPlanned: string;
  resetCompleted: string;
  timeChanged: string;
  policy: string;
  codexUpdate: string;
  roadmapHint: string;
  featureDiscussion: string;
  searchEvents: string;
  searchPlaceholder: string;
  from: string;
  to: string;
  clear: string;
  export: string;
  loading: string;
}> = {
  en: {
    account: 'Tibo (@thsottiaux)', accountDescription: 'Tibo (@thsottiaux)', unknownChecked: 'Unknown (no successful monitor run)', statusAnswerTitle: 'Current reset status', statusAnswerLead: 'See the latest known reset state first, then open an event for its source and verification details.', lastConfirmedReset: 'Last confirmed reset', lastRecordedReset: 'Last recorded reset', nextKnownReset: 'Next known reset', checkingLiveStatus: 'Checking live reset status…', statusUnknown: 'Unknown', viewResetHistory: 'View reset history', viewLatestEvent: 'View latest event', lastReset: 'Last Reset', currentPolicy: 'Latest Policy Change', latestChange: 'Latest Change', lastChecked: 'Last Checked', sourceStatus: 'Information Source', xDirect: 'X Direct', webIndexed: 'Web Indexed', noEvents: 'No events to display.', noRecentEvents: 'No recent events.', intro: 'ModelYard’s Tibo Codex Monitor tracks public OpenAI Codex AI coding-agent usage-limit resets, ChatGPT Work limits, GPT/Codex rate-limit changes, and subscription updates from Tibo (@thsottiaux); every event includes its source and status.', source: 'View source', resetReportTitle: 'Server reset report', resetReportBody: 'Server reported a usage reset. ', note: 'Note: ', automatedReport: 'Automated report.', resetCountdown: 'Reset Countdown', noResetScheduled: 'No reset currently scheduled.', historicalReference: 'Historical reference', latestEvent: 'Latest event', timeline: 'Timeline', all: 'All', resetPlanned: 'Reset Planned', resetCompleted: 'Reset Completed', timeChanged: 'Time Changed', policy: 'Policy', codexUpdate: 'Codex Update', roadmapHint: 'Roadmap Hint', featureDiscussion: 'Feature Discussion', searchEvents: 'Search events', searchPlaceholder: 'Search titles, summaries or source text', from: 'From', to: 'To', clear: 'Clear', export: 'Export', loading: 'Loading events...',
  },
  zh: {
    account: 'Tibo（@thsottiaux）', accountDescription: 'Tibo（@thsottiaux）', unknownChecked: '未知（尚无成功监控运行）', statusAnswerTitle: '当前重置状态', statusAnswerLead: '先查看已知的最新重置状态，再打开事件查看来源和验证详情。', lastConfirmedReset: '最近一次已确认重置', lastRecordedReset: '最近记录的重置', nextKnownReset: '下一次已知重置', checkingLiveStatus: '正在检查实时重置状态……', statusUnknown: '未知', viewResetHistory: '查看重置历史', viewLatestEvent: '查看最新事件', lastReset: '最近重置', currentPolicy: '最新政策变更', latestChange: '最新动态', lastChecked: '最近检查', sourceStatus: '信息源', xDirect: 'X 直接源', webIndexed: '网页索引', noEvents: '暂无事件。', noRecentEvents: '暂无最新事件。', intro: 'ModelYard 的 Tibo Codex 监控记录 Tibo（@thsottiaux）公开发布的 OpenAI Codex AI 编程代理额度重置、ChatGPT Work 限额、GPT/Codex 速率限制和订阅动态；每条事件都附来源和状态。', source: '查看来源', resetReportTitle: '服务器重置报告', resetReportBody: '服务器报告额度已重置。 ', note: '备注：', automatedReport: '系统自动报告。', resetCountdown: '重置倒计时', noResetScheduled: '目前没有已知的重置计划。', historicalReference: '历史参考', latestEvent: '最新事件', timeline: '时间线', all: '全部', resetPlanned: '计划重置', resetCompleted: '重置完成', timeChanged: '时间变更', policy: '政策', codexUpdate: 'Codex 产品更新', roadmapHint: '路线图线索', featureDiscussion: '功能讨论', searchEvents: '搜索事件', searchPlaceholder: '搜索标题、摘要或来源文本', from: '从', to: '至', clear: '清除', export: '导出', loading: '正在加载事件...',
  },
  ja: {
    account: 'Tibo（@thsottiaux）', accountDescription: 'Tibo（@thsottiaux）', unknownChecked: '不明（監視の成功した実行はまだありません）', statusAnswerTitle: '現在のリセット状態', statusAnswerLead: 'まず既知の最新リセット状態を確認し、イベントを開いて出典と確認の詳細をご覧ください。', lastConfirmedReset: '最後に確認されたリセット', lastRecordedReset: '最後に記録されたリセット', nextKnownReset: '次に予定されているリセット', checkingLiveStatus: 'リセットの状態を確認中…', statusUnknown: '不明', viewResetHistory: 'リセット履歴を見る', viewLatestEvent: '最新イベントを見る', lastReset: '最近のリセット', currentPolicy: '最新ポリシー変更', latestChange: '最新の更新', lastChecked: '最終確認', sourceStatus: '情報源', xDirect: 'X 直接ソース', webIndexed: 'ウェブ検索インデックス', noEvents: '表示できるイベントはありません。', noRecentEvents: '最近のイベントはありません。', intro: 'Tibo（@thsottiaux）が公開した OpenAI Codex の使用量リセット、ChatGPT Work の制限、GPT/Codex のレート制限、サブスクリプション更新を追跡します。各イベントに出典とステータスを表示します。', source: 'ソースを見る', resetReportTitle: 'サーバーのリセット報告', resetReportBody: 'サーバーが使用量のリセットを報告しました。', note: '注：', automatedReport: '自動報告です。', resetCountdown: 'リセットまでのカウントダウン', noResetScheduled: '現在予定されているリセットはありません。', historicalReference: '履歴の参考値', latestEvent: '最新イベント', timeline: 'タイムライン', all: 'すべて', resetPlanned: 'リセット予定', resetCompleted: 'リセット完了', timeChanged: '時刻変更', policy: 'ポリシー', codexUpdate: 'Codex 更新', roadmapHint: 'ロードマップのヒント', featureDiscussion: '機能ディスカッション', searchEvents: 'イベントを検索', searchPlaceholder: 'タイトル、概要、ソースを検索', from: '開始', to: '終了', clear: 'クリア', export: 'エクスポート', loading: 'イベントを読み込み中…',
  },
  es: {
    account: 'Tibo (@thsottiaux)', accountDescription: 'Tibo (@thsottiaux)', unknownChecked: 'Desconocido (aún no hay una ejecución correcta)', statusAnswerTitle: 'Estado actual del restablecimiento', statusAnswerLead: 'Consulta primero el estado conocido más reciente y abre un evento para ver su fuente y verificación.', lastConfirmedReset: 'Último restablecimiento confirmado', lastRecordedReset: 'Último restablecimiento registrado', nextKnownReset: 'Próximo restablecimiento conocido', checkingLiveStatus: 'Comprobando el estado del restablecimiento…', statusUnknown: 'Desconocido', viewResetHistory: 'Ver historial de restablecimientos', viewLatestEvent: 'Ver el último evento', lastReset: 'Último restablecimiento', currentPolicy: 'Último cambio de política', latestChange: 'Última actualización', lastChecked: 'Última comprobación', sourceStatus: 'Fuente de información', xDirect: 'X directo', webIndexed: 'Índice web', noEvents: 'No hay eventos que mostrar.', noRecentEvents: 'No hay eventos recientes.', intro: 'Seguimiento de los restablecimientos de uso de OpenAI Codex, límites de ChatGPT Work, cambios de límites GPT/Codex y actualizaciones de suscripción publicados por Tibo (@thsottiaux); cada evento incluye su fuente y estado.', source: 'Ver fuente', resetReportTitle: 'Informe de restablecimiento del servidor', resetReportBody: 'El servidor informó de un restablecimiento del uso. ', note: 'Nota: ', automatedReport: 'Informe automático.', resetCountdown: 'Cuenta atrás para el restablecimiento', noResetScheduled: 'No hay ningún restablecimiento programado.', historicalReference: 'Referencia histórica', latestEvent: 'Último evento', timeline: 'Línea temporal', all: 'Todos', resetPlanned: 'Restablecimiento previsto', resetCompleted: 'Restablecimiento completado', timeChanged: 'Hora modificada', policy: 'Política', codexUpdate: 'Actualización de Codex', roadmapHint: 'Pista de hoja de ruta', featureDiscussion: 'Debate de funciones', searchEvents: 'Buscar eventos', searchPlaceholder: 'Buscar títulos, resúmenes o texto de fuente', from: 'Desde', to: 'Hasta', clear: 'Limpiar', export: 'Exportar', loading: 'Cargando eventos…',
  },
  fr: {
    account: 'Tibo (@thsottiaux)', accountDescription: 'Tibo (@thsottiaux)', unknownChecked: 'Inconnu (aucune exécution réussie pour le moment)', statusAnswerTitle: 'État actuel de la réinitialisation', statusAnswerLead: 'Consultez d’abord le dernier état connu, puis ouvrez un événement pour voir sa source et sa vérification.', lastConfirmedReset: 'Dernière réinitialisation confirmée', lastRecordedReset: 'Dernière réinitialisation enregistrée', nextKnownReset: 'Prochaine réinitialisation connue', checkingLiveStatus: 'Vérification de l’état de la réinitialisation…', statusUnknown: 'Inconnu', viewResetHistory: 'Voir l’historique des réinitialisations', viewLatestEvent: 'Voir le dernier événement', lastReset: 'Dernière réinitialisation', currentPolicy: 'Dernier changement de politique', latestChange: 'Dernière mise à jour', lastChecked: 'Dernière vérification', sourceStatus: 'Source d’information', xDirect: 'X direct', webIndexed: 'Index web', noEvents: 'Aucun événement à afficher.', noRecentEvents: 'Aucun événement récent.', intro: 'Suivez les réinitialisations d’utilisation OpenAI Codex, les limites de ChatGPT Work, les changements de limites GPT/Codex et les mises à jour d’abonnement publiés par Tibo (@thsottiaux) ; chaque événement inclut sa source et son état.', source: 'Voir la source', resetReportTitle: 'Rapport de réinitialisation du serveur', resetReportBody: 'Le serveur a signalé une réinitialisation de l’utilisation. ', note: 'Note : ', automatedReport: 'Rapport automatique.', resetCountdown: 'Compte à rebours de la réinitialisation', noResetScheduled: 'Aucune réinitialisation n’est actuellement prévue.', historicalReference: 'Référence historique', latestEvent: 'Dernier événement', timeline: 'Chronologie', all: 'Tous', resetPlanned: 'Réinitialisation prévue', resetCompleted: 'Réinitialisation terminée', timeChanged: 'Heure modifiée', policy: 'Politique', codexUpdate: 'Mise à jour Codex', roadmapHint: 'Indice de feuille de route', featureDiscussion: 'Discussion de fonctionnalité', searchEvents: 'Rechercher des événements', searchPlaceholder: 'Rechercher des titres, résumés ou sources', from: 'Du', to: 'Au', clear: 'Effacer', export: 'Exporter', loading: 'Chargement des événements…',
  },
};

type LandingCopy = { title: string; description: string; lede: string };

const LANDING_COPY: Record<LandingPageKey, Record<SiteLocale, LandingCopy>> = {
  latest: {
    en: {
      title: 'Latest ModelYard Tibo Codex Reset & Usage Limit Updates',
      description: 'See the latest public Codex reset signals, ChatGPT Work limit changes, and policy updates tracked by ModelYard’s Tibo Codex Monitor, with dates and sources.',
      lede: 'Current reset status and recent Codex limit events, with dates, sources, and verification.',
    },
    zh: {
      title: 'ModelYard · Tibo Codex 最新重置与额度动态',
      description: '查看 ModelYard 的 Tibo Codex 监控记录的最新 Codex 重置信号、ChatGPT Work 限额变化和政策更新，包含日期与来源。',
      lede: '查看当前重置状态和最近的 Codex 额度事件，以及日期、来源和验证状态。',
    },
    ja: {
      title: 'ModelYard · Tibo Codex の最新リセット・使用量制限情報',
      description: 'ModelYard の Tibo Codex Monitor が追跡する Codex のリセット、ChatGPT Work の制限、ポリシー更新を日付と出典付きで確認できます。',
      lede: '現在のリセット状態と最近の Codex 制限イベントを、出典と確認状態付きで表示します。',
    },
    es: {
      title: 'ModelYard · Últimos restablecimientos y límites de Tibo Codex',
      description: 'Consulta las últimas señales de restablecimiento de Codex, cambios de límites de ChatGPT Work y políticas seguidos por el Monitor Tibo Codex de ModelYard, con fechas y fuentes.',
      lede: 'Estado actual de los restablecimientos y eventos recientes de límites de Codex, con fuentes y verificación.',
    },
    fr: {
      title: 'ModelYard · Dernières réinitialisations et limites Tibo Codex',
      description: 'Consultez les derniers signaux de réinitialisation Codex, changements de limites ChatGPT Work et mises à jour de politique suivis par le Tibo Codex Monitor de ModelYard, avec dates et sources.',
      lede: 'État actuel des réinitialisations et événements récents de limites Codex, avec sources et vérification.',
    },
  },
  'reset-history': {
    en: {
      title: 'OpenAI Codex Usage Reset History',
      description: 'A chronological record of public OpenAI Codex and ChatGPT Work usage-limit reset events.',
      lede: 'A timeline of publicly reported AI usage reset events.',
    },
    zh: {
      title: 'OpenAI Codex 与 ChatGPT 重置历史',
      description: '按时间整理公开发布的 OpenAI Codex、ChatGPT Work 使用额度重置事件。',
      lede: '按时间记录公开发布的 AI 使用额度重置事件。',
    },
    ja: {
      title: 'OpenAI Codex と ChatGPT のリセット履歴',
      description: '公開された OpenAI Codex と ChatGPT Work の使用量リセットイベントを時系列でまとめています。',
      lede: '公開された AI 使用量リセットイベントのタイムライン。',
    },
    es: {
      title: 'Historial de restablecimientos de OpenAI Codex y ChatGPT',
      description: 'Registro cronológico de los restablecimientos públicos del límite de uso de OpenAI Codex y ChatGPT Work.',
      lede: 'Una línea temporal de restablecimientos públicos de uso de IA.',
    },
    fr: {
      title: 'Historique des réinitialisations OpenAI Codex et ChatGPT',
      description: 'Historique chronologique des réinitialisations publiques des limites d’utilisation d’OpenAI Codex et ChatGPT Work.',
      lede: 'Une chronologie des réinitialisations publiques d’utilisation IA.',
    },
  },
  'rate-limit-updates': {
    en: {
      title: 'OpenAI Codex Rate Limits & ChatGPT Policy Updates',
      description: 'Public OpenAI Codex rate-limit, GPT/Codex usage-limit, reset-time, and ChatGPT subscription policy updates.',
      lede: 'Public updates about AI coding limits, reset times, and subscription policy.',
    },
    zh: {
      title: 'OpenAI Codex、GPT 与 ChatGPT 限额更新',
      description: 'OpenAI Codex 速率限制、GPT/Codex 使用额度、重置时间和 ChatGPT 订阅政策的公开更新。',
      lede: 'AI 编程工具的限额、重置时间和订阅政策公开动态。',
    },
    ja: {
      title: 'OpenAI Codex・GPT・ChatGPT の制限更新',
      description: 'OpenAI Codex のレート制限、GPT/Codex の使用量、リセット時刻、ChatGPT サブスクリプションポリシーの公開更新。',
      lede: 'AI コーディングツールの制限、リセット時刻、ポリシーに関する公開情報。',
    },
    es: {
      title: 'Límites de OpenAI Codex y actualizaciones de ChatGPT',
      description: 'Actualizaciones públicas sobre límites GPT/Codex, horarios de restablecimiento y políticas de suscripción de ChatGPT.',
      lede: 'Actualizaciones públicas sobre límites de herramientas de IA, restablecimientos y suscripciones.',
    },
    fr: {
      title: 'Limites OpenAI Codex et mises à jour ChatGPT',
      description: 'Mises à jour publiques des limites GPT/Codex, horaires de réinitialisation et politiques d’abonnement ChatGPT.',
      lede: 'Informations publiques sur les limites des outils IA, les réinitialisations et les abonnements.',
    },
  },
  faq: {
    en: {
      title: 'OpenAI Codex, ChatGPT & GPT Usage Limits FAQ',
      description: 'Answers about OpenAI Codex usage resets, ChatGPT Work limits, GPT/Codex policies, sources, and verification.',
      lede: 'Answers about this AI usage-limit monitor and its sources.',
    },
    zh: {
      title: 'OpenAI Codex、ChatGPT 与 GPT 使用额度常见问题',
      description: '了解 OpenAI Codex 额度重置、ChatGPT Work 限额、GPT/Codex 政策、来源和验证状态。',
      lede: '快速了解这个 AI 使用额度监控及其来源。',
    },
    ja: {
      title: 'OpenAI Codex・ChatGPT・GPT の使用量とリセット FAQ',
      description: 'OpenAI Codex の使用量リセット、ChatGPT Work の制限、GPT/Codex の出典と検証についてのよくある質問。',
      lede: 'この AI 使用量モニターと情報源についての回答。',
    },
    es: {
      title: 'Preguntas frecuentes sobre límites de OpenAI Codex, ChatGPT y GPT',
      description: 'Respuestas sobre restablecimientos de uso de OpenAI Codex, límites de ChatGPT Work, políticas GPT/Codex, fuentes y verificación.',
      lede: 'Respuestas sobre este monitor de uso de IA y sus fuentes.',
    },
    fr: {
      title: 'FAQ sur les limites OpenAI Codex, ChatGPT et GPT',
      description: 'Réponses sur les réinitialisations OpenAI Codex, les limites ChatGPT Work, les politiques GPT/Codex, les sources et la vérification.',
      lede: 'Réponses sur ce moniteur d’utilisation IA et ses sources.',
    },
  },
  methodology: {
    en: {
      title: 'OpenAI Codex Usage Monitor Methodology',
      description: 'How this independent monitor collects and verifies public OpenAI Codex, ChatGPT Work, and GPT/Codex usage-limit events.',
      lede: 'How the AI usage monitor collects, labels, and verifies public events.',
    },
    zh: {
      title: 'OpenAI Codex 使用额度监控方法论',
      description: '说明这个独立监控站如何收集和验证 OpenAI Codex、ChatGPT Work 与 GPT/Codex 使用额度事件。',
      lede: '说明 AI 使用额度监控如何收集、标注和验证公开事件。',
    },
    ja: {
      title: 'OpenAI Codex 使用量モニターの方法論',
      description: 'この独立モニターが OpenAI Codex、ChatGPT Work、GPT/Codex の使用量制限イベントを収集・検証する方法。',
      lede: 'AI 使用量モニターが公開イベントを収集、分類、検証する方法。',
    },
    es: {
      title: 'Metodología del monitor de uso de OpenAI Codex',
      description: 'Cómo este monitor independiente recopila y verifica eventos públicos de uso y límites de OpenAI Codex, ChatGPT Work y GPT/Codex.',
      lede: 'Cómo el monitor de uso de IA recopila, etiqueta y verifica eventos públicos.',
    },
    fr: {
      title: 'Méthodologie du moniteur d’utilisation OpenAI Codex',
      description: 'Comment ce moniteur indépendant collecte et vérifie les événements publics d’utilisation et de limites OpenAI Codex, ChatGPT Work et GPT/Codex.',
      lede: 'Comment le moniteur d’utilisation IA collecte, étiquette et vérifie les événements publics.',
    },
  },
};

const CATEGORY_LABELS_EN: Record<string, string> = {
  RESET_PLANNED: 'Reset Planned',
  RESET_COMPLETED: 'Reset Completed',
  RESET_TIME_CHANGED: 'Time Changed',
  POLICY_CHANGE: 'Policy Change',
  CODEX_UPDATE: 'Codex Update',
  ROADMAP_HINT: 'Roadmap Hint',
  FEATURE_DISCUSSION: 'Feature Discussion',
};

const CATEGORY_LABELS_ZH: Record<string, string> = {
  RESET_PLANNED: '计划重置',
  RESET_COMPLETED: '重置完成',
  RESET_TIME_CHANGED: '时间变更',
  POLICY_CHANGE: '政策变更',
  CODEX_UPDATE: 'Codex 产品更新',
  ROADMAP_HINT: '路线图线索',
  FEATURE_DISCUSSION: '功能讨论',
};

const CATEGORY_LABELS: Record<SiteLocale, Record<string, string>> = {
  en: CATEGORY_LABELS_EN,
  zh: CATEGORY_LABELS_ZH,
  ja: { RESET_PLANNED: 'リセット予定', RESET_COMPLETED: 'リセット完了', RESET_TIME_CHANGED: '時刻変更', POLICY_CHANGE: 'ポリシー変更', CODEX_UPDATE: 'Codex 更新', ROADMAP_HINT: 'ロードマップのヒント', FEATURE_DISCUSSION: '機能ディスカッション' },
  es: { RESET_PLANNED: 'Restablecimiento previsto', RESET_COMPLETED: 'Restablecimiento completado', RESET_TIME_CHANGED: 'Hora modificada', POLICY_CHANGE: 'Cambio de política', CODEX_UPDATE: 'Actualización de Codex', ROADMAP_HINT: 'Pista de hoja de ruta', FEATURE_DISCUSSION: 'Debate de funciones' },
  fr: { RESET_PLANNED: 'Réinitialisation prévue', RESET_COMPLETED: 'Réinitialisation terminée', RESET_TIME_CHANGED: 'Heure modifiée', POLICY_CHANGE: 'Changement de politique', CODEX_UPDATE: 'Mise à jour Codex', ROADMAP_HINT: 'Indice de feuille de route', FEATURE_DISCUSSION: 'Discussion de fonctionnalité' },
};

export interface SiteIntegrations {
  /** Canonical first-party origin for this deployment, including staging. */
  siteUrl?: string;
  /** Public GA4 web-stream Measurement ID for this site only. */
  googleAnalyticsId?: string;
  /** Public Search Console HTML-tag verification token for this site only. */
  googleSiteVerification?: string;
}

// ── Helpers ──

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// JSON is embedded in executable <script> blocks below. Escape characters
// that could terminate the block when source content contains </script>.
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function analyticsPageType(meta: SeoMeta): string {
  if (meta.eventId !== null) return 'event_detail';
  if (meta.isHomepage) return 'home';
  if (!meta.canonical) return 'not_found';

  const path = new URL(meta.canonical).pathname;
  if (path.includes('/latest/')) return 'latest';
  if (path.includes('/reset-history/')) return 'reset_history';
  if (path.includes('/rate-limit-updates/')) return 'rate_limit_updates';
  if (path.includes('/faq/')) return 'faq';
  if (path.includes('/methodology/')) return 'methodology';
  if (path.includes('/community/')) return 'community';
  return 'page';
}

function renderGoogleAnalytics(
  analyticsId: string | undefined,
  context: { pageLanguage: SiteLocale; pageType: string; pageTitle: string; pagePath: string },
): string {
  const id = analyticsId?.trim() || '';
  if (!/^G-[A-Z0-9]+$/i.test(id)) return '';
  const escapedId = escapeHtml(id);
  const pageContext = safeJsonForScript({
    page_language: context.pageLanguage,
    page_type: context.pageType,
    content_group: context.pageType,
    page_path: context.pagePath,
    // Keep the standard GA4 Page title dimension stable across SEO copy
    // experiments. The actual SEO title remains available as seo_title.
    page_title: SITE_NAME + ' | ' + context.pageType,
    seo_title: context.pageTitle,
  });
  return [
    '  <!-- Google tag (gtag.js) — ModelYard Tibo Codex Monitor property only -->',
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=' + escapedId + '"></script>',
    '  <script>',
    '    window.dataLayer = window.dataLayer || [];',
    '    function gtag(){dataLayer.push(arguments);}',
    "    gtag('js', new Date());",
    "    gtag('config', '" + escapedId + "', " + pageContext + ");",
    '  </script>',
  ].join('\n');
}

function renderGoogleSiteVerification(token: string | undefined): string {
  const value = token?.trim() || '';
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return '';
  return '  <meta name="google-site-verification" content="' + escapeHtml(value) + '">';
}

function formatDateForLanguage(iso: string | null | undefined, lang: SiteLocale): string {
  return formatDateTimeForLocale(iso, lang);
}

function formatDateShort(iso: string | null | undefined, lang: SiteLocale = 'en'): string {
  return formatDateShortForLocale(iso, lang);
}

function truncateMetaDescription(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 160) return normalized;
  return normalized.slice(0, 157).trimEnd() + '...';
}

function isOfficialEvent(event: MonitorEvent): boolean {
  return event.verification_status === 'OFFICIAL_VERIFIED'
    || event.source_quality === 'OFFICIAL'
    || event.evidence_quality === 'OFFICIAL';
}

function isIndexedEvent(event: MonitorEvent): boolean {
  return event.verification_status === 'INDEXED_ONLY'
    || event.source_quality === 'INDEXED'
    || event.evidence_quality === 'INDEXED';
}

function sourceQualityClass(event: MonitorEvent): 'indexed' | 'direct' | 'official' {
  return isOfficialEvent(event) ? 'official' : isIndexedEvent(event) ? 'indexed' : 'direct';
}

function analyticsEvidenceSource(event: MonitorEvent): 'official' | 'web_indexed' | 'x_direct' | 'unknown' {
  if (isOfficialEvent(event)) return 'official';
  if (isIndexedEvent(event)) return 'web_indexed';
  if (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT') return 'x_direct';
  return 'unknown';
}

/** SSR and hydration use the same fixed timezone selected by the page language. */
function localTimeElement(
  iso: string | null | undefined,
  fallback: string,
  className: string,
  format: 'date' | 'datetime' = 'datetime',
): string {
  if (!iso) return escapeHtml(fallback);
  return '<time class="' + escapeHtml(className) + ' local-time" datetime="' + escapeHtml(iso)
    + '" data-local-time="' + escapeHtml(iso) + '" data-local-format="' + format + '">' + escapeHtml(fallback) + '</time>';
}

function formatManualResetTime(iso: string | null | undefined, lang: SiteLocale): string {
  return formatDateTimeForLocale(iso, lang);
}

function fixedTimezoneTimeElement(
  iso: string | null | undefined,
  lang: SiteLocale,
  className: string,
): string {
  const fallback = formatManualResetTime(iso, lang);
  if (!iso) return escapeHtml(fallback);
  return '<time class="' + escapeHtml(className) + ' local-time" datetime="' + escapeHtml(iso)
    + '" data-local-time="' + escapeHtml(iso) + '" data-local-format="datetime">' + escapeHtml(fallback) + '</time>';
}

function getCategoryLabel(category: string, lang: SiteLocale): string {
  return CATEGORY_LABELS[lang][category] || category;
}

function getSourceQualityLabel(event: MonitorEvent, lang: SiteLocale): string {
  if (isOfficialEvent(event)) return lang === 'zh' ? '官方来源' : lang === 'ja' ? '公式ソース' : lang === 'es' ? 'Fuente oficial' : lang === 'fr' ? 'Source officielle' : 'Official source';
  if (isIndexedEvent(event)) return lang === 'zh' ? '网页搜索索引' : lang === 'ja' ? 'ウェブ検索インデックス' : lang === 'es' ? 'Índice de búsqueda web' : lang === 'fr' ? 'Index de recherche web' : 'Web Search Index';
  if (event.source_quality === 'DIRECT' || event.evidence_quality === 'DIRECT') {
    return lang === 'zh' ? 'X API 直接来源' : lang === 'ja' ? 'X API 直接ソース' : lang === 'es' ? 'API directa de X' : lang === 'fr' ? 'API X directe' : 'Direct X API';
  }
  return lang === 'zh' ? '来源类型未知' : lang === 'ja' ? '不明なソース種別' : lang === 'es' ? 'Tipo de fuente desconocido' : lang === 'fr' ? 'Type de source inconnu' : 'Unknown source type';
}

function getVerificationLabel(event: MonitorEvent, lang: SiteLocale): string {
  if (event.verification_status === 'OFFICIAL_VERIFIED') return lang === 'zh' ? '已官方验证' : lang === 'ja' ? '公式確認済み' : lang === 'es' ? 'Verificado oficialmente' : lang === 'fr' ? 'Vérifié officiellement' : 'Officially verified';
  if (event.verification_status === 'INDEXED_ONLY') return lang === 'zh' ? '等待直接来源验证' : lang === 'ja' ? '直接ソースの確認待ち' : lang === 'es' ? 'Pendiente de verificación directa' : lang === 'fr' ? 'En attente de vérification directe' : 'Awaiting direct source verification';
  if (event.verification_status === 'DIRECT_VERIFIED') return lang === 'zh' ? '已直接验证' : lang === 'ja' ? '直接確認済み' : lang === 'es' ? 'Verificado directamente' : lang === 'fr' ? 'Vérifié directement' : 'Directly verified';
  return lang === 'zh' ? '待验证' : lang === 'ja' ? '確認待ち' : lang === 'es' ? 'Pendiente de verificación' : lang === 'fr' ? 'En attente de vérification' : 'Pending verification';
}

function getVerificationStatusCode(event: MonitorEvent): string {
  return event.verification_status || 'PENDING';
}

function getTopicPath(category: string, lang: SiteLocale): string {
  if (category === 'POLICY_CHANGE' || category === 'RESET_TIME_CHANGED') {
    return getLandingPath('rate-limit-updates', lang);
  }
  if (category === 'RESET_PLANNED' || category === 'RESET_COMPLETED') {
    return getLandingPath('reset-history', lang);
  }
  return getLandingPath('latest', lang);
}

function getTopicLabel(category: string, lang: SiteLocale): string {
  if (category === 'POLICY_CHANGE' || category === 'RESET_TIME_CHANGED') {
    return lang === 'zh' ? '限额更新' : 'Rate limit updates';
  }
  if (category === 'RESET_PLANNED' || category === 'RESET_COMPLETED') {
    return lang === 'zh' ? '重置历史' : 'Reset history';
  }
  return lang === 'zh' ? '最新动态' : 'Latest updates';
}

function getEventUrl(id: number, lang: SiteLocale): string {
  return localePath('/events/' + id, lang);
}

function getCanonicalUrl(id: number | null, lang: SiteLocale): string {
  if (id === null) {
    return SITE_URL + localePath('/', lang);
  }
  return SITE_URL + getEventUrl(id, lang);
}

function getHomePath(lang: SiteLocale): string {
  return localePath('/', lang);
}

function getCommunityPath(lang: SiteLocale): string {
  return COMMUNITY_PATHS[lang];
}

function getCommunityUrl(lang: SiteLocale, siteUrl = SITE_URL): string {
  return siteUrl + getCommunityPath(lang);
}

function getLandingUrl(page: LandingPageKey, lang: SiteLocale, siteUrl = SITE_URL): string {
  const path = LANDING_PAGE_PATHS[page];
  return siteUrl + localePath(path, lang);
}

function getLandingPath(page: LandingPageKey, lang: SiteLocale): string {
  const path = LANDING_PAGE_PATHS[page];
  return localePath(path, lang);
}

function localizedPaths(path: string): Record<SiteLocale, string> {
  return Object.fromEntries(SITE_LOCALES.map(locale => [locale, localePath(path, locale)])) as Record<SiteLocale, string>;
}

// ── Hreflang helpers ──

function hreflangTags(paths: Partial<Record<SiteLocale, string>> = {}): string {
  const enPath = paths.en;
  if (!enPath) return '';
  const tags = SITE_LOCALES
    .filter(locale => paths[locale])
    .map(locale => '<link rel="alternate" hreflang="' + (locale === 'zh' ? 'zh-CN' : locale) + '" href="' + SITE_URL + paths[locale] + '" />');
  tags.push('<link rel="alternate" hreflang="x-default" href="' + SITE_URL + enPath + '" />');
  return tags.join('\n');
}

// ── JSON-LD helpers ──

function websiteSchema(lang: SiteLocale, description?: string): string {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': MODELYARD_BRAND,
    'url': getCanonicalUrl(null, lang),
    'inLanguage': SITE_HTML_LANG[lang],
  };
  // Only add a description when the caller passes the same text that is
  // visibly rendered on the page. This avoids turning a meta-only sentence
  // into structured-data content that readers cannot see.
  if (description) schema.description = description;
  return safeJsonForScript(schema);
}

function itemListSchema(events: MonitorEvent[], lang: SiteLocale): string {
  const items = events.map((e, i) => ({
    '@type': 'ListItem',
    'position': i + 1,
    'url': SITE_URL + getEventUrl(e.id!, lang),
    'name': eventTitle(e, lang),
  }));
  return safeJsonForScript({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    'name': lang === 'zh' ? '最近事件' : lang === 'ja' ? '最近のイベント' : lang === 'es' ? 'Eventos recientes' : lang === 'fr' ? 'Événements récents' : 'Recent Events',
    'itemListElement': items,
  });
}

function breadcrumbSchema(items: { name: string; url: string }[]): string {
  const list = items.map((item, i) => ({
    '@type': 'ListItem',
    'position': i + 1,
    'name': item.name,
    'item': item.url.startsWith('http') ? item.url : SITE_URL + item.url,
  }));
  return safeJsonForScript({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    'itemListElement': list,
  });
}

function articleSchema(event: MonitorEvent, lang: SiteLocale, canonical: string): string {
  const headline = eventPageHeadline(event, lang);
  const description = eventSummary(event, lang);
  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': canonical + '#article',
    'headline': headline,
    'description': description,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': canonical },
    'url': canonical,
    'articleSection': getCategoryLabel(event.category, lang),
    'inLanguage': SITE_HTML_LANG[lang],
  };
  if (event.published_at) article.datePublished = event.published_at;
  if (event.updated_at) article.dateModified = event.updated_at;
  // The source URL is a real, visible evidence link. Author and publisher are
  // intentionally omitted because this monitor does not store an independent
  // editorial author or publisher identity for each event.
  if (event.source_url) article.isBasedOn = event.source_url;
  return safeJsonForScript(article);
}

// ── HTML Template ──

interface SeoMeta {
  lang: SiteLocale;
  title: string;
  description: string;
  canonical?: string | null;
  isHomepage: boolean;
  eventId: number | null;
  enPath?: string;
  zhPath?: string;
  alternatePaths?: Partial<Record<SiteLocale, string>>;
  ogImage?: string;
  robots?: string;
  structuredData?: string[];
  ogType?: 'website' | 'article';
  publishedAt?: string | null;
  modifiedAt?: string | null;
}

interface HomepageData {
  events: MonitorEvent[];
  latestEvent: MonitorEvent | null;
  lastReset: MonitorEvent | null;
  latestDirectReset?: MonitorEvent | null;
  manualReset?: ManualResetReportPublic | null;
  lastPolicy: MonitorEvent | null;
  lastCheckedAt: string | null;
  sourceLastFetchedAt?: string | null;
  sourceLastNewPostAt?: string | null;
  sourceMode?: 'x_direct' | 'web_indexed' | null;
  totalEvents: number;
  accounts?: string[];
  gambitArticles?: GambitPublicArticle[];
}

interface EventPageData {
  event: MonitorEvent;
  prevEvent: MonitorEvent | null;
  nextEvent: MonitorEvent | null;
  relatedEvents: MonitorEvent[];
}

type CommunityCopy = Record<string, string>;

const COMMUNITY_COPY: Record<SiteLocale, CommunityCopy> = {
  en: {
    title: 'ModelYard Community',
    description: 'A lightweight, multilingual developer community from ModelYard for sharing short notes, links, and GitHub repositories.',
    lede: 'Short notes and useful links from the ModelYard community.',
    breadcrumb: 'ModelYard Community',
    composerTitle: 'Leave a message',
    nickname: 'Nickname',
    content: 'Content',
    topic: 'Topic',
    allTopics: 'All topics',
    topicGeneral: 'General',
    nicknamePlaceholder: 'Your nickname',
    contentPlaceholder: 'Share a short note, link, or GitHub repository…',
    contentHint: 'Plain text, links, inline code, and code blocks are supported.',
    post: 'Post',
    postingDisabled: 'Posting is temporarily unavailable.',
    feedTitle: 'Community feed',
    noPosts: 'No posts yet.',
    firstPost: 'Be the first to leave a message.',
    noMatchingPosts: 'No posts match these filters.',
    search: 'Search',
    searchPlaceholder: 'Search messages, links, or nicknames',
    searchButton: 'Search feed',
    clearFilters: 'Clear filters',
    allPosts: 'All posts',
    featuredPosts: 'Featured',
    githubPosts: 'GitHub repos',
    showing: 'Showing',
    filteredResults: 'Filtered results',
    pinned: 'Pinned',
    featured: 'Featured',
    announcement: 'Announcement',
    verifiedAdmin: 'Verified administrator',
    aiAccount: 'Automated account',
    translatedFrom: 'Translated from',
    showOriginal: 'Show original',
    hideOriginal: 'Hide original',
    original: 'Original',
    loadMore: 'Load more',
    loading: 'Loading…',
    unableToLoad: 'Unable to load the community right now.',
    unableToPost: 'Unable to post right now. Please try again later.',
    securityCheck: 'Please complete the security check before posting.',
    privacyNote: 'To prevent abuse, the server keeps a one-way source hash with a server secret and does not retain the raw IP. Please do not post secrets or sensitive personal information.',
  },
  zh: {
    title: 'ModelYard 社区',
    description: 'ModelYard 的一个轻量、跨语言开发者社区，用于分享短消息、链接和 GitHub 仓库。',
    lede: '来自 ModelYard 社区的短消息和有用链接。',
    breadcrumb: 'ModelYard 社区',
    composerTitle: '留下消息',
    nickname: '昵称',
    content: '内容',
    topic: '主题',
    allTopics: '全部主题',
    topicGeneral: '综合',
    nicknamePlaceholder: '你的昵称',
    contentPlaceholder: '分享短消息、链接或 GitHub 仓库……',
    contentHint: '支持纯文本、链接、行内代码和代码块。',
    post: '发布',
    postingDisabled: '暂时停止发布留言。',
    feedTitle: '社区动态',
    noPosts: '暂时还没有留言。',
    firstPost: '来留下第一条消息吧。',
    noMatchingPosts: '没有符合这些筛选条件的留言。',
    search: '搜索',
    searchPlaceholder: '搜索留言、链接或昵称',
    searchButton: '搜索动态',
    clearFilters: '清除筛选',
    allPosts: '全部留言',
    featuredPosts: '精选',
    githubPosts: 'GitHub 仓库',
    showing: '显示',
    filteredResults: '筛选结果',
    pinned: '置顶',
    featured: '精选',
    announcement: '公告',
    verifiedAdmin: '已认证管理员',
    aiAccount: '自动账号',
    translatedFrom: '译自',
    showOriginal: '显示原文',
    hideOriginal: '收起原文',
    original: '原文',
    loadMore: '加载更多',
    loading: '加载中……',
    unableToLoad: '暂时无法加载社区内容。',
    unableToPost: '暂时无法发布留言，请稍后再试。',
    securityCheck: '请完成安全验证后再发布。',
    privacyNote: '为防止滥用，服务器仅保留带服务端密钥的单向来源哈希，不保存原始 IP。请勿发布密钥或敏感个人信息。',
  },
  ja: {
    title: 'ModelYard コミュニティ',
    description: '短いメモ、リンク、GitHub リポジトリを共有できる、ModelYard の軽量な多言語開発者コミュニティ。',
    lede: 'ModelYard コミュニティの短いメモと役立つリンク。',
    breadcrumb: 'ModelYard コミュニティ',
    composerTitle: 'メッセージを残す',
    nickname: 'ニックネーム',
    content: '内容',
    topic: 'トピック',
    allTopics: 'すべてのトピック',
    topicGeneral: '一般',
    nicknamePlaceholder: 'ニックネーム',
    contentPlaceholder: '短いメモ、リンク、GitHub リポジトリを共有…',
    contentHint: 'プレーンテキスト、リンク、インラインコード、コードブロックに対応しています。',
    post: '投稿',
    postingDisabled: '現在、投稿を一時停止しています。',
    feedTitle: 'コミュニティフィード',
    noPosts: 'まだ投稿はありません。',
    firstPost: '最初のメッセージを投稿しましょう。',
    noMatchingPosts: '条件に一致する投稿はありません。',
    search: '検索',
    searchPlaceholder: 'メッセージ、リンク、ニックネームを検索',
    searchButton: 'フィードを検索',
    clearFilters: 'フィルターをクリア',
    allPosts: 'すべての投稿',
    featuredPosts: 'おすすめ',
    githubPosts: 'GitHub リポジトリ',
    showing: '表示中',
    filteredResults: '絞り込み結果',
    pinned: 'ピン留め',
    featured: 'おすすめ',
    announcement: 'お知らせ',
    verifiedAdmin: '認証済み管理者',
    aiAccount: '自動アカウント',
    translatedFrom: '翻訳元',
    showOriginal: '原文を表示',
    hideOriginal: '原文を隠す',
    original: '原文',
    loadMore: 'さらに読み込む',
    loading: '読み込み中…',
    unableToLoad: 'コミュニティを読み込めません。',
    unableToPost: '投稿できません。しばらくしてからお試しください。',
    securityCheck: '投稿前にセキュリティチェックを完了してください。',
    privacyNote: '不正利用防止のため、サーバーは秘密鍵付きの一方向ソースハッシュのみ保持し、元の IP は保存しません。秘密情報や個人情報を投稿しないでください。',
  },
  es: {
    title: 'Comunidad de ModelYard',
    description: 'Una comunidad de desarrolladores ligera y multilingüe de ModelYard para compartir notas breves, enlaces y repositorios de GitHub.',
    lede: 'Notas breves y enlaces útiles de la comunidad de ModelYard.',
    breadcrumb: 'Comunidad de ModelYard',
    composerTitle: 'Deja un mensaje',
    nickname: 'Apodo',
    content: 'Contenido',
    topic: 'Tema',
    allTopics: 'Todos los temas',
    topicGeneral: 'General',
    nicknamePlaceholder: 'Tu apodo',
    contentPlaceholder: 'Comparte una nota breve, un enlace o un repositorio de GitHub…',
    contentHint: 'Se admiten texto plano, enlaces, código en línea y bloques de código.',
    post: 'Publicar',
    postingDisabled: 'La publicación no está disponible temporalmente.',
    feedTitle: 'Actividad de la comunidad',
    noPosts: 'Aún no hay publicaciones.',
    firstPost: 'Sé la primera persona en dejar un mensaje.',
    noMatchingPosts: 'No hay publicaciones que coincidan con estos filtros.',
    search: 'Buscar',
    searchPlaceholder: 'Buscar mensajes, enlaces o apodos',
    searchButton: 'Buscar en el feed',
    clearFilters: 'Borrar filtros',
    allPosts: 'Todas las publicaciones',
    featuredPosts: 'Destacadas',
    githubPosts: 'Repositorios de GitHub',
    showing: 'Mostrando',
    filteredResults: 'Resultados filtrados',
    pinned: 'Fijada',
    featured: 'Destacada',
    announcement: 'Anuncio',
    verifiedAdmin: 'Administrador verificado',
    aiAccount: 'Cuenta automatizada',
    translatedFrom: 'Traducido del',
    showOriginal: 'Mostrar original',
    hideOriginal: 'Ocultar original',
    original: 'Original',
    loadMore: 'Cargar más',
    loading: 'Cargando…',
    unableToLoad: 'No se puede cargar la comunidad ahora.',
    unableToPost: 'No se puede publicar ahora. Inténtalo de nuevo más tarde.',
    securityCheck: 'Completa la comprobación de seguridad antes de publicar.',
    privacyNote: 'Para evitar abusos, el servidor conserva un hash unidireccional de la fuente con un secreto y no guarda la IP original. No publiques claves ni información personal sensible.',
  },
  fr: {
    title: 'Communauté ModelYard',
    description: 'Une communauté de développeurs légère et multilingue de ModelYard pour partager de courtes notes, des liens et des dépôts GitHub.',
    lede: 'Notes courtes et liens utiles de la communauté ModelYard.',
    breadcrumb: 'Communauté ModelYard',
    composerTitle: 'Laisser un message',
    nickname: 'Pseudo',
    content: 'Contenu',
    topic: 'Sujet',
    allTopics: 'Tous les sujets',
    topicGeneral: 'Général',
    nicknamePlaceholder: 'Votre pseudo',
    contentPlaceholder: 'Partagez une courte note, un lien ou un dépôt GitHub…',
    contentHint: 'Le texte brut, les liens, le code en ligne et les blocs de code sont pris en charge.',
    post: 'Publier',
    postingDisabled: 'La publication est temporairement indisponible.',
    feedTitle: 'Fil de la communauté',
    noPosts: 'Aucune publication pour le moment.',
    firstPost: 'Soyez la première personne à laisser un message.',
    noMatchingPosts: 'Aucune publication ne correspond à ces filtres.',
    search: 'Rechercher',
    searchPlaceholder: 'Rechercher des messages, liens ou pseudos',
    searchButton: 'Rechercher dans le fil',
    clearFilters: 'Effacer les filtres',
    allPosts: 'Toutes les publications',
    featuredPosts: 'À la une',
    githubPosts: 'Dépôts GitHub',
    showing: 'Affichage',
    filteredResults: 'Résultats filtrés',
    pinned: 'Épinglée',
    featured: 'À la une',
    announcement: 'Annonce',
    verifiedAdmin: 'Administrateur vérifié',
    aiAccount: 'Compte automatisé',
    translatedFrom: 'Traduit du',
    showOriginal: 'Afficher l’original',
    hideOriginal: 'Masquer l’original',
    original: 'Original',
    loadMore: 'Charger plus',
    loading: 'Chargement…',
    unableToLoad: 'La communauté est momentanément indisponible.',
    unableToPost: 'Publication impossible pour le moment. Réessayez plus tard.',
    securityCheck: 'Terminez le contrôle de sécurité avant de publier.',
    privacyNote: 'Pour prévenir les abus, le serveur conserve un hash à sens unique de la source avec un secret et ne garde pas l’adresse IP brute. Ne publiez pas de clés ni d’informations personnelles sensibles.',
  },
};

const COMMUNITY_LANGUAGE_LABELS: Record<SiteLocale, Record<string, string>> = {
  en: {
    en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', fr: 'French', de: 'German',
    es: 'Spanish', pt: 'Portuguese', it: 'Italian', ru: 'Russian', ar: 'Arabic', und: 'unknown language',
  },
  zh: {
    en: '英语', zh: '中文', ja: '日文', ko: '韩文', fr: '法文', de: '德文',
    es: '西班牙文', pt: '葡萄牙文', it: '意大利文', ru: '俄文', ar: '阿拉伯文', und: '未知语言',
  },
  ja: {
    en: '英語', zh: '中国語', ja: '日本語', ko: '韓国語', fr: 'フランス語', de: 'ドイツ語',
    es: 'スペイン語', pt: 'ポルトガル語', it: 'イタリア語', ru: 'ロシア語', ar: 'アラビア語', und: '不明な言語',
  },
  es: {
    en: 'inglés', zh: 'chino', ja: 'japonés', ko: 'coreano', fr: 'francés', de: 'alemán',
    es: 'español', pt: 'portugués', it: 'italiano', ru: 'ruso', ar: 'árabe', und: 'idioma desconocido',
  },
  fr: {
    en: 'anglais', zh: 'chinois', ja: 'japonais', ko: 'coréen', fr: 'français', de: 'allemand',
    es: 'espagnol', pt: 'portugais', it: 'italien', ru: 'russe', ar: 'arabe', und: 'langue inconnue',
  },
};

function communityLanguageLabel(language: string, lang: SiteLocale): string {
  return COMMUNITY_LANGUAGE_LABELS[lang][language] || (lang === 'zh' ? language : languageLabel(language));
}

function communityTopicLabel(topic: CommunityTopic, lang: SiteLocale): string {
  return COMMUNITY_TOPIC_LABELS[topic][lang];
}

function renderCommunityVerifiedBadge(lang: SiteLocale): string {
  const label = COMMUNITY_COPY[lang].verifiedAdmin;
  return '<span class="community-verified-badge" role="img" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9" fill="currentColor"></circle><path d="m5.8 10.1 2.7 2.7 5.8-6" fill="none" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg></span>';
}

// A subtle, non-aggressive marker for first-party automation accounts. The goal
// is transparency (readers can tell the post is automated) rather than warning
// them away from the content, so it reuses the pill badge style at low contrast.
function renderCommunityAiBadge(lang: SiteLocale): string {
  const label = COMMUNITY_COPY[lang].aiAccount;
  return '<span class="community-ai-badge" role="img" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">AI</span>';
}

function renderCommunityTopicOptions(lang: SiteLocale, selected: CommunityTopic | null, includeAll = true): string {
  const copy = COMMUNITY_COPY[lang];
  const all = includeAll
    ? '<option value=""' + (selected === null ? ' selected' : '') + '>' + escapeHtml(copy.allTopics) + '</option>'
    : '';
  return all + COMMUNITY_TOPICS.map(topic => '<option value="' + topic + '"' + (selected === topic ? ' selected' : '') + '>' + escapeHtml(communityTopicLabel(topic, lang)) + '</option>').join('');
}

function communityFilterHref(lang: SiteLocale, filters: CommunityPostFilters, mode: 'all' | 'featured' | 'github'): string {
  const next: CommunityPostFilters = {
    ...filters,
    featuredOnly: mode === 'featured',
    githubOnly: mode === 'github',
  };
  const query = communityFiltersQuery(next);
  return getCommunityPath(lang) + (query ? '?' + query : '');
}

function hasCommunityFilters(filters: CommunityPostFilters): boolean {
  return Boolean(filters.query || filters.topic || filters.featuredOnly || filters.githubOnly);
}

function renderCommunityFilters(filters: CommunityPostFilters, lang: SiteLocale): string {
  const copy = COMMUNITY_COPY[lang];
  const action = getCommunityPath(lang);
  return [
    '<form id="communityFeedFilters" class="community-feed-filters" method="get" action="' + action + '">',
    '  <div class="community-filter-search">',
    '    <label for="communitySearch">' + escapeHtml(copy.search) + '</label>',
    '    <div class="community-search-control">',
    '      <input id="communitySearch" name="q" type="search" maxlength="80" value="' + escapeHtml(filters.query || '') + '" placeholder="' + escapeHtml(copy.searchPlaceholder) + '">',
    '      <button class="secondary-btn" type="submit">' + escapeHtml(copy.searchButton) + '</button>',
    '    </div>',
    '  </div>',
    '  <div class="community-filter-topic">',
    '    <label for="communityTopicFilter">' + escapeHtml(copy.topic) + '</label>',
    '    <select id="communityTopicFilter" name="topic">' + renderCommunityTopicOptions(lang, filters.topic) + '</select>',
    '  </div>',
    filters.featuredOnly ? '  <input type="hidden" name="featured" value="1">' : '',
    filters.githubOnly ? '  <input type="hidden" name="github" value="1">' : '',
    hasCommunityFilters(filters) ? '  <a class="community-clear-filters" href="' + communityFilterHref(lang, EMPTY_COMMUNITY_FILTERS, 'all') + '">' + escapeHtml(copy.clearFilters) + '</a>' : '',
    '</form>',
    '<nav class="community-feed-modes" aria-label="' + escapeHtml(lang === 'zh' ? '动态筛选' : lang === 'ja' ? 'フィードの絞り込み' : lang === 'es' ? 'Filtros del feed' : lang === 'fr' ? 'Filtres du fil' : 'Feed filters') + '">',
    '  <a class="community-filter-mode' + (!filters.featuredOnly && !filters.githubOnly ? ' active' : '') + '" data-mode="all" href="' + communityFilterHref(lang, filters, 'all') + '">' + escapeHtml(copy.allPosts) + '</a>',
    '  <a class="community-filter-mode' + (filters.featuredOnly ? ' active' : '') + '" data-mode="featured" href="' + communityFilterHref(lang, filters, 'featured') + '">' + escapeHtml(copy.featuredPosts) + '</a>',
    '  <a class="community-filter-mode' + (filters.githubOnly ? ' active' : '') + '" data-mode="github" href="' + communityFilterHref(lang, filters, 'github') + '">' + escapeHtml(copy.githubPosts) + '</a>',
    '</nav>',
  ].filter(line => line !== '').join('\n');
}

function communityResultsLabel(total: number, filters: CommunityPostFilters, lang: SiteLocale): string {
  const copy = COMMUNITY_COPY[lang];
  const count = lang === 'zh'
    ? ' ' + total + ' 条'
    : lang === 'ja'
      ? ' ' + total + ' 件'
      : lang === 'es'
        ? ' ' + total + ' publicación' + (total === 1 ? '' : 'es')
        : lang === 'fr'
          ? ' ' + total + ' publication' + (total === 1 ? '' : 's')
          : ' ' + total + ' post' + (total === 1 ? '' : 's');
  return (hasCommunityFilters(filters) ? copy.filteredResults : copy.showing) + count;
}

function safeCommunityHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeCommunityImageHref(value: string): string | null {
  const href = safeCommunityHref(value);
  if (!href) return null;
  try {
    return new URL(href).hostname.toLowerCase() === 'avatars.githubusercontent.com' ? href : null;
  } catch {
    return null;
  }
}

function trimCommunityUrl(value: string): { url: string; suffix: string } {
  let url = value;
  let suffix = '';
  while (/[.,!?;:]$/u.test(url) || /[\])}]$/u.test(url)) {
    suffix = url.slice(-1) + suffix;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function renderCommunityPlainText(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

/** Render the deliberately small, safe Community formatting subset. */
function renderCommunityText(value: string, lang: SiteLocale = 'en'): string {
  const tokenPattern = /```[\s\S]*?```|`(?:\\.|[^`])*`|https?:\/\/[^\s<>"'`]+/giu;
  const chunks: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) chunks.push(renderCommunityPlainText(value.slice(cursor, start)));
    const token = match[0];
    if (token.startsWith('```')) {
      let code = token.slice(3, -3);
      if (code.startsWith('\n')) code = code.slice(1);
      chunks.push('<pre class="community-code"><code>' + escapeHtml(code) + '</code></pre>');
    } else if (token.startsWith('`')) {
      chunks.push('<code class="community-inline-code">' + escapeHtml(token.slice(1, -1)) + '</code>');
    } else {
      const trimmed = trimCommunityUrl(token);
      const href = safeCommunityHref(trimmed.url);
      const externalLinkLabel = lang === 'zh'
        ? '打开外部链接'
        : lang === 'ja'
          ? '外部リンクを開く'
          : lang === 'es'
            ? 'Abrir enlace externo'
            : lang === 'fr'
              ? 'Ouvrir le lien externe'
              : 'Open external link';
      chunks.push(href
        ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHtml(externalLinkLabel) + '">' + escapeHtml(trimmed.url) + '</a>' + renderCommunityPlainText(trimmed.suffix)
        : renderCommunityPlainText(token));
    }
    cursor = start + token.length;
  }
  if (cursor < value.length) chunks.push(renderCommunityPlainText(value.slice(cursor)));
  return chunks.join('');
}

function communityRelativeTimeFallback(iso: string, lang: SiteLocale): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return formatDateForLanguage(iso, lang);
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (lang === 'zh') {
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
    if (seconds < 2592000) return Math.floor(seconds / 86400) + ' 天前';
    return formatDateForLanguage(iso, lang);
  }
  if (lang === 'ja') {
    if (seconds < 60) return 'たった今';
    if (seconds < 3600) return Math.floor(seconds / 60) + '分前';
    if (seconds < 86400) return Math.floor(seconds / 3600) + '時間前';
    if (seconds < 2592000) return Math.floor(seconds / 86400) + '日前';
    return formatDateForLanguage(iso, lang);
  }
  if (lang === 'es') {
    if (seconds < 60) return 'ahora mismo';
    if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + ' min';
    if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + ' h';
    if (seconds < 2592000) return 'hace ' + Math.floor(seconds / 86400) + ' días';
    return formatDateForLanguage(iso, lang);
  }
  if (lang === 'fr') {
    if (seconds < 60) return 'à l’instant';
    if (seconds < 3600) return 'il y a ' + Math.floor(seconds / 60) + ' min';
    if (seconds < 86400) return 'il y a ' + Math.floor(seconds / 3600) + ' h';
    if (seconds < 2592000) return 'il y a ' + Math.floor(seconds / 86400) + ' jour' + (Math.floor(seconds / 86400) === 1 ? '' : 's');
    return formatDateForLanguage(iso, lang);
  }
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + ' days ago';
  return formatDateForLanguage(iso, lang);
}

function renderCommunityTime(iso: string, lang: SiteLocale): string {
  const fallback = communityRelativeTimeFallback(iso, lang);
  const absolute = formatDateForLanguage(iso, lang);
  return '<time class="community-time" datetime="' + escapeHtml(iso) + '" data-community-time="' + escapeHtml(iso) + '" title="' + escapeHtml(absolute) + '">' + escapeHtml(fallback) + '</time>';
}

function renderCommunityEmbed(embed: CommunityEmbed, lang: SiteLocale): string {
  const metadata = embed.metadata;
  const href = safeCommunityHref(embed.canonicalUrl);
  if (!metadata || !href) return '';
  const copy = lang === 'zh'
    ? { github: 'GitHub', repo: 'GitHub 仓库', stars: '星标', forks: '复刻', language: '语言', license: '许可证' }
    : lang === 'ja'
      ? { github: 'GitHub', repo: 'GitHub リポジトリ', stars: 'スター', forks: 'フォーク', language: '言語', license: 'ライセンス' }
      : lang === 'es'
        ? { github: 'GitHub', repo: 'Repositorio de GitHub', stars: 'Estrellas', forks: 'Forks', language: 'Lenguaje', license: 'Licencia' }
        : lang === 'fr'
          ? { github: 'GitHub', repo: 'Dépôt GitHub', stars: 'Étoiles', forks: 'Forks', language: 'Langage', license: 'Licence' }
          : { github: 'GitHub', repo: 'GitHub repository', stars: 'Stars', forks: 'Forks', language: 'Language', license: 'License' };
  const facts = [
    metadata.language ? '<span><b>' + escapeHtml(copy.language) + '</b> ' + escapeHtml(metadata.language) + '</span>' : '',
    metadata.stars !== null ? '<span><b>' + escapeHtml(copy.stars) + '</b> ' + metadata.stars.toLocaleString('en-US') + '</span>' : '',
    metadata.forks !== null ? '<span><b>' + escapeHtml(copy.forks) + '</b> ' + metadata.forks.toLocaleString('en-US') + '</span>' : '',
    metadata.license ? '<span><b>' + escapeHtml(copy.license) + '</b> ' + escapeHtml(metadata.license) + '</span>' : '',
  ].filter(Boolean).join('');
  const imageHref = embed.imageUrl ? safeCommunityImageHref(embed.imageUrl) : null;
  const image = imageHref
    ? '<img class="community-repo-avatar" src="' + escapeHtml(imageHref) + '" alt="" loading="lazy">'
    : '';
  return [
    '<article class="community-repo-card">',
    '  <a class="community-repo-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">',
    '    <div class="community-repo-provider">' + image + '<span>' + copy.github + '</span></div>',
    '    <h3>' + escapeHtml(metadata.owner) + ' / ' + escapeHtml(metadata.repo) + '</h3>',
    embed.description ? '    <p>' + escapeHtml(embed.description) + '</p>' : '',
    facts ? '    <div class="community-repo-facts" aria-label="' + escapeHtml(copy.repo) + '">' + facts + '</div>' : '',
    '    <span class="community-repo-url">github.com/' + escapeHtml(metadata.owner) + '/' + escapeHtml(metadata.repo) + ' ↗</span>',
    '  </a>',
    '</article>',
  ].filter(Boolean).join('\n');
}

function renderCommunityPost(post: PublicCommunityPost, lang: SiteLocale): string {
  const isZh = lang === 'zh';
  const copy = COMMUNITY_COPY[lang];
  const topic = COMMUNITY_TOPIC_LABELS[post.topic] ? post.topic : 'general';
  const translated = post.translations?.[lang]
    || (isZh ? post.contentZh : lang === 'en' ? post.contentEn : null);
  const displayed = translated || post.originalContent;
  const isTranslated = displayed !== post.originalContent;
  const originalId = 'community-original-' + post.id;
  const embeds = post.embeds.map(embed => renderCommunityEmbed(embed, lang)).filter(Boolean).join('\n');
  return [
    '<li class="community-post" data-post-id="' + post.id + '">',
    '  <article>',
    '    <div class="community-post-badges">',
    '      <span class="community-topic-badge">' + escapeHtml(communityTopicLabel(topic, lang)) + '</span>',
    post.isPinned ? '      <span class="community-post-badge pinned">' + escapeHtml(copy.pinned) + '</span>' : '',
    post.isFeatured ? '      <span class="community-post-badge featured">' + escapeHtml(copy.featured) + '</span>' : '',
    post.isAnnouncement ? '      <span class="community-post-badge announcement">' + escapeHtml(copy.announcement) + '</span>' : '',
    '    </div>',
    '    <header class="community-post-header">',
    '      <span class="community-post-nickname">' + escapeHtml(post.nickname) + '</span>' + (post.authorRole === 'admin' ? renderCommunityVerifiedBadge(lang) : '') + (post.authorType === 'agent' ? renderCommunityAiBadge(lang) : ''),
    '      <span class="community-post-meta-separator">·</span>',
    '      ' + renderCommunityTime(post.createdAt, lang),
    isTranslated ? '      <span class="community-post-meta-separator">·</span><span class="community-post-translation">' + escapeHtml(copy.translatedFrom + (isZh || lang === 'ja' ? '' : ' ') + communityLanguageLabel(post.originalLanguage, lang)) + '</span>' : '',
    '    </header>',
    '    <div class="community-post-content">' + renderCommunityText(displayed, lang) + '</div>',
    embeds ? '    <div class="community-post-embeds">' + embeds + '</div>' : '',
    isTranslated ? [
      '    <button type="button" class="community-original-toggle" data-original-toggle aria-expanded="false" aria-controls="' + originalId + '">' + escapeHtml(copy.showOriginal) + '</button>',
      '    <div id="' + originalId + '" class="community-original" hidden>',
      '      <div class="community-original-label">' + escapeHtml(copy.original) + ' · ' + escapeHtml(communityLanguageLabel(post.originalLanguage, lang)) + '</div>',
      '      <div class="community-post-content">' + renderCommunityText(post.originalContent, lang) + '</div>',
      '    </div>',
    ].join('\n') : '',
    '  </article>',
    '</li>',
  ].filter(Boolean).join('\n');
}

function communityClientPost(post: PublicCommunityPost): Record<string, unknown> {
  // Keep the browser payload explicit. A future repository field such as a
  // source hash must not become public merely because the TypeScript shape is
  // widened or a caller passes an object with extra runtime properties.
  return {
    id: post.id,
    nickname: post.nickname,
    authorRole: post.authorRole,
    isAnnouncement: post.isAnnouncement,
    originalContent: post.originalContent,
    originalLanguage: post.originalLanguage,
    contentEn: post.contentEn,
    contentZh: post.contentZh,
    translations: post.translations,
    translationStatus: post.translationStatus,
    translatedAt: post.translatedAt,
    status: post.status,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    topic: post.topic,
    isPinned: post.isPinned,
    isFeatured: post.isFeatured,
    authorType: post.authorType,
    agentId: post.agentId,
    embeds: post.embeds.map(embed => ({
      id: embed.id,
      postId: embed.postId,
      type: embed.type,
      provider: embed.provider,
      canonicalUrl: embed.canonicalUrl,
      description: embed.description,
      imageUrl: embed.imageUrl,
      metadata: embed.metadata,
    })),
  };
}

function renderHead(meta: SeoMeta, integrations?: SiteIntegrations): string {
  const isZh = meta.lang === 'zh';
  const brandCopy = SITE_BRAND_COPY[meta.lang];
  const ogImage = meta.ogImage || SITE_URL + staticAssetUrl('og-default.png');
  const langAttr = SITE_HTML_LANG[meta.lang];
  const canonical = meta.canonical || null;
  const jsonLd = meta.structuredData || (canonical ? [websiteSchema(meta.lang)] : []);

  return [
    '<!DOCTYPE html>',
    '<html lang="' + langAttr + '">',
    '<head>',
    '  <meta charset="UTF-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>' + escapeHtml(meta.title) + '</title>',
    '  <meta name="description" content="' + escapeHtml(meta.description) + '">',
    renderGoogleSiteVerification(integrations?.googleSiteVerification),
    renderGoogleAnalytics(integrations?.googleAnalyticsId, {
      pageLanguage: meta.lang,
      pageType: analyticsPageType(meta),
      pageTitle: meta.title,
      pagePath: canonical ? new URL(canonical).pathname : '/',
    }),
    canonical ? '  <link rel="canonical" href="' + escapeHtml(canonical) + '">' : '',
    '  <meta name="robots" content="' + escapeHtml(meta.robots || 'index, follow') + '">',
    '',
    '  <!-- Open Graph -->',
    '  <meta property="og:type" content="' + (meta.ogType || (meta.isHomepage ? 'website' : 'article')) + '">',
    '  <meta property="og:title" content="' + escapeHtml(meta.title) + '">',
    '  <meta property="og:description" content="' + escapeHtml(meta.description) + '">',
    canonical ? '  <meta property="og:url" content="' + escapeHtml(canonical) + '">' : '',
    '  <meta property="og:image" content="' + escapeHtml(ogImage) + '">',
    '  <meta property="og:image:width" content="1200">',
    '  <meta property="og:image:height" content="630">',
    '  <meta property="og:site_name" content="' + escapeHtml(MODELYARD_BRAND) + '">',
    '  <meta property="og:locale" content="' + (meta.lang === 'zh' ? 'zh_CN' : meta.lang === 'ja' ? 'ja_JP' : meta.lang === 'es' ? 'es_ES' : meta.lang === 'fr' ? 'fr_FR' : 'en_US') + '">',
    '',
    '  <!-- Twitter Card -->',
    '  <meta name="twitter:card" content="summary_large_image">',
    '  <meta name="twitter:title" content="' + escapeHtml(meta.title) + '">',
    '  <meta name="twitter:description" content="' + escapeHtml(meta.description) + '">',
    '  <meta name="twitter:image" content="' + escapeHtml(ogImage) + '">',
    '  <meta name="twitter:image:alt" content="' + escapeHtml(brandCopy.monitor) + '">',
    meta.publishedAt ? '  <meta property="article:published_time" content="' + escapeHtml(meta.publishedAt) + '">' : '',
    meta.modifiedAt ? '  <meta property="article:modified_time" content="' + escapeHtml(meta.modifiedAt) + '">' : '',
    '',
    '  <!-- Hreflang -->',
    hreflangTags(meta.alternatePaths || { en: meta.enPath, zh: meta.zhPath }),
    '',
    '  <!-- Structured Data -->',
    jsonLd.map(schema => '  <script type="application/ld+json">\n' + schema + '\n  </script>').join('\n'),
    '',
    '  <script>window.__TIBO_LOCALE_TIMEZONES__ = ' + safeJsonForScript(DEFAULT_TIMEZONE_BY_LOCALE) + ';</script>',
    '  <link rel="stylesheet" href="' + staticAssetUrl('style.css') + '">',
    '  <link rel="preconnect" href="https://fonts.googleapis.com">',
    '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">',
    '  <link rel="icon" type="image/svg+xml" href="' + staticAssetUrl('favicon.svg') + '">',
    '  <link rel="alternate icon" href="' + staticAssetUrl('favicon.ico') + '">',
    '  <link rel="alternate" type="application/rss+xml" title="' + escapeHtml(brandCopy.rssTitle) + '" href="' + SITE_URL + '/feed.xml">',
    '  <script src="' + staticAssetUrl('locale-time.js') + '" defer></script>',
    '  <script src="' + staticAssetUrl('local-time.js') + '" defer></script>',
    '  <script src="' + staticAssetUrl('analytics.js') + '" defer></script>',
    '</head>',
  ].join('\n');
}

function normalizeSiteUrl(value?: string): string {
  const candidate = value?.trim();
  if (!candidate) return SITE_URL;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return SITE_URL;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return SITE_URL;
    return parsed.origin;
  } catch {
    return SITE_URL;
  }
}

function renderSiteDocument(meta: SeoMeta, body: string, integrations?: SiteIntegrations): string {
  const html = renderHead(meta, integrations) + '\n' + body;
  const siteUrl = normalizeSiteUrl(integrations?.siteUrl);
  return siteUrl === SITE_URL ? html : html.replaceAll(SITE_URL, siteUrl);
}

const PRIMARY_NAV_LABELS = SHARED_PRIMARY_NAV_LABELS;

function renderSiteHeader(
  lang: SiteLocale,
  options: { accounts?: string[]; interactive?: boolean; alternatePath?: string | null } = {},
): string {
  return renderSharedHeader(lang, options);
}

function renderSiteFooter(lang: SiteLocale): string {
  return renderSharedFooter(lang);
}

interface LandingPageData {
  page: LandingPageKey;
  events: MonitorEvent[];
  latestEvent?: MonitorEvent | null;
  lastCheckedAt?: string | null;
  sourceLastFetchedAt?: string | null;
}

function eventTitle(event: MonitorEvent, lang: SiteLocale): string {
  if (lang === 'zh') return event.title_zh || event.title_en;
  if (lang === 'en') return event.title_en || event.title_zh;
  const translation = event.translations?.[lang];
  return translation?.status === 'translated' && translation.title
    ? translation.title
    : (event.title_en || event.title_zh);
}

function eventProductLabel(event: MonitorEvent, lang: SiteLocale): string {
  const text = [event.title_en, event.title_zh, event.summary_en, event.summary_zh]
    .filter(Boolean)
    .join(' ');
  const hasCodex = /\bcodex\b/i.test(text);
  const hasChatGptWork = /\bchatgpt\s*work\b/i.test(text);
  const hasChatGpt = /\bchatgpt\b/i.test(text);
  const conjunction = lang === 'zh' ? ' 与 ' : lang === 'ja' ? ' と ' : lang === 'es' ? ' y ' : lang === 'fr' ? ' et ' : ' and ';
  if (hasCodex && hasChatGptWork) return 'Codex' + conjunction + 'ChatGPT Work';
  if (hasCodex) return 'Codex';
  if (hasChatGptWork) return 'ChatGPT Work';
  if (hasChatGpt) return 'ChatGPT';
  return '';
}

function formatEventDateWithYear(iso: string | null | undefined, lang: SiteLocale): string {
  if (!iso) return '';
  const date = parseStoredUtc(iso);
  if (!date) return '';
  return new Intl.DateTimeFormat(SITE_HTML_LANG[lang], {
    timeZone: displayTimeZoneForLanguage(lang),
    year: 'numeric',
    month: lang === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
  }).format(date);
}

/** Add product context and a calendar date to event-page search snippets. */
function eventPageHeadline(event: MonitorEvent, lang: SiteLocale): string {
  let title = eventTitle(event, lang).trim();
  const product = eventProductLabel(event, lang);
  if (product && !/(?:codex|chatgpt)/i.test(title)) {
    if (product === 'Codex' && lang === 'en' && /\breset\b/i.test(title)) {
      title = title.replace(/\breset\b/i, 'Codex reset');
    } else if (product === 'Codex' && lang === 'zh' && title.includes('重置')) {
      title = title.replace('重置', 'Codex 重置');
    } else {
      const separator = lang === 'zh' ? '：' : ': ';
      title = product + separator + title;
    }
  }
  const date = formatEventDateWithYear(event.published_at, lang);
  if (date && !/(?:20\d{2}|20\d{2}年)/u.test(title)) title += ' · ' + date;
  return title;
}

function eventPageDescription(event: MonitorEvent, lang: SiteLocale): string {
  const summary = eventSummary(event, lang).trim();
  const date = formatEventDateWithYear(event.published_at, lang);
  const verification = getVerificationLabel(event, lang);
  const suffix = lang === 'zh'
    ? [date ? '发布时间：' + date + '。' : '', '验证：' + verification + '。']
    : lang === 'ja'
      ? [date ? '公開日：' + date + '。' : '', '確認：' + verification + '。']
      : lang === 'es'
        ? [date ? 'Publicado: ' + date + '.' : '', 'Verificación: ' + verification + '.']
        : lang === 'fr'
          ? [date ? 'Publié le ' + date + '.' : '', 'Vérification : ' + verification + '.']
          : [date ? 'Published ' + date + '.' : '', 'Verification: ' + verification + '.'];
  return truncateMetaDescription([summary, ...suffix].filter(Boolean).join(' '));
}

function eventInterpretation(event: MonitorEvent, lang: SiteLocale): string {
  const copy = {
    en: {
      planned: 'This is a public reset plan or signal; it does not mean usage has reset unless the source and verification status explicitly say so.',
      completed: 'The source indicates that a reset occurred; use the verification status and original source to judge the evidence strength.',
      changed: 'The source indicates that a known reset time changed; the page keeps the source and recorded times separate.',
      policy: 'This is a public limit, rate-limit, or subscription-policy change, not a statement about an individual account balance.',
      roadmap: 'This is a future-facing product signal, not a shipped feature or confirmed reset.',
      discussion: 'This is a public discussion and should not be read as confirmation of a product change.',
      fallback: 'The page is classified from the linked public source; review the original source and verification status.',
    },
    zh: {
      planned: '这是公开来源中的重置计划或线索；除非验证状态和来源明确说明完成，否则不代表额度已经重置。',
      completed: '来源表示重置已经发生；请结合验证状态和原始来源判断证据强度。',
      changed: '来源表示已知的重置时间发生变化；页面会分别显示原始来源和记录时间。',
      policy: '这是限额、速率或订阅政策相关的公开变更，不等同于个人账户额度。',
      roadmap: '这是面向未来的产品线索，不是已发布功能或已确认重置。',
      discussion: '这是公开讨论内容，不应解读为产品变更已经确认。',
      fallback: '页面内容根据链接的公开来源分类；请查看原始来源和验证状态。',
    },
    ja: {
      planned: '公開ソースに基づくリセット予定またはシグナルです。ソースと確認状態が明確に完了を示さない限り、使用量がリセットされたことを意味しません。',
      completed: 'ソースはリセットが発生したことを示しています。確認状態と原文ソースから証拠の強さを確認してください。',
      changed: '既知のリセット時刻が変更されたことを示すソースです。原文の時刻と記録された時刻は分けて表示しています。',
      policy: '使用量、レート制限、またはサブスクリプションポリシーに関する公開変更であり、個別アカウントの残量を示すものではありません。',
      roadmap: '将来の製品に関するシグナルであり、提供済み機能や確認済みリセットを示すものではありません。',
      discussion: '公開された議論であり、製品変更の確定情報として解釈しないでください。',
      fallback: 'リンク先の公開ソースに基づく分類です。原文ソースと確認状態をご確認ください。',
    },
    es: {
      planned: 'Es un plan o indicio público de restablecimiento; no significa que el uso se haya restablecido salvo que la fuente y el estado de verificación lo indiquen explícitamente.',
      completed: 'La fuente indica que se produjo un restablecimiento; consulta el estado de verificación y la fuente original para valorar la evidencia.',
      changed: 'La fuente indica que cambió una hora de restablecimiento conocida; la página mantiene separadas la fuente y la hora registrada.',
      policy: 'Es un cambio público de límites, límites de velocidad o políticas de suscripción; no describe el saldo de una cuenta individual.',
      roadmap: 'Es una señal de producto orientada al futuro, no una función publicada ni un restablecimiento confirmado.',
      discussion: 'Es un debate público y no debe interpretarse como confirmación de un cambio de producto.',
      fallback: 'La página se clasifica a partir de la fuente pública enlazada; revisa la fuente original y el estado de verificación.',
    },
    fr: {
      planned: 'Il s’agit d’un projet ou d’un indice public de réinitialisation ; cela ne signifie pas que l’utilisation a été réinitialisée, sauf si la source et l’état de vérification l’indiquent explicitement.',
      completed: 'La source indique qu’une réinitialisation a eu lieu ; consultez l’état de vérification et la source originale pour évaluer la solidité des preuves.',
      changed: 'La source indique qu’une heure de réinitialisation connue a changé ; la page sépare la source et l’heure enregistrée.',
      policy: 'Il s’agit d’une modification publique des limites, du débit ou d’une politique d’abonnement, et non du solde d’un compte individuel.',
      roadmap: 'Il s’agit d’un signal produit à venir, et non d’une fonctionnalité publiée ou d’une réinitialisation confirmée.',
      discussion: 'Il s’agit d’une discussion publique qui ne doit pas être interprétée comme la confirmation d’un changement produit.',
      fallback: 'La page est classée à partir de la source publique liée ; consultez la source originale et l’état de vérification.',
    },
  }[lang];
  switch (event.category) {
    case 'RESET_PLANNED':
      return copy.planned;
    case 'RESET_COMPLETED':
      return copy.completed;
    case 'RESET_TIME_CHANGED':
      return copy.changed;
    case 'POLICY_CHANGE':
      return copy.policy;
    case 'ROADMAP_HINT':
      return copy.roadmap;
    case 'FEATURE_DISCUSSION':
      return copy.discussion;
    default:
      return copy.fallback;
  }
}

function renderEventAnswerPanel(event: MonitorEvent, lang: SiteLocale, summary: string): string {
  const copy = {
    en: { kicker: 'Answer first', title: 'At a glance', products: 'Products', eventType: 'Event type', evidence: 'Evidence status', published: 'Published', effective: 'Effective', reset: 'Reset time', source: 'Open original source', timeline: 'View related timeline' },
    zh: { kicker: '先看结论', title: '核心事实', products: '涉及产品', eventType: '事件类型', evidence: '验证状态', published: '发布时间', effective: '生效时间', reset: '重置时间', source: '打开原始来源', timeline: '查看相关时间线' },
    ja: { kicker: 'まず結論', title: '主要な事実', products: '対象製品', eventType: 'イベント種別', evidence: '確認状態', published: '公開日', effective: '適用日時', reset: 'リセット日時', source: '原文ソースを開く', timeline: '関連タイムラインを見る' },
    es: { kicker: 'Resumen primero', title: 'Datos clave', products: 'Productos', eventType: 'Tipo de evento', evidence: 'Estado de verificación', published: 'Publicado', effective: 'Vigente', reset: 'Hora del restablecimiento', source: 'Abrir fuente original', timeline: 'Ver línea temporal relacionada' },
    fr: { kicker: 'L’essentiel', title: 'Faits principaux', products: 'Produits', eventType: 'Type d’événement', evidence: 'État des preuves', published: 'Publication', effective: 'Prise d’effet', reset: 'Heure de la réinitialisation', source: 'Ouvrir la source originale', timeline: 'Voir la chronologie associée' },
  }[lang];
  const product = eventProductLabel(event, lang);
  const effective = event.effective_at ? eventDateMarkup(event.effective_at, lang, 'event-answer-time') : '';
  const reset = event.reset_at ? eventDateMarkup(event.reset_at, lang, 'event-answer-time') : '';
  const sourceLink = event.source_url
    ? '<a class="event-answer-source" href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-placement="event_answer" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + escapeHtml(copy.source) + ' →</a>'
    : '';
  return [
    '<section class="event-answer-panel" aria-labelledby="eventAnswerTitle">',
    '  <p class="event-answer-kicker">' + escapeHtml(copy.kicker) + '</p>',
    '  <h2 id="eventAnswerTitle">' + escapeHtml(copy.title) + '</h2>',
    '  <p class="event-answer-summary">' + escapeHtml(summary) + '</p>',
    '  <dl class="event-answer-facts">',
    product ? '    <div><dt>' + escapeHtml(copy.products) + '</dt><dd>' + escapeHtml(product) + '</dd></div>' : '',
    '    <div><dt>' + escapeHtml(copy.eventType) + '</dt><dd><span class="category-badge category-' + event.category + '">' + escapeHtml(getCategoryLabel(event.category, lang)) + '</span></dd></div>',
    '    <div><dt>' + escapeHtml(copy.evidence) + '</dt><dd>' + escapeHtml(getVerificationLabel(event, lang)) + '</dd></div>',
    '    <div><dt>' + escapeHtml(copy.published) + '</dt><dd>' + eventDateMarkup(event.published_at, lang, 'event-answer-time') + '</dd></div>',
    effective ? '    <div><dt>' + escapeHtml(copy.effective) + '</dt><dd>' + effective + '</dd></div>' : '',
    reset ? '    <div><dt>' + escapeHtml(copy.reset) + '</dt><dd>' + reset + '</dd></div>' : '',
    '  </dl>',
    sourceLink ? '  <p class="event-answer-actions">' + sourceLink + ' · <a href="' + escapeHtml(getTopicPath(event.category, lang)) + '">' + escapeHtml(copy.timeline) + ' →</a></p>' : '',
    '</section>',
  ].filter(Boolean).join('\n');
}

function eventSummary(event: MonitorEvent, lang: SiteLocale): string {
  if (lang === 'zh') return event.summary_zh || event.summary_en;
  if (lang === 'en') return event.summary_en || event.summary_zh;
  const translation = event.translations?.[lang];
  return translation?.status === 'translated' && translation.summary
    ? translation.summary
    : (event.summary_en || event.summary_zh);
}

function eventHasLocalizedContent(event: MonitorEvent, lang: SiteLocale): boolean {
  if (lang === 'en' || lang === 'zh') return true;
  const translation = event.translations?.[lang];
  return translation?.status === 'translated' && Boolean(translation.title && translation.summary);
}

function eventAlternatePaths(event: MonitorEvent): Partial<Record<SiteLocale, string>> {
  return Object.fromEntries(
    SITE_LOCALES
      .filter(locale => eventHasLocalizedContent(event, locale))
      .map(locale => [locale, getEventUrl(event.id!, locale)]),
  ) as Partial<Record<SiteLocale, string>>;
}

function eventDateMarkup(iso: string | null | undefined, lang: SiteLocale, className = 'event-date'): string {
  const fallback = iso ? formatDateForLanguage(iso, lang) : (lang === 'zh' ? '未知' : 'Unknown');
  return localTimeElement(iso, fallback, className);
}

function renderEventTrustFacts(event: MonitorEvent, lang: SiteLocale): string {
  const isZh = lang === 'zh';
  const unknown = isZh ? '未知' : 'Unknown';
  const pending = isZh ? '待验证' : 'Pending verification';
  const verified = event.verified_at
    ? eventDateMarkup(event.verified_at, lang, 'trust-time')
    : escapeHtml(pending);
  return [
    '<dl class="trust-facts">',
    '  <div><dt>' + (isZh ? '验证状态' : 'Verification status') + '</dt><dd><code>' + escapeHtml(getVerificationStatusCode(event)) + '</code> · ' + escapeHtml(getVerificationLabel(event, lang)) + '</dd></div>',
    '  <div><dt>' + (isZh ? '来源类型' : 'Source type') + '</dt><dd><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span></dd></div>',
    '  <div><dt>' + (isZh ? '发布时间' : 'Published') + '</dt><dd>' + eventDateMarkup(event.published_at, lang, 'trust-time') + '</dd></div>',
    '  <div><dt>' + (isZh ? '观察时间' : 'Observed') + '</dt><dd>' + eventDateMarkup(event.observed_at, lang, 'trust-time') + '</dd></div>',
    '  <div><dt>' + (isZh ? '最近验证' : 'Last verified') + '</dt><dd>' + verified + '</dd></div>',
    '  <div><dt>' + (isZh ? '置信度' : 'Confidence') + '</dt><dd>' + Math.round(event.confidence * 100) + '%</dd></div>',
    '  <div><dt>' + (isZh ? '发现方式' : 'Discovered via') + '</dt><dd>' + escapeHtml(event.first_discovered_via || unknown) + '</dd></div>',
    '</dl>',
  ].join('\n');
}

function renderLandingEventItem(event: MonitorEvent, lang: SiteLocale, headingLevel: 3 | 4 = 3): string {
  const title = eventTitle(event, lang);
  const summary = eventSummary(event, lang);
  const heading = 'h' + headingLevel;
  const source = event.source_url
    ? '<a href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + (lang === 'zh' ? '查看来源' : 'View source') + '</a>'
    : '<span>' + (lang === 'zh' ? '来源未知' : 'Source unknown') + '</span>';
  return [
    '<li class="landing-event-item">',
    '  <div class="landing-event-meta"><span class="category-badge category-' + event.category + '">' + escapeHtml(getCategoryLabel(event.category, lang)) + '</span><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span><span>' + eventDateMarkup(event.published_at, lang) + '</span></div>',
    '  <' + heading + '><a href="' + getEventUrl(event.id!, lang) + '">' + escapeHtml(title) + '</a></' + heading + '>',
    '  <p>' + escapeHtml(summary) + '</p>',
    '  <p class="landing-event-source"><span>' + escapeHtml((lang === 'zh' ? '验证：' : 'Verification: ') + getVerificationLabel(event, lang)) + '</span> · ' + source + '</p>',
    '</li>',
  ].join('\n');
}

function renderLandingEventList(events: MonitorEvent[], lang: SiteLocale, headingLevel: 3 | 4 = 3): string {
  if (events.length === 0) {
    return '<p class="empty-state">' + (lang === 'zh' ? '暂无符合条件的事件。' : 'No matching events are recorded.') + '</p>';
  }
  return '<ol class="landing-event-list">' + events.map(event => renderLandingEventItem(event, lang, headingLevel)).join('\n') + '</ol>';
}

function renderLandingFreshness(data: LandingPageData, lang: SiteLocale): string {
  const updatedAt = data.lastCheckedAt || data.sourceLastFetchedAt || null;
  const isZh = lang === 'zh';
  return [
    '<dl class="freshness-facts">',
    '  <div><dt>' + (isZh ? '最近更新' : 'Updated') + '</dt><dd>' + eventDateMarkup(updatedAt, lang, 'trust-time') + '</dd></div>',
    '</dl>',
  ].join('\n');
}

function renderResetTimeline(events: MonitorEvent[], lang: SiteLocale): string {
  if (events.length === 0) return '<p class="empty-state">' + (lang === 'zh' ? '暂无重置事件。' : 'No reset events are recorded.') + '</p>';

  const timeZone = displayTimeZoneForLanguage(lang);
  const groups: Array<{ year: string; month: string; events: MonitorEvent[] }> = [];
  for (const event of events) {
    const date = event.published_at ? parseStoredUtc(event.published_at) : null;
    const parts = date ? datePartsInTimeZone(date, timeZone) : null;
    const year = parts ? parts.year : (lang === 'zh' ? '未知年份' : 'Unknown year');
    const month = parts
      ? (lang === 'zh'
        ? String(Number(parts.month)) + '月'
        : (date
          ? new Intl.DateTimeFormat(SITE_HTML_LANG[lang], { timeZone, month: 'long' }).format(date)
          : 'Unknown month'))
      : (lang === 'zh' ? '未知月份' : 'Unknown month');
    let group = groups.find(candidate => candidate.year === year && candidate.month === month);
    if (!group) {
      group = { year, month, events: [] };
      groups.push(group);
    }
    group.events.push(event);
  }

  const years: string[] = [];
  let currentYear = '';
  for (const group of groups) {
    if (group.year !== currentYear) {
      currentYear = group.year;
      years.push('<section class="history-year"><h3>' + escapeHtml(group.year) + '</h3>');
    }
    years.push('<section class="history-month"><h4>' + escapeHtml(group.month) + '</h4>' + renderLandingEventList(group.events, lang, 4) + '</section>');
    const nextGroup = groups[groups.indexOf(group) + 1];
    if (!nextGroup || nextGroup.year !== currentYear) years.push('</section>');
  }
  return years.join('\n');
}

function renderFaqContent(lang: SiteLocale): string {
  const methodologyPath = getLandingPath('methodology', lang);
  const historyPath = getLandingPath('reset-history', lang);
  const ratePath = getLandingPath('rate-limit-updates', lang);
  const items = lang === 'zh'
    ? [
      ['这个网站监控什么？', '记录 Tibo 公开发布的 Codex 额度重置、限额变化和订阅政策事件；每条事件都显示来源和状态。'],
      ['这个网站是官方的吗？', '这是独立监控站，与 OpenAI 无隶属关系。每条事件都附原始来源。'],
      ['OpenAI Codex、ChatGPT 和 GPT 有什么关系？', '这些词用于描述公开帖文中涉及的产品和模型；本站重点记录 Codex 使用额度、ChatGPT Work 限额及相关政策。本站不读取个人账户，也不显示实时余额。'],
      ['什么是 Codex 使用额度重置？', '公开帖文会被分类为“计划重置”或“重置完成”，详情见事件来源。'],
      ['5 小时限额或周限额是多少？', '本站记录这类限额的公开变更；当前账户额度请以产品页面为准。'],
      ['什么是 Banked Reset？', '本站按原帖记录 Banked Reset 的说法，具体含义见原始来源。'],
      ['数据来自哪里？', '来源包括 X 直接数据、官方来源和网页搜索索引；来源类型会显示在事件上。'],
      ['事件如何验证？', 'DIRECT_VERIFIED、OFFICIAL_VERIFIED 和 INDEXED_ONLY 表示不同的证据路径；规则见方法论。'],
    ]
    : [
      ['What does this monitor track?', 'It records Tibo’s public Codex updates about usage resets, limit changes, and subscription policy, with the source and status shown for each event.'],
      ['Is this website official?', 'It is an independent monitor and is not affiliated with OpenAI. Every event links to its original source.'],
      ['How are OpenAI Codex, ChatGPT, and GPT covered?', 'The monitor groups public updates that mention OpenAI Codex, ChatGPT Work, GPT, usage limits, or related policy terms. It records public events only; it does not read accounts or show live balances.'],
      ['What is a Codex usage reset?', 'A public post classified as RESET_PLANNED or RESET_COMPLETED. Open the event for its source and details.'],
      ['What is a 5-hour or weekly limit?', 'The monitor tracks public changes to these limits; current account limits belong on the product page.'],
      ['What is a banked reset?', 'The monitor keeps the wording used in the original post. Open the event for its source and status.'],
      ['Where does the data come from?', 'Sources include direct X data, official sources, and web-search index hits. The source type appears on each event.'],
      ['How are events verified?', 'DIRECT_VERIFIED, OFFICIAL_VERIFIED, and INDEXED_ONLY show the evidence path. See the methodology page for the rules.'],
    ];
  return [
    '<section class="faq-list" aria-label="' + (lang === 'zh' ? '常见问题列表' : 'Frequently asked questions') + '">',
    ...items.map(([question, answer]) => [
      '  <section class="faq-item">',
      '    <h2>' + escapeHtml(question) + '</h2>',
      '    <p>' + escapeHtml(answer) + '</p>',
      '  </section>',
    ].join('\n')),
    '</section>',
    '<p class="cross-link">' + (lang === 'zh' ? '查看完整的' : 'Read the full ') + '<a href="' + methodologyPath + '">' + (lang === 'zh' ? '方法论与验证规则' : 'methodology and verification rules') + '</a>。' + (lang === 'zh' ? '也可以浏览' : ' You can also browse the ') + '<a href="' + historyPath + '">' + (lang === 'zh' ? '重置历史' : 'reset history') + '</a> ' + (lang === 'zh' ? '和' : 'and') + ' <a href="' + ratePath + '">' + (lang === 'zh' ? '限额更新' : 'rate-limit updates') + '</a>。</p>',
  ].join('\n');
}

function renderMethodologyContent(lang: SiteLocale): string {
  const isZh = lang === 'zh';
  const sections = isZh
    ? [
      ['网站用途', '记录公开来源中的 Codex 额度、重置、限额和订阅政策动态。页面展示事件，不读取账户额度。'],
      ['数据来源', '来源包括 X 直接数据、官方来源和网页搜索索引；每条事件保留来源链接和来源类型。'],
      ['状态', 'DIRECT / OFFICIAL 表示已取得对应来源；INDEXED_ONLY 表示来自搜索索引，等待直接来源。'],
      ['摘要', '标题和摘要可能由分类器生成，并标记为 AI summary；原始来源用于复核。'],
      ['更新时间', '定时检查更新数据，并分别记录监控检查、来源获取和事件验证时间。'],
      ['更正', '后续证据可以更新事件状态；来源未提供的时间保持未知。'],
      ['当前规则', '需要账户额度或最新政策时，请查看 OpenAI 官方信息。'],
    ]
    : [
      ['Purpose', 'Tracks public Codex limit, reset, rate-limit, and subscription updates. It reports events, not account balances.'],
      ['Sources', 'Sources include direct X data, official sources, and web-search index hits. Each event keeps its source link and type.'],
      ['Status', 'DIRECT / OFFICIAL means the corresponding source was obtained; INDEXED_ONLY means it came from a search index and awaits direct source confirmation.'],
      ['Summaries', 'Titles and summaries may be generated by the classifier and are marked AI summary; the original source is the review path.'],
      ['Updates', 'Scheduled checks refresh the data and record monitor, source-fetch, and event-verification times separately.'],
      ['Corrections', 'Later evidence can update an event’s status; dates absent from the source remain Unknown.'],
      ['Current rules', 'For account limits and current policy, use OpenAI’s official information.'],
    ];
  return sections.map(([heading, text]) => [
    '<section class="methodology-section">',
    '  <h2>' + escapeHtml(heading) + '</h2>',
    '  <p>' + escapeHtml(text) + '</p>',
    '</section>',
  ].join('\n')).join('\n');
}

export function renderLandingPage(data: LandingPageData, lang: SiteLocale, integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const copy = LANDING_COPY[data.page][lang];
  const events = data.events;
  const latestEvent = data.latestEvent || events[0] || null;
  const indexable = data.page === 'faq' || data.page === 'methodology' || events.some(isEventIndexEligible);
  const canonical = getLandingUrl(data.page, lang);
  const breadcrumbName = copy.title;
  const breadcrumbJson = breadcrumbSchema([
    { name: SITE_BRAND_COPY[lang].home, url: getCanonicalUrl(null, lang) },
    { name: breadcrumbName, url: canonical },
  ]);
  const itemList = events.length > 0 ? itemListSchema(events, lang) : null;
  const meta: SeoMeta = {
    lang,
    title: copy.title + ' | ' + MODELYARD_BRAND,
    description: copy.description,
    canonical,
    isHomepage: false,
    eventId: null,
    enPath: getLandingPath(data.page, 'en'),
    zhPath: getLandingPath(data.page, 'zh'),
    alternatePaths: localizedPaths(LANDING_PAGE_PATHS[data.page]),
    robots: indexable ? 'index, follow' : 'noindex, follow',
    ogType: 'website',
    structuredData: [websiteSchema(lang, copy.lede), ...(itemList ? [itemList] : []), breadcrumbJson],
  };

  let content = '';
  if (data.page === 'latest') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '最新公开状态' : 'Latest public status') + '</h2>',
      latestEvent
        ? [
          '  <div class="trust-panel">',
          '    <h3>' + (isZh ? '最近记录的事件' : 'Latest recorded event') + '</h3>',
          '    <p class="featured-event-title"><a href="' + getEventUrl(latestEvent.id!, lang) + '">' + escapeHtml(eventPageHeadline(latestEvent, lang)) + '</a></p>',
          '    <p class="featured-event-summary">' + escapeHtml(eventSummary(latestEvent, lang)) + '</p>',
          renderEventTrustFacts(latestEvent, lang),
          latestEvent.source_url ? '    <p class="primary-source"><strong>' + (isZh ? '主要来源：' : 'Primary source: ') + '</strong><a href="' + escapeHtml(latestEvent.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(latestEvent.id)) + '" data-analytics-event-category="' + escapeHtml(latestEvent.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(latestEvent)) + '">' + escapeHtml(latestEvent.source_url) + '</a></p>' : '',
          '    <p class="status-note"><a href="' + getLandingPath('reset-history', lang) + '">' + (isZh ? '查看重置历史' : 'View reset history') + '</a> · <a href="' + getLandingPath('rate-limit-updates', lang) + '">' + (isZh ? '查看限额更新' : 'View limit updates') + '</a></p>',
          '  </div>',
        ].filter(Boolean).join('\n')
        : '  <p class="empty-state">' + (isZh ? '当前状态：未知，尚无事件记录。' : 'Current status: Unknown; no event is recorded.') + '</p>',
      renderLandingFreshness(data, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '最近事件' : 'Recent events') + '</h2>',
      renderLandingEventList(events, lang),
      '</section>',
      '<section class="landing-section cross-link-section">',
      '  <h2>' + (isZh ? '如何阅读' : 'How to read this page') + '</h2>',
      '  <p>' + (isZh ? '验证状态、来源类型和时间字段的定义见' : 'Definitions for verification, source type, and timestamps are in the ') + '<a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '方法论' : 'methodology') + '</a>。</p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'reset-history') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '当前状态' : 'Current status') + '</h2>',
      latestEvent
        ? '  <p>' + (isZh ? '最近的重置记录：' : 'Latest reset record: ') + '<a href="' + getEventUrl(latestEvent.id!, lang) + '">' + escapeHtml(eventTitle(latestEvent, lang)) + '</a> · ' + escapeHtml(getVerificationLabel(latestEvent, lang)) + '</p>'
        : '  <p class="empty-state">' + (isZh ? '当前状态：未知，暂无重置事件。' : 'Current status: Unknown; no reset events are recorded.') + '</p>',
      '</section>',
      '<section class="landing-section history-timeline">',
      '  <h2>' + (isZh ? '时间线' : 'Timeline') + '</h2>',
      renderResetTimeline(events, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '重置类型' : 'Reset types recorded') + '</h2>',
      '  <ul class="plain-list">',
      '    <li><code>RESET_PLANNED</code> — ' + (isZh ? '公开来源中的计划或公告。' : 'planned or announced in the public source.') + '</li>',
      '    <li><code>RESET_COMPLETED</code> — ' + (isZh ? '公开来源中的完成公告。' : 'completed in the public source.') + '</li>',
      '    <li><code>RESET_TIME_CHANGED</code> — ' + (isZh ? '重置时间发生变化。' : 'reset timing changed.') + '</li>',
      '  </ul>',
      '</section>',
      '<section class="landing-section cross-link-section">',
      '  <h2>' + (isZh ? '相关限额更新' : 'Related limit updates') + '</h2>',
      '  <p><a href="' + getLandingPath('rate-limit-updates', lang) + '">' + (isZh ? '查看限额和政策更新' : 'Browse rate-limit and policy updates') + '</a> · <a href="' + getLandingPath('faq', lang) + '">' + (isZh ? '查看常见问题' : 'Read the FAQ') + '</a> · <a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '查看方法论' : 'Read the methodology') + '</a>。</p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'rate-limit-updates') {
    content = [
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '本页包含的分类' : 'Recorded categories on this page') + '</h2>',
      '  <ul class="plain-list">',
      '    <li><code>POLICY_CHANGE</code> — ' + (isZh ? '政策或订阅相关的事件分类。' : 'events classified as policy or subscription changes.') + '</li>',
      '    <li><code>RESET_TIME_CHANGED</code> — ' + (isZh ? '重置时间变更分类。' : 'events classified as reset-time changes.') + '</li>',
      '  </ul>',
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '更新' : 'Updates') + '</h2>',
      renderLandingEventList(events, lang),
      '</section>',
      '<section class="landing-section">',
      '  <h2>' + (isZh ? '范围说明' : 'Scope') + '</h2>',
      '  <p>' + (isZh ? '记录涵盖 5 小时、周限额、速率、套餐和订阅更新；打开事件查看来源和状态。' : 'Covers 5-hour, weekly, rate, plan, and subscription updates. Open an event for its source and status.') + '</p>',
      '  <p><a href="' + getLandingPath('reset-history', lang) + '">' + (isZh ? '查看重置历史' : 'View reset history') + '</a> · <a href="' + getLandingPath('methodology', lang) + '">' + (isZh ? '查看方法论' : 'Read methodology') + '</a></p>',
      '</section>',
    ].join('\n');
  } else if (data.page === 'faq') {
    content = renderFaqContent(lang);
  } else {
    content = renderMethodologyContent(lang);
  }

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: getLandingPath(data.page, lang === 'en' ? 'zh' : 'en') }),
    '    <main class="landing-page">',
    '      <nav class="breadcrumb" aria-label="' + escapeHtml(lang === 'zh' ? '面包屑导航' : lang === 'ja' ? 'パンくずリスト' : lang === 'es' ? 'Ruta de navegación' : lang === 'fr' ? 'Fil d’Ariane' : 'Breadcrumb') + '">',
    '        <a href="' + getHomePath(lang) + '">' + escapeHtml(SITE_BRAND_COPY[lang].home) + '</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">' + escapeHtml(copy.title) + '</span>',
    '      </nav>',
    '      <header class="landing-header">',
    '        <h1>' + escapeHtml(copy.title) + '</h1>',
    '        <p>' + escapeHtml(copy.lede) + '</p>',
    '      </header>',
    content,
    '    </main>',
    renderSiteFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderSiteDocument(meta, body, integrations);
}

function renderHomepageEventLink(
  event: MonitorEvent | null | undefined,
  lang: SiteLocale,
  text: string,
  placement: string,
  textIsHtml = false,
): string {
  if (!event?.id) return escapeHtml(text);
  return '<a class="status-card-link" href="' + escapeHtml(getEventUrl(event.id, lang)) + '" data-analytics-placement="' + escapeHtml(placement) + '" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + (textIsHtml ? text : escapeHtml(text)) + '</a>';
}

function renderHomepageStatusAnswer(
  data: HomepageData,
  lang: SiteLocale,
  lastResetMarkup: string,
  effectiveLastResetAt: string | null,
  lastResetEvent: MonitorEvent | null,
  lastCheckedMarkup: string,
  ui: typeof HOMEPAGE_UI_COPY[SiteLocale],
): string {
  const hasConfirmedReset = Boolean(data.latestDirectReset || data.manualReset?.resetAt);
  const resetLabel = hasConfirmedReset ? ui.lastConfirmedReset : ui.lastRecordedReset;
  const resetValue = effectiveLastResetAt
    ? (data.manualReset?.resetAt
      ? lastResetMarkup
      : renderHomepageEventLink(lastResetEvent, lang, lastResetMarkup, 'status_answer', true))
    : escapeHtml(ui.statusUnknown);
  const latestValue = data.latestEvent?.id
    ? renderHomepageEventLink(data.latestEvent, lang, ui.viewLatestEvent, 'status_answer')
    : '';
  return [
    '    <section class="status-answer" aria-labelledby="statusAnswerTitle">',
    '      <div class="status-answer-heading">',
    '        <h2 id="statusAnswerTitle">' + escapeHtml(ui.statusAnswerTitle) + '</h2>',
    '        <p class="status-answer-lead" id="statusAnswerLead">' + escapeHtml(ui.statusAnswerLead) + '</p>',
    '      </div>',
    '      <dl class="status-answer-facts">',
    '        <div><dt id="lastConfirmedResetLabel">' + escapeHtml(resetLabel) + '</dt><dd id="lastConfirmedResetValue">' + resetValue + '</dd></div>',
    '        <div><dt id="nextKnownResetLabel">' + escapeHtml(ui.nextKnownReset) + '</dt><dd id="nextKnownResetValue">' + escapeHtml(ui.checkingLiveStatus) + '</dd></div>',
    '        <div><dt>' + escapeHtml(ui.lastChecked) + '</dt><dd id="statusAnswerLastUpdated">' + lastCheckedMarkup + '</dd></div>',
    '      </dl>',
    '      <p class="status-answer-actions">',
    '        <a id="statusAnswerResetHistory" href="' + escapeHtml(getLandingPath('reset-history', lang)) + '" data-analytics-placement="status_answer">' + escapeHtml(ui.viewResetHistory) + ' →</a>',
    '        ' + (latestValue === escapeHtml(ui.statusUnknown) ? '' : latestValue),
    '      </p>',
    '    </section>',
  ].filter(line => line !== '').join('\n');
}

function truncateHomepageGambitSummary(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 190) return normalized;
  return normalized.slice(0, 187).trimEnd() + '...';
}

function renderHomepageGambitModule(articles: GambitPublicArticle[], lang: SiteLocale): string {
  const visible = articles
    .filter(article => article.status === 'PUBLISHED' && !article.politicalTopic && Boolean(article.publishedAt))
    .slice(0, 3);
  if (visible.length === 0) return '';
  const isZh = lang === 'zh';
  const cards = visible.map(article => {
    const path = (lang === 'zh' ? '/zh' : '') + '/open-gambit/' + encodeURIComponent(article.slug) + '/';
    const content = isZh && article.translations?.zh?.status === 'TRANSLATED' ? article.translations.zh : article;
    const summary = truncateHomepageGambitSummary(content.thesis || content.surfaceEvent);
    const publicationDate = article.publishedAt || article.modifiedAt;
    const firstTrajectory = content.trajectories[0];
    return [
      '      <article class="homepage-gambit-card">',
      '        <p class="homepage-gambit-label">' + (isZh ? 'ANALYSIS · 阳谋' : 'ANALYSIS · Open Gambit') + '</p>',
      '        <h3><a href="' + escapeHtml(path) + '">' + escapeHtml(content.headline) + '</a></h3>',
      '        <p class="homepage-gambit-summary">' + escapeHtml(summary) + '</p>',
      '        <p class="homepage-gambit-meta">' + localTimeElement(publicationDate, formatDateShort(publicationDate, lang), 'homepage-gambit-date', 'date')
        + (firstTrajectory ? ' · ' + escapeHtml(isZh ? `AI 走势 · 约${firstTrajectory.probability}%` : `AI estimate · ~${firstTrajectory.probability}%`) : '')
        + '</p>',
      '      </article>',
    ].join('\n');
  }).join('\n');
  return [
    '    <section class="homepage-gambit-module" aria-labelledby="homepageGambitTitle">',
    '      <div class="section-header"><h2 id="homepageGambitTitle">' + (isZh ? '阳谋' : 'Open Gambit') + '</h2><a href="' + escapeHtml(OPEN_GAMBIT_PATHS[lang === 'zh' ? 'zh' : 'en']) + '">' + (isZh ? '查看全部' : 'View all') + ' →</a></div>',
    '      <p class="homepage-gambit-intro">' + escapeHtml(isZh ? 'AI、产品与生态的战略分析；事实、分析与 AI 走势分开标注。' : 'Strategic analysis of AI, products and ecosystems, with facts, analysis and AI forecasts kept distinct.') + '</p>',
    '      <div class="homepage-gambit-list">',
    cards,
    '      </div>',
    '    </section>',
  ].join('\n');
}

// ── Community Page SSR ──

export function renderCommunityPage(data: CommunityPageData, lang: SiteLocale, integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const copy = COMMUNITY_COPY[lang];
  const filters = data.filters ?? EMPTY_COMMUNITY_FILTERS;
  const canonical = getCommunityUrl(lang);
  const breadcrumbJson = breadcrumbSchema([
    { name: SITE_BRAND_COPY[lang].home, url: getCanonicalUrl(null, lang) },
    { name: copy.breadcrumb, url: canonical },
  ]);
  const meta: SeoMeta = {
    lang,
    title: copy.title + ' | ' + MODELYARD_BRAND,
    description: copy.description,
    canonical,
    isHomepage: false,
    eventId: null,
    enPath: getCommunityPath('en'),
    zhPath: getCommunityPath('zh'),
    alternatePaths: localizedPaths('/community/'),
    ogType: 'website',
    structuredData: [websiteSchema(lang, copy.lede), breadcrumbJson],
  };

  const posts = data.posts.map(post => renderCommunityPost(post, lang)).join('\n');
  const feedBody = data.feedError
      ? '<p class="community-notice error" role="alert">' + escapeHtml(copy.unableToLoad) + '</p>'
      : data.posts.length === 0
      ? '<div class="community-empty"><p>' + escapeHtml(hasCommunityFilters(filters) ? copy.noMatchingPosts : copy.noPosts) + '</p>' + (hasCommunityFilters(filters)
        ? '<p><a href="' + communityFilterHref(lang, EMPTY_COMMUNITY_FILTERS, 'all') + '">' + escapeHtml(copy.clearFilters) + '</a></p>'
        : '<p>' + escapeHtml(copy.firstPost) + '</p>') + '</div>'
      : '<ol id="communityPostList" class="community-feed">' + posts + '</ol>';
  const form = data.postingEnabled
    ? [
      '<section class="community-composer" aria-labelledby="communityComposerTitle">',
      '  <h2 id="communityComposerTitle">' + escapeHtml(copy.composerTitle) + '</h2>',
      '  <form id="communityComposer" novalidate data-posting-enabled="true">',
      '    <div class="community-form-field">',
      '      <label for="communityNickname">' + escapeHtml(copy.nickname) + '</label>',
      '      <input id="communityNickname" name="nickname" type="text" maxlength="' + data.maxNicknameLength + '" autocomplete="nickname" required placeholder="' + escapeHtml(copy.nicknamePlaceholder) + '">',
    '    </div>',
      '    <div class="community-form-field">',
      '      <label for="communityTopic">' + escapeHtml(copy.topic) + '</label>',
      '      <select id="communityTopic" name="topic">' + renderCommunityTopicOptions(lang, 'general', false) + '</select>',
      '    </div>',
      '    <div class="community-form-field">',
      '      <label for="communityContent">' + escapeHtml(copy.content) + '</label>',
      '      <textarea id="communityContent" name="content" maxlength="' + data.maxContentLength + '" rows="6" required placeholder="' + escapeHtml(copy.contentPlaceholder) + '"></textarea>',
      '      <p class="community-form-hint">' + escapeHtml(copy.contentHint) + '</p>',
      '    </div>',
    '    <div id="communityTurnstile" class="community-turnstile" aria-label="' + escapeHtml(lang === 'zh' ? 'Cloudflare Turnstile 安全验证' : lang === 'ja' ? 'Cloudflare Turnstile セキュリティチェック' : lang === 'es' ? 'Comprobación de seguridad de Cloudflare Turnstile' : lang === 'fr' ? 'Contrôle de sécurité Cloudflare Turnstile' : 'Cloudflare Turnstile security check') + '"></div>',
      '    <div class="community-form-actions">',
      '      <button id="communityPostButton" class="primary-btn community-post-button" type="submit">' + escapeHtml(copy.post) + '</button>',
      '      <p id="communityFormStatus" class="community-form-status" role="status" aria-live="polite"></p>',
      '    </div>',
      '  </form>',
      '</section>',
    ].join('\n')
    : '<div class="community-notice" role="status">' + escapeHtml(copy.postingDisabled) + '</div>';
  const loadMore = data.nextCursor
    ? '<button id="communityLoadMore" class="secondary-btn community-load-more" type="button" data-cursor="' + escapeHtml(data.nextCursor) + '">' + escapeHtml(copy.loadMore) + '</button>'
    : '';

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: getCommunityPath(lang === 'en' ? 'zh' : 'en') }),
    '    <main class="community-page" data-analytics-page-type="community">',
    '      <nav class="breadcrumb" aria-label="' + escapeHtml(lang === 'zh' ? '面包屑导航' : lang === 'ja' ? 'パンくずリスト' : lang === 'es' ? 'Ruta de navegación' : lang === 'fr' ? 'Fil d’Ariane' : 'Breadcrumb') + '">',
    '        <a href="' + getHomePath(lang) + '">' + escapeHtml(SITE_BRAND_COPY[lang].home) + '</a><span class="breadcrumb-sep">/</span><span class="breadcrumb-current">' + escapeHtml(copy.breadcrumb) + '</span>',
    '      </nav>',
    '      <header class="community-header">',
    '        <p class="community-kicker">MODELYARD / COMMUNITY</p>',
    '        <h1>' + escapeHtml(copy.title) + '</h1>',
    '        <p>' + escapeHtml(copy.lede) + '</p>',
    '      </header>',
    form,
    '      <p class="community-privacy-note">' + escapeHtml(copy.privacyNote) + '</p>',
    '      <section class="community-feed-section" aria-labelledby="communityFeedTitle">',
    '        <div class="section-header">',
    '          <h2 id="communityFeedTitle">' + escapeHtml(copy.feedTitle) + '</h2>',
    '        </div>',
    renderCommunityFilters(filters, lang),
    '        <p id="communityFeedResult" class="community-feed-result" role="status">' + escapeHtml(communityResultsLabel(data.total, filters, lang)) + '</p>',
    '        <div id="communityFeedStatus" class="sr-only" role="status" aria-live="polite"></div>',
    feedBody,
    loadMore,
    '      </section>',
    '    </main>',
    renderSiteFooter(lang),
    '  </div>',
    '  <script>window.__COMMUNITY_DATA__ = ' + safeJsonForScript({
      posts: data.posts.map(communityClientPost),
      nextCursor: data.nextCursor,
      total: data.total,
      postingEnabled: data.postingEnabled,
      turnstileSiteKey: data.turnstileSiteKey,
      maxNicknameLength: data.maxNicknameLength,
      maxContentLength: data.maxContentLength,
      filters,
      feedError: Boolean(data.feedError),
    }) + ';</script>',
    data.postingEnabled ? '  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" defer></script>' : '',
    '  <script src="' + staticAssetUrl('community.js') + '" defer></script>',
    '</body>',
    '</html>',
  ].filter(line => line !== '').join('\n');
  return renderSiteDocument(meta, body, integrations);
}

export function renderAdminCommunityPage(integrations?: SiteIntegrations): string {
  const meta: SeoMeta = {
    lang: 'en',
    title: 'ModelYard Community moderation',
    description: 'Private ModelYard Community moderation console.',
    canonical: null,
    isHomepage: false,
    eventId: null,
    robots: 'noindex, nofollow, noarchive',
  };
  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader('en', { alternatePath: getCommunityPath('en') }),
    '    <main class="community-admin-page">',
    '      <header class="community-header">',
    '        <p class="community-kicker">MODELYARD / COMMUNITY</p>',
    '        <h1>ModelYard Community moderation</h1>',
    '        <p>Review pending messages and manage source blocks.</p>',
    '      </header>',
    '      <section class="community-admin-auth" aria-labelledby="communityAdminAuthTitle">',
    '        <h2 id="communityAdminAuthTitle">Administrator access</h2>',
    '        <form id="communityAdminAuthForm">',
    '          <label for="communityAdminToken">Admin token</label>',
    '          <input id="communityAdminToken" type="password" autocomplete="current-password" required>',
    '          <button class="primary-btn" type="submit">Load moderation queue</button>',
    '        </form>',
    '        <p id="communityAdminStatus" class="community-form-status" role="status" aria-live="polite"></p>',
    '      </section>',
    '      <section id="communityAdminPanel" class="community-admin-panel" hidden aria-labelledby="communityAdminQueueTitle">',
    '        <section class="community-admin-announcement" aria-labelledby="communityAdminAnnouncementTitle">',
    '          <div class="section-header"><h2 id="communityAdminAnnouncementTitle">Publish announcement</h2><span class="community-admin-identity">Published as <strong>admin</strong>' + renderCommunityVerifiedBadge('en') + '</span></div>',
    '          <p class="community-form-hint">Only authenticated administrators can publish official announcements.</p>',
    '          <form id="communityAdminAnnouncementForm">',
    '            <label for="communityAdminAnnouncementTopic">Topic</label>',
    '            <select id="communityAdminAnnouncementTopic" name="topic">' + renderCommunityTopicOptions('en', 'general', false) + '</select>',
    '            <label for="communityAdminAnnouncementContent">Announcement</label>',
    '            <textarea id="communityAdminAnnouncementContent" name="content" maxlength="2000" rows="6" required placeholder="Write an official announcement…"></textarea>',
    '            <label class="community-admin-checkbox"><input id="communityAdminAnnouncementPin" type="checkbox"> Pin to top</label>',
    '            <div class="community-form-actions"><button id="communityAdminAnnouncementButton" class="primary-btn" type="submit">Publish announcement</button><p id="communityAdminAnnouncementStatus" class="community-form-status" role="status" aria-live="polite"></p></div>',
    '          </form>',
    '        </section>',
    '        <section class="community-admin-stats" aria-labelledby="communityAdminStatsTitle">',
    '          <div class="section-header"><h2 id="communityAdminStatsTitle">Overview</h2><button id="communityAdminRefreshStats" class="secondary-btn" type="button">Refresh</button></div>',
    '          <div id="communityAdminStatsGrid" class="community-admin-stats-grid" aria-live="polite"></div>',
    '        </section>',
    '        <div class="section-header">',
    '          <h2 id="communityAdminQueueTitle">Moderation queue</h2>',
    '          <label class="community-status-filter" for="communityAdminStatusFilter">Status <select id="communityAdminStatusFilter"><option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="hidden">Hidden</option><option value="deleted">Deleted</option></select></label>',
    '        </div>',
    '        <form id="communityAdminSearchForm" class="community-admin-filters">',
    '          <label for="communityAdminSearch">Search</label>',
    '          <input id="communityAdminSearch" type="search" maxlength="80" placeholder="Search messages, links, or nicknames">',
    '          <label for="communityAdminTopicFilter">Topic</label>',
    '          <select id="communityAdminTopicFilter"><option value="">All topics</option>' + COMMUNITY_TOPICS.map(topic => '<option value="' + topic + '">' + escapeHtml(COMMUNITY_TOPIC_LABELS[topic].en) + '</option>').join('') + '</select>',
    '          <label class="community-admin-checkbox"><input id="communityAdminFeaturedFilter" type="checkbox"> Featured only</label>',
    '          <label class="community-admin-checkbox"><input id="communityAdminGithubFilter" type="checkbox"> GitHub repos only</label>',
    '          <button class="secondary-btn" type="submit">Apply filters</button>',
    '        </form>',
    '        <div id="communityAdminPostList" class="community-admin-list"></div>',
    '        <button id="communityAdminLoadMore" class="secondary-btn community-load-more" type="button" hidden>Load more</button>',
    '        <section class="community-ban-panel" aria-labelledby="communityBanTitle">',
    '          <h2 id="communityBanTitle">Block a source</h2>',
    '          <form id="communityBanForm">',
    '            <label for="communityBanHash">Source hash</label>',
    '            <input id="communityBanHash" inputmode="text" pattern="[a-fA-F0-9]{64}" required>',
    '            <label for="communityBanReason">Reason</label>',
    '            <input id="communityBanReason" maxlength="240">',
    '            <label for="communityBanExpiry">Expires at (optional)</label>',
    '            <input id="communityBanExpiry" type="datetime-local">',
    '            <button class="secondary-btn" type="submit">Block source</button>',
    '          </form>',
    '          <div id="communityBanList" class="community-ban-list"></div>',
    '        </section>',
    '      </section>',
    '    </main>',
    renderSiteFooter('en'),
    '  </div>',
    '  <script src="' + staticAssetUrl('community-admin.js') + '" defer></script>',
    '</body>',
    '</html>',
  ].join('\n');
  return renderSiteDocument(meta, body, integrations);
}

// ── Homepage SSR ──

export function renderHomepage(data: HomepageData, lang: SiteLocale, integrations?: SiteIntegrations): string {
  const isZh = lang === 'zh';
  const ui = HOMEPAGE_UI_COPY[lang];
  const accounts = data.accounts && data.accounts.length > 0 ? data.accounts : ['thsottiaux'];
  const accountLabel = accounts.map(account => '@' + account).join(', ');
  const accountDescription = accounts.length === 1 && accounts[0] === 'thsottiaux'
    ? ui.accountDescription
    : accountLabel;
  const meta: SeoMeta = {
    lang,
    title: HOMEPAGE_COPY[lang].title,
    description: accounts.length === 1 && accounts[0] === 'thsottiaux'
      ? HOMEPAGE_COPY[lang].description
      : (isZh
        ? '追踪 ' + accountDescription + ' 公开发布的 OpenAI Codex 额度重置、ChatGPT Work 限额、GPT/Codex 速率限制与订阅政策更新。'
        : lang === 'en'
          ? 'Track public OpenAI Codex usage-limit resets, ChatGPT Work limits, GPT/Codex rate-limit changes and policy updates from ' + accountDescription + '.'
          : ui.intro),
    canonical: getCanonicalUrl(null, lang),
    isHomepage: true,
    eventId: null,
    enPath: '/',
    zhPath: '/zh/',
    alternatePaths: localizedPaths('/'),
    ogType: 'website',
  };

  const latestEvent = data.latestEvent;
  const resetEventForDisplay = data.latestDirectReset || data.lastReset;
  const manualReset = data.manualReset ?? null;
  const lastChecked = data.lastCheckedAt
    ? formatDateForLanguage(data.lastCheckedAt, lang)
    : ui.unknownChecked;
  const lastCheckedMarkup = data.lastCheckedAt
    ? localTimeElement(data.lastCheckedAt, lastChecked, 'status-time')
    : escapeHtml(lastChecked);

  const lastResetLabel = ui.lastReset;
  const policyLabel = ui.currentPolicy;
  const latestChangeLabel = ui.latestChange;
  const lastCheckedLabel = ui.lastChecked;
  const sourceStatusLabel = ui.sourceStatus;
  const sourceStatusValue = data.sourceMode === 'x_direct'
    ? ui.xDirect
    : data.sourceMode === 'web_indexed'
      ? ui.webIndexed
      : '—';

  const effectiveLastResetAt = manualReset?.resetAt
    ?? resetEventForDisplay?.reset_at
    ?? resetEventForDisplay?.effective_at
    ?? resetEventForDisplay?.published_at
    ?? null;
  const lastResetIsManual = Boolean(manualReset?.resetAt);
  const lastResetFallback = effectiveLastResetAt
    ? (lastResetIsManual
      ? formatManualResetTime(effectiveLastResetAt, lang)
      : formatDateForLanguage(effectiveLastResetAt, lang))
    : '—';
  const lastResetMarkup = effectiveLastResetAt
    ? (lastResetIsManual
      ? fixedTimezoneTimeElement(effectiveLastResetAt, lang, 'status-time manual-reset-time')
      : localTimeElement(effectiveLastResetAt, lastResetFallback, 'status-time'))
    : escapeHtml(lastResetFallback);
  const policyVal = data.lastPolicy
    ? eventTitle(data.lastPolicy, lang)
    : '—';
  const latestVal = latestEvent
    ? eventTitle(latestEvent, lang)
    : '—';
  const lastResetCardValue = effectiveLastResetAt
      ? (lastResetIsManual
      ? lastResetMarkup
      : renderHomepageEventLink(resetEventForDisplay, lang, lastResetMarkup, 'status_card', true))
    : escapeHtml(ui.statusUnknown);
  const policyCardValue = data.lastPolicy
    ? renderHomepageEventLink(data.lastPolicy, lang, policyVal, 'status_card')
    : escapeHtml(ui.statusUnknown);
  const latestCardValue = latestEvent
    ? renderHomepageEventLink(latestEvent, lang, latestVal, 'status_card')
    : escapeHtml(ui.statusUnknown);
  const statusAnswer = renderHomepageStatusAnswer(
    data,
    lang,
    lastResetMarkup,
    effectiveLastResetAt,
    resetEventForDisplay,
    lastCheckedMarkup,
    ui,
  );

  // SSR events list
  let eventsHtml = '';
  if (data.events.length === 0) {
    eventsHtml = '<li class="timeline-empty"><p>' + ui.noEvents + '</p></li>';
  } else {
    let lastDate = '';
    for (const event of data.events) {
      const dateStr = formatDateShort(event.published_at, lang);
      const showDate = dateStr !== lastDate;
      lastDate = dateStr;
      const title = eventTitle(event, lang);
      const summary = eventSummary(event, lang);
      const category = getCategoryLabel(event.category, lang);
      const eventUrl = getEventUrl(event.id!, lang);

      eventsHtml += [
        '<li class="timeline-item ' + event.category + '">',
        '  <div class="timeline-dot">',
        '    <div class="timeline-dot-marker"></div>',
        '  </div>',
        '  <div class="timeline-content">',
        (showDate ? '    <div class="timeline-date">' + localTimeElement(event.published_at, dateStr, 'timeline-date', 'date') + '</div>' : ''),
        '    <div style="margin-bottom:0.375rem">',
      '      <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
        '      <span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span>',
        '    </div>',
        '    <a href="' + escapeHtml(eventUrl) + '" class="timeline-title-link">',
        '      <h3 class="timeline-title">' + escapeHtml(title) + '</h3>',
        '    </a>',
        '    <div class="timeline-summary">' + escapeHtml(summary) + '</div>',
        '  </div>',
        '</li>',
      ].join('\n');
    }
  }

  // Latest event highlight
  let highlightHtml = '';
  if (latestEvent) {
    const title = eventTitle(latestEvent, lang);
    const summary = eventSummary(latestEvent, lang);
    const category = getCategoryLabel(latestEvent.category, lang);
    const eventUrl = getEventUrl(latestEvent.id!, lang);

    highlightHtml = [
      '<div class="event-highlight-card">',
      '  <div class="event-highlight-top">',
      '    <div>',
      '      <span class="category-badge category-' + latestEvent.category + '">',
      '        ' + escapeHtml(category),
      '      </span>',
      '      <span class="source-quality-badge ' + sourceQualityClass(latestEvent) + '">' + escapeHtml(getSourceQualityLabel(latestEvent, lang)) + '</span>',
      '    </div>',
    '    <div class="event-highlight-meta">',
      '      <span>' + localTimeElement(latestEvent.published_at, formatDateForLanguage(latestEvent.published_at, lang), 'event-time') + '</span>',
      latestEvent.source_url ? '      <a href="' + escapeHtml(latestEvent.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(latestEvent.id)) + '" data-analytics-event-category="' + escapeHtml(latestEvent.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(latestEvent)) + '">' + ui.source + ' →</a>' : '',
    '    </div>',
      '  </div>',
      '  <a href="' + escapeHtml(eventUrl) + '" class="event-highlight-title-link">',
      '    <h3 class="event-highlight-title">' + escapeHtml(title) + '</h3>',
      '  </a>',
      '  <div class="event-highlight-summary">' + escapeHtml(summary) + '</div>',
      '</div>',
    ].join('\n');
  } else {
    highlightHtml = '<div class="highlight-empty"><p>' + ui.noRecentEvents + '</p></div>';
  }

  // Intro paragraph
  const introText = accounts.length === 1 && accounts[0] === 'thsottiaux'
    ? ui.intro
    : (isZh
      ? '追踪 ' + accountDescription + ' 公开发布的 OpenAI Codex 额度重置、ChatGPT Work 限额、GPT/Codex 速率限制和订阅动态；每条事件都附来源和状态。'
      : lang === 'en'
        ? 'Track public OpenAI Codex usage-limit resets, ChatGPT Work limits, GPT/Codex rate-limit changes, and subscription updates from ' + accountDescription + '; every event includes its source and status.'
        : ui.intro);

  const manualResetNotice = manualReset
    ? [
      '    <section class="manual-reset-notice" id="manualResetNotice" aria-live="polite">',
      '      <div class="manual-reset-notice-title">' + ui.resetReportTitle + '</div>',
      '      <div class="manual-reset-notice-body">' + ui.resetReportBody + fixedTimezoneTimeElement(manualReset.resetAt, lang, 'manual-reset-time') + '</div>',
      manualReset.note ? '      <div class="manual-reset-notice-note">' + ui.note + escapeHtml(manualReset.note) + '</div>' : '',
      '      <div class="manual-reset-notice-meta">' + ui.automatedReport + '</div>',
      '    </section>',
    ].filter(Boolean).join('\n')
    : '    <section class="manual-reset-notice" id="manualResetNotice" style="display:none" aria-live="polite"></section>';

  // The same array is rendered below and represented in ItemList. Keeping
  // this as one value prevents SSR/schema count drift.
  const itemListJson = itemListSchema(data.events, lang);
  meta.structuredData = [websiteSchema(lang, introText)];

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { accounts, interactive: true }),
    '',
    '    <main class="homepage-main">',
    '      <section class="site-intro" aria-labelledby="pageTitle">',
    '        <h1 id="pageTitle">' + escapeHtml(meta.title) + '</h1>',
    '        <p class="intro-lede" id="introLede">' + escapeHtml(introText) + '</p>',
    '      </section>',
    '',
    statusAnswer,
    renderHomepageGambitModule(data.gambitArticles ?? [], lang),
    '',
    manualResetNotice,
    '',
    '    <!-- Reset Countdown -->',
    '    <section class="countdown-section" id="countdownSection" style="display:none">',
    '      <div class="countdown-header">',
    '        <span class="countdown-title" id="countdownTitle">' + ui.resetCountdown + '</span>',
    '        <span class="countdown-status-badge" id="countdownStatusBadge"></span>',
    '      </div>',
    '      <div class="countdown-display" id="countdownDisplay">',
    '        <div class="countdown-time" id="countdownTime">--:--:--</div>',
    '        <div class="countdown-info" id="countdownInfo"></div>',
    '      </div>',
    '      <div class="countdown-empty" id="countdownEmpty">',
    '        <p id="countdownEmptyText">' + ui.noResetScheduled + '</p>',
    '        <div class="countdown-history-reference" id="countdownHistoryReference" style="display:none" aria-live="polite">',
    '          <div class="countdown-history-line" id="countdownDaysSinceLastReset"></div>',
    '          <div class="countdown-history-line" id="countdownAverageResetInterval"></div>',
    '          <div class="countdown-history-disclaimer" id="countdownHistoryDisclaimer">' + ui.historicalReference + '</div>',
    '        </div>',
    '      </div>',
    '    </section>',
    '',
    '    <!-- Status Cards -->',
    '    <section class="status-grid" id="statusGrid">',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelLastReset">' + lastResetLabel + '</div>',
    '        <div class="status-card-value" id="lastResetValue">' + lastResetCardValue + '</div>',
    '      </div>',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelCurrentPolicy">' + policyLabel + '</div>',
    '        <div class="status-card-value" id="currentPolicyValue">' + policyCardValue + '</div>',
    '      </div>',
    '      <div class="status-card">',
    '        <div class="status-card-label" id="cardLabelLatestChange">' + latestChangeLabel + '</div>',
    '        <div class="status-card-value" id="latestChangeValue">' + latestCardValue + '</div>',
    '      </div>',
      '      <div class="status-card">',
      '        <div class="status-card-label" id="cardLabelLastChecked">' + lastCheckedLabel + '</div>',
      '        <div class="status-card-value" id="lastCheckedValue">' + lastCheckedMarkup + '</div>',
      '      </div>',
      '      <div class="status-card">',
      '        <div class="status-card-label" id="cardLabelSourceStatus">' + sourceStatusLabel + '</div>',
      '        <div class="status-card-value" id="sourceStatusValue">' + escapeHtml(sourceStatusValue) + '</div>',
      '      </div>',
    '    </section>',
    '',
    '    <!-- Latest Event Highlight -->',
    '    <section class="latest-event" id="latestEvent">',
    '      <h2 id="latestEventTitle">' + ui.latestEvent + '</h2>',
    '      <div class="event-highlight" id="eventHighlight">',
    highlightHtml,
    '      </div>',
    '    </section>',
    '',
    '    <!-- Timeline -->',
    '    <section class="timeline-section">',
    '      <div class="section-header">',
    '        <h2 id="timelineTitle">' + ui.timeline + '</h2>',
    '        <div class="filter-bar">',
    '          <button class="filter-btn active" data-filter="ALL" id="filterAll">' + ui.all + '</button>',
    '          <button class="filter-btn" data-filter="RESET_PLANNED" id="filterResetPlanned">' + ui.resetPlanned + '</button>',
    '          <button class="filter-btn" data-filter="RESET_COMPLETED" id="filterResetCompleted">' + ui.resetCompleted + '</button>',
    '          <button class="filter-btn" data-filter="RESET_TIME_CHANGED" id="filterTimeChanged">' + ui.timeChanged + '</button>',
    '          <button class="filter-btn" data-filter="POLICY_CHANGE" id="filterPolicyChange">' + ui.policy + '</button>',
    '          <button class="filter-btn" data-filter="CODEX_UPDATE" id="filterCodexUpdate">' + ui.codexUpdate + '</button>',
    '          <button class="filter-btn" data-filter="ROADMAP_HINT" id="filterRoadmapHint">' + ui.roadmapHint + '</button>',
    '          <button class="filter-btn" data-filter="FEATURE_DISCUSSION" id="filterFeatureDiscussion">' + ui.featureDiscussion + '</button>',
    '        </div>',
    '      </div>',
    '      <div class="event-tools" id="eventTools">',
    '        <form class="event-search-form" id="eventSearchForm" role="search">',
    '          <label class="sr-only" id="eventSearchLabel" for="eventSearchInput">' + ui.searchEvents + '</label>',
    '          <div class="search-input-wrap">',
    '            <svg class="search-input-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>',
    '            <input id="eventSearchInput" type="search" autocomplete="off" maxlength="120" placeholder="' + ui.searchPlaceholder + '">',
    '          </div>',
    '          <div class="date-filter-group">',
    '            <label for="startDateInput" id="startDateLabel">' + ui.from + '</label>',
    '            <input id="startDateInput" type="date">',
    '            <label for="endDateInput" id="endDateLabel">' + ui.to + '</label>',
    '            <input id="endDateInput" type="date">',
    '          </div>',
    '          <button class="secondary-btn" type="button" id="clearFilters">' + ui.clear + '</button>',
    '        </form>',
    '        <div class="export-actions">',
    '          <span class="export-label" id="exportLabel">' + ui.export + '</span>',
    '          <button class="export-btn" type="button" data-export-format="csv" id="exportCsv">CSV</button>',
    '          <button class="export-btn" type="button" data-export-format="json" id="exportJson">JSON</button>',
    '          <span class="export-status" id="exportStatus" role="status" aria-live="polite"></span>',
    '        </div>',
    '      </div>',
      '      <ol class="timeline" id="timeline">',
    eventsHtml,
    '      </ol>',
    (data.events.length === 0
      ? '      <div class="timeline-loading" id="timelineLoading" style="display:none">\n' +
        '        <div class="loading-spinner"></div>\n' +
        '        <span id="loadingText">' + ui.loading + '</span>\n' +
        '      </div>'
      : ''),
    '    </section>',
    '    </main>',
    '',
    '    <!-- Event Detail Modal -->',
    '    <div class="modal-overlay" id="eventModal" style="display:none">',
    '      <div class="modal">',
    '        <button class="modal-close" id="modalClose">&times;</button>',
    '        <div class="modal-content" id="modalContent">',
    '        </div>',
    '      </div>',
    '    </div>',
    '',
    renderSiteFooter(lang),
    '  </div>',
    '',
    '  <script src="' + staticAssetUrl('app.js') + '" defer></script>',
    '',
    '  <!-- SSR Data (consumed by app.js) -->',
    '  <script>',
    '    window.__SSR_META__ = ' + safeJsonForScript({
      lang: SITE_HTML_LANG[lang],
      title: meta.title,
      description: meta.description,
      canonical: meta.canonical,
    }) + ';',
    '    window.__SSR_EVENTS__ = ' + safeJsonForScript(data.events) + ';',
    '    window.__SSR_LATEST_EVENT__ = ' + safeJsonForScript(data.latestEvent) + ';',
    '    window.__SSR_LAST_RESET__ = ' + safeJsonForScript(data.lastReset) + ';',
    '    window.__SSR_LATEST_DIRECT_RESET__ = ' + safeJsonForScript(data.latestDirectReset ?? null) + ';',
    '    window.__SSR_MANUAL_RESET__ = ' + safeJsonForScript(manualReset) + ';',
    '    window.__SSR_LAST_POLICY__ = ' + safeJsonForScript(data.lastPolicy) + ';',
    '    window.__SSR_LAST_CHECKED__ = ' + safeJsonForScript(data.lastCheckedAt) + ';',
    '    window.__SSR_SOURCE_FETCHED__ = ' + safeJsonForScript(data.sourceLastFetchedAt ?? null) + ';',
    '    window.__SSR_SOURCE_LAST_NEW_POST__ = ' + safeJsonForScript(data.sourceLastNewPostAt ?? null) + ';',
    '    window.__SSR_SOURCE_MODE__ = ' + safeJsonForScript(data.sourceMode ?? null) + ';',
    '    window.__SSR_ACCOUNTS__ = ' + safeJsonForScript(accounts) + ';',
    '    window.__SSR_TOTAL_EVENTS__ = ' + data.totalEvents + ';',
    '  </script>',
    '',
    '  <!-- ItemList Structured Data -->',
    '  <script type="application/ld+json">',
    itemListJson,
    '</script>',
    '',
    '</body>',
    '</html>',
  ].join('\n');

  return renderSiteDocument(meta, body, integrations);
}

// ── Event Page SSR ──

export function renderEventPage(data: EventPageData, lang: SiteLocale, integrations?: SiteIntegrations): string {
  const event = data.event;
  const isZh = lang === 'zh';

  const title = eventPageHeadline(event, lang);
  const description = eventSummary(event, lang);
  const metaDescription = eventPageDescription(event, lang);
  const category = getCategoryLabel(event.category, lang);
  const sourceAccount = event.source_account
    ? (event.source_account === 'thsottiaux' ? 'Tibo (@thsottiaux)' : '@' + event.source_account)
    : (isZh ? '未知' : 'Unknown');

  const meta: SeoMeta = {
    lang,
    title: title + ' — ' + MODELYARD_BRAND + ' · ' + SITE_BRAND_COPY[lang].monitor,
    description: metaDescription,
    canonical: getCanonicalUrl(event.id!, lang),
    isHomepage: false,
    eventId: event.id!,
    enPath: getEventUrl(event.id!, 'en'),
    zhPath: getEventUrl(event.id!, 'zh'),
    alternatePaths: eventAlternatePaths(event),
    ogType: 'article',
    robots: isEventIndexEligible(event) && eventHasLocalizedContent(event, lang) ? 'index, follow' : 'noindex, follow',
    publishedAt: event.published_at,
    modifiedAt: event.updated_at,
  };

  const unavailable = isZh ? '未知' : 'Unknown';
  const pendingVerification = isZh ? '待验证' : 'Pending verification';
  const pubTime = event.published_at
    ? formatDateForLanguage(event.published_at, lang)
    : unavailable;
  const localPubTime = localTimeElement(event.published_at, pubTime, 'event-detail-time');
  const observedTime = event.observed_at
    ? localTimeElement(event.observed_at, formatDateForLanguage(event.observed_at, lang), 'event-detail-time')
    : escapeHtml(unavailable);
  const verifiedTime = event.verified_at
    ? localTimeElement(event.verified_at, formatDateForLanguage(event.verified_at, lang), 'event-detail-time')
    : escapeHtml(pendingVerification);
  const effectiveTime = event.effective_at
    ? eventDateMarkup(event.effective_at, lang, 'event-detail-time')
    : '';
  const resetTime = event.reset_at
    ? eventDateMarkup(event.reset_at, lang, 'event-detail-time')
    : '';

  // Build structured content sections
  const sections: string[] = [];

  // What changed?
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '变更内容' : 'What Changed') + '</h2>',
    '  <div class="modal-value">' + escapeHtml(title) + '</div>',
    '</section>',
  ].join('\n'));

  // Evidence provenance is intentionally visible next to the event details.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '验证' : 'Verification') + '</h2>',
    '  <dl class="event-facts">',
    '    <div><dt>' + (isZh ? '来源类型' : 'Source type') + '</dt><dd><span class="source-quality-badge ' + sourceQualityClass(event) + '">' + escapeHtml(getSourceQualityLabel(event, lang)) + '</span></dd></div>',
    '    <div><dt>' + (isZh ? '状态' : 'Status') + '</dt><dd><code>' + escapeHtml(getVerificationStatusCode(event)) + '</code> · ' + escapeHtml(getVerificationLabel(event, lang)) + '</dd></div>',
    '    <div><dt>' + (isZh ? '发现方式' : 'Found via') + '</dt><dd>' + escapeHtml(event.first_discovered_via || unavailable) + '</dd></div>',
    '    <div><dt>' + (isZh ? '验证方式' : 'Verified via') + '</dt><dd>' + escapeHtml(event.last_verified_via || pendingVerification) + '</dd></div>',
    '  </dl>',
    '</section>',
  ].join('\n'));

  // Summary
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '摘要' : 'Summary') + ' <span class="modal-tag ai">AI summary</span></h2>',
    '  <div class="modal-value ai-summary">' + escapeHtml(description) + '</div>',
    '</section>',
  ].join('\n'));

  // Keep the interpretation close to the source without repeating a general
  // account-scope disclaimer on every event page.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '这意味着什么？' : 'What does this mean?') + '</h2>',
    '  <p class="modal-value">' + escapeHtml(eventInterpretation(event, lang)) + '</p>',
    '</section>',
  ].join('\n'));

  // Category
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '类型' : 'Type') + '</h2>',
    '  <div>',
    '    <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
    '  </div>',
    '</section>',
  ].join('\n'));

  // Dates are kept distinct: publication is source time, observed is fetch
  // time, and verified is the event-level verification timestamp.
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '时间' : 'Event dates') + '</h2>',
    '  <dl class="event-facts">',
    '    <div><dt>' + (isZh ? '发布时间' : 'Published') + '</dt><dd>' + localPubTime + '</dd></div>',
    '    <div><dt>' + (isZh ? '观察时间' : 'Observed') + '</dt><dd>' + observedTime + '</dd></div>',
    '    <div><dt>' + (isZh ? '最近验证' : 'Last verified') + '</dt><dd>' + verifiedTime + '</dd></div>',
    effectiveTime ? '    <div><dt>' + (isZh ? '生效时间' : 'Effective') + '</dt><dd>' + effectiveTime + '</dd></div>' : '',
    resetTime ? '    <div><dt>' + (isZh ? '重置时间' : 'Reset time') + '</dt><dd>' + resetTime + '</dd></div>' : '',
    event.updated_at ? '    <div><dt>' + (isZh ? '记录更新时间' : 'Record updated') + '</dt><dd>' + eventDateMarkup(event.updated_at, lang, 'event-detail-time') + '</dd></div>' : '',
    '</dl>',
    '</section>',
  ].join('\n'));

  // Original source
  if (event.source_text) {
    const excerpt = event.source_text.length > 500
      ? event.source_text.substring(0, 500) + '...'
      : event.source_text;
    sections.push([
      '<section class="modal-section">',
      '  <h2 class="modal-label">' + (isZh ? '原始来源' : 'Original Source') + ' <span class="modal-tag source">' + (isZh ? '证据' : 'Evidence') + '</span></h2>',
      '  <div class="modal-value source-text">' + escapeHtml(excerpt) + '</div>',
      '</section>',
    ].join('\n'));
  }

  // Source account
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '来源' : 'Source') + '</h2>',
    '  <div class="modal-value">' + escapeHtml(sourceAccount) + '</div>',
    '</section>',
  ].join('\n'));

  // View original
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '查看原帖' : 'View Original') + '</h2>',
    event.source_url
      ? '  <a class="modal-link" href="' + escapeHtml(event.source_url) + '" target="_blank" rel="noopener noreferrer" data-analytics-link-type="source" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '">' + (isZh ? '打开来源 →' : 'Open source →') + '</a>'
      : '  <div class="modal-value">' + escapeHtml(unavailable) + '</div>',
    '</section>',
  ].join('\n'));

  // Confidence
  const confidencePercent = Math.round(event.confidence * 100);
  sections.push([
    '<section class="modal-section">',
    '  <h2 class="modal-label">' + (isZh ? '置信度' : 'Confidence') + '</h2>',
    '  <div class="modal-value">' + confidencePercent + '%</div>',
    '</section>',
  ].join('\n'));

  // Breadcrumb
  const breadcrumbJson = breadcrumbSchema([
    { name: SITE_BRAND_COPY[lang].home, url: getCanonicalUrl(null, lang) },
    { name: title, url: getCanonicalUrl(event.id!, lang) },
  ]);
  meta.structuredData = [
    websiteSchema(lang),
    articleSchema(event, lang, meta.canonical!),
    breadcrumbJson,
  ];

  // Navigation
  let navHtml = '';
  if (data.prevEvent) {
    const prevTitle = eventTitle(data.prevEvent, lang);
    navHtml += '<a href="' + getEventUrl(data.prevEvent.id!, lang) + '" class="event-nav-prev">← ' + escapeHtml(prevTitle) + '</a>';
  }
  if (data.nextEvent) {
    const nextTitle = eventTitle(data.nextEvent, lang);
    navHtml += '<a href="' + getEventUrl(data.nextEvent.id!, lang) + '" class="event-nav-next">' + escapeHtml(nextTitle) + ' →</a>';
  }

  // Related events
  let relatedHtml = '';
  if (data.relatedEvents.length > 0) {
    relatedHtml = '<section class="related-events"><h2>' + (isZh ? '同类型事件' : 'More events in this category') + '</h2><ol>';
    for (const re of data.relatedEvents) {
      const reTitle = eventTitle(re, lang);
      const reDate = formatDateShort(re.published_at, lang);
      relatedHtml += '<li><a href="' + getEventUrl(re.id!, lang) + '">' + escapeHtml(reTitle) + '</a> <span class="event-date">' + localTimeElement(re.published_at, reDate, 'event-date', 'date') + '</span></li>';
    }
    relatedHtml += '</ol></section>';
  }
  const topicHtml = '<p class="event-topic-link">' + (isZh ? '主题入口：' : 'Topic: ') + '<a href="' + getTopicPath(event.category, lang) + '">' + escapeHtml(getTopicLabel(event.category, lang)) + '</a></p>';
  const contextHtml = [
    '<section class="event-context">',
    '  <h2>' + (isZh ? '历史上下文' : 'Historical context') + '</h2>',
    '  <p>' + (isZh ? '查看前后事件或' : 'See the previous/next events or the ') + '<a href="' + getTopicPath(event.category, lang) + '">' + (isZh ? '主题时间线' : 'topic timeline') + '</a>。</p>',
    '</section>',
  ].join('\n');

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: getEventUrl(event.id!, lang === 'en' ? 'zh' : 'en') }),
    '',
    '    <!-- Breadcrumb -->',
    '    <nav class="breadcrumb" aria-label="' + (isZh ? '面包屑导航' : 'Breadcrumb') + '">',
    '      <a href="' + getHomePath(lang) + '">' + (isZh ? '首页' : 'Home') + '</a>',
    '      <span class="breadcrumb-sep">/</span>',
    '      <span class="breadcrumb-current">' + escapeHtml(title) + '</span>',
    '    </nav>',
    '',
    '    <main>',
    '      <!-- Event Detail -->',
    '      <article class="event-detail-page" data-analytics-page-type="event_detail" data-analytics-event-id="' + escapeHtml(String(event.id)) + '" data-analytics-event-category="' + escapeHtml(event.category) + '" data-analytics-evidence-source="' + escapeHtml(analyticsEvidenceSource(event)) + '" data-analytics-verification-status="' + escapeHtml(getVerificationStatusCode(event)) + '">',
    '      <header class="event-detail-header">',
    '        <h1 class="event-detail-title">' + escapeHtml(title) + '</h1>',
    '        <div class="event-detail-meta">',
    '          <span class="category-badge category-' + event.category + '">' + escapeHtml(category) + '</span>',
    '          ' + localTimeElement(event.published_at, pubTime, 'event-detail-date'),
    '        </div>',
    '      </header>',
    '',
    renderEventAnswerPanel(event, lang, description),
    '',
    '      <div class="event-detail-body">',
    sections.join('\n'),
    '      </div>',
    '',
    contextHtml,
    '',
    '      <!-- Event Navigation -->',
    '      <nav class="event-navigation" aria-label="' + (isZh ? '事件时间顺序' : 'Event chronology') + '">',
    navHtml,
    '      </nav>',
    '',
    topicHtml,
    relatedHtml,
    '',
    '      </article>',
    '    </main>',
    '',
    renderSiteFooter(lang),
    '  </div>',
    '',
    '</body>',
    '</html>',
  ].join('\n');

  return renderSiteDocument(meta, body, integrations);
}

// ── 404 Page ──

export function render404(lang: SiteLocale, integrations?: SiteIntegrations): string {
  const brandCopy = SITE_BRAND_COPY[lang];
  const meta: SeoMeta = {
    lang,
    title: brandCopy.pageNotFoundTitle + ' — ' + brandCopy.monitor,
    description: brandCopy.pageDoesNotExist,
    canonical: null,
    isHomepage: false,
    eventId: null,
    robots: 'noindex, nofollow',
  };

  const body = [
    '<body>',
    '  <div id="app">',
    renderSiteHeader(lang, { alternatePath: null }),
    '    <main class="not-found-page">',
    '      <h1>404 — ' + escapeHtml(brandCopy.pageNotFound) + '</h1>',
    '      <p>' + escapeHtml(brandCopy.pageDoesNotExist) + '</p>',
    '      <nav aria-label="' + escapeHtml(brandCopy.helpfulNavigation) + '">',
    '        <a href="' + getHomePath(lang) + '">' + escapeHtml(brandCopy.home) + '</a>',
    '        <a href="' + getLandingPath('latest', lang) + '">' + escapeHtml(PRIMARY_NAV_LABELS[lang].latest) + '</a>',
    '        <a href="' + getLandingPath('reset-history', lang) + '">' + escapeHtml(PRIMARY_NAV_LABELS[lang]['reset-history']) + '</a>',
    '        <a href="' + getCommunityPath(lang) + '">' + escapeHtml(PRIMARY_NAV_LABELS[lang].community) + '</a>',
    '        <a href="' + getLandingPath('faq', lang) + '">' + escapeHtml(PRIMARY_NAV_LABELS[lang].faq) + '</a>',
    '      </nav>',
    '    </main>',
    renderSiteFooter(lang),
    '  </div>',
    '</body>',
    '</html>',
  ].join('\n');

  return renderSiteDocument(meta, body, integrations);
}

// ── RSS Feed ──

function rssDate(value: string | null | undefined): string {
  if (!value) return new Date(0).toUTCString();
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + 'Z'
    : value;
  const parsed = parseStoredUtc(sqliteUtc);
  return parsed ? parsed.toUTCString() : new Date(0).toUTCString();
}

export function renderRssFeed(
  events: MonitorEvent[],
  lang: SiteLocale = 'zh',
  manualReset: ManualResetReportPublic | null = null,
  siteUrl?: string,
): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const visibleEvents = events.filter(event => event.id !== undefined).slice(0, 20);
  const channelTitle = MODELYARD_BRAND + ' · ' + SITE_BRAND_COPY[lang].monitor;
  const channelDescription = lang === 'zh'
    ? '追踪 Tibo（@thsottiaux）公开发布的 Codex 额度重置、限额和订阅政策事件。'
    : 'Public Codex usage-limit reset, rate-limit and subscription policy events tracked by Tibo Monitor.';
  const eventItems = visibleEvents.map(event => {
    const title = eventTitle(event, lang);
    const summary = eventSummary(event, lang);
    const eventUrl = baseUrl + getEventUrl(event.id!, lang);
    const description = [
      summary,
      event.source_text ? (lang === 'zh' ? '原始来源：' : 'Source text: ') + event.source_text : '',
      event.source_url ? (lang === 'zh' ? '来源链接：' : 'Source: ') + event.source_url : '',
    ].filter(Boolean).join('\n\n');
    return {
      date: event.published_at || event.created_at || new Date(0).toISOString(),
      markup: [
      '    <item>',
      '      <title>' + escapeXml(title) + '</title>',
      '      <description>' + escapeXml(description) + '</description>',
      '      <link>' + escapeXml(eventUrl) + '</link>',
      '      <guid isPermaLink="true">' + escapeXml(eventUrl) + '</guid>',
      '      <pubDate>' + rssDate(event.published_at || event.created_at) + '</pubDate>',
      '      <category>' + escapeXml(getCategoryLabel(event.category, lang)) + '</category>',
      '    </item>',
      ].join('\n'),
    };
  });

  const feedItems = [...eventItems];
  if (manualReset) {
    const manualTitle = lang === 'zh' ? '服务器报告：额度已重置' : 'Server report: usage reset';
    const manualDescription = [
      lang === 'zh'
        ? '服务器报告额度已重置。 ' + formatManualResetTime(manualReset.resetAt, lang)
        : 'Server reported a usage reset. ' + formatManualResetTime(manualReset.resetAt, lang),
      lang === 'zh' ? '系统自动报告。' : 'Automated report.',
      manualReset.note ? (lang === 'zh' ? '备注：' : 'Note: ') + manualReset.note : '',
    ].filter(Boolean).join('\n\n');
    const homepageUrl = baseUrl + (lang === 'zh' ? '/zh/' : '/');
    feedItems.push({
      date: manualReset.resetAt,
      markup: [
        '    <item>',
        '      <title>' + escapeXml(manualTitle) + '</title>',
        '      <description>' + escapeXml(manualDescription) + '</description>',
        '      <link>' + escapeXml(homepageUrl) + '</link>',
        '      <guid isPermaLink="false">system-reset-report:' + manualReset.id + '</guid>',
        '      <pubDate>' + rssDate(manualReset.resetAt) + '</pubDate>',
        '      <category>' + escapeXml(lang === 'zh' ? '服务器报告' : 'Server report') + '</category>',
        '    </item>',
      ].join('\n'),
    });
  }
  feedItems.sort((left, right) => {
    const leftTime = parseStoredUtc(left.date)?.getTime() ?? Number.NaN;
    const rightTime = parseStoredUtc(right.date)?.getTime() ?? Number.NaN;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  const items = feedItems.slice(0, 20).map(item => item.markup);
  const latestDate = feedItems[0]?.date;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>' + escapeXml(channelTitle) + '</title>',
    '    <link>' + baseUrl + (lang === 'zh' ? '/zh/' : '/') + '</link>',
    '    <description>' + escapeXml(channelDescription) + '</description>',
    '    <language>' + (lang === 'zh' ? 'zh-CN' : 'en') + '</language>',
    '    <lastBuildDate>' + rssDate(latestDate || new Date().toISOString()) + '</lastBuildDate>',
    '    <atom:link href="' + baseUrl + '/feed.xml" rel="self" type="application/rss+xml" />',
    items.join('\n'),
    '  </channel>',
    '</rss>',
  ].join('\n');
}

// ── Sitemap XML ──

export interface SitemapLandingPage {
  page: LandingPageKey;
  indexable: boolean;
  lastmod?: string | null;
}

export interface GambitSitemapArticle {
  slug: string;
  modifiedAt?: string | null;
}

export function renderSitemap(events: MonitorEvent[], lastmod: string | null, landingPages: SitemapLandingPage[] = [], gambitArticles: GambitSitemapArticle[] = [], siteUrl?: string): string {
  const baseUrl = normalizeSiteUrl(siteUrl);
  const urls: string[] = [];
  const normalizedLastmod = normalizeSitemapDate(lastmod);

  // Homepage
  urls.push([
    '  <url>',
    '    <loc>' + baseUrl + '/</loc>',
    sitemapLastmodMarkup(normalizedLastmod),
    '    <changefreq>hourly</changefreq>',
    '    <priority>1.0</priority>',
    '  </url>',
  ].join('\n'));

  for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en')) {
    urls.push([
      '  <url>',
      '    <loc>' + baseUrl + localePath('/', locale) + '</loc>',
      sitemapLastmodMarkup(normalizedLastmod),
      '    <changefreq>hourly</changefreq>',
      '    <priority>0.9</priority>',
      '  </url>',
    ].join('\n'));
  }

  // Community is one stable landing page per language. Individual anonymous
  // posts intentionally do not receive indexable URLs.
  urls.push(SITE_LOCALES.map(locale => [
    '  <url>',
    '    <loc>' + getCommunityUrl(locale, baseUrl) + '</loc>',
    sitemapLastmodMarkup(normalizedLastmod),
    '    <changefreq>daily</changefreq>',
    '    <priority>0.8</priority>',
    '  </url>',
  ].join('\n')).join('\n'));

  // Core landing pages are included only when they are index-eligible. The
  // dynamic aggregations become noindex when their underlying category has no
  // real events; FAQ and methodology remain indexable because they contain
  // their own substantive content.
  for (const landing of landingPages) {
    if (!landing.indexable) continue;
    const landingLastmod = normalizeSitemapDate(landing.lastmod || lastmod);
    urls.push(SITE_LOCALES.map(locale => [
      '  <url>',
      '    <loc>' + getLandingUrl(landing.page, locale, baseUrl) + '</loc>',
      sitemapLastmodMarkup(landingLastmod),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
    ].join('\n')).join('\n'));
  }

  // Open Gambit has a substantive landing page even when it has no articles;
  // individual URLs are included only for published articles supplied by the
  // caller. English and Chinese are the V1 locales for this domain.
  urls.push(['en', 'zh'].map(locale => [
    '  <url>',
    '    <loc>' + baseUrl + OPEN_GAMBIT_PATHS[locale as 'en' | 'zh'] + '</loc>',
    sitemapLastmodMarkup(normalizedLastmod),
    '    <changefreq>daily</changefreq>',
    '    <priority>0.7</priority>',
    '  </url>',
  ].join('\n')).join('\n'));
  for (const article of gambitArticles) {
    const articleLastmod = normalizeSitemapDate(article.modifiedAt || lastmod);
    urls.push(['en', 'zh'].map(locale => [
      '  <url>',
      '    <loc>' + baseUrl + OPEN_GAMBIT_PATHS[locale as 'en' | 'zh'] + encodeURIComponent(article.slug) + '/</loc>',
      sitemapLastmodMarkup(articleLastmod),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.7</priority>',
      '  </url>',
    ].join('\n')).join('\n'));
  }

  // Event pages
  for (const event of events) {
    if (!event.id || !isEventIndexEligible(event)) continue;
    const eventUpdated = normalizeSitemapDate(event.updated_at || event.created_at || lastmod);
    urls.push([
      '  <url>',
      '    <loc>' + baseUrl + '/events/' + event.id + '</loc>',
      sitemapLastmodMarkup(eventUpdated),
      '    <changefreq>daily</changefreq>',
      '    <priority>0.8</priority>',
      '  </url>',
    ].join('\n'));

    for (const locale of SITE_LOCALES.filter(candidate => candidate !== 'en' && eventHasLocalizedContent(event, candidate))) {
      urls.push([
        '  <url>',
        '    <loc>' + baseUrl + getEventUrl(event.id, locale) + '</loc>',
        sitemapLastmodMarkup(eventUpdated),
        '    <changefreq>daily</changefreq>',
        '    <priority>0.7</priority>',
        '  </url>',
      ].join('\n'));
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls.join('\n'),
    '</urlset>',
  ].join('\n');
}

function sitemapLastmodMarkup(value: string | null): string {
  return value ? '    <lastmod>' + value + '</lastmod>' : '';
}

function normalizeSitemapDate(value: string | null | undefined): string | null {
  const source = value?.trim() || '';
  if (!source) return null;
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source)
    ? source.replace(' ', 'T') + 'Z'
    : source;
  const parsed = new Date(sqliteUtc);
  return Number.isNaN(parsed.getTime()) ? source.slice(0, 10) : parsed.toISOString();
}
