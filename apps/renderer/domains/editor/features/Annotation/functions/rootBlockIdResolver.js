/**
 * rootBlockIdResolver.js
 *
 * 批注只能挂在 rootBlock 上。
 *
 * 历史数据和部分外部入口可能传入内容块 ID（例如 paragraph/baseBlock 的 UUID）。
 * 小文档里内容 DOM 常驻时，这类错误偶尔还能靠当前 editor owner 的 DOM 查找；
 * 大文档 placeholder 虚拟化后，内容 DOM 会被卸载，批注定位必须先归一化为
 * `.root-block-outer[data-id]` 对应的 rootBlock ID。
 * 禁止全局查询 document；同屏 pane 或未来多 Editor 可能存在重复的块 ID。
 */

import { getBlockPosIndex } from '../../../extensions/position/blockPosIndex';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function escapeCssAttributeValue(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function findRootBlockIdForNodeId(doc, nodeId) {
  let foundRootBlockId = null;

  doc.descendants((node, pos) => {
    if (foundRootBlockId) return false;
    if (node?.attrs?.id !== nodeId) return true;

    if (node.type?.name === 'rootBlock') {
      foundRootBlockId = node.attrs.id;
      return false;
    }

    const resolved = doc.resolve(pos);
    for (let depth = resolved.depth; depth >= 0; depth -= 1) {
      const parent = resolved.node(depth);
      const parentId = parent?.attrs?.id;
      if (parent?.type?.name === 'rootBlock' && isNonEmptyString(parentId)) {
        foundRootBlockId = parentId;
        return false;
      }
    }

    return false;
  });

  return foundRootBlockId;
}

export function resolveAnnotationRootBlockId(editor, blockId) {
  if (!isNonEmptyString(blockId)) return null;

  const doc = editor?.state?.doc;
  if (doc) {
    const rootBlockIndex = getBlockPosIndex(doc);
    if (rootBlockIndex.has(blockId)) return blockId;

    const resolvedFromDoc = findRootBlockIdForNodeId(doc, blockId);
    if (resolvedFromDoc) return resolvedFromDoc;
  }

  const editorRoot = editor?.view?.dom;
  if (!(editorRoot instanceof Element)) return blockId;

  const escaped = escapeCssAttributeValue(blockId);
  const exactRootBlock = editorRoot.querySelector(`.root-block-outer[data-id="${escaped}"]`);
  if (exactRootBlock) return blockId;

  const elementWithId = editorRoot.querySelector(`[data-id="${escaped}"]`);
  const outer = elementWithId?.closest?.('.root-block-outer[data-id]');
  const outerBlockId = outer?.getAttribute?.('data-id');
  return isNonEmptyString(outerBlockId) ? outerBlockId : blockId;
}

export function resolveAnnotationRootBlockIdFromEvent(editor, event, fallbackBlockId) {
  const eventTarget = event?.currentTarget instanceof Element
    ? event.currentTarget
    : event?.target instanceof Element
      ? event.target
      : null;
  const outer = eventTarget?.closest?.('.root-block-outer[data-id]');
  const domBlockId = outer?.getAttribute?.('data-id');
  return resolveAnnotationRootBlockId(editor, domBlockId || fallbackBlockId);
}
