import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ConversationSelectedAgentIdSchema, PromptKeys } from '@app/schemas';
import { requireRendererAiInvocationPort } from '@plugin/renderer/aiInvocationPort';
import {
  addComposerReference,
  clearRendererComposerCommandPortForTest,
  removeComposerReference,
} from '@plugin/renderer/composerCommandPort';
import {
  clearRendererConversationSubrunInvocationPortForTest,
  startConversationSubruns,
} from '@plugin/renderer/conversationSubrunInvocationPort';
import type { InvokeAssistantParams } from '@/domains/conversation/services/assistantService';
import type { AssistantServiceCallbacks } from '@/domains/conversation/types';
import { cancelContributedAssistantRuns } from '@/domains/conversation/ports/contributedAssistantRunCancellationPort';
import {
  activateRendererPlugin,
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';
import { installBuiltinRendererPluginPorts } from './installBuiltinRendererPluginPorts';

const sendChatMessageMock = vi.hoisted(() => vi.fn());
const updateSelectedAgentMock = vi.hoisted(() => vi.fn(async (
  _conversationId: string,
  selectedAgentId: unknown,
) => selectedAgentId));
const invokeAssistantMock = vi.hoisted(() => vi.fn<(
  params: InvokeAssistantParams,
  callbacks: AssistantServiceCallbacks,
  signal: AbortSignal,
) => Promise<void>>(async () => undefined));
const resolveCurrentConversationMessageMock = vi.hoisted(() => vi.fn((
  key: string,
  params?: Record<string, unknown>,
) => {
  if (key === 'conversation.flow.pluginRun.agentChoiceUnavailable') {
    return `localized agent choice unavailable: ${params?.agentChoiceId}`;
  }
  if (key === 'conversation.flow.pluginRun.executionFailed') {
    return 'localized execution failed';
  }
  if (key === 'conversation.flow.pluginRun.noConversation') {
    return 'localized no conversation';
  }
  if (key === 'conversation.flow.pluginRun.missingProject') {
    return 'localized missing project';
  }
  return key;
}));
const TestIcon = { name: 'InstallBuiltinRendererPluginPortsTestIcon', template: '<svg />' };
const FIXTURE_PLUGIN_ID = 'renderer-port-fixture';
const FIXTURE_AGENT_ID = ConversationSelectedAgentIdSchema.parse('renderer_port_fixture_agent');
const FIXTURE_PROMPT_KEY = 'renderer_port_fixture_prompt';
const FIXTURE_WORKER_ID = 'fixture-research';
const composerReferenceHarness = vi.hoisted(() => ({
  addReference: vi.fn(() => 'reference-1'),
  removeReference: vi.fn(),
}));
const conversationTitleFeatureHarness = vi.hoisted(() => ({
  registerAutomaticCandidate: vi.fn(),
  handleUserMessage: vi.fn(async () => undefined),
  discardConversation: vi.fn(),
}));

const assistantHarness = vi.hoisted(() => {
  type TestConversation = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: Array<Record<string, unknown>>;
    metadata: Record<string, unknown>;
    selectedAgentId: unknown;
  };

  const state = {
    activeConversation: null as TestConversation | null,
    activeConversationId: null as string | null,
    currentAbortController: null as AbortController | null,
  };

  const store = {
    get activeConversation() {
      return state.activeConversation;
    },
    get activeConversationId() {
      return state.activeConversationId;
    },
    get activeMessages() {
      return state.activeConversation?.messages ?? [];
    },
    get isLoading() {
      return false;
    },
    get isStreaming() {
      return false;
    },
    createNewConversation: vi.fn(() => {
      const conversation: TestConversation = {
        id: 'conversation-1',
        title: 'Plugin edit',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        metadata: {},
        selectedAgentId: null,
      };
      state.activeConversation = conversation;
      state.activeConversationId = conversation.id;
      return conversation.id;
    }),
    setConversationSelectedAgent: vi.fn((conversationId: string, selectedAgentId: unknown) => {
      if (state.activeConversation?.id !== conversationId) return;
      state.activeConversation.selectedAgentId = selectedAgentId;
    }),
    setError: vi.fn(),
    commitUserInput: vi.fn((event: {
      id: string;
      conversation_id: string;
      content: string;
      timestamp: number;
    }) => {
      const message = {
        id: event.id,
        role: 'user' as const,
        type: 'user_input' as const,
        content: event.content,
        timestamp: event.timestamp,
      };
      if (state.activeConversation?.id === event.conversation_id) {
        state.activeConversation.messages.push(message);
      }
      return message;
    }),
    appendMessage: vi.fn(),
    startExecution: vi.fn((controller: AbortController) => {
      state.currentAbortController = controller;
    }),
    setLoading: vi.fn(),
    setStreaming: vi.fn(),
    clearAbortController: vi.fn(() => {
      state.currentAbortController = null;
    }),
    clearAbortControllerIfCurrent: vi.fn((controller: AbortController) => {
      if (state.currentAbortController !== controller) return false;
      state.currentAbortController = null;
      return true;
    }),
    setSelectedConversation: vi.fn(),
  };

  return { state, store };
});

