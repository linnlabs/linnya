import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantServiceCallbacks, Conversation } from '../../types';
import type { InvokeAssistantParams } from '../assistantService';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';

const harness = vi.hoisted(() => {
  const conversationA: Conversation = {
    id: 'conversation-a',
    title: 'A',
    titleOrigin: 'explicit' as const,
    messages: [{
      id: 'message-a',
      role: 'user' as const,
      type: 'user_input' as const,
      content: '原问题',
      timestamp: 1,
    }],
    createdAt: 1,
    updatedAt: 1,
    selectedAgentId: null,
    metadata: {},
  };
  const conversationB: Conversation = {
    id: 'conversation-b',
    title: 'B',
    titleOrigin: 'explicit' as const,
    messages: [],
    selectedAgentId: null,
    createdAt: 2,
    updatedAt: 2,
  };
  const assistantStore = {
    activeConversation: conversationA,
    activeMessages: conversationA.messages,
    hasActiveConversation: true,
    isStreaming: false,
    isLoading: false,
    commitUserInput: vi.fn((event: ConversationUserInputCommittedEvent) => ({
      id: event.id,
      role: 'user' as const,
      type: 'user_input' as const,
      content: event.raw_content ?? event.content,
      timestamp: event.timestamp,
      attachments: event.attachments,
    })),
    truncateProjectionStateAfterMessage: vi.fn(),
    updateMessageById: vi.fn(),
    cancelCurrentStream: vi.fn(),
    startExecution: vi.fn(),
    startInteractiveRun: vi.fn(),
    handleSseEvent: vi.fn(async () => ({ success: true })),
    setError: vi.fn(),
    setSelectedConversation: vi.fn(),
  };
  const invokeAssistantMock = vi.fn<(
    params: InvokeAssistantParams,
    callbacks: AssistantServiceCallbacks,
    signal: AbortSignal,
  ) => Promise<void>>(async () => undefined);

  return {
    assistantStore,
    conversationA,
    conversationB,
    conversationState: {
      conversations: [conversationA, conversationB],
    },
    invokeAssistantMock,
    cancelInteractiveRun: vi.fn(async () => undefined),
    interactiveRunStore: {
      snapshotFor: vi.fn<(_conversationId: string) => { status: string } | undefined>(() => undefined),
      failRun: vi.fn(),
      recordCommandError: vi.fn(),
    },
    messageWindowStore: {
      conversationId: conversationA.id,
      truncateAfterMessage: vi.fn(),
    },
    conversationTitleFeature: {
      handleUserMessage: vi.fn(async () => undefined),
      discardConversation: vi.fn(),
      sealForSubsequentUserAction: vi.fn(),
    },
  };
});

vi.mock('../assistantService', () => ({
  invokeAssistant: harness.invokeAssistantMock,
}));

vi.mock('./context', () => ({
  buildPageContextV1WithLog: () => ({ kind: 'none' }),
  formatPageContextForContextBefore: () => '',
  validateStructuredContextRequirements: () => ({ ok: true }),
}));

vi.mock('./context/contextHelper', () => ({
  getSidebarDocumentContext: vi.fn(async () => {
    harness.assistantStore.activeConversation = harness.conversationB;
    return { document_fragment: 'document-a' };
  }),
  getSidebarDocumentFragmentContext: vi.fn(async () => ({ document_fragment: '' })),
}));

vi.mock('../../store/assistantStore', () => ({
  useAssistantStore: () => harness.assistantStore,
}));

vi.mock('../../features/interactive-run', () => ({
  useInteractiveRunStore: () => harness.interactiveRunStore,
  isInteractiveRunBusy: (run: unknown) => run !== undefined,
  cancelInteractiveRun: harness.cancelInteractiveRun,
}));

vi.mock('../../message-window', () => ({
  useMessageWindowStore: () => harness.messageWindowStore,
}));

vi.mock('../../../../shared/stores/ui', () => ({
  useUIStore: () => ({ getEditor: () => null }),
}));

vi.mock('@/domains/model-configuration', () => ({
  readEffectiveModelPurposeBinding: () => 'image-generation-default',
}));

vi.mock('../../history/orchestration/scheduleSyncConversationToHistory', () => ({
  scheduleSyncConversationToHistory: vi.fn(),
}));

vi.mock('../../history/orchestration/syncConversationMetadataToHistory', () => ({
  syncConversationMetadataToHistory: vi.fn(),
  touchConversationHistoryTimestamp: vi.fn(),
}));

vi.mock('./helpers', () => ({
  useWorkspaceMetadata: () => ({
    buildWorkspaceMetadata: () => ({
      projectId: 'project-1',
      projectMetadata: { id: 'project-1' },
      documentMetadata: undefined,
      projectFileList: [],
    }),
    syncMetadataToConversation: vi.fn(),
  }),
}));

