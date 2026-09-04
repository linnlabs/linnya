/**
 * @file package/schemas/src/api-dtos.ts
 * @description API 请求/响应的 Zod schema 定义
 * 
 * 定义前后端 API 通信的数据传输对象（DTO），
 * 确保 API 边界的类型安全和数据校验。
 */

import { z } from 'zod';
import { ConversationUiSpecSchema } from './conversation/presentation';
import {
  CONVERSATION_IMAGE_MAX_ATTACHMENTS,
  CONVERSATION_IMAGE_MAX_BYTES,
  ConversationAttachmentRefSchema,
  ConversationDraftAttachmentRefSchema,
  ConversationImageMediaTypeSchema,
} from './conversation/attachment-ref';
import { PromptKeys } from './agent-config/index';
import { JsonValueSchema, type JsonValue } from './json-value';
import {
  ConversationActivityBindingSchema,
  ConversationUserInputMetadataSchema,
} from './conversation/message-metadata';
import { ConversationInteractionResponseToolMetadataSchema } from './conversation/tool-message';
import { ConversationSelectedAgentIdSchema } from './conversation/selected-agent';

/**
 * 增量事件 - 前端可以发送给后端的事件子集
 */
export const ConversationExistingAttachmentSelectionItemSchema = z.object({
  source: z.literal('existing'),
  attachmentId: z.string().min(1).max(200),
}).strict();

export const ConversationDraftAttachmentSelectionItemSchema = z.object({
  source: z.literal('draft'),
  draft: ConversationDraftAttachmentRefSchema,
}).strict();

export const ConversationAttachmentSelectionItemSchema = z.discriminatedUnion('source', [
  ConversationExistingAttachmentSelectionItemSchema,
  ConversationDraftAttachmentSelectionItemSchema,
]);

export const ConversationAttachmentSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preserve') }).strict(),
  z.object({
    mode: z.literal('replace'),
    items: z.array(ConversationAttachmentSelectionItemSchema)
      .max(CONVERSATION_IMAGE_MAX_ATTACHMENTS),
  }).strict(),
]);

const IncrementalUserInputEventSchema = z.object({
    type: z.literal('user_input'),
    timestamp: z.number(),
    content: z.string(),
    raw_content: z.string().optional(),
    id: z.string().optional(),
    turn_id: z.string().optional(),
    /** host 已完成 ingress 校验的草稿附件；发送 commit 后由 host 替换成 durable refs。 */
    attachments: z.array(ConversationDraftAttachmentRefSchema)
      .min(1)
      .max(CONVERSATION_IMAGE_MAX_ATTACHMENTS)
      .optional(),
    /** edit/regenerate 上行 mutation command；不会进入 durable user message。 */
    attachment_selection: ConversationAttachmentSelectionSchema.optional(),
    metadata: ConversationUserInputMetadataSchema.optional(),
    source: z.enum(['user', 'editor', 'system']).default('user'),
});

const IncrementalToolOutputEventSchema = z.discriminatedUnion('status', [
  z.object({
    type: z.literal('tool_output'),
    timestamp: z.number(),
    tool_call_id: z.string(),
    /**
     * 工具名（必填）
     *
     * 说明：
     * - 后端会将 tool_output 持久化为 RuntimeEvent（其 tool_name 为必填字段）；
     * - 若缺失 tool_name，会导致历史回放/渲染链路无法稳定关联工具语义。
     */
    tool_name: z.string(),
    status: z.literal('success'),
    observation: z.string().trim().min(1),
    data: JsonValueSchema,
    id: z.string().optional(),
    turn_id: z.string().optional(),
    metadata: ConversationInteractionResponseToolMetadataSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('tool_output'),
    timestamp: z.number(),
    tool_call_id: z.string(),
    tool_name: z.string(),
    status: z.literal('error'),
    observation: z.string().trim().min(1),
    error: z.string().trim().min(1),
    error_code: z.string().trim().min(1).optional(),
    id: z.string().optional(),
    turn_id: z.string().optional(),
    metadata: ConversationInteractionResponseToolMetadataSchema.optional(),
  }).strict(),
]);

export const IncrementalEvent = z.union([
  IncrementalUserInputEventSchema,
  IncrementalToolOutputEventSchema,
]);

