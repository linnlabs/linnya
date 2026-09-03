/**
 * tableCoreOperations.js 
 * 
 * 【核心实现层】此文件包含表格操作的底层实现逻辑
 * 
 * 重要说明:
 * 1. 此文件包含表格操作的实际实现，如添加/删除行列、合并拆分单元格等
 * 2. 这些函数通过 TableBlock.js 中的 addCommands() 注册到编辑器实例上
 * 3. 上层接口在 tableToolbarCommands.js 中，它通过调用编辑器实例上的命令来使用这些函数
 * 
 * 命名规则:
 * - 所有命令都使用 xxxCustom 形式命名，表示这是自定义实现
 * - 这些函数都返回一个高阶函数 ({ tr, dispatch, editor }) => boolean
 * 
 * 此文件与其他命令文件的区别:
 * - 与其他专用命令文件(如tableDeleteCommands.js)不同，此文件实现核心的表格结构操作
 * - 这些命令直接操作ProseMirror文档模型、处理节点位置和事务映射等底层细节
 */

import { TextSelection } from 'prosemirror-state';
import { selectedRect } from 'prosemirror-tables';
import { generateBlockId } from '../../../../../shared/utils/idUtils';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import { getDetailedCellInfoFromDocPosition } from '../position';
import { insertTableColumnAt } from './tableColumnInsertion';
import { insertTableRowAt } from './tableRowInsertion';

/**
 * 自定义表格插入命令
 */
export const insertTableCustom = (options) => ({ tr, dispatch, editor }) => {
  const { schema } = editor.state;
  const resolvedOptions = {
    rows: 3,
    cols: 3,
    withHeaderRow: true,
    ...options,
  };

  if (!schema.nodes.tableCellContentBlock) {
    console.error("[TableBlock] FATAL: 'tableCellContentBlock' node type not found in schema.");
    if (dispatch) {
      const notification = {
        message: resolveCurrentEditorMessage('editor.tableBlock.notification.missingTableComponents'),
        type: "error",
        duration: 5000
      };
      if (editor.view.dispatch && typeof editor.view.dispatch === 'function') {
          tr.setMeta('userNotification', notification);
      } else {
          window.__APP_NOTIFICATION_STORE__?.show(notification.message, notification.type, notification.duration);
      }
    }
    return false;
  }

  const rows = [];
  // ⭐️ 默认列宽设置
  const defaultColWidth = 150; // 每列默认 150px
  
  for (let r = 0; r < resolvedOptions.rows; r++) {
    const cells = [];
    for (let c = 0; c < resolvedOptions.cols; c++) {
      const cellContentNode = schema.nodes.tableCellContentBlock.create({ 
        id: generateBlockId(), 
        blockType: 'tableCellContent' 
      });
      if (!cellContentNode) continue; 
      
      let cellNode;
      // ⭐️ 设置 colwidth 属性，确保列宽固定
      const cellAttrs = {
        colwidth: [defaultColWidth] // prosemirror-tables 使用数组格式
      }; 
      if (resolvedOptions.withHeaderRow && r === 0) {
        cellNode = schema.nodes.tableHeader?.create(cellAttrs, cellContentNode);
      } else {
        cellNode = schema.nodes.tableCell?.create(cellAttrs, cellContentNode);
      }
      if (cellNode) cells.push(cellNode);
      else return false; 
    }
    if (cells.length > 0) {
      const rowNode = schema.nodes.tableRow?.create(null, cells);
      if (rowNode) rows.push(rowNode);
      else return false; 
    } else if (resolvedOptions.cols > 0) return false; 
  }

  if (rows.length > 0) {
    const tableNode = schema.nodes.table?.create(null, rows);
    if (tableNode) {
      if (dispatch) {
        const currentSelection = tr.selection;
        tr.replaceSelectionWith(tableNode);
        const tableInitialPos = currentSelection.from; 
        let finalCursorPos = -1;
        // table (1) > tableRow (1) > tableCell/Header (1) > tableCellContentBlock (nodeSize 2 if empty, content starts at +1 from its own pos)
        // So, first tableCellContentBlock is at tableInitialPos + 1(table) + 1(row) + 1(cell) = tableInitialPos + 3
        const firstCellContentBlockNodePos = tableInitialPos + 3; 
        const nodeAtFirstCellContentBlockPos = tr.doc.nodeAt(firstCellContentBlockNodePos);

        if (nodeAtFirstCellContentBlockPos && nodeAtFirstCellContentBlockPos.type.name === schema.nodes.tableCellContentBlock.name) {
          finalCursorPos = firstCellContentBlockNodePos + 1; // Inside the content block
        } else {
          // Fallback, should ideally not happen with correct schema
          const intendedPos = tableInitialPos + 4; // Try one pos deeper
          if (intendedPos <= tr.doc.content.size) {
              const $desiredPos = tr.doc.resolve(intendedPos);
              const selectionNear = TextSelection.near($desiredPos, 1); 
              if (selectionNear && selectionNear.$from.parent.inlineContent) finalCursorPos = selectionNear.$from.pos;
          }
        }
        if (finalCursorPos !== -1 && finalCursorPos <= tr.doc.content.size) {
          try {
            tr.setSelection(TextSelection.create(tr.doc, finalCursorPos));
            tr.scrollIntoView();
          } catch (e) { console.error('[TableBlock insertTable Debug] Error resolving cursorPos:', e); }
        } else {
            // Fallback to selecting the table itself or its start
            tr.setSelection(TextSelection.create(tr.doc, tableInitialPos));
        }
      }
      return true;
    }
  }
  return false;
};

