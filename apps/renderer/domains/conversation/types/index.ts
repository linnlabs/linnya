/**
 * @file apps/renderer/domains/conversation/types/index.ts
 * @description AI 助手的 TypeScript 类型定义
 */

import type {
  ConversationUserInputCommittedEvent,
  ConversationAttachmentRef,
  ConversationActivityBinding,
  ConversationCitationDependencySnapshot,
  ConversationPartialAnswerMessageMetadata,
  ConversationTerminalAnswerMessageMetadata,
  ConversationToolPreambleMessageMetadata,
  ConversationUnsealedAnswerMessageMetadata,
  ConversationMessageId,
  ConversationHistorySummaryPayload,
  ConversationReferenceId,
  ConversationSummarizationPresentationId,
  ConversationSummarizationProgressMetadata,
  ConversationThoughtMessageMetadata,
  ConversationTimelineMessageType,
  ConversationToolMessageMetadata,
  ConversationUserMessageMetadata,
  ConversationSelectedAgentId,
  ConversationUiMessageRole,
  ConversationUiSpec,
  HostToolCallRequestData,
} from '@app/schemas';
import type { SSEThoughtEvent, SSEToolOutputEvent, SSEToolCallDecisionEvent, SSEToolProcessEvent, SSEFinalAnswerEvent, SSEFinalAnswerChunkEvent, SSESubRunTraceEvent, SSETransportEndEvent } from '@linnlabs/linnkit/contracts';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { ConversationTransportOutcome } from '../definitions/conversationTransport';

export type {
  InteractiveToolMetadata,
  InteractiveToolActiveMetadata,
  InteractiveToolStatus,
  InteractiveToolSubmissionMetadata,
  InteractiveToolSubmissionStatus,
} from '@linnya/plugin-host-contract/renderer/interactiveTool';

// ===============================
// UI / Activity 元数据（Message + Metadata 驱动）
// ===============================

export type UiSpec = ConversationUiSpec;

export type ActivityBinding = ConversationActivityBinding;

