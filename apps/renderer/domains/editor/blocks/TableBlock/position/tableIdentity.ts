import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface ResolvedTableIdentity {
  node: ProseMirrorNode;
  pos: number;
  rootBlockId: string | null;
}

export interface TableInfoSnapshot {
  node?: ProseMirrorNode | null;
  pos: number;
  rootBlockId?: string | null;
}

function readRootBlockId(node: ProseMirrorNode): string | null {
  if (node.type.name !== 'rootBlock') return null;

  const id = node.attrs.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function findRootBlockIdAtPos(doc: ProseMirrorNode, pos: number): string | null {
  if (!Number.isFinite(pos) || pos < 0 || pos > doc.content.size) return null;

  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const blockId = readRootBlockId($pos.node(depth));
    if (blockId) return blockId;
  }

  return null;
}

export function findTableIdentityAtPosition(
  doc: ProseMirrorNode,
  tablePos: number
): ResolvedTableIdentity | null {
  if (!Number.isFinite(tablePos) || tablePos < 0 || tablePos >= doc.content.size) return null;

  const node = doc.nodeAt(tablePos);
  if (!node || node.type.name !== 'table') return null;

  return {
    node,
    pos: tablePos,
    rootBlockId: findRootBlockIdAtPos(doc, tablePos),
  };
}

export function findTableIdentityByRootBlockId(
  doc: ProseMirrorNode,
  rootBlockId: string | null | undefined
): ResolvedTableIdentity | null {
  if (!rootBlockId) return null;

  let found: ResolvedTableIdentity | null = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock') return true;
    if (readRootBlockId(node) !== rootBlockId) return true;

    node.descendants((child, relativePos) => {
      if (found) return false;
      if (child.type.name !== 'table') return true;

      // ProseMirror 子节点相对位置从父节点 content 起点开始，绝对位置需补上 rootBlock 的 opening token。
      found = {
        node: child,
        pos: pos + 1 + relativePos,
        rootBlockId,
      };
      return false;
    });

    return false;
  });

  return found;
}

/**
 * 刷新保存的 tableInfo 快照。
 *
 * 中文说明：
 * - `tablePos` 会随着表格前面的文档改动漂移，不能长期当作身份；
 * - rootBlock id 是块级稳定身份，优先用它在最新 doc 中重新定位 table；
 * - 没有 rootBlockId 的旧上下文继续走 pos 校验，保持兼容。
 */
export function refreshTableInfoSnapshot<T extends TableInfoSnapshot>(
  doc: ProseMirrorNode,
  tableInfo: T
): (T & ResolvedTableIdentity) | null {
  const resolved =
    findTableIdentityByRootBlockId(doc, tableInfo.rootBlockId) ||
    findTableIdentityAtPosition(doc, tableInfo.pos);

  if (!resolved) return null;

  return {
    ...tableInfo,
    node: resolved.node,
    pos: resolved.pos,
    rootBlockId: resolved.rootBlockId,
  };
}
