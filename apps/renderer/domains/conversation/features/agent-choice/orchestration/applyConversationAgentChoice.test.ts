import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationSelectedAgentIdSchema,
  type ConversationSelectedAgentId,
} from '@app/schemas';
import type { Conversation } from '../../../types';
import {
  applyConversationAgentChoice,
  type ConversationAgentChoiceAssistantStore,
  type ConversationAgentChoicePersistencePort,
} from './applyConversationAgentChoice';

const conversationTitleFeature = vi.hoisted(() => ({
  registerAutomaticCandidate: vi.fn(),
}));

vi.mock('../../conversation-title', () => ({
  useConversationTitleFeature: () => conversationTitleFeature,
}));

const fixtureAgentId = ConversationSelectedAgentIdSchema.parse('agent-choice-fixture');
const choices = [{
  id: 'fixture',
  agentId: fixtureAgentId,
  menuText: '测试 Agent',
  pillText: '测试',
  ariaLabel: '测试 Agent',
  iconComponent: {},
}];

function conversation(id: string): Conversation {
  return {
    id,
    title: 'New conversation',
    titleOrigin: 'default',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function createHarness(activeConversation: Conversation | null = conversation('conversation-1')): {
  assistantStore: ConversationAgentChoiceAssistantStore;
  persisted: ConversationAgentChoicePersistencePort;
  selectedWrites: Array<{ conversationId: string; selectedAgentId: ConversationSelectedAgentId | null }>;
} {
  let currentConversation = activeConversation;
  const selectedWrites: Array<{
    conversationId: string;
    selectedAgentId: ConversationSelectedAgentId | null;
  }> = [];
  return {
    assistantStore: {
      get activeConversation() {
        return currentConversation;
      },
      createNewConversation: vi.fn(() => {
        currentConversation = conversation('materialized-conversation');
        return currentConversation.id;
      }),
      setConversationSelectedAgent(conversationId, selectedAgentId) {
        selectedWrites.push({ conversationId, selectedAgentId });
      },
    },
    persisted: {
      updateSelectedAgent: vi.fn(async (_conversationId, selectedAgentId) => selectedAgentId),
    },
    selectedWrites,
  };
}

const projectScope = {
  currentScope: { kind: 'project' as const, projectId: 'project-1' },
  materializeCurrentDraft: vi.fn(),
};

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolver: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolver) {
        throw new Error('deferred promise is not initialized');
      }
      resolver(value);
    },
  };
}

describe('applyConversationAgentChoice', () => {
  beforeEach(() => {
    conversationTitleFeature.registerAutomaticCandidate.mockClear();
    projectScope.materializeCurrentDraft.mockClear();
  });

  it('先持久化产品 Agent 身份，再同步指定 conversation 的 read model', async () => {
    const harness = createHarness();

    await expect(applyConversationAgentChoice({
      assistantStore: harness.assistantStore,
      scopeStore: projectScope,
      agentChoiceId: 'fixture',
      choices,
      persistence: harness.persisted,
    })).resolves.toEqual({
      conversationId: 'conversation-1',
      selectedAgentId: fixtureAgentId,
    });

    expect(harness.persisted.updateSelectedAgent).toHaveBeenCalledWith(
      'conversation-1',
      fixtureAgentId,
      'project-1',
    );
    expect(harness.selectedWrites).toEqual([{
      conversationId: 'conversation-1',
      selectedAgentId: fixtureAgentId,
    }]);
  });

  it('持久化失败时不修改 Renderer selectedAgentId', async () => {
    const harness = createHarness();
    const failure = new Error('persistence failed');
    harness.persisted.updateSelectedAgent = vi.fn(async () => {
      throw failure;
    });

    await expect(applyConversationAgentChoice({
      assistantStore: harness.assistantStore,
      scopeStore: projectScope,
      agentChoiceId: 'fixture',
      choices,
      persistence: harness.persisted,
    })).rejects.toBe(failure);
    expect(harness.selectedWrites).toEqual([]);
  });

  it('持久化等待期间切换会话时，只回写发起时的 conversation', async () => {
    const harness = createHarness(conversation('conversation-a'));
    const persistence = createDeferred<ConversationSelectedAgentId | null>();
    harness.persisted.updateSelectedAgent = vi.fn(() => persistence.promise);

    const applying = applyConversationAgentChoice({
      assistantStore: harness.assistantStore,
      scopeStore: projectScope,
      agentChoiceId: 'fixture',
      choices,
      persistence: harness.persisted,
    });
    harness.assistantStore.createNewConversation();
    persistence.resolve(fixtureAgentId);
    await applying;

    expect(harness.selectedWrites).toEqual([{
      conversationId: 'conversation-a',
      selectedAgentId: fixtureAgentId,
    }]);
  });

  it('空白草稿清空 Agent 时不创建会话', async () => {
    const harness = createHarness(null);

    await expect(applyConversationAgentChoice({
      assistantStore: harness.assistantStore,
      scopeStore: projectScope,
      agentChoiceId: null,
      choices,
      persistence: harness.persisted,
    })).resolves.toBeNull();

    expect(harness.assistantStore.createNewConversation).not.toHaveBeenCalled();
    expect(harness.persisted.updateSelectedAgent).not.toHaveBeenCalled();
  });

  it('空白草稿选择 Agent 时先取得稳定 conversationId，再由 Host 原子正式化', async () => {
    const harness = createHarness(null);

    await applyConversationAgentChoice({
      assistantStore: harness.assistantStore,
      scopeStore: projectScope,
      agentChoiceId: 'fixture',
      choices,
      persistence: harness.persisted,
    });

    expect(projectScope.materializeCurrentDraft).toHaveBeenCalledWith('materialized-conversation');
    expect(conversationTitleFeature.registerAutomaticCandidate).toHaveBeenCalledWith(
      'materialized-conversation',
    );
    expect(harness.persisted.updateSelectedAgent).toHaveBeenCalledWith(
      'materialized-conversation',
      fixtureAgentId,
      'project-1',
    );
  });
});
