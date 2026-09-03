/**
 * TableSelectionDecoratorExtension.js
 * 
 * 此扩展用于增强表格选区的可视化，特别是在AI输入界面显示时保持选区的高亮状态。
 * 实现了一个ProseMirror插件，该插件在表格选区激活时添加装饰，并在AI输入界面显示时保持这些装饰。
 * 支持同时高亮原选区和AI输出目标列选区。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { CellSelection, selectedRect } from '@tiptap/pm/tables';
import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils';
import { refreshTableInfoSnapshot } from '../position/tableIdentity';

// ✅ 使用字符串作为 Transaction meta key（跨 TS/JS 文件稳定、可序列化、类型友好）
// 说明：此前使用 Symbol 会导致 TS 侧 setMeta/getMeta 需要放宽类型，不符合工程规范。
export const TABLE_SELECTION_DECORATOR_KEY = 'tableSelectionDecorator';
export const COLUMN_REFS_DECORATOR_KEY = 'columnRefsDecorator';

function refreshTableInfoForTransaction(newState, tr, tableInfo) {
  if (!tableInfo || typeof tableInfo.pos !== 'number') return null;

  const mappedPos = tr.docChanged ? tr.mapping.map(tableInfo.pos, -1) : tableInfo.pos;
  return refreshTableInfoSnapshot(newState.doc, {
    ...tableInfo,
    pos: mappedPos,
  });
}

/**
 * 表格选区增强扩展
 * 提供在AI交互时保持表格选区高亮的功能，并支持AI输出目标列高亮
 */