export interface ContextFenceInjection {
  kind: string;
  content: string;
  attrs?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ConversationReference {
  id: ConversationReferenceId;
  /** 贡献该引用能力的插件。平台内置引用使用 platform。 */
  pluginId: string;
  /** 插件内稳定引用类型，例如 text-selection / canvas-element / graph-node。 */
  kind: string;
  /** 可跨插件持久定位的稳定 URI；纯临时文本引用可为空。 */
  uri?: string;
  /** 输入框引用预览的短标签。 */
  label: string;
  /** 输入框引用预览正文，通常是摘要或首尾片段。 */
  previewText: string;
  /** 本轮发送给模型的引用文本；复杂插件后续可由 provider 解析为 fences。 */
  text: string;
  /** 持久化到对应 user_quote item 的定位信息。 */
  source?: Record<string, unknown>;
  /** 插件私有元数据；conversation 只保存和透传，不理解其业务含义。 */
  metadata?: Record<string, unknown>;
}

interface ConversationMessageFields {
  /**
   * UI 消息实体身份，用于窗口锚点、消息索引、Vue key 与入场动画去重。
   * 答案消息必须等于 metadata.answer_id，不能使用 chunk/seal 的临时事件 ID。
   */
  id: ConversationMessageId;
  content: string;
  /** host commit 后的有序附件引用；Renderer 不保存 draft ID 或本地路径。 */
  attachments?: readonly ConversationAttachmentRef[];
  timestamp: number;
  /** Renderer presentation 依赖闭包；不进入 Runtime metadata，也不作为 Citation 事实源。 */
  citationDependencies?: ConversationCitationDependencySnapshot;
}

/**
 * Renderer 中一条正式 timeline 消息。
 * role/type 组合从 @app/schemas 的唯一合同派生，不允许本地追加字面量。
 */
export type UserMessage = ConversationMessageFields & {
  role: 'user';
  type: 'user_input';
  metadata?: ConversationUserMessageMetadata;
};

export type ThoughtMessage = ConversationMessageFields & {
  role: 'assistant';
  type: 'thought';
  metadata: ConversationThoughtMessageMetadata;
};

export type ToolCallMessage = ConversationMessageFields & {
  role: 'assistant';
  type: 'tool_calls';
  metadata: ConversationToolMessageMetadata;
  /** Renderer admission 派生结果；不持久化、不进入 metadata。 */
  toolPresentation?: ToolCardPresentation;
};

export type FinalAnswerMessage = ConversationMessageFields & {
  role: 'assistant';
  type: 'final_answer';
  metadata: ConversationUnsealedAnswerMessageMetadata | ConversationTerminalAnswerMessageMetadata;
};

export type ToolPreambleMessage = ConversationMessageFields & {
  role: 'assistant';
  type: 'tool_preamble';
  metadata: ConversationToolPreambleMessageMetadata;
};

export type PartialAnswerMessage = ConversationMessageFields & {
  role: 'assistant';
  type: 'partial_answer';
  metadata: ConversationPartialAnswerMessageMetadata;
};

export type AnswerMessage = FinalAnswerMessage | ToolPreambleMessage | PartialAnswerMessage;

export type HistorySummaryMessage = ConversationMessageFields & {
  role: 'system';
  type: 'history_summary';
  metadata: ConversationHistorySummaryPayload & {
    turn_id: string;
    run_id: string;
    merge_key?: string;
    ui?: UiSpec;
  };
};

/**
 * SSE-only 摘要进度 presentation。
 *
 * 它不是 Runtime fact、durable timeline row 或窗口锚点。独立 type 与 ID 前缀用于阻止
 * Renderer 把 summarization_start/end/error 伪装成 history_summary。
 */
export type SummarizationProgressMessage = ConversationMessageFields & {
  role: 'system';
  type: 'summarization_progress';
  id: ConversationSummarizationPresentationId;
  metadata: ConversationSummarizationProgressMetadata;
};

export type BaseMessage =
  | UserMessage
  | ThoughtMessage
  | ToolCallMessage
  | AnswerMessage
  | HistorySummaryMessage
  | SummarizationProgressMessage;

export type MessageRole = ConversationUiMessageRole;
export type MessageType = ConversationTimelineMessageType;

export type AssistantMessage = ThoughtMessage | ToolCallMessage | AnswerMessage;

// 新增：摘要状态枚举
export type SummaryMessage = HistorySummaryMessage | SummarizationProgressMessage;

export interface Conversation {
  id: string;
  title: string;
  /**
   * 标题来源用于区分“系统默认占位”和“用户/内容产生的真实标题”。
   *
   * 中文说明：UI 不应该通过比较 title 文案判断业务语义；语言切换和历史数据都会让字符串判断失效。
   */
  titleOrigin: 'default' | 'explicit' | 'fallback' | 'automatic';
  createdAt: number;
  updatedAt: number;
  /** 后端历史 metadata 已知的全量用户消息数；新会话在首次同步前可为空。 */
  userMessageCount?: number;
  messages: BaseMessage[];
  tags?: string[];
  /** 会话级 Agent 产品身份；null 表示使用默认 Agent。 */
  selectedAgentId: ConversationSelectedAgentId | null;
  metadata?: {
    [key: string]: unknown;
  };
}

export interface AssistantState {
  activeConversationId: string | null;
  conversations: Conversation[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  inputText: string;
}

/**
 * 项目文件概要信息（用于 Agent 上下文）
 *
 * 说明：
 * - 这是从 workspace_nodes 中抽取出的轻量级只读视图；
 * - 用于告诉模型「当前项目里大致有哪些文件」；
 * - 真正的大规模浏览 / 搜索仍然交给 workspace 相关工具。
 */
export interface ProjectFileSummary {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

/**
 * SendMessageOptions（前端请求 options）——语义收口版
 *
 * 设计目标（中文，务必读懂）：
 * - `historyIsolation='isolated'` 表示本轮不读取已有会话历史；
 * - 是否持久化由 persist / persistOnly 独立决定。
 */
type SendMessageAgentRouting =
  | {
      /** 一次性运行或 app-level 编排使用的内部执行模板。 */
      promptKey: string;
      selectedAgentId?: never;
    }
  | {
      promptKey?: never;
      /** 会话级 Agent 产品身份；Host 负责解析到内部 promptKey。 */
      selectedAgentId?: ConversationSelectedAgentId;
    };

type SendMessageOptionsBase = SendMessageAgentRouting & {
  /**
   * 提示词键。
   *
   * 仅供一次性运行或专用 app-level 编排显式选择内部执行模板。
   * 会话级 Agent 选择必须使用 selectedAgentId，禁止把 promptKey 存入 read model。
   */
  /** 项目ID */
  projectId?: string;
  /** 知识库ID */
  knowledgeBaseId?: string;
  /** 是否启用工具 */
  enableTools?: boolean;
  /** 上下文信息 */
  context?: {
    contextBefore?: string;
    contextAfter?: string;
    imageGenerationModelId?: string;
  };
  /** 文档片段（侧边栏对话用） */
  documentFragment?: string;
  /**
   * 结构化上下文围栏。
   *
   * 中文说明：
   * - 新功能应优先使用该通道表达业务上下文；
   * - `documentFragment/contextBefore` 保留给 legacy 文档上下文兼容。
   */
  fences?: ContextFenceInjection[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  current_paragraph?: string;
  /** 可用工具列表 */
  availableTools?: string[];
  /**
   * Host 确定性指定本轮首个工具调用。
   *
   * 该字段只供 app-level orchestration 使用；普通聊天 UI 不应让用户直接构造工具调用。
   */
  hostToolCall?: HostToolCallRequestData;
  /** 思考努力程度（统一语义）；未传时由 assistantService 从 modelsStore 读取 */
  reasoning_effort?: import('@linnlabs/linnkit/contracts').ReasoningEffort;
  // 🔥 新增：用于对齐会话链路的会话ID
  conversationId?: string;
  /**
   * 仅持久化（不执行）
   *
   * @description
   * 对应后端 ConversationOptions.persist_only。
   * 用于把本次 new_events 写入事件库（保证 reload 可回放），但不触发一次新的推理/工具执行。
   */
  persistOnly?: boolean;
  /** 是否把本轮事件写入会话历史；未提供时由后端按默认 true 处理。 */
  persist?: boolean;
  // 从目标消息开始截断：编辑重发会删除目标消息/事件及其后续内容
  truncateFromMessageId?: string;
  truncateReason?: 'regenerate' | 'edit'; // 截断原因
  messageId?: string;
  // 🔥 Phase 2: 摘要上下文ID（性能优化）
  summaryContextId?: string;
  projectMetadata?: {
    id?: string;
    name?: string;
    description?: string;
  };
  documentMetadata?: {
    id?: string;
    title?: string;
  };
  /**
   * 当前项目的文件/文档列表概要
   *
   * 约定：
   * - 只包含最多若干个节点（前端会控制数量，例如最多 10 个），避免占用过多 token；
   * - 主要包含文档 / 思维导图节点，必要时可补充少量文件夹，帮助模型理解项目结构；
   * - 该字段只用于构造 workspace_context，不直接在 UI 中展示。
   */
  projectFileList?: ProjectFileSummary[];
  /**
   * 前端 UI 协议（只控制展示，不影响后端逻辑）
   * - 会透传到 user_input 的 metadata 中
   * - 常用：表格每行的 user_input 标记为 hidden，避免侧边栏刷屏
   */
  ui?: UiSpec;
  /**
   * 外部活动归属协议。
   * - 会透传到 user_input 的 metadata 中；
   * - 请求和事件统一使用 `activity` wire key。
   */
  activity?: ActivityBinding;
};

type HistoryIsolatedSendMessageOptions = SendMessageOptionsBase & {
  /** 本轮不读取已有会话历史，但仍可按 persist 配置持久化。 */
  historyIsolation: 'isolated';
};

type HistoryAwareSendMessageOptions = SendMessageOptionsBase & {
  historyIsolation?: undefined;
};

export type SendMessageOptions =
  | HistoryIsolatedSendMessageOptions
  | HistoryAwareSendMessageOptions;

// 新增：轮次类型定义
export interface Turn {
  id: string;
  userMessage: BaseMessage; // 该轮次的用户输入消息
  messages: BaseMessage[]; // 该轮次的所有消息（包括用户输入）
  startIndex: number; // 在原始消息列表中的起始索引
  endIndex: number; // 在原始消息列表中的结束索引
}

// 问卷答案集合
export interface QuestionnaireAnswers {
  answers: Record<string, string>;
  multiAnswers: Record<string, string[]>;
  textAnswers: Record<string, string>;
  otherAnswers: Record<string, string>;
}

// API 服务相关类型

type AssistantCallbackResult = void | Promise<void>;

export interface AssistantServiceCallbacks {
  /** 流开始回调，仅用于生命周期提示，不包含业务数据 */
  onStreamStart?: () => AssistantCallbackResult;
  /** host 已原子提交 user input 与附件后的 app-level 确认。 */
  onUserInputCommitted?: (event: ConversationUserInputCommittedEvent) => AssistantCallbackResult;
  onThought?: (payload: string | SSEThoughtEvent) => AssistantCallbackResult;
  onToolCall?: (event: SSEToolCallDecisionEvent) => AssistantCallbackResult;
  onToolProcess?: (event: SSEToolProcessEvent) => AssistantCallbackResult;
  onToolOutput?: (event: SSEToolOutputEvent) => AssistantCallbackResult;
  /**
   * 🔥 SubRun Trace Channel：子 run 过程事件
   *
   * 说明：
   * - 该事件不会被投影为主时间轴消息，而是挂载到父 tool_calls message.metadata.subrunTrace；
   * - 主要用于工具卡内部实时渲染（例如 KnowledgeSearchCard 展示 deep_search 子 Agent 过程）。
   */
  onSubRunTrace?: (event: SSESubRunTraceEvent) => AssistantCallbackResult;
  onFinalAnswer?: (payload: string | SSEFinalAnswerEvent) => AssistantCallbackResult;
  /** 基于 SSE final_answer_chunk 的统一答案增量回调（推荐） */
  onFinalAnswerChunk?: (event: SSEFinalAnswerChunkEvent) => AssistantCallbackResult;
  onError?: (error: Error) => AssistantCallbackResult;
  /** reader 与请求 transport 已释放后的 typed outcome；不表示 run 终态。 */
  onTransportOutcome?: (outcome: ConversationTransportOutcome) => AssistantCallbackResult;
  /** 当前请求 transport 结束；不承载 run 业务终态。 */
  onTransportEnd?: (event?: SSETransportEndEvent) => AssistantCallbackResult;
} 
