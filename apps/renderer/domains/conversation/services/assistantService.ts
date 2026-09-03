/**
 * @file apps/renderer/domains/conversation/services/assistantService.ts
 * @description AI 助手的统一 API 网关服务
 * 
 * @brief 功能说明
 * 功能 (What): 作为所有AI助手API调用的统一入口点，封装不同模式的API调用逻辑
 * 输入 (Input): 调用参数、回调函数、取消信号
 * 输出 (Output): 通过回调函数返回流式数据
 * 副作用 (Side-effects): 调用后端AI服务，触发回调函数
 */

import { streamConversation, type ConversationNextRequest } from './conversationService';
import { determineModelId } from '../../../shared/services/aiService/common';
import { readPrimaryReasoningEffort } from '@/domains/model-configuration';
import type {
  AssistantServiceCallbacks,
  InteractiveToolSubmissionMetadata,
  SendMessageOptions,
} from '../types';
import {
  PromptKeys,
  type ConversationInteractionResponseRequest,
  type ConversationAttachmentSelection,
  type ConversationDraftAttachmentRef,
  type ConversationMessageExtension,
} from '@app/schemas';
import type { UserMessageContent } from '../definitions/userMessageContent';
import { generateMessageId } from '@shared/utils/idUtils';
import { toSerializableJsonRecord } from '@linnlabs/linnkit/contracts';
import { resolveCurrentConversationMessage } from '../functions/resolveCurrentConversationMessage';
import { toUserQuoteWire } from '../functions/userQuoteWire';
import { createAssistantStreamCallbacks } from './orchestration/createAssistantStreamCallbacks';
import { settleAssistantTransportOutcome } from './orchestration/settleAssistantTransportOutcome';
import type { PendingRunInteraction } from '../features/interactive-run';
import {
  createConversationRequestEventRouter,
  type ConversationEventDispatcher,
  type ConversationEventRouteContext,
} from '../features/realtime-event-routing';

export type { UserMessageContent } from '../definitions/userMessageContent';

/**
 * AI助手调用参数接口
 */
export interface InvokeAssistantParams {
  /** 本轮完整用户消息内容；所有可重放字段只有这一份权威来源。 */
  userMessage: UserMessageContent;
  /** 插件附加到 durable user_input 的命名空间扩展；核心 metadata 不接受任意字段。 */
  userInputExtension?: ConversationMessageExtension;
  /** 普通发送本轮的 host 草稿快照；不属于 durable UserMessageContent。 */
  draftAttachments?: readonly ConversationDraftAttachmentRef[];
  /** edit/regenerate 专用窄 mutation command；与普通发送 draftAttachments 互斥。 */
  attachmentSelection?: ConversationAttachmentSelection;
  /** 额外选项 */
  options?: SendMessageOptions;
  /** 🔥 新增：项目ID */
  projectId?: string;
  /** 当前请求的 conversation 实时投影端口；不提供时仅调用传统 callbacks。 */
  eventDispatcher?: ConversationEventDispatcher;
}

/**
 * 调用 AI 助手服务
 * 
 * @description
 * 功能: 根据模式调用相应的AI服务API，所有AI请求的统一入口
 * 输入: 调用参数、事件回调函数、取消信号
 * 输出: 通过回调函数流式返回AI响应
 * 副作用: 发起网络请求，调用AI服务
 * 
 * @param params 调用参数，包含用户消息内容、模式等
 * @param callbacks 事件回调函数集合
 * @param signal 用于取消请求的AbortSignal
 */
