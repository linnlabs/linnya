/**
 * tableColumnResizeKeepAlive.js
 *
 * 表格列宽拖拽与 RootBlock 渲染虚拟化之间的保活桥。
 *
 * 中文说明：
 * - 列宽拖拽期间必须保证表格所在 rootBlock 保持 hydrated；
 * - 这里只通过 DOM 事件声明保活，不直接依赖虚拟化 controller；
 * - 使用独立 reason，避免与坐标轴 / toolbar 的 interaction-open 互相释放。
 */

import { applyRenderVirtualizationKeepAliveCommand } from '../../../features/RenderVirtualization';
import { findClosestElementFromTableEventTarget } from './TableCellInteractionExtension';

const ROOT_BLOCK_SELECTOR = '.root-block-outer[data-id]';
const RESIZE_HANDLE_SELECTOR = '.column-resize-handle';

/**
 * @param {EventTarget | null} target
 * @returns {HTMLElement | null}
 */
export function findColumnResizeHandleFromEventTarget(target) {
  const handle = findClosestElementFromTableEventTarget(target, RESIZE_HANDLE_SELECTOR);
  return handle instanceof HTMLElement ? handle : null;
}

/**
 * @param {EventTarget | null} target
 * @returns {string | null}
 */
export function findRootBlockIdFromColumnResizeTarget(target) {
  const handle = findColumnResizeHandleFromEventTarget(target);
  if (!handle) return null;

  const rootBlock = handle.closest(ROOT_BLOCK_SELECTOR);
  const blockId = rootBlock?.getAttribute('data-id');
  return typeof blockId === 'string' && blockId.length > 0 ? blockId : null;
}

/**
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
export function isFirstColumnResizeHandle(target) {
  const handle = findColumnResizeHandleFromEventTarget(target);
  const cell = handle?.closest('td, th');
  return cell instanceof HTMLTableCellElement && cell.cellIndex === 0;
}

/**
 * @param {EventTarget | null} target
 * @param {string | null} blockId
 * @param {boolean} active
 * @param {import('../../../features/RenderVirtualization').RenderVirtualizationKeepAlivePort | null | undefined} keepAlivePort
 */
export function dispatchTableColumnResizeKeepAlive(target, blockId, active, keepAlivePort = null) {
  if (!blockId) return;

  applyRenderVirtualizationKeepAliveCommand({
    port: keepAlivePort,
    legacyTarget: target,
    command: {
      blockId,
      reason: 'table-column-resize',
    },
    active,
  });
}
