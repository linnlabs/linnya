import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationUserInputCommittedEvent } from '@app/schemas';
import { orchestrateCommittedConversationTitle } from './orchestrateCommittedConversationTitle';

const harness = vi.hoisted(() => ({
  handleUserMessage: vi.fn<() => Promise<void>>(),
  scheduleHistorySync: vi.fn(),
}));

vi.mock('../../features/conversation-title', () => ({
  useConversationTitleFeature: () => ({
    handleUserMessage: harness.handleUserMessage,
  }),
}));

vi.mock('../../history/orchestration/scheduleSyncConversationToHistory', () => ({
  scheduleSyncConversationToHistory: harness.scheduleHistorySync,
}));

function committedEvent(): ConversationUserInputCommittedEvent {
  return {
    id: 'message-1',
    type: 'user_input_committed',
    timestamp: 100,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    operation: 'append',
    content: '<context>引用与 Host 包装</context>用户问题',
    raw_content: '用户问题',
    metadata: {
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: '不应进入标题的引用',
        }],
      },
    },
    attachments: [{
      id: 'attachment-1',
      kind: 'image',
      assetId: 'asset-1',
      mediaType: 'image/png',
      byteLength: 4,
      width: 2,
      height: 2,
      sha256: 'a'.repeat(64),
      fileName: '不应进入标题.png',
    }],
  };
}

describe('orchestrateCommittedConversationTitle', () => {
  beforeEach(() => {
    harness.handleUserMessage.mockReset();
    harness.scheduleHistorySync.mockReset();
  });

  it('标题只消费 durable raw_content，并在 fallback 写入结束后展示历史入口', async () => {
    let settleFallback: () => void = () => undefined;
    harness.handleUserMessage.mockReturnValue(new Promise<void>((resolve) => {
      settleFallback = resolve;
    }));
    const onHistorySynced = vi.fn();
    const event = committedEvent();

    orchestrateCommittedConversationTitle({
      event,
      wasNewConversation: true,
      scope: { kind: 'project', projectId: 'project-1' },
      onHistorySynced,
    });

    expect(harness.handleUserMessage).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      userText: '用户问题',
    });
    expect(harness.scheduleHistorySync).not.toHaveBeenCalled();

    settleFallback();
    await vi.waitFor(() => expect(harness.scheduleHistorySync).toHaveBeenCalledWith(
      'conversation-1',
      {
        scope: { kind: 'project', projectId: 'project-1' },
        lastEventAtOverride: 100,
        onSynced: onHistorySynced,
      },
    ));
  });

  it('旧会话仍终结候选，但不重复调度历史入口', () => {
    harness.handleUserMessage.mockResolvedValue(undefined);

    orchestrateCommittedConversationTitle({
      event: committedEvent(),
      wasNewConversation: false,
      scope: { kind: 'linnya-assistant' },
    });

    expect(harness.handleUserMessage).toHaveBeenCalledOnce();
    expect(harness.scheduleHistorySync).not.toHaveBeenCalled();
  });
});
