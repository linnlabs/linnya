import { describe, expect, it } from 'vitest';
import type { WorkspaceNode } from '@/domains/workspace/store';
import { WORKSPACE_MESSAGE_FALLBACKS } from '@/domains/workspace/definitions/workspaceMessageCatalog';
import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';
import {
  buildProjectOverviewStats,
  collectProjectDocumentNodes,
  countProjectFolders,
} from '../projectOverviewStats';

const node = (params: {
  id: string;
  type: WorkspaceNode['type'];
  children?: WorkspaceNode[];
}): WorkspaceNode => ({
  id: params.id,
  name: params.id,
  type: params.type,
  projectId: 'project-1',
  parentId: null,
  children: params.children ?? [],
  isExpanded: true,
  depth: 0,
});

const workspaceMessage: WorkspaceMessageResolver = (key) => WORKSPACE_MESSAGE_FALLBACKS[key];
const documentNodeTypes = new Set(['document', 'mindmap', 'sheet', 'presentation']);

describe('projectOverviewStats', () => {
  it('collects project document-like nodes from a nested workspace tree', () => {
    const tree = [
      node({
        id: 'folder-a',
        type: 'folder',
        children: [
          node({ id: 'doc-1', type: 'document' }),
          node({ id: 'mindmap-1', type: 'mindmap' }),
          node({ id: 'asset-1', type: 'asset_image' }),
        ],
      }),
      node({ id: 'sheet-1', type: 'sheet' }),
      node({ id: 'slides-1', type: 'presentation' }),
    ];

    expect(collectProjectDocumentNodes(tree, documentNodeTypes).map((item) => item.id)).toEqual([
      'doc-1',
      'mindmap-1',
      'sheet-1',
      'slides-1',
    ]);
  });

  it('uses the supplied registry-derived document node types', () => {
    const tree = [
      node({ id: 'doc-1', type: 'document' }),
      node({ id: 'whiteboard-1', type: 'whiteboard' }),
      node({ id: 'asset-1', type: 'asset_file' }),
    ];

    expect(
      collectProjectDocumentNodes(tree, new Set(['document', 'whiteboard'])).map((item) => item.id),
    ).toEqual(['doc-1', 'whiteboard-1']);
  });

  it('counts nested folders only', () => {
    const tree = [
      node({
        id: 'folder-a',
        type: 'folder',
        children: [
          node({ id: 'folder-b', type: 'folder' }),
          node({ id: 'doc-1', type: 'document' }),
        ],
      }),
      node({ id: 'asset-1', type: 'asset_file' }),
    ];

    expect(countProjectFolders(tree)).toBe(2);
  });

  it('builds stable overview stats labels', () => {
    expect(buildProjectOverviewStats({
      documentCount: 4,
      folderCount: 2,
      charCount: null,
      workspaceMessage,
    })).toEqual([
      { label: '页面', value: 4, hint: '包含文档、思维导图、表格与演示文稿' },
      { label: '文件夹', value: 2, hint: '' },
      { label: '字符数', value: '—', hint: '统计中' },
    ]);
  });
});