const scopeHarness = vi.hoisted(() => ({
  store: {
    currentScope: { kind: 'linnya-assistant' as const },
    currentProjectId: 'project-1' as string | null,
    materializeCurrentDraft: vi.fn(),
  },
}));

vi.mock('@/domains/conversation/store/assistantStore', () => ({
  useAssistantStore: () => assistantHarness.store,
}));

vi.mock('@/domains/conversation/features/conversation-title', () => ({
  useConversationTitleFeature: () => conversationTitleFeatureHarness,
}));

vi.mock('@/domains/conversation/history/services/historyApiService', () => ({
  historyApiService: {
    updateSelectedAgent: updateSelectedAgentMock,
  },
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => scopeHarness.store,
}));

vi.mock('@/domains/conversation/services/orchestration/chatFlowOrchestrator', () => ({
  useChatFlowOrchestrator: () => ({
    sendChatMessage: sendChatMessageMock,
  }),
}));

vi.mock('@/app/plugins/enabledPluginsStore', () => ({
  useEnabledPluginsStore: () => ({
    enabledPluginIds: new Set(['renderer-port-fixture']),
  }),
}));

vi.mock('@/shared/stores/file', () => ({
  useFileStore: () => ({
    isDirty: false,
    setDirty: vi.fn(),
    setLoading: vi.fn(),
    setSaving: vi.fn(),
  }),
}));

vi.mock('@/app/notification', () => ({
  useNotificationStore: () => ({
    show: vi.fn(),
  }),
}));

vi.mock('@/shared/ipc/projectKbLinksGateway', () => ({
  projectKbLinksGateway: {
    listKnowledgeBaseIdsForProject: vi.fn(async () => ({ success: true, data: [] })),
  },
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'notify-document-opened': vi.fn(async () => ({ success: true })),
    'create-document': vi.fn(async () => ({
      success: true,
      data: { documentId: 'document-1' },
    })),
  },
}));

vi.mock('@/domains/workspace/services/file-manager', () => ({
  getActiveFileSession: vi.fn(() => null),
  markActiveFileDirty: vi.fn(),
}));

vi.mock('@/domains/conversation/services/assistantService', () => ({
  invokeAssistant: invokeAssistantMock,
}));

vi.mock('@/domains/conversation/history', () => ({
  ensureHistoryWindowTailForBottom: vi.fn(async () => undefined),
}));

vi.mock('@/domains/conversation/services/orchestration/helpers/requestSaveBeforeAssistantInvoke', () => ({
  requestSaveBeforeAssistantInvoke: vi.fn(async () => undefined),
}));

vi.mock('@/domains/conversation/functions/resolveCurrentConversationMessage', () => ({
  resolveCurrentConversationMessage: resolveCurrentConversationMessageMock,
}));