export type IncrementalEvent = z.infer<typeof IncrementalEvent>;
export type ConversationAttachmentSelection = z.infer<typeof ConversationAttachmentSelectionSchema>;
export type ConversationAttachmentSelectionItem = z.infer<typeof ConversationAttachmentSelectionItemSchema>;

export const ConversationImageAttachmentErrorCodeSchema = z.enum([
  'conversation.image.invalid_request',
  'conversation.image.too_large',
  'conversation.image.unsupported_format',
  'conversation.image.invalid_image',
  'conversation.image.pixel_limit_exceeded',
  'conversation.image.invalid_file_name',
  'conversation.image.staging_failed',
  'conversation.image.draft_not_found',
  'conversation.image.draft_changed',
  'conversation.image.too_many_attachments',
  'conversation.image.total_bytes_exceeded',
  'conversation.image.asset_not_found',
  'conversation.image.asset_integrity_failed',
  'conversation.image.preview_failed',
]);

export type ConversationImageAttachmentErrorCode = z.infer<typeof ConversationImageAttachmentErrorCodeSchema>;

export const ConversationImageDraftStageResponseSchema = z.object({
  draft: ConversationDraftAttachmentRefSchema,
  mediaType: ConversationImageMediaTypeSchema,
  byteLength: z.number().int().positive().max(CONVERSATION_IMAGE_MAX_BYTES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type ConversationImageDraftStageResponse = z.infer<typeof ConversationImageDraftStageResponseSchema>;

export const ConversationImageAttachmentErrorResponseSchema = z.object({
  code: ConversationImageAttachmentErrorCodeSchema,
}).strict();

export type ConversationImageAttachmentErrorResponse = z.infer<typeof ConversationImageAttachmentErrorResponseSchema>;

export const ConversationUserInputCommittedEventSchema = z.object({
  id: z.string().min(1),
  type: z.literal('user_input_committed'),
  timestamp: z.number(),
  conversation_id: z.string().min(1),
  turn_id: z.string().min(1),
  operation: z.enum(['append', 'replace']),
  replaced_from_message_id: z.string().min(1).optional(),
  content: z.string(),
  /** 用户实际提交的 message；不得混入 Host 注入上下文、引用或附件描述。 */
  raw_content: z.string(),
  metadata: ConversationUserInputMetadataSchema.optional(),
  attachments: z.array(ConversationAttachmentRefSchema)
    .max(CONVERSATION_IMAGE_MAX_ATTACHMENTS)
    .optional(),
}).strict().superRefine((event, context) => {
  if (event.operation === 'append' && event.replaced_from_message_id !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replaced_from_message_id'],
      message: 'append ack 不能携带 replaced_from_message_id',
    });
  }
  if (event.operation === 'replace' && event.replaced_from_message_id !== event.id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replaced_from_message_id'],
      message: 'replace ack 必须绑定同一个稳定 message ID',
    });
  }
});

export type ConversationUserInputCommittedEvent = z.infer<typeof ConversationUserInputCommittedEventSchema>;

/**
 * 对话请求选项
 */
const ProjectMetadata = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

const DocumentMetadata = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
});

