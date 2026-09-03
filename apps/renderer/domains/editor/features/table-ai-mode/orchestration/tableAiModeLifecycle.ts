import type { Editor } from '@tiptap/core';
import { generateMessageId } from '@shared/utils/idUtils';
import { deleteColumnByIndex } from '../../../blocks/TableBlock/commands/tableDeleteCommands.js';
import { refreshTableInfoSnapshot } from '../../../blocks/TableBlock/position/tableIdentity';
import type { StartTableAiModeSessionInput } from '../definitions/tableAiMode';
import { runAndWaitForTableDocumentChange } from '../functions/waitForTableDocumentChange';
import { useTableAiModeStore } from '../store/tableAiModeStore';
import { tableAiHighlightRuntime } from './tableAiHighlightRuntime';

export interface ActivateTableAiModeInput extends Omit<StartTableAiModeSessionInput, 'sessionId'> {
  readonly sessionId?: string;
}

export interface DeactivateTableAiModeInput {
  readonly editor: Editor | null;
  readonly shouldUndoColumnAddition: boolean;
}

export interface DeactivateTableAiModeDependencies {
  readonly clearHighlights: typeof tableAiHighlightRuntime.clearTableHighlights;
  readonly deleteColumnAndWait: (
    editor: Editor,
    tablePos: number,
    columnIndex: number,
  ) => Promise<boolean>;
  readonly scheduleAfterRender: () => Promise<void>;
}

const defaultDeactivateDependencies: DeactivateTableAiModeDependencies = {
  clearHighlights: (table) => tableAiHighlightRuntime.clearTableHighlights(table),
  deleteColumnAndWait: (editor, tablePos, columnIndex) => runAndWaitForTableDocumentChange(
    editor,
    () => deleteColumnByIndex(editor, tablePos, columnIndex),
    200,
  ),
  scheduleAfterRender: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
};

export function activateTableAiMode(input: ActivateTableAiModeInput): string {
  const sessionId = input.sessionId ?? `table-ai-mode-${generateMessageId()}`;
  useTableAiModeStore().startSession({ ...input, sessionId });
  return sessionId;
}

export async function deactivateTableAiMode(
  input: DeactivateTableAiModeInput,
  dependencies: DeactivateTableAiModeDependencies = defaultDeactivateDependencies,
): Promise<boolean> {
  const store = useTableAiModeStore();
  const activeSession = store.session;
  if (!activeSession || !store.beginClosing(activeSession.sessionId)) return false;

  const { context, table, sessionId, execution } = activeSession;
  dependencies.clearHighlights(table);
  const shouldUndo = input.shouldUndoColumnAddition
    && context.outputColumnAdded
    && !execution.completedSuccessfully
    && typeof context.insertedColumnIndex === 'number';

  if (shouldUndo && input.editor) {
    const currentTable = refreshTableInfoSnapshot(input.editor.state.doc, {
      pos: table.lastKnownPos,
      rootBlockId: table.rootBlockId,
    });
    if (currentTable) {
      const deleted = await dependencies.deleteColumnAndWait(
        input.editor,
        currentTable.pos,
        context.insertedColumnIndex,
      );
      if (deleted) {
        await dependencies.scheduleAfterRender();
      }
    }
  }

  return store.completeClosing(sessionId);
}