/**
 * 自定义在下方插入行命令
 */
export const addRowAfterCustom = () => ({ tr, dispatch, editor }) => { 
  const isCanCheck = !dispatch;
  // console.log(`[TableOpCmd addRowAfterCustom] Called. Is .can() check: ${isCanCheck}`);

  const detailedCellInfoForCheck = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);
  if (!detailedCellInfoForCheck) {
    // console.log('[TableOpCmd addRowAfterCustom] .can() check: No detailedCellInfo, returning false.');
    return false; 
  }
  if (isCanCheck) {
    // console.log('[TableOpCmd addRowAfterCustom] .can() check: detailedCellInfo found, returning true.');
    return true; // Generally possible if in a table cell
  }

  const { schema } = editor.state;
  const detailedCellInfo = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);

  if (!detailedCellInfo) {
    return false; 
  }

  const rect = selectedRect(editor.state);
  const result = insertTableRowAt({
    tr,
    rect,
    row: rect.bottom,
  });
  if (!result) return false;

  if (result.firstInsertedContentPos !== -1 && result.firstInsertedContentPos <= tr.doc.content.size) {
      const $finalCursorPos = tr.doc.resolve(result.firstInsertedContentPos);
      if ($finalCursorPos.parent && $finalCursorPos.parent.type.name === schema.nodes.tableCellContentBlock.name) {
        tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos));
        tr.scrollIntoView();
      } else {
        tr.setSelection(TextSelection.near(tr.doc.resolve(result.firstInsertedContentPos), 1));
      }
  } else {
    tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
  }
  return true;
};

/**
 * 自定义在上方插入行命令
 */
export const addRowBeforeCustom = () => ({ tr, dispatch, editor }) => {
  const isCanCheck = !dispatch;
  // console.log(`[TableOpCmd addRowBeforeCustom] Called. Is .can() check: ${isCanCheck}`);

  const detailedCellInfoForCheck = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);
  if (!detailedCellInfoForCheck) {
    // console.log('[TableOpCmd addRowBeforeCustom] .can() check: No detailedCellInfo, returning false.');
    return false;
  }
  if (isCanCheck) {
    // console.log('[TableOpCmd addRowBeforeCustom] .can() check: detailedCellInfo found, returning true.');
    return true;
  }

  const { schema } = editor.state;
  const detailedCellInfo = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);

  if (!detailedCellInfo) {
    return false;
  }

  const rect = selectedRect(editor.state);
  const result = insertTableRowAt({
    tr,
    rect,
    row: rect.top,
  });
  if (!result) return false;

  if (result.firstInsertedContentPos !== -1 && result.firstInsertedContentPos <= tr.doc.content.size) {
      const $finalCursorPos = tr.doc.resolve(result.firstInsertedContentPos);
      if ($finalCursorPos.parent && $finalCursorPos.parent.type.name === schema.nodes.tableCellContentBlock.name) {
        tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos));
        tr.scrollIntoView();
      } else {
        tr.setSelection(TextSelection.near(tr.doc.resolve(result.firstInsertedContentPos), 1));
      }
  } else {
    tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
  }
  return true;
}; 

