import { describe, expect, it, vi } from 'vitest';
import type { BaseMessage, Conversation } from '@/domains/conversation/types';
import { prepareTableFillRunCommand } from '../orchestration/prepareTableFillRunCommand';

vi.mock('@/domains/conversation/features/conversation-title', () => ({
  useConversationTitleFeature: () => ({ registerAutomaticCandidate: vi.fn() }),
}));

interface TestStore {
  activeConversation: Conversation | null;
  readonly activeMessages: BaseMessage[];
  currentProjectId: string | null;
  currentScope: { kind: 'project'; projectId: string } | { kind: 'linnya-assistant' };
  createdProjectIds: Array<string | null | undefined>;
  materializedConversationIds: string[];
  createNewConversation(projectId?: string | null): string;
  materializeCurrentDraft(conversationId: string): void;
}

function createConversation(
  id: string,
  metadata: Record<string, unknown> = {},
  messages: BaseMessage[] = [],
): Conversation {
  return {
    id,
    title: '测试对话',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages,
    selectedAgentId: null,
    metadata,
  };
}

function createStore(activeConversation: Conversation | null = createConversation('conversation-1')): TestStore {
  const store: TestStore = {
    activeConversation,
    get activeMessages() {
      return store.activeConversation?.messages ?? [];
    },
    currentProjectId: 'project-1',
    currentScope: { kind: 'project', projectId: 'project-1' },
    createdProjectIds: [],
    materializedConversationIds: [],
    createNewConversation(projectId) {
      store.createdProjectIds.push(projectId);
      store.activeConversation = createConversation('created-conversation', { projectId });
      return 'created-conversation';
    },
    materializeCurrentDraft(conversationId) {
      store.materializedConversationIds.push(conversationId);
    },
  };
  return store;
}

describe('prepareTableFillRunCommand', () => {
  it('只准备 command identity，不在 durable ack 前创建用户消息', async () => {
    const store = createStore();

    const result = await prepareTableFillRunCommand({
      assistantStore: store,
      workspaceScopeStore: store,
      signal: new AbortController().signal,
      createRunId: () => 'run-1',
      createMessageId: () => 'message-1',
    });

    expect(result).toEqual({
      ok: true,
      run: {
        conversationId: 'conversation-1',
        runId: 'run-1',
        messageId: 'message-1',
        projectId: 'project-1',
        projectMetadata: { id: 'project-1' },
        wasNewConversation: true,
      },
    });
    expect(store.activeMessages).toHaveLength(0);
  });

  it('先把当前项目草稿正式化，但仍不伪造 run header', async () => {
    const store = createStore(null);

    const result = await prepareTableFillRunCommand({
      assistantStore: store,
      workspaceScopeStore: store,
      signal: new AbortController().signal,
      createRunId: () => 'run-1',
      createMessageId: () => 'message-1',
    });

    expect(result).toMatchObject({ ok: true, run: { conversationId: 'created-conversation' } });
    expect(store.createdProjectIds).toEqual(['project-1']);
    expect(store.materializedConversationIds).toEqual(['created-conversation']);
    expect(store.activeMessages).toHaveLength(0);
  });

  it('活跃 scope 无项目时使用 conversation 的正式项目 metadata', async () => {
    const store = createStore(createConversation(
      'conversation-1',
      { project_id: 'metadata-project' },
      [{
        id: 'existing',
        role: 'user',
        type: 'user_input',
        content: '旧消息',
        timestamp: 1,
      }],
    ));
    store.currentProjectId = null;
    store.currentScope = { kind: 'linnya-assistant' };

    const result = await prepareTableFillRunCommand({
      assistantStore: store,
      workspaceScopeStore: store,
      signal: new AbortController().signal,
      createRunId: () => 'run-1',
      createMessageId: () => 'message-1',
    });

    expect(result).toMatchObject({
      ok: true,
      run: { projectId: 'metadata-project', wasNewConversation: false },
    });
  });

  it('准备前已取消时不创建 command 或消息', async () => {
    const store = createStore();
    const controller = new AbortController();
    controller.abort();

    await expect(prepareTableFillRunCommand({
      assistantStore: store,
      workspaceScopeStore: store,
      signal: controller.signal,
    })).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(store.activeMessages).toHaveLength(0);
  });
});
