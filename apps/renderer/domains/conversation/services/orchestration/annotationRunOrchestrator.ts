/**
 * @file apps/renderer/domains/conversation/services/orchestration/annotationRunOrchestrator.ts
 * @description 编辑器批注 AI run 编排器
 *
 * 职责边界：
 * - 处理 Editor Annotation 发起的无状态 AI run；
 * - 持久化模式下只在 Host durable ack 后接纳 run 头与统一事件投影；
 * - 通过流式回调把最终文本交还 Annotation；
 * - ❌ 不处理直接聊天交互（由 chatFlowOrchestrator 负责）
 * - ❌ 不处理工具交互流程（由 toolingFlowOrchestrator 负责）
 */

import { invokeAssistant, type InvokeAssistantParams } from '../assistantService';
import { generateConversationId, generateMessageId } from '@shared/utils/idUtils';
import { useAssistantStore } from '../../store/assistantStore';
import { useWorkspaceScopeStore } from '../../../../shared/stores/workspaceScopeStore';
import { useWorkspaceMetadata } from './helpers';
import { requestSaveBeforeAssistantInvoke } from './helpers/requestSaveBeforeAssistantInvoke';
import {
  ensureMaterializedConversation,
  hasRenderableConversationContent,
} from './ensureMaterializedConversation';
import { resolveCurrentConversationMessage } from '../../functions/resolveCurrentConversationMessage';
import type { AnnotationRunParams } from '../../definitions/annotationRun';
import { useAnnotationRunExecutionStore } from '../../features/annotation-run/store/annotationRunExecutionStore';
import { createConversationUserInputAdmission } from '../../features/user-input-admission';
import { orchestrateCommittedConversationTitle } from './orchestrateCommittedConversationTitle';

type AnnotationRunScope =
  | {
      readonly persistsToConversation: true;
      readonly messageId: string;
      readonly conversationId: string;
      readonly runId: string;
      readonly wasNewConversation: boolean;
    }
  | {
      readonly persistsToConversation: false;
      readonly conversationId: string;
      readonly runId: string;
    };