const ContextFenceInjection = z.object({
  kind: z.string(),
  content: z.string(),
  attrs: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * host 主动指定的单次工具调用。
 *
 * 调用方只声明工具与业务参数；事件 ID、tool call ID 和图执行状态均由 host 生成。
 */
export const HostToolCallRequest = z.object({
  tool_name: z.string().trim().min(1),
  args: z.record(JsonValueSchema),
  completion_mode: z.enum(['continue_to_llm', 'yield_after_batch']).optional(),
});

export type HostToolCallRequestData = z.infer<typeof HostToolCallRequest>;

export const ConversationOptions = z.object({
  /**
   * 执行起始节点（内部执行参数）
   *
   * 中文备注（根因级说明）：
   * - GraphExecutor 的入口节点通常是 `user`（需要 new_events 里带 user_input 才能推进到 llm）；
   * - 历史上存在“继续推进”（new_events 为空）的场景，需要从 `llm` 节点启动；
   * - 该字段是通用执行参数：不绑定具体业务编排概念，仅描述“本次 run 从哪里开始”。
   */
  execution_start_node: z.enum(['user', 'llm']).optional(),
  /** host 指定工具后直接从 ToolNode 启动；批次完成后的去向由 completion_mode 声明。 */
  host_tool_call: HostToolCallRequest.optional(),
  /**
   * turn_id（Phase 2：Step-per-Turn 对齐字段）
   *
   * 中文备注：
   * - 用于让一次 `/conversation/next` 的所有事件共享同一个 turn_id（包括工具事件与推理事件）；
   * - 若缺失：后端可自行生成；
   * - 该字段属于“请求级执行归属”。
   */
  turn_id: z.string().optional(),
  /** 知识库ID */
  knowledge_base_id: z.string().optional(),
  /** AI模型ID */
  model_id: z.string().optional(),
  /** 上下文 - 前置内容 */
  context_before: z.string().optional(),
  /** 上下文 - 后置内容 */
  context_after: z.string().optional(),
  /** 文档片段 */
  document_fragment: z.string().optional(),
  /**
   * 结构化上下文围栏。
   *
   * 中文说明：
   * - 这是新的通用上下文注入通道，承载 host 业务语义；
   * - `document_fragment/context_before` 仍保留兼容，但新功能应优先走 fences。
   */
  fences: z.array(ContextFenceInjection).optional(),
  /** 当前段落 */
  current_paragraph: z.string().optional(),
  /** 当前块内容（旧编辑器单轮任务仍使用，host 会映射为 AgentInvokeRequest.currentBlockContent） */
  current_block_content: z.string().optional(),
  /** 可用文档列表（项目文件文本列表，仅 Agent 模式使用） */
  document_list: z.string().optional(),
  /** 提示词模板键：跨端 wire contract 只要求 string，是否已注册由 app-host 校验。 */
  promptKey: z.string().optional(),
  /** 会话级产品 Agent 身份；Host 在 admission 后将其解析为本轮 promptKey。 */
  selected_agent_id: ConversationSelectedAgentIdSchema.optional(),
  /** 图片生成模型ID */
  imageGenerationModelId: z.string().optional(),
  /** 是否启用工具 */
  enableTools: z.boolean().optional(),
  /** 可用工具白名单 */
  availableTools: z.array(z.string()).optional(),
  /** 对话历史记录 */
  conversationHistory: z.array(z.any()).optional(),
  /**
   * 思考努力程度（统一语义，值需与 linnkit `ReasoningEffort` 对齐）。
   * 未传时后端按模型 `reasoning.default_effort` 兜底。
   */
  reasoning_effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  /** 本轮会话历史读取策略；isolated 表示不读取已有历史。 */
  history_mode: z.literal('isolated').optional(),
  /** 运行通道只描述产品归属，不承担持久化或历史读取语义。 */
  run_lane: z.enum(['foreground', 'auxiliary']).optional(),
  /** 本次运行事件允许进入的 UI 投影范围。 */
  event_visibility: z.enum(['conversation', 'none']).optional(),
  /** 从指定消息开始截断（inclusive，删除目标消息/事件及其后续内容） */
  truncateFromMessageId: z.string().optional(),
  /** 截断原因 */
  truncateReason: z.enum(['regenerate', 'edit']).optional(),
  /** 🔥 是否持久化到历史对话（默认true，设为false用于临时任务如自动补全） */
  persist: z.boolean().optional(),
  /**
   * 🔥 仅持久化（不执行）
   *
   * @description
   * 用于“只想把 new_events 写入事件库/历史，但不希望触发 LLM/Agent 执行”的场景。
   * 典型用法：表格填充（table_fill）的 run 头用户原始请求需要落库以支持 reload 回放，
   * 但该请求本身不应触发一次实际推理/工具执行。
   *
   * 约定：
   * - persist_only=true：后端会在完成 new_events 的持久化后立即结束流程（不进入 AgentRunner）。
   * - 该字段只影响“执行”，不影响“持久化”：是否写库仍由 persist 控制（默认 true）。
   */
  persist_only: z.boolean().optional(),
  /** 🔥 Phase 2 优化: 替换目标消息的摘要事件ID（性能优化提示） */
  summaryContextId: z.string().optional(),
  /** @deprecated 使用 new_events.id */
  messageId: z.string().optional(),
  /** 当前项目的可读信息 */
  project_metadata: ProjectMetadata.optional(),
  /** 当前文档的可读信息 */
  document_metadata: DocumentMetadata.optional(),

  // ============================================================================
  // Review（审阅）扩展字段：按 promptKey='review' 使用
  // - 这些字段必须在 options schema 声明，否则 Zod 会 strip 掉，后端无法读取
  // ============================================================================

  /** 本次审阅运行 ID（用于 annotation.meta.reviewRunId 分组） */
  review_run_id: z.string().optional(),
  /** 审阅角色 ID（系统内置 or agents 表） */
  agent_id: z.string().optional(),
  /** 当前 chunk 索引（从 0 开始） */
  chunk_index: z.number().int().min(0).optional(),
  /** 总 chunk 数（>= 1） */
  total_chunks: z.number().int().min(1).optional(),
  /** 审阅背景（可为空字符串） */
  review_background: z.string().optional(),
  /** 审阅目标（可为空字符串） */
  review_goal: z.string().optional(),

  /**
   * 🔥 方案B：UI 展示协议（仅透传，后端可写入事件 metadata 以支持历史回放）
   *
   * 典型用法：
   * - 表格填充的行级 user_input：`ui: { presentation: 'hidden' }`（避免侧边栏刷屏）
   * - 卡片头属于客户端本地 presentation entity，不进入请求或持久化消息合同。
   */
  ui: ConversationUiSpecSchema.optional(),

  /**
   * 外部活动归属协议（runId / feature）
   *
   * 说明：
   * - renderer 会从 SSE/RuntimeEvent 的 `event.metadata.activity` 提取运行归属；
   * - 请求与事件统一使用 `activity` wire key；
   * - 后端会把该字段落到事件 metadata 中。
   */
  activity: ConversationActivityBindingSchema.optional(),

  // ============================================================================
  // Autocomplete（自动补全）扩展字段：按 promptKey='autocomplete' 使用
  // - 这些字段必须在 options schema 声明，否则 Zod 会 strip 掉，后端无法读取
  // ============================================================================

  /** 补全长度提示（如 "Output exactly 1 short sentence."） */
  completionLengthHint: z.string().optional(),
  completion_length_hint: z.string().optional(),

  /** 最近被拒绝的建议列表（最多2条，用于避免重复建议） */
  recentRejections: z.array(z.object({
    /** 被拒绝的建议文本 */
    suggestionText: z.string(),
    /** 用户拒绝后继续输入的文本（可选） */
    userContinuedWith: z.string().optional(),
  })).optional(),
  recent_rejections: z.array(z.object({
    suggestionText: z.string(),
    userContinuedWith: z.string().optional(),
  })).optional(),

  intentKey: z.enum([
    'continue_paragraph',
    'list_next_item',
    'bridge_to_suffix_delimiter',
    'rewrite_after_large_delete',
    'structure_editing',
  ]).optional(),
  intent_key: z.enum([
    'continue_paragraph',
    'list_next_item',
    'bridge_to_suffix_delimiter',
    'rewrite_after_large_delete',
    'structure_editing',
  ]).optional(),
  intentConfidence: z.number().optional(),
  intent_confidence: z.number().optional(),
  intentConstraints: z.array(z.string()).optional(),
  intent_constraints: z.array(z.string()).optional(),
  behaviorSummary: z.object({
    totalEvents: z.number(),
    totalInsertedChars: z.number(),
    totalDeletedChars: z.number(),
    recentDeletedChars: z.number().optional(),
    hasLargeRecentDelete: z.boolean().optional(),
    typingSpeedCps: z.number().optional(),
  }).optional(),
  behavior_summary: z.object({
    totalEvents: z.number(),
    totalInsertedChars: z.number(),
    totalDeletedChars: z.number(),
    recentDeletedChars: z.number().optional(),
    hasLargeRecentDelete: z.boolean().optional(),
    typingSpeedCps: z.number().optional(),
  }).optional(),
});

export type ConversationOptions = z.infer<typeof ConversationOptions>;

/**
 * /api/v1/conversation/next 请求体
 */
const ConversationNextRequestBody = z.object({
  /** 对话ID */
  conversation_id: z.string().optional(),
  /** 新增：项目ID */
  project_id: z.string().optional(),
  /** 新的增量事件 */
  new_events: z.array(IncrementalEvent).optional(),
  /** 请求选项 */
  options: ConversationOptions.optional(),
}).superRefine((request, context) => {
  if (request.options?.selected_agent_id !== undefined && request.options.promptKey !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['options', 'selected_agent_id'],
      message: 'selected_agent_id 与 promptKey 不能同时出现',
    });
  }
  const isUserInputReplacement = request.options?.truncateFromMessageId !== undefined
    && (request.options.truncateReason === 'edit' || request.options.truncateReason === 'regenerate');
  for (const [eventIndex, event] of (request.new_events ?? []).entries()) {
    if (event.type !== 'user_input') continue;
    if (isUserInputReplacement && event.attachment_selection === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['new_events', eventIndex, 'attachment_selection'],
        message: 'edit/regenerate replace 请求必须显式声明附件选择',
      });
      continue;
    }
    if (event.attachment_selection === undefined) continue;
    if (event.attachments !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['new_events', eventIndex, 'attachments'],
        message: 'attachment_selection 与普通发送 attachments 不能同时出现',
      });
    }
    if (!request.options?.truncateFromMessageId || !request.options.truncateReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['new_events', eventIndex, 'attachment_selection'],
        message: 'attachment_selection 只能用于 edit/regenerate replace 请求',
      });
    }
    if (request.options?.truncateReason === 'regenerate' && event.attachment_selection.mode !== 'preserve') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['new_events', eventIndex, 'attachment_selection', 'mode'],
        message: 'regenerate 只能 preserve 原附件',
      });
    }
  }
});