export const TableSelectionDecoratorExtension = Extension.create({
  name: 'tableSelectionDecorator',

  addProseMirrorPlugins() {
    // 创建列引用装饰插件
    const columnRefsPlugin = new Plugin({
      key: new PluginKey('columnRefsDecorator'),
      state: {
        init() {
          return {
            decorations: DecorationSet.empty,
            columnRefs: {},
            tableInfo: null
          };
        },
        apply(tr, pluginState, oldState, newState) {
          const columnRefsMeta = tr.getMeta(COLUMN_REFS_DECORATOR_KEY);
          
          if (columnRefsMeta) {
            const columnRefs = columnRefsMeta.refs || {};
            const tableInfo = refreshTableInfoForTransaction(
              newState,
              tr,
              columnRefsMeta.tableInfo || pluginState.tableInfo
            );
            
            let decorations = DecorationSet.empty;
            if (tableInfo && tableInfo.node && tableInfo.pos !== null) {
              decorations = createColumnRefsHighlights(
                newState,
                tableInfo.node,
                tableInfo.pos,
                columnRefs
              );
            }
            return { 
              decorations,
              columnRefs,
              tableInfo
            };
          }
          
          if (tr.docChanged && pluginState.tableInfo && pluginState.tableInfo.node && 
              Object.keys(pluginState.columnRefs).length > 0) {
            const refreshedTableInfo = refreshTableInfoForTransaction(newState, tr, pluginState.tableInfo);
            
            if (refreshedTableInfo) {
              const decorations = createColumnRefsHighlights(
                newState,
                refreshedTableInfo.node,
                refreshedTableInfo.pos,
                pluginState.columnRefs
              );
              
              return { 
                ...pluginState,
                decorations,
                tableInfo: refreshedTableInfo
              };
            }
          }
          return pluginState;
        }
      },
      props: {
        decorations(state) {
          return this.getState(state).decorations;
        }
      }
    });
    
    const selectionPlugin = new Plugin({
      key: new PluginKey('tableSelectionDecorator'),
      state: {
        init() {
          return {
            decorations: DecorationSet.empty,
            keepSelectionVisible: false,
            persistedRect: null,       // Stores the main selection rect (originalRect)
            persistedOutputRect: null, // Stores the output rect
            persistedTableNode: null,  // Table node where selection was made
            persistedTablePos: null,   // Position of that table node
            persistedSuppressOutputCalc: false // Suppression flag for output column
          };
        },
        apply(tr, pluginState, oldState, newState) {
          const meta = tr.getMeta(TABLE_SELECTION_DECORATOR_KEY);
          const columnMeta = tr.getMeta(COLUMN_REFS_DECORATOR_KEY);

          let newPluginState = { ...pluginState }; // Start with a copy of the current state

          if (meta) { 
            const suppressOutputCalc = meta.suppressOutputCalc !== undefined ? meta.suppressOutputCalc : newPluginState.persistedSuppressOutputCalc;
            
            if (meta.keepSelectionVisible === true) {
              let currentRect = meta.originalRect || null;
              let currentOutputRect = suppressOutputCalc ? null : (meta.outputRect || null);
              let currentTableNode = meta.tableNode || null;
              let currentTablePos = meta.tablePos !== undefined ? meta.tablePos : null;

              if (!currentTableNode && newState.selection instanceof CellSelection) {
                const { $anchorCell } = newState.selection;
                currentTableNode = $anchorCell.node(-1);
                currentTablePos = $anchorCell.start(-1) - 1;
                if (!currentRect) currentRect = selectedRect(newState);
                if (!meta.outputRect && !suppressOutputCalc) {
                    currentOutputRect = createOutputColumnRect(currentRect, newState);
                }
              }

              newPluginState.decorations = DecorationSet.empty;
              if (currentTableNode && currentTablePos !== null && (currentRect || currentOutputRect)) {
                newPluginState.decorations = createSelectionDecorationsFromMeta(
                  newState, currentTableNode, currentTablePos, currentRect, currentOutputRect
                );
              }
              
              newPluginState.keepSelectionVisible = true;
              newPluginState.persistedRect = currentRect;
              newPluginState.persistedOutputRect = currentOutputRect;
              newPluginState.persistedTableNode = currentTableNode;
              newPluginState.persistedTablePos = currentTablePos;
              newPluginState.persistedSuppressOutputCalc = suppressOutputCalc;

            } else if (meta.keepSelectionVisible === false) {
              newPluginState.decorations = DecorationSet.empty; 
              newPluginState.keepSelectionVisible = false; 
              newPluginState.persistedRect = null;
              newPluginState.persistedOutputRect = null;
              newPluginState.persistedTableNode = null;
              newPluginState.persistedTablePos = null;
              newPluginState.persistedSuppressOutputCalc = false;

            } else {
              if (newPluginState.keepSelectionVisible) {
                if (newPluginState.persistedTableNode && newPluginState.persistedTablePos !== null && (newPluginState.persistedRect || (newPluginState.persistedOutputRect && !newPluginState.persistedSuppressOutputCalc))) {
                  newPluginState.decorations = createSelectionDecorationsFromMeta(
                    newState, 
                    newPluginState.persistedTableNode, 
                    newPluginState.persistedTablePos, 
                    newPluginState.persistedRect, 
                    newPluginState.persistedSuppressOutputCalc ? null : newPluginState.persistedOutputRect
                  );
                } else {
                  newPluginState.decorations = DecorationSet.empty;
                }
              }
            }
            return newPluginState;
          }

          // No meta for TABLE_SELECTION_DECORATOR_KEY. Check if we need to maintain visibility.
          if (newPluginState.keepSelectionVisible) {
            if (newPluginState.persistedTableNode && newPluginState.persistedTablePos !== null && (newPluginState.persistedRect || (newPluginState.persistedOutputRect && !newPluginState.persistedSuppressOutputCalc))) {
              let tableNodeToUse = newPluginState.persistedTableNode;
              let tablePosToUse = newPluginState.persistedTablePos;
              if (tr.docChanged && newPluginState.persistedTablePos !== null) {
                const refreshedTableInfo = refreshTableInfoForTransaction(newState, tr, {
                  node: tableNodeToUse,
                  pos: newPluginState.persistedTablePos,
                });
                if (refreshedTableInfo) {
                  tableNodeToUse = refreshedTableInfo.node;
                  tablePosToUse = refreshedTableInfo.pos;
                  newPluginState.persistedTableNode = tableNodeToUse;
                  newPluginState.persistedTablePos = tablePosToUse;
                }
              }

              newPluginState.decorations = createSelectionDecorationsFromMeta(
                newState, 
                tableNodeToUse, 
                tablePosToUse, 
                newPluginState.persistedRect, 
                newPluginState.persistedSuppressOutputCalc ? null : newPluginState.persistedOutputRect
              );
            } else {
              newPluginState.decorations = DecorationSet.empty;
            }
            return newPluginState;
          }
          
          // If not keeping selection visible and no meta instruction to change it, maintain current decoration state (likely empty).
          // If doc changed, decorations might need remapping, but DecorationSet.map handles that implicitly if called by PM.
          // If we are here, keepSelectionVisible is false. Ensure decorations are empty.
          if (!newPluginState.keepSelectionVisible && newPluginState.decorations.find().length > 0) {
             newPluginState.decorations = DecorationSet.empty;
          }

          return newPluginState; 
        }
      },
      props: {
        decorations(state) {
          return this.getState(state).decorations;
        }
      }
    });
    
    return [selectionPlugin, columnRefsPlugin];
  }
});

