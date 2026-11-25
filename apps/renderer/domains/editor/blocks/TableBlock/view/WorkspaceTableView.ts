import { TableView } from '@tiptap/extension-table';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { applyWorkspaceTableStyle, observeWorkspaceTableFit, WORKSPACE_TABLE_CLASS } from '@linnya/markdown-document-core/workspace-table';

/**
 * 编辑器表格视图：在 Tiptap TableView 上接入共用表格呈现。
 * 可编辑时 NodeView 由列宽插件创建、不会带上配置的 HTMLAttributes，因此在这里补上共用 class；
 * 按正文栏宽度给表格定级（normal / tight / scroll），横向滚动发生在根块内容区。
 * 定级与表格样式只写 table 元素的 data 属性，它在 contentDOM（tbody）之外，TableView 会忽略这类 mutation，不触发重新解析。
 */
export class WorkspaceTableView extends TableView {
  private readonly releaseFit: () => void;

  constructor(node: ProseMirrorNode, cellMinWidth: number, view?: EditorView, HTMLAttributes?: Record<string, unknown>) {
    super(node, cellMinWidth, view, HTMLAttributes);
    this.table.classList.add(WORKSPACE_TABLE_CLASS);
    applyWorkspaceTableStyle(this.table, node.attrs.tableStyle);
    this.releaseFit = observeWorkspaceTableFit(this.table, this.dom, () => this.dom.parentElement);
  }

  update(node: ProseMirrorNode): boolean {
    const updated = super.update(node);
    if (updated) {
      clearStaleColumnWidths(this.colgroup, node);
      applyWorkspaceTableStyle(this.table, node.attrs.tableStyle);
    }
    return updated;
  }

  destroy(): void {
    this.releaseFit();
  }
}

/**
 * Tiptap 的 updateColumns 在列失去存储宽度时只补 min-width，不清掉旧的 width，
 * “按内容适配列宽”后列仍保持原宽度直到重新挂载。这里按第一行的 colwidth 清掉不再成立的 width。
 */
export function clearStaleColumnWidths(colgroup: HTMLTableColElement, node: ProseMirrorNode): void {
  const row = node.firstChild;
  if (!row) return;
  const widths: (number | null)[] = [];
  row.forEach(cell => {
    const colspan = typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
    const colwidth: unknown = cell.attrs.colwidth;
    for (let index = 0; index < colspan; index++) {
      const width: unknown = Array.isArray(colwidth) ? colwidth[index] : null;
      widths.push(typeof width === 'number' && width > 0 ? width : null);
    }
  });
  Array.from(colgroup.children).forEach((column, index) => {
    if (column instanceof HTMLElement && widths[index] === null && column.style.width) {
      column.style.removeProperty('width');
    }
  });
}
