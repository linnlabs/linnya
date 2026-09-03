/**
 * tableToolbarUtils.js
 *
 * 此文件包含与表格浮动工具栏相关的 UI 工具函数，
 * 主要用于计算工具栏的显示位置等。
 *
 * 依赖：
 * - @tiptap/pm/tables 中的 TableMap, CellSelection
 * - prosemirror-view 中的 EditorView
 */
import { TableMap, CellSelection } from '@tiptap/pm/tables';
import { getCellOffsetAtLogicalPosition } from '../position/tableMapUtils';
import { ROOT_BLOCK_RENDER_MODE_DATA_ATTR } from '../../../features/RenderVirtualization/view/rootBlockRenderMode';

const ROOT_BLOCK_SELECTOR = '.root-block-outer[data-id]';

function escapeCssAttributeValue(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/["\\]/g, '\\$&');
}

function getEditorDom(editorView) {
  return editorView?.dom instanceof HTMLElement ? editorView.dom : null;
}

function getRootBlockIdAtPos(doc, pos) {
  if (!Number.isFinite(pos) || pos < 0 || pos > doc.content.size) {
    return null;
  }

  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);
    if (node.type.name !== 'rootBlock') continue;

    const id = node.attrs?.id;
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  return null;
}

function findRootBlockElement(editorView, blockId) {
  const editorDom = getEditorDom(editorView);
  if (!editorDom) return null;

  const escapedBlockId = escapeCssAttributeValue(blockId);
  const selector = `${ROOT_BLOCK_SELECTOR}[data-id="${escapedBlockId}"]`;

  if (editorDom.matches(selector)) return editorDom;

  const element = editorDom.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
}

function isPlaceholderRootBlockElement(element) {
  return (
    element.dataset.placeholder === 'true' ||
    element.getAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR) === 'placeholder' ||
    element.classList.contains('root-block-virtual-placeholder')
  );
}

function isPositionInsidePlaceholderRootBlock(editorView, pos) {
  const blockId = getRootBlockIdAtPos(editorView.state.doc, pos);
  if (!blockId) return false;

  const rootBlockElement = findRootBlockElement(editorView, blockId);
  return rootBlockElement ? isPlaceholderRootBlockElement(rootBlockElement) : false;
}

/**
 * 计算表格选区浮动工具栏的理想位置
 *
 * @param {import('prosemirror-view').EditorView} editorView - ProseMirror 编辑器视图实例
 * @param {import('prosemirror-state').Selection} selection - 当前的选区对象
 * @returns {{top: number, left: number} | null} 返回工具栏的 top 和 left 坐标，如果不应显示则返回 null
 */