/**
 * 使用元数据直接创建选区装饰
 * 此函数不依赖当前选区，适用于添加列后的情况
 * 
 * @param {import('prosemirror-state').EditorState} state - 编辑器状态
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {Object|null} rect - 原始选区矩形
 * @param {Object} outputRect - 输出列矩形区域
 * @returns {DecorationSet} 装饰集合
 */
function createSelectionDecorationsFromMeta(state, tableNode, tablePos, rect, outputRect) {
  if (!tableNode || tablePos === null) { 
    return DecorationSet.empty;
  }
  const map = getTableMap(tableNode);
  if (!map) {
    return DecorationSet.empty;
  }
  
  const decorations = [];
  
  if (rect) {
    decorations.push(...createLogicalRectCellDecorations({
      state,
      tablePos,
      map,
      rect,
      baseClassNames: ['ai-persistent-selected-cell-outline'],
      getBoundaryClassNames: getPersistentSelectionBoundaryClassNames,
    }));
  }
  
  if (outputRect) {
    const colInRange = outputRect.left < map.width;
  
    if (colInRange) {
      decorations.push(...createLogicalRectCellDecorations({
        state,
        tablePos,
        map,
        rect: {
          ...outputRect,
          right: Math.min(outputRect.left + 1, map.width),
        },
        baseClassNames: ['ai-persistent-selected-cell-outline', 'ai-output-column-cell'],
        getBoundaryClassNames: getPersistentSelectionBoundaryClassNames,
      }));
    }
  }
  
  return DecorationSet.create(state.doc, decorations);
}

/**
 * 创建AI输出目标列的矩形区域
 * 
 * @param {Object} rect - 原选区矩形信息 {left, right, top, bottom}
 * @param {import('prosemirror-state').EditorState} state - 编辑器状态
 * @returns {Object|null} 目标列矩形区域
 */
function createOutputColumnRect(rect, state) {
  if (!rect) return null;
  const { selection } = state;
  if (!(selection instanceof CellSelection)) return null;
  const tableNode = selection.$anchorCell.node(-1);
  if (!tableNode) return null;
  const map = getTableMap(tableNode);
  if (!map) return null;
  return {
    left: rect.right, 
    right: rect.right + 1, 
    top: rect.top,
    bottom: rect.bottom,
    isOutputColumn: true 
  };
}

/**
 * 创建列引用高亮装饰
 * @param {import('prosemirror-state').EditorState} state - 编辑器状态
 * @param {import('@tiptap/pm/model').Node} tableNode - 表格节点
 * @param {number} tablePos - 表格节点在文档中的位置
 * @param {Object} columnRefs - 列引用信息，格式为 {refKey: {rect, color, id, active}}
 * @returns {DecorationSet} 装饰集合
 */
function createColumnRefsHighlights(state, tableNode, tablePos, columnRefs) {
  if (!tableNode || tablePos === null || !columnRefs) {
    return DecorationSet.empty;
  }
  
  const map = getTableMap(tableNode);
  if (!map) {
    return DecorationSet.empty;
  }
  
  const decorations = [];
  const activeRefs = Object.values(columnRefs).filter(ref => ref.active && ref.rect);
  
  for (const ref of activeRefs) {
    const { rect, color, id } = ref;
    
    let rectInvalidReason = null;
    if (!rect) {
      rectInvalidReason = 'rect 对象本身为空';
    } else if (typeof rect.top !== 'number') {
      rectInvalidReason = 'rect.top 不是数字';
    } else if (typeof rect.bottom !== 'number') {
      rectInvalidReason = 'rect.bottom 不是数字';
    } else if (typeof rect.left !== 'number') {
      rectInvalidReason = 'rect.left 不是数字';
    } else if (typeof rect.right !== 'number') {
      rectInvalidReason = 'rect.right 不是数字';
    }
    
    if (rectInvalidReason) {
      continue;
    }
    
    decorations.push(...createLogicalRectCellDecorations({
      state,
      tablePos,
      map,
      rect,
      baseClassNames: ['ai-column-ref-cell', `ai-column-ref-${id}`],
      getBoundaryClassNames: getColumnRefBoundaryClassNames,
      attrs: { style: `--table-ai-column-ref-color: ${color};`, columnRef: true },
    }));
  }
  return DecorationSet.create(state.doc, decorations);
}

