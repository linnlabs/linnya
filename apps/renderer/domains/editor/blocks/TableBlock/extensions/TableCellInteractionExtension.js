import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getDetailedCellInfoFromDocPosition } from '../position/tablePositionUtils';
import { CellSelection, cellAround, TableMap, selectedRect } from '@tiptap/pm/tables';

export const TableCellInteractionPluginKey = new PluginKey('tableCellInteraction');

// +++ 移植自新版，定义交互模式常量 +++
const INTERACTION_MODES = {
  NONE: 'none',
  EDITING: 'editing',
  SELECTED_SINGLE: 'selected-single',
  SELECTED_MULTI: 'selected-multi',
};

/**
 * DOM 事件的 target 不保证一定是 Element，也可能是 Text、Document 或 SVG 子节点。
 * 表格交互大量依赖 closest 查询，所以先统一归一化，避免不同事件分支各自散落判断。
 * @param {EventTarget | null} target
 * @param {string} selector
 * @returns {Element | null}
 */
export function findClosestElementFromTableEventTarget(target, selector) {
  if (!target || typeof selector !== 'string') return null;

  if (typeof target.closest === 'function') {
    return target.closest(selector);
  }

  const parentElement = target.parentElement;
  if (parentElement && typeof parentElement.closest === 'function') {
    return parentElement.closest(selector);
  }

  return null;
}

/**
 * 从当前 selection 推导“是否在单元格内”以及单元格起始 pos。
 * 说明：这是为了在从 suspended=true 恢复到 suspended=false 时，能够基于当前光标/选区恢复 handle 状态，
 * 避免 Vue 层做命令式补偿（restoreHandleVisibility）。
 * @param {import('prosemirror-state').Selection} selection
 * @returns {{ activeCellPos: number | null, interactionMode: string }}
 */
function deriveActiveCellFromSelection(selection) {
  // CellSelection：从 $anchorCell 向上找 table cell/header_cell
  if (selection instanceof CellSelection) {
    const $anchor = selection.$anchorCell;
    if ($anchor) {
      for (let d = $anchor.depth; d > 0; d--) {
        const node = $anchor.node(d);
        if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
          return {
            activeCellPos: $anchor.before(d),
            interactionMode: INTERACTION_MODES.SELECTED_SINGLE,
          };
        }
      }
    }
    return { activeCellPos: null, interactionMode: INTERACTION_MODES.NONE };
  }

  // TextSelection：从 $from 向上找 table cell/header_cell
  const $from = selection?.$from;
  if ($from) {
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.spec.tableRole === 'cell' || node.type.spec.tableRole === 'header_cell') {
        return {
          activeCellPos: $from.before(d),
          interactionMode: INTERACTION_MODES.EDITING,
        };
      }
    }
  }

  return { activeCellPos: null, interactionMode: INTERACTION_MODES.NONE };
}

