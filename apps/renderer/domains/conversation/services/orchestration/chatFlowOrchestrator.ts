/**
 * @file apps/renderer/domains/conversation/services/orchestration/chatFlowOrchestrator.ts
 * @description 聊天流程编排器 (Chat Flow Orchestrator)
 * 
 * @brief 专门负责聊天交互的业务流程编排
 * =================================================================
 * 
 * 这是从原始 conversationOrchestrator.ts 中拆分出来的聊天专用编排器。
 * 它专注于处理用户与AI的直接对话交互，包括：
 * - 发送新消息
 * - 编辑后重新发送
 * - 重新生成回答
 * 
 * 职责边界：
 * - ✅ 处理侧边栏的直接聊天交互
 * - ✅ 管理消息的编辑和重新生成流程
 * - ❌ 不处理编辑器任务流程（由 annotationRunOrchestrator 负责）
 * - ❌ 不处理工具交互流程（由 toolingFlowOrchestrator 负责）
 */

import {
  invokeAssistant,
} from '../assistantService';
import {
  buildPageContextV1WithLog,
  formatPageContextForContextBefore,
  validateStructuredContextRequirements,
} from './context';
import {
  getSidebarDocumentContext,
  getSidebarDocumentFragmentContext,
} from './context/contextHelper';
import { useAssistantStore } from '../../store/assistantStore';
import { useMessageWindowStore } from '../../message-window';
import { useUIStore } from '../../../../shared/stores/ui';
import { readEffectiveModelPurposeBinding } from '@/domains/model-configuration';
import {
  syncConversationMetadataToHistory,
  touchConversationHistoryTimestamp,
} from '../../history/orchestration/syncConversationMetadataToHistory';
import { useWorkspaceMetadata } from './helpers';
import { useConversationState } from '../../store/conversationState';
import {
  useWorkspaceScopeStore,
  type WorkspaceScope,
} from '../../../../shared/stores/workspaceScopeStore';
import { getWorkspaceContextPort } from '../../../../shared/ports/workspaceContextPort';
import {
  ensureMaterializedConversation,
  hasRenderableConversationContent,
} from './ensureMaterializedConversation';
import { requestSaveBeforeAssistantInvoke } from './helpers/requestSaveBeforeAssistantInvoke';
import { useConversationTitleFeature } from '../../features/conversation-title';
import { resolveCurrentConversationMessage } from '../../functions/resolveCurrentConversationMessage';
import { readUserMessageContent } from '../../functions/userMessageContent';
import type {
  EditUserMessageCommand,
  RegenerateUserMessageCommand,
  UserMessageContent,
} from '../../definitions/userMessageContent';
import type {
  SendMessageOptions,
  ProjectFileSummary,
  Conversation,
  UserMessage,
} from '../../types';
import { consumeQuotaOrNull } from '../../../../shared/quota/quotaClient';
import { ensureHistoryWindowTailForBottom } from '../../history';
import { generateMessageId } from '@shared/utils/idUtils';
import {
  ConversationHistorySummaryPayloadSchema,
  ConversationAgentIds,
  PromptKeys,
  type ConversationUserInputCommittedEvent,
} from '@app/schemas';
import type { ConversationAttachmentSelection } from '@app/schemas';
import {
  getActiveConversationImageEditSessionController,
  type ConversationImageDraftSubmissionSnapshot,
} from '../../features/image-attachments';
import {
  cancelInteractiveRun,
  isInteractiveRunBusy,
  reconcileInteractiveRunTransportOutcome,
  useInteractiveRunStore,
} from '../../features/interactive-run';
import { createConversationUserInputAdmission } from '../../features/user-input-admission';
import { orchestrateCommittedConversationTitle } from './orchestrateCommittedConversationTitle';

/**
 * 聊天流程编排器的组合式函数
 * 
 * @description
 * 提供所有聊天相关的业务流程编排方法：
 * 1. 发送新的聊天消息
 * 2. 编辑现有消息并重新发送
 * 3. 重新生成AI回答
 * 
 * @returns 包含聊天流程方法的对象
 */
