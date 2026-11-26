/**
 * tableStoredWidths.js
 *
 * 表格是否有存储列宽。没有存储列宽的表格按内容分列（共用表格呈现），
 * 插入的行列也不能写默认宽度，否则表格变成“部分列有宽度”，显示、坐标头与 Agent 投影都会不一致。
 */

/**
 * @param {import('prosemirror-model').Node} table
 * @returns {boolean}
 */
export function tableHasStoredColumnWidths(table) {
  let found = false;
  table.descendants((node) => {
    if (found) return false;
    const widths = node.attrs?.colwidth;
    if (Array.isArray(widths) && widths.some((width) => typeof width === 'number' && width > 0)) {
      found = true;
    }
    return node.type.spec.tableRole !== 'cell' && node.type.spec.tableRole !== 'header_cell';
  });
  return found;
}