export const ConversationNextRequest = ConversationNextRequestBody.optional().default({});

export type ConversationNextRequest = z.infer<typeof ConversationNextRequest>;

/** 用户对一个已暂停 foreground run 的一次性响应命令。 */
export const ConversationInteractionResponseRequest = z.object({
  conversation_id: z.string().min(1),
  run_id: z.string().min(1),
  interaction_id: z.string().min(1),
  resume_token: z.string().min(1),
  checkpoint_revision: z.number().int().nonnegative(),
  tool_call_id: z.string().min(1),
  tool_name: z.string().min(1),
  observation: z.string().trim().min(1),
  data: JsonValueSchema,
  interaction_status: z.enum(['submitted', 'skipped', 'approved', 'modified']),
  interaction_submitted_at: z.number().nonnegative(),
  interaction_response: JsonValueSchema.optional(),
  project_id: z.string().optional(),
  project_metadata: ProjectMetadata.optional(),
}).strict();

export type ConversationInteractionResponseRequest = z.infer<typeof ConversationInteractionResponseRequest>;

export const ConversationActiveRun = z.object({
  run_id: z.string().min(1),
  turn_id: z.string().min(1),
  execution_id: z.string().min(1).optional(),
  status: z.enum(['pending', 'running', 'awaiting_user']),
  lane: z.literal('foreground'),
  pending_interaction: z.object({
    interaction_id: z.string().min(1),
    run_id: z.string().min(1),
    tool_call_id: z.string().min(1),
    checkpoint_revision: z.number().int().nonnegative(),
    resume_token: z.string().min(1),
  }).strict().optional(),
}).strict();