vi.mock('@/domains/conversation/features/composer-references', () => ({
  useComposerReferences: () => composerReferenceHarness,
}));

vi.mock('@/domains/conversation/history/orchestration/scheduleSyncConversationToHistory', () => ({
  scheduleSyncConversationToHistory: vi.fn(),
}));

vi.mock('@shared/utils/idUtils', () => ({
  generateMessageId: vi.fn(() => 'message-1'),
}));

describe('installBuiltinRendererPluginPorts AI invocation port', () => {
  beforeEach(async () => {
    clearRendererComposerCommandPortForTest();
    clearRendererConversationSubrunInvocationPortForTest();
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: {
        id: FIXTURE_PLUGIN_ID,
        name: 'Renderer Port Fixture',
        version: '1.0.0',
        description: 'Renderer port contract fixture',
        developer: 'Linnya',
        builtin: true,
        required: false,
      },
      conversationAgentChoices: [{
        id: 'fixture-agent-choice',
        agentId: FIXTURE_AGENT_ID,
        menuText: '测试 Agent',
        pillText: '测试',
        ariaLabel: '已开启：测试 Agent',
        iconComponent: TestIcon,
      }],
      subrunWorkers: [{ id: FIXTURE_WORKER_ID, promptKey: FIXTURE_PROMPT_KEY }],
    });
    await activateRendererPlugin(FIXTURE_PLUGIN_ID);
    vi.clearAllMocks();
    assistantHarness.state.activeConversation = null;
    assistantHarness.state.activeConversationId = null;
    assistantHarness.state.currentAbortController = null;
    scopeHarness.store.currentProjectId = 'project-1';
    invokeAssistantMock.mockImplementation(async (params, callbacks) => {
      const conversationId = params.options?.conversationId;
      const messageId = params.options?.messageId;
      if (conversationId && messageId) {
        await callbacks.onUserInputCommitted?.({
          type: 'user_input_committed',
          id: messageId,
          timestamp: 2,
          conversation_id: conversationId,
          turn_id: 'turn-1',
          operation: 'append',
          content: params.userMessage.text,
          raw_content: params.userMessage.text,
        });
      }
    });
    installBuiltinRendererPluginPorts();
  });

  it('binds composer reference commands without exposing the conversation feature', () => {
    const input = {
      text: 'Node A',
      pluginId: 'fixture-plugin',
      kind: 'node',
    };

    expect(addComposerReference(input)).toBe('reference-1');
    removeComposerReference('reference-1');

    expect(composerReferenceHarness.addReference).toHaveBeenCalledWith(input);
    expect(composerReferenceHarness.removeReference).toHaveBeenCalledWith('reference-1');
  });

  it('starts a visible subrun run through a declared worker', async () => {
    const handle = startConversationSubruns({
      pluginId: FIXTURE_PLUGIN_ID,
      workerId: FIXTURE_WORKER_ID,
      prompt: '研究当前页面',
      activityFeature: 'fixture_research',
      subruns: [{ description: '当前页面', prompt: '研究当前页面内容' }],
    });

    expect(handle.runId).toBe('message-1');
    await handle.completion;
    expect(assistantHarness.store.commitUserInput).toHaveBeenCalledOnce();
    expect(invokeAssistantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          promptKey: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
          hostToolCall: {
            tool_name: 'subrun_batch',
            args: {
              worker_prompt_key: FIXTURE_PROMPT_KEY,
              subruns: [{
                unit_id: 'subrun-unit-message-1',
                subrun_id: 'subrun-message-1',
                description: '当前页面',
                prompt: '研究当前页面内容',
              }],
            },
          },
        }),
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    );
    expect(assistantHarness.store.clearAbortControllerIfCurrent).toHaveBeenCalledWith(
      expect.any(AbortController),
    );
  });

  it('cancels only the subrun run represented by its handle', async () => {
    const handle = startConversationSubruns({
      pluginId: FIXTURE_PLUGIN_ID,
      workerId: FIXTURE_WORKER_ID,
      prompt: '研究当前页面',
      activityFeature: 'fixture_research',
      subruns: [{ description: '当前页面', prompt: '研究当前页面内容' }],
    });
    const startExecutionCalls = assistantHarness.store.startExecution.mock.calls;
    const controller = startExecutionCalls[startExecutionCalls.length - 1]?.[0];
    expect(controller).toBeInstanceOf(AbortController);

    handle.cancel();
    expect(controller.signal.aborted).toBe(true);
    await expect(handle.completion).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('旧 subrun run 收尾时不清理后来者的执行态', async () => {
    assistantHarness.store.clearAbortControllerIfCurrent.mockReturnValueOnce(false);
    invokeAssistantMock.mockRejectedValueOnce(new Error('stale run failed'));

    const handle = startConversationSubruns({
      pluginId: FIXTURE_PLUGIN_ID,
      workerId: FIXTURE_WORKER_ID,
      prompt: '研究当前页面',
      activityFeature: 'fixture_research',
      subruns: [{ description: '当前页面', prompt: '研究当前页面内容' }],
    });

    await expect(handle.completion).rejects.toThrow('stale run failed');
    expect(assistantHarness.store.setLoading).not.toHaveBeenCalled();
    expect(assistantHarness.store.setStreaming).not.toHaveBeenCalled();
    expect(assistantHarness.store.setError).not.toHaveBeenCalled();
  });

  it('通过贡献的 Agent choice 正式化并持久化会话', async () => {
    const port = requireRendererAiInvocationPort();

    const conversation = await port.ensureConversation({
      agentChoiceId: 'fixture-agent-choice',
    });

    expect(conversation).toEqual({ conversationId: 'conversation-1' });
    expect(assistantHarness.store.createNewConversation).toHaveBeenCalledWith(null);
    expect(scopeHarness.store.materializeCurrentDraft).toHaveBeenCalledWith('conversation-1');
    expect(updateSelectedAgentMock).toHaveBeenCalledWith(
      'conversation-1',
      FIXTURE_AGENT_ID,
      null,
    );
    expect(assistantHarness.state.activeConversation?.selectedAgentId).toBe(FIXTURE_AGENT_ID);
  });

  it('sends messages through chat flow with fences and user quote preserved', async () => {
    sendChatMessageMock.mockResolvedValueOnce(true);
    const port = requireRendererAiInvocationPort();

    const result = await port.sendMessage({
      conversationId: 'conversation-1',
      prompt: '改成圆角矩形',
      promptKey: FIXTURE_PROMPT_KEY,
      enableTools: true,
      fences: [{ kind: 'fixture-selection', content: 'source' }],
      userQuote: {
        items: [{
          id: 'reference-11111111111111111111111111111111',
          pluginId: FIXTURE_PLUGIN_ID,
          kind: 'fixture-source-selection',
          text: '第 1 页元素',
          label: '第 1 页',
        }],
      },
    });

    expect(result).toBe(true);
    expect(sendChatMessageMock).toHaveBeenCalledWith({
      text: '改成圆角矩形',
      userQuote: {
        items: [{
          id: 'reference-11111111111111111111111111111111',
          pluginId: FIXTURE_PLUGIN_ID,
          kind: 'fixture-source-selection',
          text: '第 1 页元素',
          label: '第 1 页',
        }],
      },
    }, {
      conversationId: 'conversation-1',
      promptKey: FIXTURE_PROMPT_KEY,
      enableTools: true,
      fences: [{ kind: 'fixture-selection', content: 'source' }],
    });
  });

  it('reports an error when a requested agent choice is not registered or enabled', async () => {
    const port = requireRendererAiInvocationPort();

    const conversation = await port.ensureConversation({
      agentChoiceId: 'missing-agent-choice',
    });

    expect(conversation).toBeNull();
    expect(resolveCurrentConversationMessageMock).toHaveBeenCalledWith(
      'conversation.flow.pluginRun.agentChoiceUnavailable',
      { agentChoiceId: 'missing-agent-choice' },
    );
    expect(assistantHarness.store.setError).toHaveBeenCalledWith(
      'localized agent choice unavailable: missing-agent-choice',
    );
  });

  it('reports history-isolated run failures through the AI invocation error port', async () => {
    invokeAssistantMock.mockImplementationOnce(async (_params, callbacks) => {
      await callbacks.onError?.(new Error('boom'));
    });
    const port = requireRendererAiInvocationPort();

    await port.startHistoryIsolatedRun({
      prompt: '生成一个文档',
      promptKey: FIXTURE_PROMPT_KEY,
      activityFeature: 'fixture-test',
    });
    const invocationOptions = invokeAssistantMock.mock.calls[0]?.[0]?.options;
    expect(invocationOptions?.historyIsolation).toBe('isolated');
    expect(invocationOptions?.conversationHistory).toBeUndefined();
    expect(invocationOptions?.activity).toMatchObject({ feature: 'fixture-test' });
    expect(invocationOptions?.activity?.runId).toEqual(expect.any(String));

    expect(resolveCurrentConversationMessageMock).toHaveBeenCalledWith(
      'conversation.flow.streamFailed',
    );
    expect(assistantHarness.store.setError).toHaveBeenCalledWith('conversation.flow.streamFailed');
    expect(assistantHarness.store.clearAbortControllerIfCurrent).toHaveBeenCalledWith(
      expect.any(AbortController),
    );
    expect(assistantHarness.store.clearAbortController).not.toHaveBeenCalled();
  });

  it('全局取消会中止历史隔离 run，且取消不写失败态', async () => {
    let finishInvocation: (() => void) | undefined;
    invokeAssistantMock.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishInvocation = resolve;
      });
    });
    const port = requireRendererAiInvocationPort();

    const completion = port.startHistoryIsolatedRun({
      prompt: '生成一个文档',
      promptKey: FIXTURE_PROMPT_KEY,
      activityFeature: 'fixture-test',
    });
    await vi.waitFor(() => {
      expect(invokeAssistantMock).toHaveBeenCalled();
    });
    const invocationCalls = invokeAssistantMock.mock.calls;
    const signal = invocationCalls[invocationCalls.length - 1]?.[2];
    expect(signal).toBeInstanceOf(AbortSignal);

    cancelContributedAssistantRuns();
    expect(signal?.aborted).toBe(true);
    finishInvocation?.();
    await completion;

    expect(assistantHarness.store.setError).not.toHaveBeenCalled();
  });

  it('旧历史隔离 run 收尾时不清理或污染后来者执行态', async () => {
    let finishInvocation: (() => void) | undefined;
    let streamCallbacks: AssistantServiceCallbacks | undefined;
    invokeAssistantMock.mockImplementationOnce(async (_params, callbacks) => {
      streamCallbacks = callbacks;
      await new Promise<void>((resolve) => {
        finishInvocation = resolve;
      });
    });
    const port = requireRendererAiInvocationPort();
    const completion = port.startHistoryIsolatedRun({
      prompt: '生成一个文档',
      promptKey: FIXTURE_PROMPT_KEY,
      activityFeature: 'fixture-test',
    });
    await vi.waitFor(() => {
      expect(streamCallbacks).toBeDefined();
    });
    const laterController = new AbortController();
    assistantHarness.store.startExecution(laterController);

    await streamCallbacks?.onError?.(new Error('stale run failed'));
    finishInvocation?.();
    await completion;

    expect(assistantHarness.state.currentAbortController).toBe(laterController);
    expect(assistantHarness.store.setLoading).not.toHaveBeenCalled();
    expect(assistantHarness.store.setStreaming).not.toHaveBeenCalled();
    expect(assistantHarness.store.setError).not.toHaveBeenCalled();
  });
});
