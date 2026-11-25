import { TableView } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { observeWorkspaceTableFit, WORKSPACE_TABLE_CLASS } from '@linnya/markdown-document-core/workspace-table';

/**
 * 编辑器表格视图：在 Tiptap TableView 上接入共用表格呈现。
 * 可编辑时 NodeView 由列宽插件创建、不会带上配置的 HTMLAttributes，因此在这里补上共用 class；
 * 按正文栏宽度给表格定级（normal / tight / scroll），横向滚动发生在根块内容区。
 * 定级只写 table 元素的 data 属性，它在 contentDOM（tbody）之外，TableView 会忽略这类 mutation，不触发重新解析。
 */
export class WorkspaceTableView extends TableView {
  private readonly releaseFit: () => void;

  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView, HTMLAttributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.table.classList.add(WORKSPACE_TABLE_CLASS);
    this.releaseFit = observeWorkspaceTableFit(this.table, this.dom, () => this.dom.parentElement);
  }

  destroy(): void {
    this.releaseFit();
  }
}