/**
 * 自定义在左侧插入列命令
 */
export const addColumnBeforeCustom = () => ({ tr, dispatch, editor }) => {
  const isCanCheck = !dispatch;
  
  const detailedCellInfoForCheck = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);
  if (!detailedCellInfoForCheck) {
    return false;
  }
  if (isCanCheck) {
    return true; 
  }

  const { schema } = editor.state;
  const detailedCellInfo = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);

  if (!detailedCellInfo) {
    return false;
  }

  const rect = selectedRect(editor.state);
  const result = insertTableColumnAt({
    tr,
    rect,
    col: rect.left,
  });
  if (!result) return false;
 
  if (result.firstInsertedContentPos !== -1 && result.firstInsertedContentPos <= tr.doc.content.size) {
      try {
          const $finalCursorPos = tr.doc.resolve(result.firstInsertedContentPos);
          if ($finalCursorPos.parent && $finalCursorPos.parent.type.name === schema.nodes.tableCellContentBlock.name) {
                tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos));
          } else {
              const nearPos = TextSelection.near(tr.doc.resolve(result.firstInsertedContentPos), 1);
              if (nearPos.$from.parent.isTextblock || nearPos.$from.parent.inlineContent) {
                  tr.setSelection(nearPos);
              } else {
                  tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos -1));
              }
          }
          tr.scrollIntoView();
      } catch(e) {
          tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
      }
  } else if (detailedCellInfo.tableStartPos !== undefined) {
        tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
  }
  return true; 
};

/**
 * 自定义在右侧插入列命令
 */
export const addColumnAfterCustom = () => ({ tr, dispatch, editor }) => {
  const isCanCheck = !dispatch;
  // console.log(`[TableOpCmd addColumnAfterCustom] Called. Is .can() check: ${isCanCheck}`);
  
  const detailedCellInfoForCheck = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);
  if (!detailedCellInfoForCheck) {
    // console.log('[TableOpCmd addColumnAfterCustom] .can() check: No detailedCellInfo, returning false.');
    return false;
  }
  if (isCanCheck) {
    // console.log('[TableOpCmd addColumnAfterCustom] .can() check: detailedCellInfo found, returning true.');
    return true; // Generally possible if in a table cell
  }

  // Actual execution logic (dispatch is present)
  const { schema } = editor.state;
  const detailedCellInfo = getDetailedCellInfoFromDocPosition(editor.state, editor.state.selection.$head.pos);

  if (!detailedCellInfo) {
    return false;
  }

  const rect = selectedRect(editor.state);
  const result = insertTableColumnAt({
    tr,
    rect,
    col: rect.right,
  });
  if (!result) return false;

  if (result.firstInsertedContentPos !== -1 && result.firstInsertedContentPos <= tr.doc.content.size) {
      try {
          const $finalCursorPos = tr.doc.resolve(result.firstInsertedContentPos);
            if ($finalCursorPos.parent && $finalCursorPos.parent.type.name === schema.nodes.tableCellContentBlock.name) {
                  tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos));
            } else {
              const nearPos = TextSelection.near(tr.doc.resolve(result.firstInsertedContentPos), 1);
              if (nearPos.$from.parent.isTextblock || nearPos.$from.parent.inlineContent) {
                  tr.setSelection(nearPos);
              } else {
                  tr.setSelection(TextSelection.create(tr.doc, result.firstInsertedContentPos -1));
              }
          }
          tr.scrollIntoView();
      } catch(e) {
            tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
      }
  } else if (detailedCellInfo.tableStartPos !== undefined) {
        tr.setSelection(TextSelection.create(tr.doc, detailedCellInfo.tableStartPos));
  }
  return true;
};