function getPersistentSelectionBoundaryClassNames(row, col, rect) {
  const classNames = [];
  if (row === rect.top) classNames.push('ai-outline-top');
  if (row === rect.bottom - 1) classNames.push('ai-outline-bottom');
  if (col === rect.left) classNames.push('ai-outline-left');
  if (col === rect.right - 1) classNames.push('ai-outline-right');
  return classNames;
}

function getColumnRefBoundaryClassNames(row, col, rect) {
  const classNames = [];
  if (row === rect.top) classNames.push('ai-column-ref-top');
  if (row === rect.bottom - 1) classNames.push('ai-column-ref-bottom');
  if (col === rect.left) classNames.push('ai-column-ref-left');
  if (col === rect.right - 1) classNames.push('ai-column-ref-right');
  return classNames;
}

function createLogicalRectCellDecorations(params) {
  const {
    state,
    tablePos,
    map,
    rect,
    baseClassNames,
    getBoundaryClassNames,
    attrs = {},
  } = params;

  const cellsByOffset = new Map();

  for (let row = rect.top; row < rect.bottom; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      if (row < 0 || col < 0 || row >= map.height || col >= map.width) {
        continue;
      }

      const cellOffset = getCellOffsetAtLogicalPosition(map, row, col);
      if (cellOffset === null) {
        continue;
      }

      if (!cellsByOffset.has(cellOffset)) {
        cellsByOffset.set(cellOffset, new Set(baseClassNames));
      }

      const classNames = cellsByOffset.get(cellOffset);
      for (const boundaryClassName of getBoundaryClassNames(row, col, rect)) {
        classNames.add(boundaryClassName);
      }
    }
  }

  const decorations = [];
  for (const [cellOffset, classNames] of cellsByOffset.entries()) {
    const absoluteCellPos = tablePos + 1 + cellOffset;
    const cellNode = state.doc.nodeAt(absoluteCellPos);
    if (!cellNode) {
      continue;
    }

    decorations.push(Decoration.node(
      absoluteCellPos,
      absoluteCellPos + cellNode.nodeSize,
      { ...attrs, class: Array.from(classNames).join(' ') }
    ));
  }

  return decorations;
}

/**
 * 设置或更新列引用的辅助函数
 * @param {import('prosemirror-state').Transaction} tr - 编辑器事务
 * @param {Object} refs - 列引用信息，格式为 {refKey: {rect, color, id, active}}
 * @param {Object} tableInfo - 表格信息 {node, pos}
 * @returns {import('prosemirror-state').Transaction} 更新后的事务
 */
export function setColumnRefs(tr, refs, tableInfo) {
  const newTr = tr.setMeta(COLUMN_REFS_DECORATOR_KEY, { refs, tableInfo });
  return newTr;
}

/**
 * 设置是否保持表格选区高亮的辅助函数
 * @param {import('prosemirror-state').Transaction} tr - 编辑器事务
 * @param {boolean} keepVisible - 是否保持选区可见
 * @param {Object} [outputRect=null] - 可选的输出列矩形区域
 * @param {boolean} [suppressOutputCalc=false] - 是否抑制输出列装饰的计算
 * @returns {import('prosemirror-state').Transaction} 更新后的事务
 */
export function setKeepTableSelectionVisible(tr, keepVisible, outputRect = null, suppressOutputCalc = false) {
  const contextParts = [
    `keepVisible: ${keepVisible}`,
    outputRect ? `outputRect provided (${JSON.stringify(outputRect)})` : `no outputRect`,
    suppressOutputCalc ? `suppressOutputCalc: true` : `suppressOutputCalc: false`
  ];
  const context = `setKeepTableSelectionVisible (${contextParts.join(', ')}): ${keepVisible}`;
  
  const newTr = tr.setMeta(TABLE_SELECTION_DECORATOR_KEY, {
    keepSelectionVisible: keepVisible,
    outputRect,
    suppressOutputCalc
  });
  return newTr;
}