export type ConversationActiveRun = z.infer<typeof ConversationActiveRun>;

export const ConversationActiveRunResponse = z.object({
  conversation_id: z.string().min(1),
  run: ConversationActiveRun.nullable(),
}).strict();

export type ConversationActiveRunResponse = z.infer<typeof ConversationActiveRunResponse>;

export const ConversationRunTerminalStatus = z.enum(['completed', 'failed', 'cancelled']);

export const ConversationRunSettlementTerminal = z.object({
  run_id: z.string().min(1),
  status: ConversationRunTerminalStatus,
  lane: z.literal('foreground'),
  error: z.object({
    error_code: z.string().min(1),
    message: z.string(),
    recoverable: z.boolean(),
  }).strict().optional(),
}).strict();

export type ConversationRunSettlementTerminal = z.infer<
  typeof ConversationRunSettlementTerminal
>;

/**
 * transport teardown 后按 runId 读取的控制面结算快照。
 * active variant 复用现有 active-run contract；terminal variant 只表达 durable run 终态，
 * 不向 Renderer 补造 RuntimeEvent。
 */
export const ConversationRunSettlementResponse = z.object({
  conversation_id: z.string().min(1),
  requested_run_id: z.string().min(1),
  run: z.union([
    ConversationActiveRun,
    ConversationRunSettlementTerminal,
  ]).nullable(),
}).strict();

export type ConversationRunSettlementResponse = z.infer<
  typeof ConversationRunSettlementResponse
>;

export const ConversationRunCancelRequest = z.object({
  conversation_id: z.string().min(1),
  reason: z.string().min(1).max(500),
}).strict();

export type ConversationRunCancelRequest = z.infer<typeof ConversationRunCancelRequest>;