export async function invokeAssistant(
  params: InvokeAssistantParams,
  callbacks: AssistantServiceCallbacks,
  signal: AbortSignal
): Promise<void> {
  const {
    userMessage,
    userInputExtension,
    draftAttachments,
    attachmentSelection,
    options,
    projectId,
    eventDispatcher,
  } = params;

  const conversationId = options?.conversationId || `conv_${Date.now()}`;
  const promptKey = options?.promptKey;
  const modelRoutingKey = promptKey ?? PromptKeys.DEFAULT;
  // `determineModelId` 可能返回 null，这里统一转换为 undefined 以符合类型定义
  const modelId: string | undefined = determineModelId(modelRoutingKey) ?? undefined;

  /**
   * ✅ 根因级收口：工具上下文的项目作用域使用 `project_metadata.id`（workspaceProjectId），
   * 而 `project_id` 主要用于会话落库与历史过滤。
   *
   * 为保证所有调用入口的一致性：只要本次调用显式传入了 projectId，
   * 就必须至少透传 `{ id: projectId }` 到 `options.project_metadata`，否则后端工具（尤其是知识库工具）
   * 会判定“无项目上下文”并拒绝执行。
   *
   * 注意：
   * - 调用方若提供了更完整的 projectMetadata（name/description），优先使用调用方信息；
   * - 这里不做 any 断言，严格按现有类型字段拼装最小对象。
   */
  const normalizedProjectMetadata: SendMessageOptions['projectMetadata'] | undefined =
    options?.projectMetadata ??
    (typeof projectId === 'string' && projectId.trim().length > 0
      ? { id: projectId }
      : undefined);

  // 请求级投影上下文：给 thought/tool/final_answer 等事件附加 activity/ui 归属。
  const routeContext: ConversationEventRouteContext | undefined =
    options?.ui || options?.activity ? { ui: options?.ui, activity: options?.activity } : undefined;
  const routeEvent = createConversationRequestEventRouter({
    conversationId,
    signal,
    dispatcher: eventDispatcher,
    routeContext,
  });

  // 说明：这里禁止输出临时诊断日志，避免污染用户控制台。

  const convReq: ConversationNextRequest = {
    conversation_id: conversationId,
    project_id: projectId, // 新增：传递 projectId
    new_events: [{ 
      type: 'user_input', 
      timestamp: Date.now(), 
      content: userMessage.text,
      source: 'user', // 🔥 修复：添加必需的 source 字段
      id: options?.messageId,
      ...(draftAttachments?.length ? { attachments: [...draftAttachments] } : {}),
      ...(attachmentSelection ? { attachment_selection: attachmentSelection } : {}),
      metadata: {
        ...(userInputExtension
          ? { extension: userInputExtension }
          : {}),
        ...(userMessage.userQuote
          ? {
              user_quote: toUserQuoteWire(userMessage.userQuote),
            }
          : {}),
      } 
    }],
    options: {
      model_id: modelId,
      reasoning_effort: readPrimaryReasoningEffort() ?? undefined,
      knowledge_base_id: options?.knowledgeBaseId || 'default',
      context_before: options?.context?.contextBefore || '',
      context_after: options?.context?.contextAfter || '',
      document_fragment: options?.documentFragment || '', // 🔥 修复：传递文档片段参数
      fences: options?.fences,
      current_paragraph: options?.current_paragraph || '',
      ...(promptKey ? { promptKey } : {}),
      ...(options?.selectedAgentId ? { selected_agent_id: options.selectedAgentId } : {}),
      imageGenerationModelId: options?.context?.imageGenerationModelId,
      enableTools: options?.enableTools ?? true,
      availableTools: options?.availableTools, // 🔥 透传动态工具白名单
      host_tool_call: options?.hostToolCall,
      /**
       * 活动归属/展示协议
       *
       * 说明：
       * - 这里必须同时写入 `options.activity`，否则后端在运行期无法将活动归属传播到
       *   thought/action/final_answer 等 AI 事件的 RuntimeEvent.metadata 中，导致历史回放时分组丢失。
       * - `ui` 在表格逐行场景常用 `presentation: 'hidden'`，后端是否使用由其决定；
       *   `realtime-event-routing` 只把非 hidden 的 ui 上下文附加到过程事件，避免隐藏整个执行过程。
       */
      activity: options?.activity,
      ui: options?.ui,
      /**
       * 🔥 关键字段：对话历史
       *
       * @description
       * 后端 `ConversationOptions` 支持 `conversationHistory`（见 `@app/schemas`），
       * `conversationHistory` 只用于调用方显式提供一组消息历史；
       * “不读取已有会话历史”必须通过 historyIsolation 表达，不能靠手写空数组模拟。
       *
       * 约定：
       * - 未提供：保持 undefined，让后端按 conversation_id 的默认策略处理；
       * - 提供数组：作为显式消息历史传给后端；历史隔离模式会由后端覆盖为空数组。
       */
      conversationHistory: options?.conversationHistory,
      // 从目标消息开始截断：编辑重发必须删除目标事件本身，避免复用 event.id 时撞唯一约束。
      truncateFromMessageId: options?.truncateFromMessageId,
      truncateReason: options?.truncateReason,
      /**
       * ✅ 仅持久化（不执行）
       *
       * @description
       * 仅持久化调用只写 run 头，不触发实际执行。
       * 该字段是稳定请求契约，供显式需要“只落库”的调用方使用。
       */
      persist_only: options?.persistOnly === true,
      // 历史隔离只控制本轮上下文读取，不改变 persist / persist_only 语义。
      history_mode: options?.historyIsolation,
      // 是否落库由调用方独立决定；未提供时保留后端默认 true。
      persist: options?.persist,
      // 🔥 Phase 2: 传递摘要上下文ID（性能优化）
      summaryContextId: options?.summaryContextId,
      project_metadata: normalizedProjectMetadata,
      document_metadata: options?.documentMetadata,
      // 🔥 新增：将项目文件列表概要串行化为 document_list
      document_list:
        Array.isArray(options?.projectFileList) && options.projectFileList.length > 0
          ? options.projectFileList
              .map((node, index) => {
                const indexLabel = `${index + 1}.`;
                const typeLabel = node.type;
                const idLabel = node.id;
                return `${indexLabel} [${typeLabel}] ${node.name} (id=${idLabel})`;
              })
              .join('\n')
          : undefined,
    }
  };

  // 中文备注：旧“多步编排”概念已移除；前端不再支持传入编排实例相关字段。

  try {
    await callbacks.onStreamStart?.();

    const transportOutcome = await streamConversation(convReq, createAssistantStreamCallbacks({
      callbacks,
      routeEvent,
      projectsConversationEvents: eventDispatcher !== undefined,
      signal,
      resolveExecutionFailureMessage: () => resolveCurrentConversationMessage(
        'conversation.flow.conversationExecutionFailed',
      ),
    }), signal);
    await settleAssistantTransportOutcome(callbacks, transportOutcome);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 🔥 修复：将 AbortError 传递给 onError 回调，以便调用方可以处理它
      // 取消也是调用方需要结算的请求结果，不能在服务层吞掉。
      await callbacks.onError?.(error);
    } else {
      console.error('[AssistantService] invokeAssistant error:', error);
      await callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * 使用 tool_output 事件继续会话执行（HITL 提交/同步工具结果）
 *
 * @param conversationId 当前会话 ID（由前端 store 维护）
 * @param toolCallId 要对应的工具调用 ID（来自 action/tool_calls 事件）
 * @param toolName 工具名称（必填）
 * @param observation 交给 Agent 的工具结果文本
 * @param data 程序化工具结果
 * @param callbacks 事件回调（沿用 invokeAssistant 同一套）
 * @param signal 取消信号
 */
export async function continueWithToolOutput(
  conversationId: string,
  toolCallId: string,
  toolName: string,
  observation: string,
  data: Record<string, unknown>,
  context: {
    projectId?: string;
    projectMetadata?: SendMessageOptions['projectMetadata'];
  } | undefined,
  callbacks: AssistantServiceCallbacks,
  signal: AbortSignal,
  eventDispatcher: ConversationEventDispatcher | undefined,
  interactionResponse: InteractiveToolSubmissionMetadata,
  runInteraction: PendingRunInteraction & { turnId: string },
): Promise<void> {
  const routeEvent = createConversationRequestEventRouter({
    conversationId,
    signal,
    dispatcher: eventDispatcher,
  });
  if (runInteraction.toolCallId !== toolCallId) {
    throw new Error('Pending interaction toolCallId does not match submission');
  }

  const serializedData = toSerializableJsonRecord(data);
  if (!serializedData) {
    throw new Error('Interactive tool response data must be a serializable object');
  }
  const serializedInteractionResponse = toSerializableJsonRecord({
    response: interactionResponse.response,
  })?.response;

  const convReq: ConversationInteractionResponseRequest = {
    conversation_id: conversationId,
    run_id: runInteraction.runId,
    interaction_id: runInteraction.interactionId,
    resume_token: runInteraction.resumeToken,
    checkpoint_revision: runInteraction.checkpointRevision,
    tool_call_id: toolCallId,
    tool_name: toolName,
    observation,
    data: serializedData,
    interaction_status: interactionResponse.status,
    interaction_submitted_at: interactionResponse.submittedAt ?? Date.now(),
    ...(serializedInteractionResponse === undefined
      ? {}
      : { interaction_response: serializedInteractionResponse }),
    project_id: context?.projectId,
    project_metadata: context?.projectMetadata,
  };

  // 🔥 关键修复：在开始流式请求前调用 onStreamStart，确保前端设置 loading 状态
  try {
    await callbacks.onStreamStart?.();

    const transportOutcome = await streamConversation(convReq, createAssistantStreamCallbacks({
      callbacks,
      routeEvent,
      projectsConversationEvents: eventDispatcher !== undefined,
      signal,
      resolveExecutionFailureMessage: () => resolveCurrentConversationMessage(
        'conversation.flow.agentExecutionFailed',
      ),
    }), signal, `/api/v1/conversation/runs/${encodeURIComponent(runInteraction.runId)}/interactions/${encodeURIComponent(runInteraction.interactionId)}/respond`);
    await settleAssistantTransportOutcome(callbacks, transportOutcome);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // 🔥 修复：将 AbortError 传递给 onError 回调，以便调用方可以处理它
      const abortError = new Error('Request was cancelled');
      abortError.name = 'AbortError';
      await callbacks.onError?.(abortError);
    } else {
      // 将其他错误传递给回调
      await callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

/**
 * AI助手服务的公共接口
 *
 * @description
 * 提供AI助手服务相关的所有核心功能
 */
export const AssistantService = {
  invokeAssistant,
  continueWithToolOutput,
} as const;

export default AssistantService; 
