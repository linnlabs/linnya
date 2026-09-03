/**
 * @file installBuiltinRendererPluginPorts.ts
 * @description 安装内置渲染端插件 port 的 host 实现。
 *
 * 中文说明：
 * - 这里属于 app-level orchestration：可以协调 conversation、workspace 与插件 SDK；
 * - 插件包不能直接 import conversation store / assistantService，所以由这里承接真实调用；
 * - port 实现保持窄小，避免把 conversation 细节暴露成插件公共 API。
 */

import {
  registerRendererAiInvocationPort,
  type RendererEnsureAiConversationRequest,
  type RendererSendAiMessageRequest,
  type RendererAiHistoryIsolatedRunRequest,
} from '@plugin/renderer/aiInvocationPort';
import { registerRendererComposerCommandPort } from '@plugin/renderer/composerCommandPort';
import { registerRendererConversationSubrunInvocationPort } from '@plugin/renderer/conversationSubrunInvocationPort';
import { registerRendererInteractiveToolPort } from '@plugin/renderer/interactiveTool';
import { registerRendererReferenceRuntimePort } from '@plugin/renderer/referenceRuntime';
import { registerWorkspaceRuntimePort } from '@plugin/renderer/workspaceRuntime';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useFileStore } from '@/shared/stores/file';
import { useNotificationStore } from '@/app/notification';
import { confirm } from '@/shared/composables/confirmDialog';
import { projectKbLinksGateway } from '@/shared/ipc/projectKbLinksGateway';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { validateWebManualForm } from '@/domains/editor/features/citation/adapters/webCitationAdapter';
import { useWebManualCitationForm } from '@/domains/editor/features/citation/ui/useWebManualCitationForm';
import {
  getActiveFileSession,
  markActiveFileDirty,
} from '@/domains/workspace/services/file-manager';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { applyConversationAgentChoice } from '@/domains/conversation/features/agent-choice';
import { useChatFlowOrchestrator } from '@/domains/conversation/services/orchestration/chatFlowOrchestrator';
import { listConversationAgentChoices } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { invokeAssistant } from '@/domains/conversation/services/assistantService';
import { ensureHistoryWindowTailForBottom } from '@/domains/conversation/history';
import { resolveCurrentConversationMessage } from '@/domains/conversation/functions/resolveCurrentConversationMessage';
import { generateMessageId } from '@shared/utils/idUtils';
import { useComposerReferences } from '@/domains/conversation/features/composer-references';
import { registerContributedAssistantRunCancellation } from '@/domains/conversation/ports/contributedAssistantRunCancellationPort';
import { registerToolPresentationProjectionPort } from '@/domains/conversation/ports/toolPresentationProjectionPort';
import { registerToolCompactStepProjectionPort } from '@/domains/conversation/ports/toolCompactStepProjectionPort';
import { createConversationSubrunInvocationPort } from '@/app/workflows/conversation-subruns';
import { createToolCompactStepProjectionPort } from '../orchestration/createToolCompactStepProjectionPort';
import { createToolPresentationProjectionPort } from '../orchestration/createToolPresentationProjectionPort';
import { ensureMaterializedConversation } from '@/domains/conversation/services/orchestration/ensureMaterializedConversation';
import { createConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import { registerKnowledgeSearchHistoryPort } from '@/domains/conversation/ports/knowledgeSearchHistoryPort';
import { orchestrateCommittedConversationTitle } from '@/domains/conversation/services/orchestration/orchestrateCommittedConversationTitle';

function reportMissingProject(request: RendererAiHistoryIsolatedRunRequest): void {
  reportError(
    request.missingProjectMessage
      ?? resolveCurrentConversationMessage('conversation.flow.pluginRun.missingProject'),
  );
}

async function ensureConversation(request: RendererEnsureAiConversationRequest) {
  const assistantStore = useAssistantStore();
  const workspaceScopeStore = useWorkspaceScopeStore();
  const enabledPluginsStore = useEnabledPluginsStore();
  const agentChoices = listConversationAgentChoices(enabledPluginsStore.enabledPluginIds);
  const agentChoice = request.agentChoiceId
    ? agentChoices.find((choice) => choice.id === request.agentChoiceId) ?? null
    : null;

  if (request.agentChoiceId && !agentChoice) {
    reportError(resolveCurrentConversationMessage('conversation.flow.pluginRun.agentChoiceUnavailable', {
      agentChoiceId: request.agentChoiceId,
    }));
    return null;
  }

  const conversation = await applyConversationAgentChoice({
    assistantStore,
    scopeStore: workspaceScopeStore,
    agentChoiceId: agentChoice?.id ?? null,
    choices: agentChoices,
  });

  if (!conversation?.conversationId) {
    return null;
  }

  return { conversationId: conversation.conversationId };
}

async function sendMessage(request: RendererSendAiMessageRequest): Promise<boolean> {
  const chatFlowOrchestrator = useChatFlowOrchestrator();
  return await chatFlowOrchestrator.sendChatMessage({
    text: request.prompt,
    ...(request.userQuote ? { userQuote: request.userQuote } : {}),
  }, {
    conversationId: request.conversationId,
    promptKey: request.promptKey,
    enableTools: request.enableTools,
    fences: request.fences ? [...request.fences] : undefined,
  });
}

function reportError(message: string): void {
  const assistantStore = useAssistantStore();
  assistantStore.setError(message);
}

async function startHistoryIsolatedRun(request: RendererAiHistoryIsolatedRunRequest): Promise<void> {
  const workspaceScopeStore = useWorkspaceScopeStore();
  const assistantStore = useAssistantStore();

  ensureMaterializedConversation(assistantStore, workspaceScopeStore);

  const conversation = assistantStore.activeConversation;
  if (!conversation) {
    reportError(resolveCurrentConversationMessage('conversation.flow.pluginRun.noConversation'));
    return;
  }

  const projectId = workspaceScopeStore.currentProjectId;
  if (!projectId) {
    reportMissingProject(request);
    return;
  }

  const wasNewConversation = !assistantStore.hasRenderableMessages;
  const runId = generateMessageId();
  const messageId = generateMessageId();
  const activity = { runId, feature: request.activityFeature };
  const userInputAdmission = createConversationUserInputAdmission({
    expectation: { conversationId: conversation.id, messageId, operation: 'append' },
    commitUserInput: assistantStore.commitUserInput,
    onCommitted: (_message, event) => {
      orchestrateCommittedConversationTitle({
        event,
        wasNewConversation,
        scope: workspaceScopeStore.currentScope,
        onHistorySynced: () => assistantStore.setSelectedConversation(conversation.id),
      });
    },
  });

  const controller = new AbortController();
  assistantStore.startExecution(controller);
  const unregisterCancellation = registerContributedAssistantRunCancellation(
    () => controller.abort(),
  );
  let settled = false;
  const settle = (errorMessage?: string): void => {
    if (settled) return;
    settled = true;
    unregisterCancellation();

    // 旧 run 失去 controller 所有权后，不得清理或改写后来者的执行态。
    if (!assistantStore.clearAbortControllerIfCurrent(controller)) return;
    assistantStore.setLoading(false);
    assistantStore.setStreaming(false);
    if (errorMessage) assistantStore.setError(errorMessage);
  };

  try {
    await ensureHistoryWindowTailForBottom(conversation.id);
    await invokeAssistant(
      {
        userMessage: { text: request.prompt },
        userInputExtension: request.messageExtension,
        projectId,
        options: {
          conversationId: conversation.id,
          messageId,
          promptKey: request.promptKey,
          enableTools: true,
          context: {
            contextBefore: request.contextBefore ?? '',
          },
          historyIsolation: 'isolated',
          projectMetadata: { id: projectId },
          ...(request.documentMetadata
            ? { documentMetadata: request.documentMetadata }
            : {}),
          ...(request.documentFragment
            ? { documentFragment: request.documentFragment }
            : {}),
          activity,
        },
        eventDispatcher: assistantStore.handleSseEvent,
      },
      {
        onUserInputCommitted: (event) => {
          userInputAdmission.accept(event);
        },
        onStreamStart: () => {},
        onTransportEnd: () => {
          if (!userInputAdmission.committedMessage) {
            throw new Error('History-isolated run completed without a durable user input commit');
          }
          settle();
        },
        onError: (error) => {
          if (error.name === 'AbortError') {
            settle();
            return;
          }
          console.error('[installBuiltinRendererPluginPorts] History-isolated run stream failed:', error);
          settle(resolveCurrentConversationMessage('conversation.flow.streamFailed'));
        },
      },
      controller.signal
    );
    if (!settled && !controller.signal.aborted && !userInputAdmission.committedMessage) {
      throw new Error('History-isolated run completed without a durable user input commit');
    }
  } catch (err) {
    if (!(err instanceof Error && err.name === 'AbortError')) {
      console.error('[installBuiltinRendererPluginPorts] History-isolated run failed:', err);
      settle(resolveCurrentConversationMessage('conversation.flow.pluginRun.executionFailed'));
    }
  } finally {
    settle();
  }
}

function installWorkspaceRuntimePort(): void {
  registerWorkspaceRuntimePort({
    getCurrentProjectId: () => useWorkspaceScopeStore().currentProjectId,
    getActiveFileSession,
    markActiveFileDirty,
    isActiveFileDirty: () => useFileStore().isDirty,
    setActiveFileDirty: (dirty) => useFileStore().setDirty(dirty),
    setActiveFileLoading: (loading) => useFileStore().setLoading(loading),
    setActiveFileSaving: (saving) => useFileStore().setSaving(saving),
    showNotification: (message, type, duration) => useNotificationStore().show(message, type, duration),
    confirm,
    notifyDocumentOpened: (args) => workspaceGateway['notify-document-opened'](args),
    readDocument: (args) => workspaceGateway['read-document'](args),
    saveDocument: (args) => workspaceGateway['save-document'](args),
    createDocument: (args) => workspaceGateway['create-document'](args),
    listKnowledgeBaseIdsForProject: (args) => projectKbLinksGateway.listKnowledgeBaseIdsForProject(args),
  });
}

function installReferenceRuntimePort(): void {
  registerRendererReferenceRuntimePort({
    async searchInMultipleKbs(request) {
      const { searchInMultipleKbs } = await import(
        '@/domains/editor/features/citation/services/citationKbSearchService'
      );
      return searchInMultipleKbs(request);
    },
    useWebManualCitationForm,
    validateWebManualForm,
    async listKnowledgeBasesForPlugin() {
      const { knowledgeBaseService } = await import(
        '@/domains/knowledgebase/services/knowledgeBaseService'
      );
      const response = await knowledgeBaseService.getAllKnowledgeBases();
      return (response.knowledge_bases ?? []).map((kb) => ({
        id: kb.id,
        name: kb.name,
      }));
    },
  });
}

function installInteractiveToolPort(): void {
  registerRendererInteractiveToolPort({
    concludeInteractiveToolInteraction(options) {
      return useAssistantStore().concludeInteractiveToolInteraction(options);
    },
  });
}

function installComposerCommandPort(): void {
  registerRendererComposerCommandPort({
    addReference(input) {
      return useComposerReferences().addReference(input);
    },
    removeReference(referenceId) {
      useComposerReferences().removeReference(referenceId);
    },
  });
}

export function installBuiltinRendererPluginPorts(): void {
  registerToolPresentationProjectionPort(createToolPresentationProjectionPort());
  registerToolCompactStepProjectionPort(createToolCompactStepProjectionPort());
  registerKnowledgeSearchHistoryPort({
    async readCitationSnapshot(request) {
      const { knowledgeBaseService } = await import(
        '@/domains/knowledgebase/services/knowledgeBaseService'
      );
      const record: unknown = await knowledgeBaseService.getCitationSnapshotBundle(
        request.bundleId,
        request.conversationId,
      );
      return record;
    },
  });
  installWorkspaceRuntimePort();
  installReferenceRuntimePort();
  installInteractiveToolPort();
  installComposerCommandPort();
  registerRendererConversationSubrunInvocationPort(createConversationSubrunInvocationPort());
  registerRendererAiInvocationPort({
    id: 'linnya.conversation-ai',
    startHistoryIsolatedRun,
    ensureConversation,
    sendMessage,
    reportError,
  });
}