/**
 * cancel 是“使指定 run 进入终态”的命令，不承诺用户点击一定赢过自然完成。
 * outcome 必须保留这层竞争结果，Renderer 才不会把 completed/failed 伪装成 cancelled。
 */
export const ConversationRunCancelResponse = z.discriminatedUnion('outcome', [
  z.object({
    success: z.literal(true),
    run_id: z.string().min(1),
    outcome: z.literal('cancelled'),
    terminal_status: z.literal('cancelled'),
  }).strict(),
  z.object({
    success: z.literal(true),
    run_id: z.string().min(1),
    outcome: z.literal('already_terminal'),
    terminal_status: ConversationRunTerminalStatus,
  }).strict(),
]);

export type ConversationRunCancelResponse = z.infer<typeof ConversationRunCancelResponse>;

/**
 * /api/v1/conversation/next 响应体
 */
export const ConversationNextResponse = z.object({
  /** 对话ID */
  conversation_id: z.string(),
  /** 新产生的事件 */
  events: z.array(z.any()).optional(), // 这里使用 RuntimeEvent，但为了避免循环依赖，暂时用 any
  /** 执行步数 */
  stepCount: z.number().optional(),
  /** 是否成功 */
  success: z.boolean().default(true),
  /** 错误信息 */
  error: z.string().optional(),
});

export type ConversationNextResponse = z.infer<typeof ConversationNextResponse>;

/**
 * Agent 调用请求
 */
export const AgentInvokeRequest = z.object({
  /** 用户查询 */
  query: z.string(),
  /** 提示词模板键：跨端 wire contract 只要求 string，是否已注册由 app-host 校验。 */
  promptKey: z.string().default(PromptKeys.DEFAULT),
  /** 模型ID */
  model_id: z.string().optional(),
  /** 上下文 - 前置内容 */
  context_before: z.string().default(''),
  /** 上下文 - 后置内容 */
  context_after: z.string().default(''),
  /** 文档片段 */
  document_fragment: z.string().default(''),
  /** 当前段落 */
  current_paragraph: z.string().default(''),
  /** 图片生成模型ID */
  imageGenerationModelId: z.string().optional(),
  /** 知识库ID */
  knowledgeBaseId: z.string().optional(),
  /** 最大推理步数 */
  maxSteps: z.number().optional(),
  /** 是否启用工具 */
  enableTools: z.boolean().default(true),
  /** 可用工具白名单 */
  availableTools: z.array(z.string()).optional(),
  /** 对话历史记录 */
  conversationHistory: z.array(z.any()).default([]),
  /** 思考努力程度（统一语义，值需与 linnkit `ReasoningEffort` 对齐） */
  reasoning_effort: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
  /** 项目的人类可读信息 */
  project_metadata: ProjectMetadata.optional(),
  /** 文档的人类可读信息 */
  document_metadata: DocumentMetadata.optional(),
  // ============================================================================
  // Review（审阅）扩展字段：与后端 AgentInvokeRequestSchema 对齐
  // ============================================================================
  review_run_id: z.string().optional(),
  agent_id: z.string().optional(),
  chunk_index: z.number().int().min(0).optional(),
  total_chunks: z.number().int().min(1).optional(),
  review_background: z.string().optional(),
  review_goal: z.string().optional(),
});

export type AgentInvokeRequest = z.infer<typeof AgentInvokeRequest>;

/**
 * 聊天消息
 */
export const ChatMessage = z.object({
  /** 消息角色 */
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  /** 消息内容 */
  content: z.string(),
  /** 消息类型 */
  type: z.string().optional(),
  /** 工具调用ID */
  tool_call_id: z.string().optional(),
  /** 工具调用数组 */
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
      name: z.string(),
      arguments: z.string(),
    }),
  })).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * 知识库搜索请求
 */
export const KnowledgeBaseSearchRequest = z.object({
  /** 搜索查询 */
  query: z.string(),
  /** 知识库ID */
  knowledge_base_id: z.string().optional(),
  /** 返回结果数量 */
  top_k: z.number().default(5),
  /** 嵌入模型ID */
  embedding_model_id: z.string().optional(),
  /** 重排序模型ID */
  rerank_model_id: z.string().optional(),
});

export type KnowledgeBaseSearchRequest = z.infer<typeof KnowledgeBaseSearchRequest>;

