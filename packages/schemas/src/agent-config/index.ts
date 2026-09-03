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
  // ---- Deep Research ----
  /** Deep Research Leader（研究负责人）：澄清问题、拆解子问题、制定检索计划 */
  DEEP_RESEARCH_LEADER: 'deep_research_leader',
  /** Deep Research Scout（检索员）：多轮检索，产出候选文档/块列表 */
  DEEP_RESEARCH_SCOUT: 'deep_research_scout',
  /** Deep Research Reasoner_1（推理员：第一轮）：初步结论与关键假设 */
  DEEP_RESEARCH_REASONER_1: 'deep_research_reasoner_1',
  /** Deep Research Reasoner_2（推理员：第二轮）：基于 Challenger 做收敛，产出写作大纲 */
  DEEP_RESEARCH_REASONER_2: 'deep_research_reasoner_2',
  /** Deep Research Challenger（反对派）：挑刺与反例检索 */
  DEEP_RESEARCH_CHALLENGER: 'deep_research_challenger',
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