export function calculateToolbarPosition(editorView, selection) {
  if (!(selection instanceof CellSelection)) {
    return null;
  }
  
  if (!editorView.editable) {
    return null;
  }

  const tableNode = selection.$anchorCell.node(-1); // 获取表格节点
  if (!tableNode) {
    return null;
  }

  const tableContentStartPos = selection.$anchorCell.start(-1); // 获取表格内容区的起始位置
  const map = TableMap.get(tableNode); // 获取 TableMap

  // 计算选区矩形
  // 重要：下面的 anchorOffset 和 headOffset 计算方式直接影响 TableMap.rectBetween 的行为。
  // 1. `$selection.$anchorCell.pos` (及 `$headCell.pos`):
  //    根据项目 README.md 中定义的表格节点结构 (`tableCell` -> `tableCellContentBlock`)，
  //    此位置指向的是 `tableCellContentBlock` 节点的起始处，即单元格内容的开始。
  //    (例如, 若 `<td>` 在 P_cell, 则 `$anchorCell.pos` 为 P_cell + 1).
  // 2. `tableContentStartPos`: 这是整个 `<table>` 顶级节点的内容区起始位置 (P_table + 1)。
  // 3. `TableMap.rectBetween` 的参数：
  //    尽管 TableMap 内部的偏移量通常是相对于表格内容区 (P_table + 1) 的，
  //    但经过实践验证，对于 `CellSelection`，将 `($anchorCell.pos - tableContentStartPos)`
  //    直接作为 `rectBetween` 的参数可以正确工作。这表明 `rectBetween` 对源自
  //    `CellSelection` 的此类输入有特定的处理方式，以正确解析单元格范围。
  //    这与 `TROUBLESHOOTING_TABLE_ARROW_NAVIGATION.md` 中关于精确位置计算的经验教训一致：
  //    ProseMirror 的位置解析非常精细，具体API的行为需通过测试验证。
  const anchorOffset = selection.$anchorCell.pos - tableContentStartPos;
  const headOffset = selection.$headCell.pos - tableContentStartPos;
  const selectionRect = map.rectBetween(anchorOffset, headOffset);

  // selectionRect 中的行列索引是相对于整个表格的（0-based）。
  // 左上角逻辑格子可能被 rowspan / colspan 的真实 cell 覆盖，因此统一走覆盖关系 helper。
  const topLeftCellNodeOffsetFromTableContentStart = getCellOffsetAtLogicalPosition(
    map,
    selectionRect.top,
    selectionRect.left
  );

  if (topLeftCellNodeOffsetFromTableContentStart === null) {
    console.error("[calculateToolbarPosition] Could not resolve top-left cell offset.", { rect: selectionRect });
    return null;
  }

  // 计算左上角真实覆盖单元格的内容块起始位置。
  // nodeDOM 读取内容块 DOM 后再 closest('td, th')，比直接依赖 cell DOM 更兼容不同 NodeView 实现。
  const absPosOfTopLeftCellContentNode = tableContentStartPos + topLeftCellNodeOffsetFromTableContentStart + 1;

  let pos = { top: -10000, left: -10000 }; // 默认位置，防止意外显示

  // 确保计算出的位置在文档范围内
  if (absPosOfTopLeftCellContentNode >= 0 && absPosOfTopLeftCellContentNode < editorView.state.doc.content.size) {
    // 虚拟化 placeholder rootBlock 没有 contentDOM。这里必须直接等待 hydrate 后再定位，
    // 不能继续调用 coordsAtPos，否则 PM 会尝试从不存在的内部 DOM 计算坐标。
    if (isPositionInsidePlaceholderRootBlock(editorView, absPosOfTopLeftCellContentNode)) {
      return null;
    }

    try {
      // 获取该位置对应的 DOM 节点，这通常是单元格内容块的起始位置
      const contentNodeDom = editorView.nodeDOM(absPosOfTopLeftCellContentNode);

      if (contentNodeDom instanceof HTMLElement) {
        // 从内容节点向上找到其父级 <td> 或 <th> 元素
        const cellElement = contentNodeDom.closest('td, th');

        if (cellElement instanceof HTMLElement) {
          const domRect = cellElement.getBoundingClientRect();
          pos = {
            top: domRect.top + window.scrollY - 48, // UI偏移：-48px 经验值，使工具栏显示在选中单元格区域的上方
            left: domRect.left + window.scrollX,
          };
        } else {
          console.warn('[calculateToolbarPosition] Could not find parent cell (td/th) for content node, or it was not an HTMLElement. Using content node coords as fallback. Content node DOM:', contentNodeDom);
          const coords = editorView.coordsAtPos(absPosOfTopLeftCellContentNode);
          pos = {
            top: coords.top + window.scrollY - 40,
            left: coords.left + window.scrollX,
          };
        }
      } else {
        console.warn('[calculateToolbarPosition] nodeDOM at top-left cell content node did not return HTMLElement. NodeDOM:', contentNodeDom, 'Pos:', absPosOfTopLeftCellContentNode);
        const coords = editorView.coordsAtPos(absPosOfTopLeftCellContentNode);
        pos = {
          top: coords.top + window.scrollY - 40,
          left: coords.left + window.scrollX,
        };
      }
    } catch (e) {
      console.warn('[calculateToolbarPosition] Error resolving DOM for top-left cell or getting its rect. Pos:', absPosOfTopLeftCellContentNode, 'Error:', e);
      try {
        const coords = editorView.coordsAtPos(absPosOfTopLeftCellContentNode);
        pos = {
          top: coords.top + window.scrollY - 40,
          left: coords.left + window.scrollX,
        };
      } catch (coordError) {
        console.error('[calculateToolbarPosition] Fallback coordsAtPos also failed for top-left cell content node. Pos:', absPosOfTopLeftCellContentNode, 'Error:', coordError);
        return null; // 无法计算位置
      }
    }
  } else {
    console.warn('[calculateToolbarPosition] Calculated top-left cell content position is out of document bounds or invalid. Pos:', absPosOfTopLeftCellContentNode, 'Doc size:', editorView.state.doc.content.size);
    return null; // 位置无效
  }

  return pos;
}
