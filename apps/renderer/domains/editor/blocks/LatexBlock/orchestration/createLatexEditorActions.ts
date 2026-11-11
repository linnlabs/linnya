import { NodeSelection } from 'prosemirror-state';
import { sleep } from '@linnya/foundation';
import type { useLatexEditorStore } from '../store/latexEditor';

export function createLatexEditorActions(store: ReturnType<typeof useLatexEditorStore>) {
  async function hidePanel(): Promise<void> {
    store.setPanelVisible(false);
    await sleep(10);
    store.resetHiddenPanel();
    store.updateSource('');
  }
  async function cancelEdit(): Promise<void> {
    store.updateSource(store.originalSource);
    store.setPanelVisible(false);
    await sleep(10);
    store.resetHiddenPanel();
  }
  async function submitCurrentLatex(): Promise<boolean> {
    const editor = store.getEditor();
    const source = store.currentSource;
    const nodeId = store.targetNodeId;

    if (!editor) {
      console.error('[LatexStore] Submission aborted: Editor instance not available.');
      return false;
    }
    if (!store.isSourceValid) {
      console.warn('[LatexStore] Submission aborted: Invalid LaTeX source.');
      return false;
    }

    const { state } = editor;
    const { tr, selection } = state;

    if (
      !(selection instanceof NodeSelection) ||
      (selection.node.type.name !== 'inlineLatex' && selection.node.type.name !== 'latexBlock') ||
      selection.node.attrs.id !== nodeId
    ) {
      console.warn(
        `[LatexStore] Submission check failed: Selection is not the target NodeSelection`
      );
      return false;
    }

    try {
      const pos = selection.from;
      const nodeSize = selection.node.nodeSize;

      const newNodeAttrs = { ...selection.node.attrs, latexSource: source };
      tr.setNodeMarkup(pos, undefined, newNodeAttrs);

      const endPos = pos + nodeSize;
      const mappedEndPos = tr.mapping.map(endPos);

      // --- 修改开始：使用 Selection.near 查找合适的光标位置 ---
      const { Selection } = await import('prosemirror-state'); // 动态导入 Selection
      const $pos = tr.doc.resolve(mappedEndPos);
      const newSelection = Selection.near($pos); // 使用 Selection.near
      tr.setSelection(newSelection);
      // --- 修改结束 ---

      tr.scrollIntoView();

      editor.view.dispatch(tr);

      return true;
    } catch (error) {
      console.error('[LatexStore] Error building or dispatching transaction:', error);
      return false;
    }
  }
  return { hidePanel, cancelEdit, submitCurrentLatex };
}
