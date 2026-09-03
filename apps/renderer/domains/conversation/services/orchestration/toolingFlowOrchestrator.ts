/**
 * @file apps/renderer/domains/conversation/services/orchestration/toolingFlowOrchestrator.ts
 * @description 工具交互流程编排器 (Tooling Flow Orchestrator)
 *
 * @brief 专门负责工具交互的业务流程编排
 * =================================================================
 *
 * 这是从原始 assistantStore.ts 和 conversationOrchestrator.ts 中拆分出来的工具交互专用编排器。
 * 它专注于处理AI工具调用后的用户交互流程，包括：
 * - 问卷工具的提交和跳过处理
 * - 工具输出的后续处理
 *
 * 职责边界：
 * - ✅ 处理工具调用后的用户交互流程
 * - ✅ 管理问卷工具的生命周期
 * - ❌ 不处理直接聊天交互（由 chatFlowOrchestrator 负责）
 * - ❌ 不处理编辑器任务流程（由 annotationRunOrchestrator 负责）
 */

import { continueWithToolOutput } from '../assistantService';
import { useAssistantStore } from '../../store/assistantStore';
import { useWorkspaceScopeStore } from '../../../../shared/stores/workspaceScopeStore';
import type {
  Conversation,
  InteractiveToolSubmissionMetadata,
  BaseMessage,
} from '../../types';
import { findToolMessageByToolCallId } from '../../functions/toolMessageLookup';
import {
  reconcileInteractiveRunCommandFailure,
  reconcileInteractiveRunTransportOutcome,
  useInteractiveRunStore,
} from '../../features/interactive-run';

/**
 * 🔥 新增：工具调用信息接口 - 替代猜测查找
 */
interface ToolCallInfo {
  toolCallId: string;
  toolName: string;
}

/**
 * 工具交互流程编排器的组合式函数
 * 
 * @description
 * 提供所有工具交互相关的业务流程编排方法：
 * 1. 处理问卷工具的提交和跳过
   * 2. 管理工具调用的后续流程
 * 
 * @returns 包含工具交互流程方法的对象
 */
export function useToolingFlowOrchestrator() {
  // 获取依赖的Store和服务
  const assistantStore = useAssistantStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const interactiveRunStore = useInteractiveRunStore();

  // 🔥 移除：findLastToolCallByName 猜测函数
  // ❌ const findLastToolCallByName = (conversation: Conversation, toolName: string) => { ... }

  /**
   * 🔥 新增：基于明确ID查找工具调用信息
   * 
   * @param conversation 对话对象
   * @param toolCallId 明确的工具调用ID
   * @returns 工具调用信息或null
   */
  const resolveMessagesForToolLookup = (conversation: Conversation): readonly BaseMessage[] => {
    return conversation.id === assistantStore.activeConversationId
      ? assistantStore.activeMessages
      : conversation.messages;
  };

  const findToolCallById = (conversation: Conversation, toolCallId: string): ToolCallInfo | null => {
    if (!toolCallId) {
      return null;
    }

    const result = findToolMessageByToolCallId(resolveMessagesForToolLookup(conversation), toolCallId);
    return result
      ? {
          toolCallId: result.toolCallId,
          toolName: result.toolName,
        }
      : null;
  };

  const concludeInteractiveToolInteraction = async (options: {
    observation: string;
    toolCallId: string;
    toolName: string;
    data: Record<string, unknown>;
    interactionResponse: InteractiveToolSubmissionMetadata;
  }) => {
    const { toolCallId, toolName } = options;

    if (!toolCallId) {
      throw new Error('[ToolingFlowOrchestrator] 缺少必要的 toolCallId 参数');
    }

    const conversation = assistantStore.activeConversation;
    if (!conversation) {
      throw new Error('[ToolingFlowOrchestrator] 没有活跃对话');
    }

    const toolCallInfo = findToolCallById(conversation, toolCallId);
    if (!toolCallInfo) {
      throw new Error(`[ToolingFlowOrchestrator] 找不到工具调用 ID: ${toolCallId}`);
    }

    if (toolCallInfo.toolName !== toolName) {
      throw new Error(`[ToolingFlowOrchestrator] 工具类型不匹配: 期望 ${toolName}，实际 ${toolCallInfo.toolName}`);
    }

    const abortController = new AbortController();
    const run = interactiveRunStore.snapshotFor(conversation.id);
    const pendingInteraction = run?.pendingInteraction;
    if (!run?.turnId || !pendingInteraction) {
      throw new Error(`[ToolingFlowOrchestrator] conversation ${conversation.id} 没有可恢复的等待中 run`);
    }
    if (pendingInteraction.toolCallId !== toolCallId) {
      throw new Error('[ToolingFlowOrchestrator] pending interaction 与工具调用不匹配');
    }
    interactiveRunStore.beginSubmitting(conversation.id, abortController);

    try {
      await continueWithToolOutput(
        conversation.id,
        toolCallId,
        toolName,
        options.observation,
        options.data,
        {
          projectId: workspaceScopeStore.currentProjectId ?? undefined,
          projectMetadata: (() => {
            const pid = workspaceScopeStore.currentProjectId;
            return typeof pid === 'string' && pid.trim().length > 0 ? { id: pid } : undefined;
          })(),
        },
        {
          onStreamStart: () => {
            console.log('[ToolingFlowOrchestrator] AI继续执行开始');
          },
          onTransportEnd: () => {
            console.log('[ToolingFlowOrchestrator] AI执行完成');
          },
          onError: async (error: Error) => {
            console.error('[ToolingFlowOrchestrator] AI执行错误:', error);
            await reconcileInteractiveRunCommandFailure(conversation.id, error);
          },
          onTransportOutcome: outcome => reconcileInteractiveRunTransportOutcome(
            conversation.id,
            abortController,
            outcome,
          ),
        },
        abortController.signal,
        assistantStore.handleSseEvent,
        {
          ...options.interactionResponse,
          submittedAt: options.interactionResponse.submittedAt ?? Date.now(),
        },
        {
          ...pendingInteraction,
          turnId: run.turnId,
        },
      );
    } catch (error) {
      console.error('[ToolingFlowOrchestrator] 继续执行失败:', error);
      await reconcileInteractiveRunCommandFailure(conversation.id, error);
    }
  };

  /**
   * 处理问卷交互结束（提交/跳过），续跑时显式注入 conversation dispatcher。
   *
   * @description
   * 编排问卷工具交互的完整流程：
   * 1. 基于明确的 tool_call_id 查找工具调用
   * 2. 更新工具执行状态
   * 3. 使用请求级事件路由继续 AI 对话
   *
   * @param options 包含 Agent observation、工具调用 ID 等信息的对象
   */
  const concludeAskQuestionsInteraction = async (options: {
    observation: string;
    isSkipped: boolean;
    toolCallId: string; // 🔥 新增：要求明确的工具调用ID
    toolName: string;
    answersPayload?: Record<string, unknown>;
  }) => {
    await concludeInteractiveToolInteraction({
      observation: options.observation,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      data: options.isSkipped
        ? { skipped: true }
        : { answers: options.answersPayload ?? {} },
      interactionResponse: options.isSkipped
        ? {
            status: 'skipped',
            response: {
              skipped: true,
            },
          }
        : {
            status: 'submitted',
            response: options.answersPayload,
          },
    });
  };

  return {
    concludeInteractiveToolInteraction,
    // 🔥 重构后的方法：基于明确ID，无猜测逻辑
    concludeAskQuestionsInteraction,
    // 🔥 新增：工具调用查找方法（基于明确ID）
    findToolCallById,
    
  };
} 