export function useChatFlowOrchestrator(orchestratorOptions: {
  readonly onUserMessageCommitted?: () => void;
} = {}) {
  // 获取依赖的Store和服务
  const assistantStore = useAssistantStore();
  const messageWindowStore = useMessageWindowStore();
  const uiStore = useUIStore();
  const { buildWorkspaceMetadata, syncMetadataToConversation } = useWorkspaceMetadata();
  const conversationState = useConversationState();
  const interactiveRunStore = useInteractiveRunStore();
  const workspaceScopeStore = useWorkspaceScopeStore();

  /**
   * ✅ Phase 1 解耦：工作区元数据统一从 useWorkspaceMetadata 获取
   *
   * 中文备注：
   * - chat/task/... 共享同一份 metadata 组装逻辑，避免口径漂移；
   * - 会话 metadata 的回退（历史回放）也收口在 helper 内。
   */
  
  /**
   * 发送直接对话消息（侧边栏输入）
   * 
   * @description
   * 编排完整的用户消息发送流程：
   * 1. 确保活跃对话存在
   * 2. 在UI中添加用户消息
   * 3. 获取文档上下文
   * 4. 调用AI服务
   * 5. 处理流式响应和状态更新
   * 
   * @param userMessage 本轮完整用户消息内容
   * @param options 可选的发送选项
   */
  /**
   * chatFlowOrchestrator 禁止发送历史隔离运行
   *
   * 中文备注：
   * - 历史隔离运行由专用 app/feature 编排负责；当前真实入口是 annotationRunOrchestrator；
   * - chat 流需要依赖历史回放（保持会话语义稳定），否则会引发“共享状态被错误初始化/覆盖”这类问题。
   */
  type ChatFlowSendMessageOptions = Exclude<SendMessageOptions, { historyIsolation: 'isolated' }>;

  function mergeDocumentFragments(...fragments: Array<string | null | undefined>): string {
    return fragments
      .map((fragment) => typeof fragment === 'string' ? fragment.trim() : '')
      .filter((fragment) => fragment.length > 0)
      .join('\n\n');
  }

  /**
   * 仅在 Markdown 文档会话激活时返回编辑器实例。
   *
   * 中文说明：
   * - 页面是否显示文档不再由 UI 视图枚举决定；
   * - file-manager 的 activeSession 才是“当前文档 runtime 类型”的权威来源。
   */
  function getEditorIfEditorView(): unknown {
    const activeSession = getWorkspaceContextPort().getActiveDocumentSession();
    return activeSession?.type === 'markdown' ? uiStore.getEditor() : null;
  }

  function ensureConversationForSend(): Conversation | null {
    return ensureMaterializedConversation(assistantStore, workspaceScopeStore);
  }

  const WEEKLY_LIMIT_FALLBACK = 3;

  const sendChatMessage = async (
    userMessage: UserMessageContent,
    options: ChatFlowSendMessageOptions = {},
    imageSubmission?: ConversationImageDraftSubmissionSnapshot,
  ) => {
    console.log('[ChatFlowOrchestrator] sendChatMessage invoked', {
      promptLength: userMessage.text.length,
      hasActiveConversation: !!assistantStore.hasActiveConversation,
      activeConversationId: assistantStore.activeConversation?.id,
      isLoading: assistantStore.isLoading,
      isStreaming: assistantStore.isStreaming,
    });
    const structuredContextCheck = validateStructuredContextRequirements({ userMessage, options });
    if (!structuredContextCheck.ok) {
      assistantStore.setError(structuredContextCheck.message);
      return false;
    }

    // 1. 首次发送时才把当前空白草稿正式创建为会话，避免空历史污染。
    const conversation = ensureConversationForSend();
    if (!conversation) {
      console.error('[ChatFlowOrchestrator] sendChatMessage: No active conversation found.');
      return false;
    }
    const { projectId, projectMetadata, documentMetadata, projectFileList } = buildWorkspaceMetadata();
    if (workspaceScopeStore.currentScope.kind === 'project' && !projectId) {
      const message = resolveCurrentConversationMessage('conversation.flow.missingProjectForSend');
      console.error(`[ChatFlowOrchestrator] ${message}`);
      assistantStore.setError(message);
      return false;
    }
    if (conversation?.id) {
      syncMetadataToConversation(conversation.id, { projectId, projectMetadata, documentMetadata, projectFileList });
    }
    console.log(`[ChatFlowOrchestrator] sendChatMessage got projectId from workspaceScope: ${projectId}`);
    const conversationId = conversation.id;
    const sendScope: WorkspaceScope = workspaceScopeStore.currentScope.kind === 'project'
      ? { kind: 'project', projectId: workspaceScopeStore.currentScope.projectId }
      : { kind: 'linnya-assistant' };
    console.log(`[ChatFlowOrchestrator] sendChatMessage - Active conversation ID: ${conversationId}`);

    // =========================================================================
    // 阶段0：Deep Research 本地配额（每周3次）
    // - “点击开始”即消耗一次
    // - 超限时阻止发送，并给出明确 UI 文案
    // =========================================================================
    const selectedAgentIdForSend = options.promptKey
      ? undefined
      : options.selectedAgentId ?? conversation.selectedAgentId ?? undefined;
    const usesDeepResearch = selectedAgentIdForSend === ConversationAgentIds.DEEP_RESEARCH
      || options.promptKey === PromptKeys.DEEP_RESEARCH_LEADER;
    if (usesDeepResearch) {
      const consumeRes = await consumeQuotaOrNull('deep_research');
      if (consumeRes && consumeRes.success === true && 'allowed' in consumeRes && consumeRes.allowed === false) {
        const usedCount = typeof consumeRes.usedCount === 'number' ? consumeRes.usedCount : WEEKLY_LIMIT_FALLBACK;
        const limit = typeof consumeRes.limit === 'number' ? consumeRes.limit : WEEKLY_LIMIT_FALLBACK;
        const resetAt = typeof consumeRes.resetAt === 'number' ? consumeRes.resetAt : null;
        const resetText = resetAt
          ? new Date(resetAt).toLocaleString()
          : resolveCurrentConversationMessage('conversation.flow.deepResearch.resetFallback');

        const uiMessage = resolveCurrentConversationMessage('conversation.flow.deepResearch.weeklyLimitReached', {
          usedCount,
          limit,
          resetText,
        });
        assistantStore.setError(uiMessage);

        return false;
      }
    }

    // 中文说明：草稿对话可能已有 hidden/context/tool_output 等底层消息；
    // 是否进入历史必须按“用户可见内容”判断，不能再直接看 messages.length。
    const isNewConversation = !hasRenderableConversationContent(conversation, assistantStore.activeMessages);
    const messageId = generateMessageId();
    const admission = createConversationUserInputAdmission({
      expectation: { conversationId, messageId, operation: 'append' },
      commitUserInput: assistantStore.commitUserInput,
      onCommitted: (committedMessage, event) => {
        orchestrateCommittedConversationTitle({
          event,
          wasNewConversation: isNewConversation,
          scope: sendScope,
          onHistorySynced: () => assistantStore.setSelectedConversation(conversationId),
        });
        touchConversationHistoryTimestamp(conversationId, committedMessage.timestamp);
        orchestratorOptions.onUserMessageCommitted?.();
      },
    });

    // 普通发送必须先回到权威尾窗；否则中部窗口会丢弃 liveOnly 用户消息。
    await ensureHistoryWindowTailForBottom(conversationId);

    try {
      // 3. 获取文档片段，与其他流程保持一致
      const editor = getEditorIfEditorView();
      const documentContext = await getSidebarDocumentContext(editor);
      const mergedDocumentFragment = mergeDocumentFragments(
        documentContext?.document_fragment,
        options.documentFragment,
      );

      // 4. 调用统一的执行方法（包含完整的状态管理）
      await _invokeAssistantWithCallbacks({
        conversationId,
        userMessage,
        messageId,
        documentFragment: mergedDocumentFragment,
        projectId, // 🔥 直接传递 projectId
        projectMetadata,
        documentMetadata,
        projectFileList,
        historySyncScope: sendScope,
        resolveHistoryLastEventAtOverride: () => admission.committedMessage?.timestamp,
        draftAttachments: imageSubmission?.attachments,
        onUserInputCommitted: admission.accept,
        options,
      });

      return admission.committedMessage !== null;
    } catch (error) {
      console.error('[ChatFlowOrchestrator] sendChatMessage failed:', error);
      return false;
    }
  };

  type UserMessageRerunRequest =
    | { readonly action: 'edit'; readonly command: EditUserMessageCommand }
    | { readonly action: 'regenerate'; readonly command: RegenerateUserMessageCommand };

  /** 编辑与重新生成共享同一条 inclusive truncate 流程，action 只描述业务原因。 */
  const rerunUserMessage = async (request: UserMessageRerunRequest): Promise<boolean> => {
    const messageId = request.command.messageId;
    const conversation = assistantStore.activeConversation;
    if (!conversation) {
      if (request.action === 'regenerate') {
        assistantStore.setError(resolveCurrentConversationMessage('conversation.error.regenerateNoConversation'));
      } else {
        console.error('[ChatFlowOrchestrator] editAndResendMessage: No active conversation found.');
      }
      return false;
    }

    const visibleMessages = assistantStore.activeMessages;
    const targetMessage = visibleMessages.find(
      (message): message is UserMessage => message.id === messageId
        && message.role === 'user'
        && message.type === 'user_input',
    );
    if (!targetMessage) {
      if (request.action === 'regenerate') {
        assistantStore.setError(resolveCurrentConversationMessage('conversation.error.regenerateMessageNotFound'));
      } else {
        console.error(`[ChatFlowOrchestrator] editAndResendMessage: Message with id ${messageId} not found.`);
      }
      return false;
    }

    const originalContent = readUserMessageContent(targetMessage);
    const rerunContent: UserMessageContent = request.action === 'edit'
      ? { ...originalContent, text: request.command.text }
      : originalContent;
    const attachmentSelection: ConversationAttachmentSelection = request.action === 'edit'
      ? request.command.attachmentSelection
      : { mode: 'preserve' };
    useConversationTitleFeature().sealForSubsequentUserAction(conversation.id);

    // summary hint 必须在本地投影截断前读取；权威 truncate 仍由后端 EventStore 执行。
    let summaryContextId: string | undefined;
    for (const message of visibleMessages) {
      if (message.type !== 'history_summary') continue;
      const replacedIds = ConversationHistorySummaryPayloadSchema.parse(
        { summary: message.metadata?.summary },
      ).summary.replacedMessageIds;
      if (replacedIds.includes(messageId)) {
        summaryContextId = message.id;
        break;
      }
    }

    // rerun 必须先终止旧请求，避免旧流在新请求提交期间继续追加事件。
    // 本地投影不能在这里提前截断；只有 durable replace ack 才能改写历史。
    if (isInteractiveRunBusy(interactiveRunStore.snapshotFor(conversation.id))) {
      await cancelInteractiveRun(conversation.id, { reason: 'rerun_replaced_foreground_run' });
    }

    const admission = createConversationUserInputAdmission({
      expectation: {
        conversationId: conversation.id,
        messageId,
        operation: 'replace',
      },
      commitUserInput: assistantStore.commitUserInput,
      onCommitted: (committedMessage) => {
        if (messageWindowStore.conversationId === conversation.id) {
          messageWindowStore.truncateAfterMessage(messageId, { replacement: committedMessage });
        }
        if (request.action === 'edit') {
          getActiveConversationImageEditSessionController()?.acceptCommitted(messageId);
        }
        touchConversationHistoryTimestamp(conversation.id, committedMessage.timestamp);
        orchestratorOptions.onUserMessageCommitted?.();
      },
    });

    console.log(`[ChatFlowOrchestrator] 准备${request.action === 'edit' ? '编辑重发' : '重新生成'}消息 ${messageId}，等待 durable replace ack`);

    try {
      // 与 sendChatMessage 保持一致，重新获取文档上下文
      const editor = getEditorIfEditorView();
      const documentContext = await getSidebarDocumentContext(editor);

      // 使用统一的执行方法，带上截断参数
      const { projectMetadata, documentMetadata, projectId, projectFileList } = buildWorkspaceMetadata();
      syncMetadataToConversation(conversation.id, { projectId, projectMetadata, documentMetadata, projectFileList });
      await _invokeAssistantWithCallbacks({
        conversationId: conversation.id,
        userMessage: rerunContent,
        attachmentSelection,
        onUserInputCommitted: admission.accept,
        messageId, // 使用原始消息ID
        documentFragment: documentContext?.document_fragment || '',
        projectId,
        projectMetadata,
        documentMetadata,
        projectFileList,
        options: {
          conversationId: conversation.id,
          // 从目标消息开始截断；编辑重发需要删除旧 user_input 事件本身。
          truncateFromMessageId: messageId,
          truncateReason: request.action,
          // 🔥 Phase 2: 传递摘要上下文ID（如果找到）
          summaryContextId,
        }
      });
      if (!admission.committedMessage && request.action === 'edit') {
        getActiveConversationImageEditSessionController()?.failSubmission(messageId);
      }
      return admission.committedMessage !== null;
    } catch (error) {
      if (request.action === 'edit') {
        getActiveConversationImageEditSessionController()?.failSubmission(messageId);
      }
      console.error(`[ChatFlowOrchestrator] ${request.action} user message failed:`, error);
      return false;
    }
  };

  const editAndResendMessage = (command: EditUserMessageCommand): Promise<boolean> => (
    rerunUserMessage({ action: 'edit', command })
  );

  const regenerateResponseForMessage = (
    command: RegenerateUserMessageCommand,
  ): Promise<boolean> => rerunUserMessage({ action: 'regenerate', command });

  /**
   * 内部辅助函数，用于统一调用AI服务和处理回调
   * @private
   */
  /**
   * 每次请求显式注入 conversation 事件投影端口，避免模块全局 handler 串线。
   */
  const _invokeAssistantWithCallbacks = async (params: {
    conversationId: string;
    userMessage: UserMessageContent;
    messageId: string;
    documentFragment?: string;
    // 允许传入 null，但在真正调用服务前会归一化为 undefined
    projectId?: string | null; // 🔥 接收 projectId
    projectMetadata?: {
      id?: string;
      name?: string;
      description?: string;
    };
    documentMetadata?: {
      id?: string;
      title?: string;
    };
    projectFileList?: ProjectFileSummary[];
    historySyncScope?: WorkspaceScope;
    resolveHistoryLastEventAtOverride?: () => number | undefined;
    draftAttachments?: ConversationImageDraftSubmissionSnapshot['attachments'];
    attachmentSelection?: ConversationAttachmentSelection;
    onUserInputCommitted?: (event: ConversationUserInputCommittedEvent) => void;
    options: SendMessageOptions;
  }) => {
    const {
      conversationId,
      userMessage,
      messageId,
      documentFragment,
      projectId,
      projectMetadata,
      documentMetadata,
      projectFileList,
      historySyncScope,
      resolveHistoryLastEventAtOverride,
      draftAttachments,
      attachmentSelection,
      onUserInputCommitted,
      options,
    } = params;

    const conversation = conversationState.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found for invocation: ${conversationId}`);
    }

    // 🔥 关键修复：在创建新请求前，先显式取消当前流（如果有）
    // 这确保旧的 AbortController 完全清理，不会干扰新请求
    if (isInteractiveRunBusy(interactiveRunStore.snapshotFor(conversationId))) {
      throw new Error(`Conversation ${conversationId} already has an active foreground run`);
    }

    // foreground 正文 run 只写 conversation-scoped interactive-run 状态。
    const abortController = new AbortController();
    assistantStore.startInteractiveRun(abortController);

    try {
      // 1. 构建当前页面上下文（kind/document/selection）
      const pageContext = buildPageContextV1WithLog();
      const {
        promptKey: oneShotPromptKey,
        selectedAgentId: requestedSelectedAgentId,
        ...sharedOptions
      } = options;
      const selectedAgentId = oneShotPromptKey
        ? undefined
        : requestedSelectedAgentId ?? conversation.selectedAgentId ?? undefined;
      const agentRouting = oneShotPromptKey
        ? { promptKey: oneShotPromptKey }
        : selectedAgentId
          ? { selectedAgentId }
          : {};

      console.log('[ChatFlowOrchestrator] agent routing selected:', {
        pageKind: pageContext.kind,
        documentId: pageContext.document?.id,
        documentType: pageContext.document?.type,
        selectedAgentId,
        oneShotPromptKey,
        reason: oneShotPromptKey ? 'one-shot promptKey' : 'conversation selectedAgentId',
      });

      // =========================================================================
      // Milestone 4: 上下文注入（pageContext → context_before / document_fragment）
      // =========================================================================

      // 5) 注入 pageContext 到 context_before（短文本，稳定可观测）
      const injectedPageContextText = formatPageContextForContextBefore(pageContext);
      const originalContextBefore = options?.context?.contextBefore;
      const mergedContextBefore = (() => {
        const parts = [injectedPageContextText, originalContextBefore].filter(
          (p): p is string => typeof p === 'string' && p.trim().length > 0
        );
        return parts.join('\n\n');
      })();

      // 6) 确保 document_fragment 在无 editor 的插件文档场景也可用
      //    - Editor：sendChatMessage 已提前用 editor 构建 DocumentView 并传入 documentFragment
      //    - 插件文档：无 editor 时，通过 page-context provider 构建文本投影
      let effectiveDocumentFragment = documentFragment || '';
      if (!effectiveDocumentFragment) {
        const editor = pageContext.kind === 'editor' ? getEditorIfEditorView() : null;
        const ctx = await getSidebarDocumentFragmentContext({ editor, pageContext });
        effectiveDocumentFragment = ctx.document_fragment || '';
      }

      // conversation 消息由当前请求显式注入的 dispatcher 投影。
      const safeProjectId = projectId ?? undefined;

      await requestSaveBeforeAssistantInvoke();
      await invokeAssistant(
        {
          userMessage,
          draftAttachments,
          attachmentSelection,
          projectId: safeProjectId, // 🔥 传递 projectId（已去除 null）
          options: {
            ...sharedOptions,
            ...agentRouting,
            conversationId: conversation.id,
            messageId,
            documentFragment: effectiveDocumentFragment,
            context: {
              ...options?.context,
              // 🔥 Milestone 4：pageContext 注入到 contextBefore（短文本）
              contextBefore: mergedContextBefore,
              // 请求必须冻结当前有效绑定；显式选择为空时，有效绑定仍可能来自模型目录默认值。
              imageGenerationModelId: readEffectiveModelPurposeBinding('image_generation') ?? undefined,
            },
            projectMetadata: projectMetadata ?? options?.projectMetadata,
            documentMetadata: documentMetadata ?? options?.documentMetadata,
            projectFileList: projectFileList ?? options?.projectFileList,
          },
          eventDispatcher: assistantStore.handleSseEvent,
        },
        // 空回调集合：所有业务事件都通过请求级 dispatcher + messageProjection 处理，
        // 这里只保留最基本的生命周期钩子和错误日志，避免重复消费 SSE 文本流。
        {
          onStreamStart: () => {},
          onUserInputCommitted,
          onTransportEnd: () => {
            syncConversationMetadataToHistory(conversation.id, {
              initialDelayMs: 300,
              maxAttempts: 6,
              retryIntervalMs: 500,
              scope: historySyncScope,
              lastEventAtOverride: resolveHistoryLastEventAtOverride?.(),
            });
          },
          onError: (error) => {
            console.error('[ChatFlowOrchestrator] Stream error:', error);
            if (error.name !== 'AbortError') {
              interactiveRunStore.failRun(
                conversationId,
                resolveCurrentConversationMessage('conversation.flow.chatInvocationFailed'),
              );
            }
          },
          onTransportOutcome: outcome => reconcileInteractiveRunTransportOutcome(
            conversationId,
            abortController,
            outcome,
          ),
        },
        abortController.signal
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // 忽略用户中止的错误
      if (errorMessage !== 'The user aborted a request.') {
        console.error(`[ChatFlowOrchestrator] Invocation failed for message ${messageId}:`, error);
        interactiveRunStore.recordCommandError(
          conversationId,
          resolveCurrentConversationMessage('conversation.flow.chatInvocationFailed'),
        );
      } else {
        console.log(`[ChatFlowOrchestrator] Stream for message ${messageId} was cancelled by user.`);
      }
      // 🔥 注意：不再在这里抛出错误，因为错误已经通过 error 事件在 store 中处理
    }
  };

  // 返回所有聊天流程编排方法
  return {
    sendChatMessage,
    editAndResendMessage,
    regenerateResponseForMessage,
  };
}