/**
 * 知识库搜索响应
 */
export const KnowledgeBaseSearchResponse = z.object({
  /** 搜索结果 */
  results: z.array(z.object({
    /** 文档ID */
    doc_id: z.string(),
    /** 块ID */
    block_id: z.string(),
    /** 内容 */
    content: z.string(),
    /** 相似度分数 */
    score: z.number(),
    /** 元数据 */
    metadata: z.record(z.any()).optional(),
  })),
  /** 查询统计 */
  stats: z.object({
    /** 总搜索时间 */
    search_time_ms: z.number(),
    /** 嵌入时间 */
    embedding_time_ms: z.number().optional(),
    /** 重排序时间 */
    rerank_time_ms: z.number().optional(),
    /** 结果总数 */
    total_results: z.number(),
  }).optional(),
});

export type KnowledgeBaseSearchResponse = z.infer<typeof KnowledgeBaseSearchResponse>;

/**
 * 错误响应
 */
export const ErrorResponse = z.object({
  /** 是否成功 */
  success: z.literal(false),
  /** 错误消息 */
  error: z.string(),
  /** 错误代码 */
  error_code: z.string().optional(),
  /** 错误详情 */
  details: z.any().optional(),
  /** 请求ID */
  request_id: z.string().optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponse>;

/**
 * 成功响应
 */
export const SuccessResponse = z.object({
  /** 是否成功 */
  success: z.literal(true),
  /** 响应数据 */
  data: z.any().optional(),
  /** 响应消息 */
  message: z.string().optional(),
});

export type SuccessResponse = z.infer<typeof SuccessResponse>;

/**
 * API 响应联合类型
 */
export const ApiResponse = z.union([ErrorResponse, SuccessResponse]);
export type ApiResponse = z.infer<typeof ApiResponse>;

/**
 * 验证函数
 */
export const validateConversationNextRequest = (req: unknown) => 
  ConversationNextRequest.safeParse(req);

export const validateConversationInteractionResponseRequest = (req: unknown) =>
  ConversationInteractionResponseRequest.safeParse(req);

export const validateConversationActiveRunResponse = (response: unknown) =>
  ConversationActiveRunResponse.safeParse(response);

export const validateConversationRunSettlementResponse = (response: unknown) =>
  ConversationRunSettlementResponse.safeParse(response);

export const validateConversationRunCancelRequest = (req: unknown) =>
  ConversationRunCancelRequest.safeParse(req);

export const validateConversationRunCancelResponse = (response: unknown) =>
  ConversationRunCancelResponse.safeParse(response);

export const validateAgentInvokeRequest = (req: unknown) => 
  AgentInvokeRequest.safeParse(req);

export const validateKnowledgeBaseSearchRequest = (req: unknown) => 
  KnowledgeBaseSearchRequest.safeParse(req);

/**
 * 请求创建工具函数
 */
export const createConversationNextRequest = (
  conversationId: string | undefined,
  events: IncrementalEvent[],
  options: ConversationOptions = {}
): ConversationNextRequest => ({
  conversation_id: conversationId,
  new_events: events,
  options,
});

export const createAgentInvokeRequest = (
  query: string,
  options: Partial<AgentInvokeRequest> = {}
): AgentInvokeRequest => ({
  query,
  promptKey: PromptKeys.DEFAULT,
  context_before: '',
  context_after: '',
  document_fragment: '',
  current_paragraph: '',
  enableTools: true,
  conversationHistory: [],
  ...options,
});

export const createUserInputEvent = (
  content: string,
  options: Partial<Extract<IncrementalEvent, { type: 'user_input' }>> = {}
): Extract<IncrementalEvent, { type: 'user_input' }> => ({
  type: 'user_input',
  timestamp: Date.now(),
  content,
  source: 'user',
  ...options,
});

export const createToolOutputEvent = (
  toolCallId: string,
  toolName: string,
  observation: string,
  data: JsonValue,
  options: Partial<Omit<
    Extract<IncrementalEvent, { type: 'tool_output'; status: 'success' }>,
    'tool_name' | 'status' | 'observation' | 'data'
  >> = {}
): Extract<IncrementalEvent, { type: 'tool_output'; status: 'success' }> => ({
  type: 'tool_output',
  timestamp: Date.now(),
  tool_call_id: toolCallId,
  tool_name: toolName,
  observation,
  data,
  status: 'success',
  ...options,
}); 