export function useAnnotationRunOrchestrator() {
  const assistantStore = useAssistantStore();
  const annotationExecutionState = useAnnotationRunExecutionStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const { buildWorkspaceMetadata } = useWorkspaceMetadata();

  /** 准备请求身份；此阶段禁止创建正式用户消息。 */
  const prepareAnnotationRun = (
    persistToConversation: boolean,
  ): AnnotationRunScope => {
    const runId = generateMessageId();
    if (!persistToConversation) {
      return {
        persistsToConversation: false,
        conversationId: assistantStore.activeConversation?.id ?? generateConversationId(),
        runId,
      };
    }

    const conversation = ensureMaterializedConversation(assistantStore, workspaceScopeStore);
    if (!conversation) {
      throw new Error('[AnnotationRunOrchestrator] No active conversation available');
    }

    return {
      persistsToConversation: true,
      messageId: generateMessageId(),
      conversationId: conversation.id,
      runId,
      wasNewConversation: !hasRenderableConversationContent(
        conversation,
        assistantStore.activeMessages,
      ),
    };
  };

  const cancelAnnotationRun = (conversationId?: string): void => {
    if (conversationId && annotationExecutionState.conversationId !== conversationId) return;
    const controller = annotationExecutionState.currentAbortController;
    if (!controller) {
      annotationExecutionState.setError(null);
      return;
    }
    controller.abort();
    annotationExecutionState.settle({ controller, errorMessage: null });
  };

  /** 执行批注 AI run，并将同一事件流投影到侧边栏和批注写回回调。 */
  const executeAnnotationRun = async (params: AnnotationRunParams) => {
    const { prompt, mode, options, streamHandlers, persistToConversation = true } = params;
    
    console.log('[AnnotationRunOrchestrator] 开始执行批注 run:', { prompt: prompt.substring(0, 50), mode });
    
    /**
     * ✅ 根因修复：历史会话列表会按 projectId 过滤。
     *
     * 必须在准备任务 command identity 前先确认项目归属，避免缺少 projectId 时污染当前草稿。
     */
    const { projectId, projectMetadata } = buildWorkspaceMetadata();
    if (!projectId) {
      const message = resolveCurrentConversationMessage('conversation.flow.missingProjectForRun');
      console.error(`[AnnotationRunOrchestrator] ${message}`);
      annotationExecutionState.setError(message);
      return;
    }
    
    let runInfo: AnnotationRunScope;
    try {
      runInfo = prepareAnnotationRun(persistToConversation);
      
      console.log('[AnnotationRunOrchestrator] 批注请求已创建:', {
        messageId: runInfo.persistsToConversation ? runInfo.messageId : undefined,
        conversationId: runInfo.conversationId,
      });
    } catch (error) {
      console.error('[AnnotationRunOrchestrator] 创建批注请求失败:', error);
      const uiMessage = resolveCurrentConversationMessage('conversation.flow.taskInvocationFailed');
      annotationExecutionState.setError(uiMessage);
      streamHandlers.onError(uiMessage, 'api_error');
      return;
    }

    const { conversationId, runId } = runInfo;
    const userInputAdmission = runInfo.persistsToConversation
      ? createConversationUserInputAdmission({
          expectation: {
            conversationId,
            messageId: runInfo.messageId,
            operation: 'append',
          },
          commitUserInput: assistantStore.commitUserInput,
          onCommitted: (_message, event) => {
            orchestrateCommittedConversationTitle({
              event,
              wasNewConversation: runInfo.wasNewConversation,
              scope: workspaceScopeStore.currentScope,
              onHistorySynced: () => assistantStore.setSelectedConversation(conversationId),
            });
          },
        })
      : null;

    /**
     * ✅ 根因对齐：知识库/工作区工具的项目作用域来自 `project_metadata.id`（即 workspaceProjectId），
     * 而不是 `project_id`。
     *
     * - chatFlowOrchestrator 会透传 `options.projectMetadata`，因此工具上下文完整；
     * - 任务流此前只传 `projectId`，导致后端 toolContext.workspaceProjectId 为空，从而报：
     *   “当前对话未绑定 Workspace 项目（缺少 workspaceProjectId）”。
     *
     * 这里显式补齐最小必要信息：只要 id 存在，工具即可按项目解析关联知识库。
     */
    const effectiveProjectMetadata =
      projectMetadata && typeof projectMetadata.id === 'string' && projectMetadata.id.length > 0
        ? projectMetadata
        : { id: projectId };

    // 4. 设置执行状态和 AbortController
    cancelAnnotationRun();
    const abortController = new AbortController();
    annotationExecutionState.begin({ conversationId, runId, controller: abortController });
    
    const invokeParams: InvokeAssistantParams = {
      userMessage: { text: prompt },
      projectId,
      options: {
        ...options,
        // 说明：工具白名单/默认知识库由后端 AgentRegistry 统一决策，前端不再做 promptKey→tools 映射。
        // conversationId 决定事件归属；历史读取策略与持久化分别显式声明。
        conversationId,
        ...(runInfo.persistsToConversation ? { messageId: runInfo.messageId } : {}),
        historyIsolation: 'isolated',
        persist: runInfo.persistsToConversation,
        // ✅ 关键：透传项目元数据，供后端工具上下文构造 workspaceProjectId
        projectMetadata: effectiveProjectMetadata,
        activity: { runId, feature: 'annotation' },
      },
      // 纯编辑器任务不注入 conversation 投影端口，避免在侧边栏创建消息。
      eventDispatcher: runInfo.persistsToConversation ? assistantStore.handleSseEvent : undefined,
    };

    try {
      await requestSaveBeforeAssistantInvoke();
      await invokeAssistant(
        invokeParams,
        {
          ...(userInputAdmission
            ? {
                onUserInputCommitted: (event: Parameters<typeof userInputAdmission.accept>[0]) => {
                  userInputAdmission.accept(event);
                },
              }
            : {}),
          // 🔥 重构：简化回调，只保留必要的编辑器交互和错误处理
          // conversation SSE 由显式 dispatcher 处理，这里专注于“写回编辑器”。
          onStreamStart: () => {
            console.log('[AnnotationRunOrchestrator] AI开始响应');
            streamHandlers.onOpen?.();
          },
          /**
           * 核心修复：使用 SSE final_answer_chunk 事件驱动编辑器流式写入。
           * 是否注入 conversation dispatcher 都不会影响这里的编辑器回调（assistantService 中已保证）。
           */
          onFinalAnswerChunk: (event) => {
            const textChunk = typeof event === 'string' ? event : event.chunk;
            if (!textChunk) return;

            // 关键：只将纯文本增量传递给上层 streamHandlers，
            // 由 useStreamingHandlers + WASM Parser 决定如何写回编辑器。
            streamHandlers.onStreamChunk(textChunk);
          },
          // 🔥 重构：移除 onThought, onToolCall, onToolOutput, onFinalAnswer 回调
          // 这些事件由请求级 conversation dispatcher 处理，避免重复投影。
          onTransportEnd: () => {
            if (userInputAdmission && !userInputAdmission.committedMessage) {
              throw new Error('Annotation run completed without a durable user input commit');
            }
            console.log('[AnnotationRunOrchestrator] AI响应结束');

            annotationExecutionState.settle({ controller: abortController, errorMessage: null });
            streamHandlers.onTransportEnd(true, 'normal_completion');
          },
          onError: (error) => {
            console.error('[AnnotationRunOrchestrator] AI执行出错:', error);
            const uiMessage = resolveCurrentConversationMessage('conversation.flow.streamFailed');
            annotationExecutionState.settle({ controller: abortController, errorMessage: uiMessage });
            streamHandlers.onError(uiMessage, 'stream_error');
          },
        },
        abortController.signal
      );
    } catch (error: unknown) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (!isAbortError) {
        const uiMessage = resolveCurrentConversationMessage('conversation.flow.taskInvocationFailed');
        console.error('[AnnotationRunOrchestrator] 调用失败:', error);
        annotationExecutionState.settle({ controller: abortController, errorMessage: uiMessage });
        streamHandlers.onError(uiMessage, 'api_error');
      } else {
        annotationExecutionState.settle({ controller: abortController, errorMessage: null });
      }
    }
  };

  return {
    executeAnnotationRun,
    cancelAnnotationRun,
  };
}
