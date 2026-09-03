import { PromptKeys, type ConversationMessageExtension } from '@app/schemas';
import type { SSETransportEndEvent } from '@linnlabs/linnkit/contracts';
import type {
  RendererConversationSubrunInvocationPort,
  StartConversationSubrunsRequest,
} from '@plugin/renderer/conversationSubrunInvocationPort';
import { generateMessageId } from '@shared/utils/idUtils';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { ensureHistoryWindowTailForBottom } from '@/domains/conversation/history';
import { invokeAssistant } from '@/domains/conversation/services/assistantService';
import { requestSaveBeforeAssistantInvoke } from '@/domains/conversation/services/orchestration/helpers/requestSaveBeforeAssistantInvoke';
import { resolveCurrentConversationMessage } from '@/domains/conversation/functions/resolveCurrentConversationMessage';
import { registerContributedAssistantRunCancellation } from '@/domains/conversation/ports/contributedAssistantRunCancellationPort';
import { prepareConversationSubrunRunCommand } from '@/domains/conversation/features/subrun-invocation';
import { createConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import type { ConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import { requireActiveConversationSubrunWorker } from '@/app/plugins/registry';
import { buildConversationSubrunBatchArgs } from '../functions/buildConversationSubrunBatchArgs';
import { orchestrateCommittedConversationTitle } from '@/domains/conversation/services/orchestration/orchestrateCommittedConversationTitle';

function createAbortError(): Error {
  const error = new Error('Conversation subrun invocation was cancelled');
  error.name = 'AbortError';
  return error;
}

function requireIdentity(value: string, field: string): void {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[conversationSubrunInvocation] ${field} 不能为空`);
  }
  if (normalized !== value) {
    throw new Error(`[conversationSubrunInvocation] ${field} 不能包含首尾空白`);
  }
}

function requireContent(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[conversationSubrunInvocation] ${field} 不能为空`);
  }
}

async function executeConversationSubruns(options: {
  readonly request: StartConversationSubrunsRequest;
  readonly run: {
    readonly conversationId: string;
    readonly runId: string;
    readonly messageId: string;
    readonly projectId: string;
    readonly projectMetadata: { readonly id: string };
    readonly userInputExtension?: ConversationMessageExtension;
  };
  readonly batchArgs: ReturnType<typeof buildConversationSubrunBatchArgs>;
  readonly controller: AbortController;
  readonly eventDispatcher: ReturnType<typeof useAssistantStore>['handleSseEvent'];
  readonly userInputAdmission: ConversationUserInputAdmission;
}): Promise<void> {
  let failure: Error | null = null;
  let streamEnd: SSETransportEndEvent | undefined;

  await ensureHistoryWindowTailForBottom(options.run.conversationId);
  await requestSaveBeforeAssistantInvoke();
  await invokeAssistant(
    {
      userMessage: { text: options.request.prompt },
      userInputExtension: options.run.userInputExtension,
      projectId: options.run.projectId,
      options: {
        promptKey: PromptKeys.SYSTEM_BATCH_SUMMARIZER,
        conversationId: options.run.conversationId,
        messageId: options.run.messageId,
        projectMetadata: options.run.projectMetadata,
        activity: {
          runId: options.run.runId,
          feature: options.request.activityFeature,
        },
        hostToolCall: {
          tool_name: 'subrun_batch',
          args: options.batchArgs,
        },
      },
      eventDispatcher: options.eventDispatcher,
    },
    {
      onUserInputCommitted: (event) => {
        options.userInputAdmission.accept(event);
      },
      onError: (error) => {
        if (error.name !== 'AbortError' && !failure) failure = error;
      },
      onTransportEnd: (event) => {
        streamEnd = event;
      },
    },
    options.controller.signal,
  );

  if (options.controller.signal.aborted) throw createAbortError();
  if (failure) throw failure;
  if (!options.userInputAdmission.committedMessage) {
    throw new Error('Subrun invocation completed without a durable user input commit');
  }
  if (streamEnd?.reason && streamEnd.reason !== 'complete') {
    throw new Error(streamEnd.reason_message || `Subrun invocation ended with ${streamEnd.reason}`);
  }
}

export function createConversationSubrunInvocationPort(): RendererConversationSubrunInvocationPort {
  return {
    start(request) {
      const assistantStore = useAssistantStore();
      if (assistantStore.isLoading || assistantStore.isStreaming) {
        throw new Error('[conversationSubrunInvocation] 当前已有 conversation run 正在执行');
      }

      requireIdentity(request.pluginId, 'pluginId');
      requireIdentity(request.workerId, 'workerId');
      requireContent(request.prompt, 'prompt');
      requireIdentity(request.activityFeature, 'activityFeature');
      const worker = requireActiveConversationSubrunWorker(request.pluginId, request.workerId);
      const batchArgs = buildConversationSubrunBatchArgs({
        request,
        workerPromptKey: worker.promptKey,
        createId: generateMessageId,
      });
      const runId = generateMessageId();
      const controller = new AbortController();
      const workspaceScopeStore = useWorkspaceScopeStore();

      const prepared = prepareConversationSubrunRunCommand({
        runId,
        userInputExtension: request.messageExtension,
        assistantStore,
        workspaceScopeStore,
        signal: controller.signal,
        resolveMissingConversationMessage: () => resolveCurrentConversationMessage(
          'conversation.flow.subrun.noConversation',
        ),
        resolveMissingProjectMessage: () => resolveCurrentConversationMessage(
          'conversation.flow.subrun.missingProject',
        ),
      });
      if (!prepared.ok) {
        if (prepared.reason === 'cancelled') throw createAbortError();
        throw new Error(prepared.message);
      }

      const admission = createConversationUserInputAdmission({
        expectation: {
          conversationId: prepared.run.conversationId,
          messageId: prepared.run.messageId,
          operation: 'append',
        },
        commitUserInput: assistantStore.commitUserInput,
        onCommitted: (_message, event) => {
          orchestrateCommittedConversationTitle({
            event,
            wasNewConversation: prepared.run.wasNewConversation,
            scope: workspaceScopeStore.currentScope,
            onHistorySynced: () => assistantStore.setSelectedConversation(
              prepared.run.conversationId,
            ),
          });
        },
      });

      assistantStore.startExecution(controller);
      const unregisterCancellation = registerContributedAssistantRunCancellation(
        () => controller.abort(),
      );
      // 收尾时记录本 run 是否仍是当前 controller 的拥有者：若已被后来者接管，
      // 则既不清 loading/streaming，也不写 error，避免旧 run 的失败污染后来者执行态。
      let ownedControllerAtSettle = false;
      const completion = executeConversationSubruns({
        request,
        run: prepared.run,
        batchArgs,
        controller,
        eventDispatcher: assistantStore.handleSseEvent,
        userInputAdmission: admission,
      }).finally(() => {
        unregisterCancellation();
        ownedControllerAtSettle = assistantStore.clearAbortControllerIfCurrent(controller);
        if (ownedControllerAtSettle) {
          assistantStore.setLoading(false);
          assistantStore.setStreaming(false);
        }
      });

      void completion.catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        if (!ownedControllerAtSettle) return;
        assistantStore.setError(resolveCurrentConversationMessage(
          'conversation.flow.subrun.executionFailed',
        ));
      });

      return {
        runId,
        completion,
        cancel: () => controller.abort(),
      };
    },
  };
}
