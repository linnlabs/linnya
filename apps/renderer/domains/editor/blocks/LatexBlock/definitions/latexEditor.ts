import type { Editor } from '@tiptap/core';
import type { StoreDefinition } from 'pinia';

export interface LatexEditorState {
  isPanelVisible: boolean;
  targetNodeId: string | null;
  currentSource: string;
  originalSource: string;
  panelPosition: { top: number; left: number };
  referenceElement: HTMLElement | null;
  editorInstance: Editor | null;
  pendingOpenNodeId: string | null;
}

export interface LatexEditorActions {
  getEditor(): Editor | null;
  setPanelVisible(visible: boolean): void;
  resetHiddenPanel(): void;
  showPanel(
    nodeId: string,
    initialSource: string,
    reference: HTMLElement | null,
    editor?: Editor | null
  ): void;
  updateSource(source: string): void;
  updatePosition(position: LatexEditorState['panelPosition']): void;
  setReferenceElement(reference: HTMLElement | null): void;
  setEditor(editor: Editor): void;
  setPendingOpenNodeId(nodeId: string): void;
  clearPendingOpenNodeId(): void;
}

/** JS store 的现有公开合同，供生产 NodeView 与类型化集成测试共同消费。 */
export type LatexEditorStoreDefinition = StoreDefinition<
  'latexEditor',
  LatexEditorState,
  { isSourceValid: (state: LatexEditorState) => boolean },
  LatexEditorActions
>;