vi.mock('../../store/conversationState', () => ({
  useConversationState: () => harness.conversationState,
}));

vi.mock('../../../../shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentScope: { kind: 'project', projectId: 'project-1' },
    currentProjectId: 'project-1',
  }),
}));

vi.mock('../../../../shared/ports/workspaceContextPort', () => ({
  getWorkspaceContextPort: () => ({ getActiveDocumentSession: () => null }),
}));

vi.mock('./ensureMaterializedConversation', () => ({
  ensureMaterializedConversation: () => harness.assistantStore.activeConversation,
  hasRenderableConversationContent: () => true,
}));

vi.mock('./helpers/requestSaveBeforeAssistantInvoke', () => ({
  requestSaveBeforeAssistantInvoke: vi.fn(async () => undefined),
}));

vi.mock('../../functions/resolveCurrentConversationMessage', () => ({
  resolveCurrentConversationMessage: (key: string) => key,
}));

vi.mock('../../../../shared/quota/quotaClient', () => ({
  consumeQuotaOrNull: vi.fn(async () => null),
}));

vi.mock('../../history', () => ({
  ensureHistoryWindowTailForBottom: vi.fn(async () => undefined),
}));

vi.mock('../../features/conversation-title', () => ({
  useConversationTitleFeature: () => harness.conversationTitleFeature,
}));

import { useChatFlowOrchestrator } from './chatFlowOrchestrator';

