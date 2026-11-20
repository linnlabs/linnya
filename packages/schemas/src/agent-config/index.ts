/**
 * @file packages/schemas/src/agent-config/index.ts
 * @brief 内置 Prompt Key 常量（前后端共享）
 *
 * @description
 * 🎯 内置 promptKey 的稳定常量定义处。跨端 API wire contract 只承诺 string，
 * 插件自带 promptKey 由 app-host registry 注册与校验，不需要写入这里。
 * ⚠️ 内置 key 如需引用，必须从本文件或通过 @app/schemas 导入，避免散落字符串。
 */

// =============================================================================
// 🎯 内置 PromptKeys 常量
// =============================================================================

export const PromptKeys = {
  // ---- 通用（Chat + Agent 共用） ----
  /** 默认对话 / 默认 Agent */
  DEFAULT: 'default',
  /** AI 写作 */
  WRITING: 'writing',
  /** 批注 */
  ANNOTATION: 'annotation',
  /** 自动补全 */
  AUTOCOMPLETE: 'autocomplete',
  /** 表格 AI 填充 */
  TABLE_AI_FILL: 'table_ai_fill',
  /** 系统发起 batch 的收尾 Agent（无工具，只负责总结） */
  SYSTEM_BATCH_SUMMARIZER: 'system_batch_summarizer',
  /** 对话活动 batch/subrun 端到端 Spike（显式环境开关启用） */
  /** 通用翻译 */
  TRANSLATION: 'translation',
  /** 音频转录纪要/摘要 */
  AUDIO_SUMMARY: 'audio_summary',
  /** 新对话标题生成 */
  CONVERSATION_TITLE: 'conversation_title',

  // ---- Agent 系统 ----
  /** Agent 系统级提示（内部） */
  AGENT_SYSTEM: 'agent_system',
  /** Agent 默认提示模板 ID（与 DEFAULT 区分：DEFAULT 是分发 key，AGENT_DEFAULT 是 prompt template ID） */
  AGENT_DEFAULT: 'agent_default',
  /** 项目初始化 / 项目规划 */
  PROJECT_PLANNING: 'project_planning',

  // ---- Review ----
  /** 审阅（Review）：通过工具创建批注 */
  REVIEW: 'review',

  // ---- 子 Agent ----
  /** 通用子 Agent（内部：subagent 工具使用），不依赖 default agent 的通用提示词 */
  SUBAGENT_GENERAL: 'subagent_general',
  /** 文档编辑专用子 Agent：专注 Markdown 文档编辑 */
  SUBAGENT_DOCUMENT_EDITOR: 'subagent_document_editor',
  // ---- Deep Search ----
  /** Deep Search Agent：知识库深度搜索 */
  DEEP_SEARCH: 'deep_search',
  DEEP_WEB_SEARCH: 'deep_web_search',

  // ---- 正式研究专项角色（v1 是持久身份，不是方法或 Skill 版本） ----
  RESEARCH_AUTHOR_V1: 'research_author_v1',
  RESEARCH_INVESTIGATION_REVIEW_V1: 'research_investigation_review_v1',
  RESEARCH_ARGUMENT_REVIEW_V1: 'research_argument_review_v1',
  RESEARCH_SOURCE_REVIEW_V1: 'research_source_review_v1',

  // ---- Internal（后端内部任务） ----
  /** PDF 视觉识别 */
  PDF_OCR: 'pdf_ocr',
  /** 图像描述 */
  IMAGE_DESCRIPTION: 'image_description',
  /** 软知识图谱抽取 */
  KNOWLEDGE_GRAPH_EXTRACTION: 'knowledge_graph_extraction',
} as const;

/** 所有 promptKey 的联合类型 */
export type PromptKey = typeof PromptKeys[keyof typeof PromptKeys];

/** 内置 PromptKey 值元组（供内置功能强类型与局部校验使用；跨端 API wire 只要求 string）。 */
export const PROMPT_KEY_VALUES = Object.values(PromptKeys) as [PromptKey, ...PromptKey[]];

// =============================================================================
// 🪦 已退役 Agent 身份
// =============================================================================

/**
 * 已删除定义的旧版深度研究 beta 与 CLI 实验身份。
 *
 * 这些 Agent 的 AgentDefinition.id 与 promptKey 相同，因此同一份列表同时识别会话选中 Agent、
 * 运行记录里的 Agent 身份和请求 promptKey。它只用于历史展示回退和拒绝/终止旧运行，
 * 不得映射到正式“研究”或 Default。
 */
export const RETIRED_DEEP_RESEARCH_AGENT_IDS = [
  'deep_research_leader',
  'deep_research_scout',
  'deep_research_reasoner_1',
  'deep_research_reasoner_2',
  'deep_research_challenger',
  'deep_research_experimental',
  'deep_research_investigation_review',
  'deep_research_argument_review',
  'deep_research_source_review',
] as const;

const RETIRED_DEEP_RESEARCH_AGENT_ID_SET: ReadonlySet<string> = new Set(
  RETIRED_DEEP_RESEARCH_AGENT_IDS
);

export function isRetiredDeepResearchAgentId(agentIdOrPromptKey: string): boolean {
  return RETIRED_DEEP_RESEARCH_AGENT_ID_SET.has(agentIdOrPromptKey);
}

// =============================================================================
// 🔗 兼容别名（映射到 PromptKeys，禁止重复写值）
// =============================================================================

export const DEFAULT_PROMPT_KEY = PromptKeys.DEFAULT;
export const WRITING_PROMPT_KEY = PromptKeys.WRITING;
export const ANNOTATION_PROMPT_KEY = PromptKeys.ANNOTATION;
export const AUTOCOMPLETE_PROMPT_KEY = PromptKeys.AUTOCOMPLETE;
export const TABLE_AI_FILL_PROMPT_KEY = PromptKeys.TABLE_AI_FILL;
export const AGENT_DEFAULT_PROMPT_KEY = PromptKeys.AGENT_DEFAULT;
export const REVIEW_PROMPT_KEY = PromptKeys.REVIEW;
export const PROJECT_PLANNING_PROMPT_KEY = PromptKeys.PROJECT_PLANNING;
export const TRANSLATION_PROMPT_KEY = PromptKeys.TRANSLATION;
export const AUDIO_SUMMARY_PROMPT_KEY = PromptKeys.AUDIO_SUMMARY;
export const CONVERSATION_TITLE_PROMPT_KEY = PromptKeys.CONVERSATION_TITLE;
