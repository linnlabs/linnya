import { generateMessageId } from '@shared/utils/idUtils';
import { getCurrentScope, onScopeDispose } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { readEffectiveModelPurposeBinding } from '@/domains/model-configuration';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { registerContributedAssistantRunCancellation } from '@/domains/conversation/ports/contributedAssistantRunCancellationPort';
import { createConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import { prepareTableFillRunCommand } from './prepareTableFillRunCommand';
import { ensureHistoryWindowTailForBottom } from '@/domains/conversation/history';
import { invokeAssistant } from '@/domains/conversation/services/assistantService';
import { requestSaveBeforeAssistantInvoke } from '@/domains/conversation/services/orchestration/helpers/requestSaveBeforeAssistantInvoke';
import { resolveCurrentTableFillMessage } from '../functions/resolveCurrentTableFillMessage';
import {
  deactivateTableAiMode,
  useTableAiModeStore,
} from '@/domains/editor/features/table-ai-mode';
import {
  buildTableFillRowPlans,
  tableFillWritePort,
  tableFillWriteSessions,
  type TableFillInputReference,
} from '@/domains/editor/features/table-fill-write';
import { buildTableFillBatchPlan } from '../functions/buildTableFillBatchPlan';
import { executeTableFillRun } from './executeTableFillRun';
import type { TableFillWorkflow } from '../definitions/tableFillWorkflow';
import { orchestrateCommittedConversationTitle } from '@/domains/conversation/services/orchestration/orchestrateCommittedConversationTitle';

interface ActiveColumnRef {
  readonly rect: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

function mapActiveInputRefs(
  refs: Readonly<Record<string, ActiveColumnRef>>,
): TableFillInputReference[] {
  return Object.entries(refs).map(([key, value]) => ({
    refKey: key,
    label: key,
    rect: { ...value.rect },
  }));
}

export function useTableFillWorkflow(): TableFillWorkflow {
  const uiStore = useUIStore();
  const assistantStore = useAssistantStore();
  const tableAiModeStore = useTableAiModeStore();
  const workspaceScopeStore = useWorkspaceScopeStore();

  const cancel = (): void => {
    const controller = tableAiModeStore.session?.execution.controller;
    if (!controller) return;
    controller.abort();
    tableAiModeStore.clearExecution();
  };

  const workflow: TableFillWorkflow = {
    async submit(prompt: string): Promise<void> {
      const session = tableAiModeStore.session;
      if (!tableAiModeStore.isActive || !session) {
        throw new Error('[TableFillWorkflow] table mode is not active');
      }
      const editor = uiStore.getEditor();
      const outputRect = session.context.outputRect;
      if (!editor || !outputRect || !session.table.rootBlockId) {
        throw new Error('[TableFillWorkflow] table context is incomplete');
      }

      await executeTableFillRun(
        {
          prompt,
          editor,
          table: {
            initialPos: session.table.lastKnownPos,
            rootBlockId: session.table.rootBlockId,
          },
          outputRect,
          activeInputRefs: mapActiveInputRefs(session.context.activeColumnRefs),
          imageGenerationModelId: readEffectiveModelPurposeBinding('image_generation') ?? undefined,
        },
        {
          executionState: {
            begin: (controller) => {
              tableAiModeStore.beginExecution(controller);
            },
            settle: (params) => {
              tableAiModeStore.settleExecution(params);
            },
          },
          readActiveConversationId: () => assistantStore.activeConversation?.id ?? null,
          ensureHistoryTail: ensureHistoryWindowTailForBottom,
          prepareRunCommand: ({ signal }) => prepareTableFillRunCommand({
            signal,
            assistantStore,
            workspaceScopeStore,
          }),
          createUserInputAdmission: ({ run }) => (
            createConversationUserInputAdmission({
              expectation: {
                conversationId: run.conversationId,
                messageId: run.messageId,
                operation: 'append',
              },
              commitUserInput: assistantStore.commitUserInput,
              onCommitted: (_message, event) => {
                orchestrateCommittedConversationTitle({
                  event,
                  wasNewConversation: run.wasNewConversation,
                  scope: workspaceScopeStore.currentScope,
                  onHistorySynced: () => assistantStore.setSelectedConversation(run.conversationId),
                });
              },
            })
          ),
          buildRowPlans: buildTableFillRowPlans,
          buildBatchPlan: (rows) => buildTableFillBatchPlan(rows, {
            createUnitId: () => `table-fill-unit-${generateMessageId()}`,
            createSubrunId: () => `table-fill-subrun-${generateMessageId()}`,
            describeRow: (row) => resolveCurrentTableFillMessage(
              'tableFill.card.step',
              { index: row.rowIndex + 1 },
            ),
          }),
          createSessionId: () => `table-fill-session-${generateMessageId()}`,
          writePort: tableFillWritePort,
          writeSessions: tableFillWriteSessions,
          requestSave: requestSaveBeforeAssistantInvoke,
          invokeAssistant: (params, callbacks, signal) => invokeAssistant(
            {
              ...params,
              eventDispatcher: assistantStore.handleSseEvent,
            },
            callbacks,
            signal,
          ),
          resolveProcessingFailureMessage: () => resolveCurrentTableFillMessage(
            'tableFill.flow.processingFailed',
          ),
        },
      );
    },
    cancel,
    async deactivate(): Promise<void> {
      const session = tableAiModeStore.session;
      cancel();
      await deactivateTableAiMode({
        editor: uiStore.getEditor(),
        shouldUndoColumnAddition: session?.context.outputColumnAdded === true,
      });
    },
  };

  const unregisterCancellation = registerContributedAssistantRunCancellation(cancel);
  if (getCurrentScope()) onScopeDispose(unregisterCancellation);

  return workflow;
}
