import { describe, expect, it } from 'vitest';
import type { PageSelectionNode } from '../definitions/pageSelectionAfterRemoval';
import { resolvePageSelectionAfterRemoval } from './resolvePageSelectionAfterRemoval';

function node(id: string, type = 'document'): PageSelectionNode {
  return { id, type, projectId: 'project-1', parentId: null, name: id };
}

const isPageNode = (candidate: PageSelectionNode) => candidate.type === 'document';

describe('resolvePageSelectionAfterRemoval', () => {
  it('当前 page 未被移除时保持当前 page', () => {
    expect(resolvePageSelectionAfterRemoval({
      nodesBeforeRemoval: [node('doc-1'), node('doc-2')],
      removedNodeIds: new Set(['doc-2']),
      activeDocumentId: 'doc-1',
      isPageNode,
    })).toEqual({ kind: 'preserve-active', documentId: 'doc-1' });
  });

  it('当前 page 被移除后优先选择上方最近 page', () => {
    expect(resolvePageSelectionAfterRemoval({
      nodesBeforeRemoval: [node('doc-1'), node('image-1', 'asset_image'), node('doc-2')],
      removedNodeIds: new Set(['doc-2']),
      activeDocumentId: 'doc-2',
      isPageNode,
    })).toEqual({ kind: 'select-page', documentId: 'doc-1' });
  });

  it('第一个 page 被移除时选择下方 page', () => {
    expect(resolvePageSelectionAfterRemoval({
      nodesBeforeRemoval: [node('doc-1'), node('image-1', 'asset_image'), node('doc-2')],
      removedNodeIds: new Set(['doc-1']),
      activeDocumentId: 'doc-1',
      isPageNode,
    })).toEqual({ kind: 'select-page', documentId: 'doc-2' });
  });

  it('只剩非 page 节点时进入空态', () => {
    expect(resolvePageSelectionAfterRemoval({
      nodesBeforeRemoval: [node('doc-1'), node('image-1', 'asset_image')],
      removedNodeIds: new Set(['doc-1']),
      activeDocumentId: 'doc-1',
      isPageNode,
    })).toEqual({ kind: 'empty' });
  });
});
