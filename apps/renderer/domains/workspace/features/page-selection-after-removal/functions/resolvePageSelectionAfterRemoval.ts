import type {
  PageSelectionAfterRemovalDecision,
  PageSelectionNode,
} from '../definitions/pageSelectionAfterRemoval';

interface ResolvePageSelectionAfterRemovalInput {
  readonly nodesBeforeRemoval: readonly PageSelectionNode[];
  readonly removedNodeIds: ReadonlySet<string>;
  readonly activeDocumentId: string | null;
  readonly isPageNode: (node: PageSelectionNode) => boolean;
}

/**
 * 计算节点离开当前项目后的 page 继任者。
 *
 * 中文说明：删除和跨项目移动对来源项目都是同一种“移除”。顺序采用移除前文件树的
 * 深度优先顺序；当前 page 未被移除时保持不变，否则优先上方、再下方。
 */
export function resolvePageSelectionAfterRemoval(
  input: ResolvePageSelectionAfterRemovalInput,
): PageSelectionAfterRemovalDecision {
  const { nodesBeforeRemoval, removedNodeIds, activeDocumentId, isPageNode } = input;

  if (activeDocumentId && !removedNodeIds.has(activeDocumentId)) {
    return { kind: 'preserve-active', documentId: activeDocumentId };
  }

  const anchorIndex = activeDocumentId
    ? nodesBeforeRemoval.findIndex((node) => node.id === activeDocumentId)
    : nodesBeforeRemoval.findIndex((node) => removedNodeIds.has(node.id));

  if (anchorIndex >= 0) {
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const node = nodesBeforeRemoval[index];
      if (!node || removedNodeIds.has(node.id) || !isPageNode(node)) continue;
      return { kind: 'select-page', documentId: node.id };
    }

    for (let index = anchorIndex + 1; index < nodesBeforeRemoval.length; index += 1) {
      const node = nodesBeforeRemoval[index];
      if (!node || removedNodeIds.has(node.id) || !isPageNode(node)) continue;
      return { kind: 'select-page', documentId: node.id };
    }
  }

  const firstPage = nodesBeforeRemoval.find((node) => (
    !removedNodeIds.has(node.id) && isPageNode(node)
  ));
  return firstPage
    ? { kind: 'select-page', documentId: firstPage.id }
    : { kind: 'empty' };
}