describe('chatFlowOrchestrator edit and resend', () => {
  beforeEach(() => {
    harness.conversationA.messages.splice(1);
    harness.assistantStore.activeConversation = harness.conversationA;
    harness.assistantStore.isStreaming = false;
    harness.assistantStore.isLoading = false;
    harness.invokeAssistantMock.mockClear();
    harness.assistantStore.cancelCurrentStream.mockClear();
    harness.cancelInteractiveRun.mockClear();
    harness.interactiveRunStore.snapshotFor.mockReset();
    harness.interactiveRunStore.snapshotFor.mockReturnValue(undefined);
    harness.assistantStore.commitUserInput.mockClear();
    harness.assistantStore.truncateProjectionStateAfterMessage.mockClear();
    harness.assistantStore.updateMessageById.mockClear();
    harness.messageWindowStore.truncateAfterMessage.mockClear();
    delete harness.conversationA.messages[0]?.metadata;
    delete harness.conversationA.messages[0]?.attachments;
  });

  it('把模型配置域解析出的有效图片生成模型冻结到本次请求', async () => {
    await useChatFlowOrchestrator().sendChatMessage({ text: '生成一张图片' });

    expect(harness.invokeAssistantMock.mock.calls[0]?.[0]).toMatchObject({
      options: {
        context: {
          imageGenerationModelId: 'image-generation-default',
        },
      },
    });
  });

  it('普通图片发送只在 durable ack 后投影，并把独立 draft snapshot 原样上行', async () => {
    const onUserMessageCommitted = vi.fn();
    harness.invokeAssistantMock.mockImplementationOnce(async (params, callbacks) => {
      expect(harness.assistantStore.commitUserInput).not.toHaveBeenCalled();
      const messageId = params.options?.messageId;
      if (!messageId) throw new Error('message ID should be allocated before invoke');
      await callbacks.onUserInputCommitted?.({
        id: messageId,
        type: 'user_input_committed',
        timestamp: 20,
        conversation_id: 'conversation-a',
        turn_id: 'turn-image-1',
        operation: 'append',
        content: '<user_request>\n\n</user_request>',
        raw_content: '',
        attachments: [{
          id: 'attachment-1',
          kind: 'image',
          assetId: 'asset-1',
          mediaType: 'image/png',
          byteLength: 4,
          width: 2,
          height: 2,
          sha256: 'a'.repeat(64),
          fileName: 'diagram.png',
        }],
      });
    });
    const orchestrator = useChatFlowOrchestrator({ onUserMessageCommitted });

    const committed = await orchestrator.sendChatMessage({ text: '' }, {}, {
      attachments: [{ draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' }],
    });

    expect(committed).toBe(true);
    expect(harness.invokeAssistantMock.mock.calls[0]?.[0]).toMatchObject({
      userMessage: { text: '' },
      draftAttachments: [{ draftId: 'draft-1', kind: 'image', fileName: 'diagram.png' }],
    });
    expect(harness.assistantStore.commitUserInput).toHaveBeenCalledOnce();
    expect(onUserMessageCommitted).toHaveBeenCalledOnce();
    expect(harness.conversationTitleFeature.handleUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userText: '' }),
    );
  });

  it('commit 前请求失败不写消息，也不触发 composer 清理回调', async () => {
    const onUserMessageCommitted = vi.fn();
    harness.invokeAssistantMock.mockImplementationOnce(async () => undefined);

    const committed = await useChatFlowOrchestrator({ onUserMessageCommitted })
      .sendChatMessage({ text: 'question' });

    expect(committed).toBe(false);
    expect(harness.assistantStore.commitUserInput).not.toHaveBeenCalled();
    expect(onUserMessageCommitted).not.toHaveBeenCalled();
  });

  it('编辑上下文等待期间切换活跃会话，仍应向发起时的会话请求', async () => {
    const orchestrator = useChatFlowOrchestrator();

    await orchestrator.editAndResendMessage({
      messageId: 'message-a',
      text: '修改后的问题',
      attachmentSelection: { mode: 'replace', items: [] },
    });

    expect(harness.assistantStore.activeConversation.id).toBe('conversation-b');
    expect(harness.invokeAssistantMock).toHaveBeenCalledTimes(1);
    expect(harness.invokeAssistantMock.mock.calls[0]?.[0]).toMatchObject({
      options: { conversationId: 'conversation-a' },
      eventDispatcher: expect.any(Function),
    });
  });

  it('编辑重发先取消旧流，但 commit 前不改写旧历史', async () => {
    harness.interactiveRunStore.snapshotFor.mockReturnValueOnce({ status: 'running' });

    const orchestrator = useChatFlowOrchestrator();

    await orchestrator.editAndResendMessage({
      messageId: 'message-a',
      text: '修改后的问题',
      attachmentSelection: { mode: 'replace', items: [] },
    });

    expect(harness.cancelInteractiveRun).toHaveBeenCalledWith('conversation-a', {
      reason: 'rerun_replaced_foreground_run',
    });
    expect(harness.assistantStore.commitUserInput).not.toHaveBeenCalled();
    expect(harness.messageWindowStore.truncateAfterMessage).not.toHaveBeenCalled();
  });

  it('编辑重发时从 snake wire 恢复全部结构化引用', async () => {
    const targetMessage = harness.conversationA.messages[0];
    if (!targetMessage) throw new Error('missing test user message');
    targetMessage.metadata = {
      user_quote: {
        items: [
          {
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'platform',
            kind: 'text-selection',
            text: 'first',
            source: { doc_id: 'doc-1' },
          },
          {
            quote_id: 'reference-22222222222222222222222222222222',
            plugin_id: 'slides',
            kind: 'slides-source-selection',
            text: 'second',
            metadata: { presentationId: 'deck-1' },
          },
        ],
      },
    };
    targetMessage.attachments = [{
      id: 'attachment-edit',
      kind: 'image',
      assetId: 'asset-edit',
      mediaType: 'image/png',
      byteLength: 128,
      width: 16,
      height: 8,
      sha256: 'd'.repeat(64),
    }];

    await useChatFlowOrchestrator().editAndResendMessage({
      messageId: targetMessage.id,
      text: '修改后的问题',
      attachmentSelection: {
        mode: 'replace',
        items: [{ source: 'existing', attachmentId: 'attachment-edit' }],
      },
    });

    expect(harness.invokeAssistantMock.mock.calls[0]?.[0]).toMatchObject({
      userMessage: {
        text: '修改后的问题',
        userQuote: {
          items: [
            {
              pluginId: 'platform',
              kind: 'text-selection',
              text: 'first',
              source: { doc_id: 'doc-1' },
            },
            {
              pluginId: 'slides',
              kind: 'slides-source-selection',
              text: 'second',
              metadata: { presentationId: 'deck-1' },
            },
          ],
        },
        attachments: targetMessage.attachments,
      },
      options: {
        truncateFromMessageId: 'message-a',
        truncateReason: 'edit',
      },
      attachmentSelection: {
        mode: 'replace',
        items: [{ source: 'existing', attachmentId: 'attachment-edit' }],
      },
    });
  });

  it('重新生成完整复用用户消息，并保留 regenerate 原因', async () => {
    const targetMessage = harness.conversationA.messages[0];
    if (!targetMessage) throw new Error('missing test user message');
    targetMessage.metadata = {
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'quoted context',
        }],
      },
    };
    targetMessage.attachments = [{
      id: 'attachment-regenerate',
      kind: 'image',
      assetId: 'asset-regenerate',
      mediaType: 'image/webp',
      byteLength: 256,
      width: 32,
      height: 24,
      sha256: 'e'.repeat(64),
      fileName: 'regenerate.webp',
    }];

    await useChatFlowOrchestrator().regenerateResponseForMessage({ messageId: targetMessage.id });

    expect(harness.invokeAssistantMock.mock.calls[0]?.[0]).toMatchObject({
      userMessage: {
        text: '原问题',
        userQuote: {
          items: [{
            id: 'reference-11111111111111111111111111111111',
            pluginId: 'platform',
            kind: 'text-selection',
            text: 'quoted context',
          }],
        },
        attachments: targetMessage.attachments,
      },
      options: {
        truncateFromMessageId: 'message-a',
        truncateReason: 'regenerate',
      },
      attachmentSelection: { mode: 'preserve' },
    });
  });

  it('provider 在 durable ack 后失败仍保留用户图片，换模型后 regenerate 复用原附件', async () => {
    let committedMessageId = '';
    harness.assistantStore.commitUserInput.mockImplementationOnce((event) => {
      const committedMessage = {
        id: event.id,
        role: 'user' as const,
        type: 'user_input' as const,
        content: event.raw_content ?? event.content,
        timestamp: event.timestamp,
        attachments: event.attachments,
      };
      harness.conversationA.messages.push(committedMessage);
      return committedMessage;
    });
    harness.invokeAssistantMock.mockImplementationOnce(async (params, callbacks) => {
      committedMessageId = params.options?.messageId ?? '';
      await callbacks.onUserInputCommitted?.({
        id: committedMessageId,
        type: 'user_input_committed',
        timestamp: 30,
        conversation_id: 'conversation-a',
        turn_id: 'turn-provider-failed',
        operation: 'append',
        content: '识别这张图',
        raw_content: '识别这张图',
        attachments: [{
          id: 'attachment-provider-failed',
          kind: 'image',
          assetId: 'asset-provider-failed',
          mediaType: 'image/png',
          byteLength: 4,
          width: 2,
          height: 2,
          sha256: '9'.repeat(64),
          fileName: 'provider-failed.png',
        }],
      });
      callbacks.onError?.(new Error('provider unavailable'));
    });
    const orchestrator = useChatFlowOrchestrator();

    const committed = await orchestrator.sendChatMessage(
      { text: '识别这张图' },
      {},
      { attachments: [{ draftId: 'draft-provider-failed', kind: 'image', fileName: 'provider-failed.png' }] },
    );

    expect(committed).toBe(true);
    expect(harness.conversationA.messages[harness.conversationA.messages.length - 1]).toMatchObject({
      id: committedMessageId,
      attachments: [{ id: 'attachment-provider-failed', assetId: 'asset-provider-failed' }],
    });

    harness.assistantStore.activeConversation = harness.conversationA;
    await orchestrator.regenerateResponseForMessage({ messageId: committedMessageId });

    expect(harness.invokeAssistantMock.mock.calls[1]?.[0]).toMatchObject({
      userMessage: {
        text: '识别这张图',
        attachments: [{ id: 'attachment-provider-failed', assetId: 'asset-provider-failed' }],
      },
      attachmentSelection: { mode: 'preserve' },
      options: {
        truncateFromMessageId: committedMessageId,
        truncateReason: 'regenerate',
      },
    });
  });

  it('replace ack 后以同一 durable 消息同步 live 与 window 投影', async () => {
    harness.invokeAssistantMock.mockImplementationOnce(async (_params, callbacks) => {
      await callbacks.onUserInputCommitted?.({
        id: 'message-a',
        type: 'user_input_committed',
        timestamp: 20,
        conversation_id: 'conversation-a',
        turn_id: 'turn-edit-ack',
        operation: 'replace',
        replaced_from_message_id: 'message-a',
        content: '修改后的问题',
        raw_content: '修改后的问题',
        attachments: [{
          id: 'attachment-after-edit',
          kind: 'image',
          assetId: 'asset-after-edit',
          mediaType: 'image/png',
          byteLength: 4,
          width: 2,
          height: 2,
          sha256: 'f'.repeat(64),
        }],
      });
    });

    const committed = await useChatFlowOrchestrator().editAndResendMessage({
      messageId: 'message-a',
      text: '修改后的问题',
      attachmentSelection: { mode: 'replace', items: [] },
    });

    expect(committed).toBe(true);
    expect(harness.assistantStore.commitUserInput).toHaveBeenCalledTimes(1);
    expect(harness.messageWindowStore.truncateAfterMessage).toHaveBeenCalledTimes(1);
    expect(harness.messageWindowStore.truncateAfterMessage).toHaveBeenCalledWith(
      'message-a',
      { replacement: expect.objectContaining({
        id: 'message-a',
        content: '修改后的问题',
        attachments: [expect.objectContaining({ id: 'attachment-after-edit' })],
      }) },
    );
  });
});
