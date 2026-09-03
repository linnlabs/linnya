import { computed, shallowRef } from 'vue';
import type {
  ConversationInputExtensionExecutionStatus,
  HostConversationInputExtension,
} from '@/domains/conversation/features/input-extensions';
import {
  TableAiColumnReferenceExtension,
  updateTableAiColumnReferencesFromText,
  useTableAiComposerState,
  validateAndActivateTableAiColumnReference,
} from '@/domains/editor/features/table-ai-mode';
import type { TableFillWorkflow } from '../definitions/tableFillWorkflow';
import TableFillConversationInputContext from '../ui/TableFillConversationInputContext';

export const TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID = 'table-fill';
export const TABLE_FILL_COLUMN_REFERENCE_EDITOR_EXTENSION_ID = 'table-fill-column-reference';

/**
 * 在 app 层把 conversation 宿主契约、editor table 能力与 table-fill workflow 组装起来。
 * 三个边界都只通过公开契约相交，不把 table payload 下沉到 conversation。
 */
export function createTableFillConversationInputExtension(
  workflow: TableFillWorkflow,
): HostConversationInputExtension {
  const composerState = useTableAiComposerState();
  const executionStatus = computed<ConversationInputExtensionExecutionStatus>(() => (
    composerState.isLoading.value || composerState.isStreaming.value ? 'running' : 'idle'
  ));

  return {
    id: TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID,
    isActive: composerState.isActive,
    acceptsReferences: false,
    acceptsAttachments: false,
    contextBar: {
      component: TableFillConversationInputContext,
      payload: shallowRef<unknown>(null),
    },
    editorExtensions: [
      {
        id: TABLE_FILL_COLUMN_REFERENCE_EDITOR_EXTENSION_ID,
        create: () => TableAiColumnReferenceExtension.configure({
          validateRef: validateAndActivateTableAiColumnReference,
        }),
      },
    ],
    onTextChange: updateTableAiColumnReferencesFromText,
    onSubmit: ({ text }) => workflow.submit(text),
    onDeactivate: workflow.deactivate,
    executionState: {
      status: executionStatus,
      cancel: workflow.cancel,
    },
  };
}