export const TableCellInteractionExtension = Extension.create({
  name: 'tableCellInteraction',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: TableCellInteractionPluginKey,
        state: {
          init() {
            // +++ 添加新状态字段 +++
            return { 
              activeCellPos: null, 
              showHandle: false,
              interactionMode: INTERACTION_MODES.NONE,
              // 是否暂停交互（用于表格 AI 模式互斥）
              suspended: false,
              lastClickTime: 0,
              clickCount: 0
            };
          },
          apply(tr, pluginState) {
            const meta = tr.getMeta(TableCellInteractionPluginKey);
            
            if (meta) {
              // suspended：表格 AI 模式互斥开关
              // - suspended=true：强制隐藏 handle/装饰，禁止交互状态变更
              // - suspended=false：基于当前 selection 自动恢复 handle（若光标仍在表格内）
              if (typeof meta.suspended === 'boolean' && meta.suspended !== pluginState.suspended) {
                if (meta.suspended) {
                  return {
                    ...pluginState,
                    suspended: true,
                    showHandle: false,
                    interactionMode: INTERACTION_MODES.NONE,
                  };
                }

                // 从 suspended=true 恢复：根据当前 selection 推导是否应该显示 handle
                const derived = deriveActiveCellFromSelection(tr.selection);
                return {
                  ...pluginState,
                  suspended: false,
                  activeCellPos: derived.activeCellPos,
                  showHandle: derived.activeCellPos !== null,
                  interactionMode: derived.interactionMode,
                };
              }

              // hideHandle 优先级最高
              if (meta.hideHandle) {
                return { 
                  activeCellPos: null, 
                  showHandle: false, 
                  interactionMode: INTERACTION_MODES.NONE,
                  suspended: pluginState.suspended,
                  lastClickTime: 0,
                  clickCount: 0
                };
              }
              // 合并新的状态
              const newState = { ...pluginState, ...meta };
              // 若处于 suspended，则不允许展示 handle（防止外部误写 meta.showHandle=true）
              if (newState.suspended) {
                newState.showHandle = false;
                newState.interactionMode = INTERACTION_MODES.NONE;
              }
              return newState;
            }

            // suspended 模式下不响应任何自动更新（避免 selection 变化导致 handle 反复闪烁）
            if (pluginState.suspended) {
              return pluginState;
            }

            // 如果文档发生变化，且可能影响到了活动单元格，则重置状态
            if (tr.docChanged && pluginState.activeCellPos !== null) {
                try {
                    const node = tr.doc.nodeAt(pluginState.activeCellPos);
                    if (!node || (node.type.name !== 'tableCell' && node.type.name !== 'tableHeader')) {
                        return { activeCellPos: null, showHandle: false, interactionMode: INTERACTION_MODES.NONE, suspended: false, lastClickTime: 0, clickCount: 0 };
                    }
                } catch (e) {
                    return { activeCellPos: null, showHandle: false, interactionMode: INTERACTION_MODES.NONE, suspended: false, lastClickTime: 0, clickCount: 0 };
                }
            }
            return pluginState;
          },
        },
        props: {
          handleClick(view, pos, event) {
            const pluginState = TableCellInteractionPluginKey.getState(view.state);
            // 表格 AI 模式互斥：暂停交互时不处理点击
            if (pluginState?.suspended) {
              return false;
            }

            const clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!clickPos) return false;

            const cellInfo = getDetailedCellInfoFromDocPosition(view.state, clickPos.pos);
            let resolvedCellStartPos = cellInfo ? cellInfo.cellStartPos : null;

            if (resolvedCellStartPos === null) {
              const closestCell = findClosestElementFromTableEventTarget(event.target, 'td,th');
              if (closestCell) {
                try {
                  const cellContentPos = view.posAtDOM(closestCell, 0);
                  if (typeof cellContentPos === 'number') {
                    const possibleCellNodePos = cellContentPos - 1;
                    const nodeAtPos = view.state.doc.nodeAt(possibleCellNodePos);
                    if (nodeAtPos && (nodeAtPos.type.spec.tableRole === 'cell' || nodeAtPos.type.spec.tableRole === 'header_cell')) {
                      resolvedCellStartPos = possibleCellNodePos;
                    }
                  }
                } catch (e) { /* silent */ }
              }
            }

            if (resolvedCellStartPos !== null) {
              // pluginState 已在上方读取
              const currentTime = Date.now();
              const timeDiff = currentTime - (pluginState?.lastClickTime || 0);
              
              const isTripleClick = pluginState && 
                                   pluginState.activeCellPos === resolvedCellStartPos && 
                                   timeDiff < 300 && 
                                   pluginState.clickCount >= 2;

              const tr = view.state.tr;
              let newInteractionMode = INTERACTION_MODES.EDITING;
              let newClickCount = 1;
              
              if (pluginState && pluginState.activeCellPos === resolvedCellStartPos && timeDiff < 300) {
                newClickCount = (pluginState.clickCount || 0) + 1;
              }
              
              if (isTripleClick) {
                newInteractionMode = INTERACTION_MODES.SELECTED_SINGLE;
                const $cell = view.state.doc.resolve(resolvedCellStartPos);
                tr.setSelection(new CellSelection($cell));
              } else {
                newInteractionMode = INTERACTION_MODES.EDITING;

                // --- 仅在当前仍是 CellSelection 或非 EDITING 模式时，才主动设置光标 ---
                const currentSelection = view.state.selection;
                const needsCollapse = (currentSelection instanceof CellSelection) || (pluginState && pluginState.interactionMode !== INTERACTION_MODES.EDITING);

                if (needsCollapse) {
                  const cellNode = view.state.doc.nodeAt(resolvedCellStartPos);
                  if (cellNode) {
                    const contentStartPos = resolvedCellStartPos + 1; // 单元格内容起点
                    const contentEndPos = resolvedCellStartPos + cellNode.nodeSize - 1; // 单元格内容终点
                    let targetPos = clickPos.pos;
                    if (targetPos < contentStartPos || targetPos > contentEndPos) {
                      targetPos = contentStartPos; // 限制在内容块内部
                    }
                    try {
                      tr.setSelection(TextSelection.create(view.state.doc, targetPos));
                    } catch (e) {
                      // fallback: 如果解析失败，忽略
                    }
                  }
                }
              }
              
              const newState = {
                activeCellPos: resolvedCellStartPos,
                showHandle: true,
                interactionMode: newInteractionMode,
                lastClickTime: currentTime,
                clickCount: newClickCount
              };
              
              tr.setMeta(TableCellInteractionPluginKey, newState);
              view.dispatch(tr);
              
              if (!view.hasFocus()) view.focus();
              return true;
            }

            // --- 点击表格外部，隐藏句柄 ---
            if (pluginState && pluginState.showHandle) {
                view.dispatch(
                  view.state.tr.setMeta(TableCellInteractionPluginKey, { hideHandle: true })
                );
            }
            return false;
          },
          handleDOMEvents: {
            mousemove(view, event) {
              const target = event.target;
              const pluginState = TableCellInteractionPluginKey.getState(view.state);
              const closestActiveCell = findClosestElementFromTableEventTarget(target, '.is-cell-active');
              
              if (target && 
                  ((target.classList && target.classList.contains('cell-interaction-handle')) || 
                   (pluginState && pluginState.showHandle && closestActiveCell))) {
                view.dom.classList.remove('resize-cursor');
                return true;
              }
              
              return false;
            }
          },
          decorations(state) {
            const pluginState = TableCellInteractionPluginKey.getState(state);
            if (pluginState?.suspended) {
              return DecorationSet.empty;
            }
            const { selection } = state;
            const decorations = [];
        
            // 优先处理多单元格选择的情况 (CellSelection)
            if (selection instanceof CellSelection) {
              const tableNode = selection.$anchorCell.node(-1);
              const tableStart = selection.$anchorCell.start(-1);
              const map = TableMap.get(tableNode);
              const selectionRect = selectedRect(state);
        
              const cells = map.cellsInRect(selectionRect);
        
              cells.forEach(cellPosInTable => {
                const docPos = tableStart + cellPosInTable;
                const cellNode = state.doc.nodeAt(docPos);
                if (!cellNode) return;
        
                const cellRect = map.findCell(cellPosInTable);
                const classList = ['selection-outline']; // 基类，用于清除背景等
        
                if (cellRect.top === selectionRect.top) {
                  classList.push('selection-outline-top');
                }
                if (cellRect.bottom === selectionRect.bottom) {
                  classList.push('selection-outline-bottom');
                }
                if (cellRect.left === selectionRect.left) {
                  classList.push('selection-outline-left');
                }
                if (cellRect.right === selectionRect.right) {
                  classList.push('selection-outline-right');
                }
        
                if (classList.length > 1) { // 只有在有边框类时才添加装饰
                  decorations.push(
                    Decoration.node(docPos, docPos + cellNode.nodeSize, {
                      class: classList.join(' '),
                    })
                  );
                }
              });
            } 
            // 如果不是多选，但有单个激活的单元格（例如单击后）
            else if (pluginState && pluginState.showHandle && pluginState.activeCellPos !== null) {
              const cellNode = state.doc.nodeAt(pluginState.activeCellPos);
              if (cellNode) {
                try {
                  const decorationEndPos = pluginState.activeCellPos + cellNode.nodeSize;
                  decorations.push(
                    Decoration.node(pluginState.activeCellPos, decorationEndPos, {
                      class: 'is-cell-active',
                    })
                  );
                } catch (e) {
                  console.error("[TableCellInteractionExtension] Error creating single node decoration:", e);
                }
              }
            }
        
            return DecorationSet.create(state.doc, decorations);
          },
        },
        appendTransaction: (transactions, oldState, newState) => {
            // pending 注入期间跳过表格交互状态更新
            if (transactions.some(tr => tr.getMeta('pendingRevisionApply'))) {
              return null;
            }
            const oldPluginState = TableCellInteractionPluginKey.getState(oldState);
            const newPluginState = TableCellInteractionPluginKey.getState(newState);
            if (newPluginState?.suspended) {
              return null;
            }
            const { selection } = newState;
        
            // 仅在选区实际发生变化时才进行后续逻辑判断
            const selectionHasChanged = !oldState.selection.eq(newState.selection);
            if (!selectionHasChanged) {
              return null;
            }
        
            // --- 核心逻辑 ---
        
            // 情况 1: 选区是多单元格选区 (CellSelection)，通常由拖拽或三次点击创建
            if (selection instanceof CellSelection) {
              const rect = selectedRect(newState);
              const table = selection.$anchorCell.node(-1);
              const tablePos = selection.$anchorCell.start(-1);
              const map = TableMap.get(table);
        
              // 判断是单选还是多选
              if (rect.left === rect.right - 1 && rect.top === rect.bottom - 1) { // 单个单元格
                const cellPosInTable = map.map[rect.top * map.width + rect.left];
                const selectedCellStartPos = tablePos + cellPosInTable;
        
                // 如果状态需要更新
                if (oldPluginState?.activeCellPos !== selectedCellStartPos || oldPluginState?.interactionMode !== INTERACTION_MODES.SELECTED_SINGLE) {
                  return newState.tr.setMeta(TableCellInteractionPluginKey, {
                    activeCellPos: selectedCellStartPos,
                    showHandle: true,
                    interactionMode: INTERACTION_MODES.SELECTED_SINGLE
                  });
                }
              } else { // 多个单元格
                const topLeftCellPosInTable = map.map[rect.top * map.width + rect.left];
                const topLeftCellStartPos = tablePos + topLeftCellPosInTable;
        
                // 如果状态需要更新
                if (oldPluginState?.activeCellPos !== topLeftCellStartPos || oldPluginState?.interactionMode !== INTERACTION_MODES.SELECTED_MULTI) {
                  return newState.tr.setMeta(TableCellInteractionPluginKey, {
                    activeCellPos: topLeftCellStartPos,
                    showHandle: true,
                    interactionMode: INTERACTION_MODES.SELECTED_MULTI
                  });
                }
              }
              return null; // 状态已是最新，无需操作
            }
        
            // 情况 2: 选区是光标 (TextSelection)，例如键盘移动光标
            if (selection instanceof TextSelection) {
              const { $head } = selection;

              // 轻量前置检查：遍历 $head 的父节点判断是否在表格 cell 内
              // O(depth)，depth 通常 < 10，避免非表格场景下调用较重的 getDetailedCellInfoFromDocPosition
              let inTableCell = false;
              for (let d = $head.depth; d > 0; d--) {
                const role = $head.node(d).type.spec.tableRole;
                if (role === 'cell' || role === 'header_cell') {
                  inTableCell = true;
                  break;
                }
              }

              if (!inTableCell) {
                if (oldPluginState?.showHandle) {
                  return newState.tr.setMeta(TableCellInteractionPluginKey, { hideHandle: true });
                }
                return null;
              }

              const cellInfo = getDetailedCellInfoFromDocPosition(newState, $head.pos);
        
              if (cellInfo) {
                const newActiveCellPos = cellInfo.cellStartPos;
                if (oldPluginState?.activeCellPos !== newActiveCellPos || !oldPluginState?.showHandle) {
                  return newState.tr.setMeta(TableCellInteractionPluginKey, {
                    activeCellPos: newActiveCellPos,
                    showHandle: true,
                    interactionMode: INTERACTION_MODES.EDITING
                  });
                }
                return null;
              }
            }
        
            // 情况 3: 回退情况 - 非 CellSelection 且非 TextSelection 的其他选区类型
            if (oldPluginState?.showHandle) {
              return newState.tr.setMeta(TableCellInteractionPluginKey, { hideHandle: true });
            }
            
            return null; // 无任何操作
        },
        view: (editorView) => {
          const handleDocumentMousedown = (event) => {
            const pluginState = TableCellInteractionPluginKey.getState(editorView.state);
            if (!pluginState?.showHandle) return;
            
            if (findClosestElementFromTableEventTarget(event.target, 'td, th, .cell-handle-overlay')) return;

            editorView.dispatch(
              editorView.state.tr.setMeta(TableCellInteractionPluginKey, { hideHandle: true })
            );
          };

          document.addEventListener('mousedown', handleDocumentMousedown, true);

          return {
            destroy() {
              document.removeEventListener('mousedown', handleDocumentMousedown, true);
            },
          };
        }
      }),
    ];
  },
});

export default TableCellInteractionExtension; 
