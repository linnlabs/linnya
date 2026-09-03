import type { Editor } from '@tiptap/core';
import {
  TABLE_SELECTION_DECORATOR_KEY,
  setColumnRefs,
} from '../../../blocks/TableBlock/extensions/TableSelectionDecoratorExtension';
import { refreshTableInfoSnapshot } from '../../../blocks/TableBlock/position/tableIdentity';
import type {
  TableAiColumnReferenceHighlightRequest,
  TableAiModeActiveColumnReference,
  TableAiModeTableIdentity,
} from '../definitions/tableAiMode';
import { useTableAiModeStore } from '../store/tableAiModeStore';

function copyActiveColumnRefs(
  refs: Readonly<Record<string, TableAiModeActiveColumnReference>>,
): Record<string, TableAiModeActiveColumnReference> {
  return Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, {
    ...ref,
    rect: { ...ref.rect },
  }]));
}

export class TableAiHighlightRuntime {
  private readonly editorInstances = new Map<string, Editor>();

  registerEditor(editorId: string, editor: Editor): void {
    this.editorInstances.set(editorId, editor);
  }

  unregisterEditor(editorId: string): void {
    this.editorInstances.delete(editorId);
  }

  clearTableHighlights(table: TableAiModeTableIdentity): void {
    this.updateTableHighlights(table, {});

    const editor = this.editorInstances.get(table.editorId);
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(TABLE_SELECTION_DECORATOR_KEY, {
      clearSelection: true,
      keepSelectionVisible: false,
      suppressOutputCalc: true,
    }));
  }

  applyColumnReferenceHighlights(request: TableAiColumnReferenceHighlightRequest): void {
    const store = useTableAiModeStore();
    const session = store.session;
    if (!store.isActive || !session || session.sessionId !== request.sessionId) return;
    this.updateTableHighlights(session.table, request.activeColumnRefs);
  }

  private updateTableHighlights(
    table: TableAiModeTableIdentity,
    activeColumnRefs: Readonly<Record<string, TableAiModeActiveColumnReference>>,
  ): void {
    const editor = this.editorInstances.get(table.editorId);
    if (!editor || editor.isDestroyed) return;

    const latestTableInfo = refreshTableInfoSnapshot(editor.state.doc, {
      pos: table.lastKnownPos,
      rootBlockId: table.rootBlockId,
    });
    if (!latestTableInfo) return;

    const transaction = setColumnRefs(
      editor.state.tr,
      copyActiveColumnRefs(activeColumnRefs),
      latestTableInfo,
    );
    editor.view.dispatch(transaction);
  }
}

export const tableAiHighlightRuntime = new TableAiHighlightRuntime();
