export const COMMUNITY_TOPICS = [
  'general',
  'ai-coding',
  'llm',
  'rag',
  'agents',
  'prompts',
  'ai-tools',
  'open-source',
] as const;

export type CommunityTopic = typeof COMMUNITY_TOPICS[number];

export const COMMUNITY_TOPIC_LABELS: Record<CommunityTopic, { en: string; zh: string; ja: string; es: string; fr: string }> = {
  general: { en: 'General', zh: '综合', ja: '一般', es: 'General', fr: 'Général' },
  'ai-coding': { en: 'AI coding', zh: 'AI 编程', ja: 'AI コーディング', es: 'Programación con IA', fr: 'Programmation IA' },
  llm: { en: 'LLMs', zh: '大语言模型', ja: 'LLM', es: 'LLM', fr: 'LLM' },
  rag: { en: 'RAG', zh: 'RAG', ja: 'RAG', es: 'RAG', fr: 'RAG' },
  agents: { en: 'Agents', zh: '智能体', ja: 'エージェント', es: 'Agentes', fr: 'Agents' },
  prompts: { en: 'Prompts', zh: '提示词', ja: 'プロンプト', es: 'Prompts', fr: 'Prompts' },
  'ai-tools': { en: 'AI tools', zh: 'AI 工具', ja: 'AI ツール', es: 'Herramientas de IA', fr: 'Outils IA' },
  'open-source': { en: 'Open source', zh: '开源项目', ja: 'オープンソース', es: 'Código abierto', fr: 'Open source' },
};

export function isCommunityTopic(value: unknown): value is CommunityTopic {
  return typeof value === 'string' && (COMMUNITY_TOPICS as readonly string[]).includes(value);
}
