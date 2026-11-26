import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { columnResizingPluginKey, TableMap } from '@tiptap/pm/tables';
import { clearTableColumnWidth } from '../structure/tableStructureCommands';

export const tableColumnFitPluginKey = new PluginKey('tableColumnFit');

/** 由单元格位置（其右边界即被拖动的分隔线）找到对应的逻辑列。 */
export function resolveBorderColumn(view: EditorView, cellPos: number): { tablePos: number; column: number } | null {
  const $cell = view.state.doc.resolve(cellPos);
  const cell = $cell.nodeAfter;
  if (!cell || (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader')) return null;
  const tablePos = $cell.before(-1);
  const table = view.state.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return null;
  const map = TableMap.get(table);
  const colspan = typeof cell.attrs.colspan === 'number' ? cell.attrs.colspan : 1;
  return { tablePos, column: map.colCount(cellPos - tablePos - 1) + colspan - 1 };
}

/**
 * 双击列分隔线按内容适配：清除该列的存储宽度，表格回到按内容分列。
 * 拖动本身仍由 prosemirror-tables 的 columnResizing 负责。
 */
export const TableColumnFitExtension = Extension.create({
  name: 'tableColumnFit',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tableColumnFitPluginKey,
        props: {
          handleDOMEvents: {
            dblclick(view, event) {
              if (!view.editable) return false;
              // 两次单击之间列宽插件会重绘调整柄，事件目标不可靠；以插件记录的当前分隔线为准。
              const resizeState: unknown = columnResizingPluginKey.getState(view.state);
              const activeHandle = resizeState && typeof resizeState === 'object' && 'activeHandle' in resizeState
                ? resizeState.activeHandle
                : -1;
              if (typeof activeHandle !== 'number' || activeHandle < 0) return false;
              const resolved = resolveBorderColumn(view, activeHandle);
              if (!resolved) return false;
              const tr = view.state.tr;
              if (!clearTableColumnWidth(tr, resolved.tablePos, resolved.column)) return false;
              event.preventDefault();
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },
});
