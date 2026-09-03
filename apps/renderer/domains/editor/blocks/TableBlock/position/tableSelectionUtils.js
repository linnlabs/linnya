/**
 * tableSelectionUtils.js
 * 
 * 此文件包含与表格选区相关的工具函数，用于处理表格内的选择和光标位置。
 * 主要功能：
 * 1. 检查位置是否在表格单元格内
 * 2. 获取选区信息
 * 3. 查找单元格和表格信息
 * 
 * 依赖：
 * - @tiptap/pm/model 中的 ResolvedPos, Node
 * - @tiptap/pm/state 中的 EditorState
 * 
 * 相关工具：
 * - 基础位置解析工具：tablePositionUtils.js
 * - TableMap 相关工具：tableMapUtils.js，用于获取单元格和表格的行列信息
 * - 内容相关工具：tableContentUtils.js
 * - 导航相关工具：tableNavigationUtils.js
 */

/**
 * 检查当前选区的头部是否位于表格单元格内
 * @param {import('@tiptap/pm/model').ResolvedPos} $head - 解析后的选区头部位置对象
 * @returns {boolean}
 */
export function isInTableCellByResolvedPos($head) {
  if (!$head) return false;
  for (let d = $head.depth; d > 0; d--) {
    const node = $head.node(d);
    if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
      return true;
    }
  }
  return false;
}

/**
 * 获取编辑器状态中的选区信息
 * @param {import('@tiptap/pm/state').EditorState} state - 编辑器状态
 * @returns {{
 *   $head: import('@tiptap/pm/model').ResolvedPos,
 *   $anchor: import('@tiptap/pm/model').ResolvedPos,
 *   from: number,
 *   to: number,
 *   empty: boolean
 * }}
 */
export function getResolvedSelection(state) {
  const { selection } = state;
  return {
    $head: selection.$head,
    $anchor: selection.$anchor,
    from: selection.from,
    to: selection.to,
    empty: selection.empty,
  };
}

/**
 * 从当前选区向上查找其所在的父级单元格节点以及父级表格节点
 * @param {import('@tiptap/pm/model').ResolvedPos} $head - 解析后的选区头部位置对象
 * @param {import('@tiptap/pm/model').NodeType} tableNodeType - Schema中的表格节点类型
 * @returns {{
 *   cellNode: import('@tiptap/pm/model').Node,
 *   cellPos: number,
 *   cellDepth: number,
 *   tableNode: import('@tiptap/pm/model').Node,
 *   tablePos: number,
 *   tableDepth: number
 * }|null}
 */
export function findCellAndTableInfoFromResolvedPos($head, tableNodeType) {
  if (!$head || !tableNodeType) return null;

  let cellNode = null;
  let cellPos = -1;
  let cellDepth = -1;
  let tableNode = null;
  let tablePos = -1;
  let tableDepth = -1;

  for (let d = $head.depth; d > 0; d--) {
    const ancestorNode = $head.node(d);
    // const ancestorStartPos = $head.start(d); // 旧代码

    if (!cellNode && (ancestorNode.type.spec.tableRole === 'cell' || ancestorNode.type.spec.tableRole === 'header_cell')) {
      cellNode = ancestorNode;
      cellPos = $head.before(d); // <--- 修改：获取单元格节点本身的起始位置
      cellDepth = d;
    }

    // 注意：查找 tableNode 的逻辑也需要调整
    // 如果 cellDepth 已确定，tableNode 应该是 cellNode 的祖父节点 (table > tableRow > cell)
    // 所以 tableNode 的深度应该是 cellDepth - 2
    // $head.node(cellDepth - 2) 和 $head.before(cellDepth - 2)
    if (cellNode && ancestorNode.type === tableNodeType && d === cellDepth - 2) {
        tableNode = ancestorNode;
        tablePos = $head.before(d); // <--- 修改：获取表格节点本身的起始位置
        tableDepth = d;
        break; 
    }
  }

  if (cellNode && tableNode) {
    return { cellNode, cellPos, cellDepth, tableNode, tablePos, tableDepth };
  }
  // Fallback if tableNode wasn't found with exact depth -2 (e.g. if cell is directly under table, though unlikely)
  // This part might need more robust logic if structure varies significantly.
  // For now, we assume the table > tableRow > cell structure.
  // If only cell is found, we might still try to find table by iterating further up.
  // However, the current loop breaks once table is found based on cellDepth - 2.
  // If the loop completes and tableNode is still null but cellNode is found, we might need an additional loop.
  // For simplicity, let's assume the primary structure holds.

  return null;
} 