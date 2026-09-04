import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWorkspaceReadFilePresentation } from './projectWorkspaceReadFilePresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWorkspaceReadFilePresentation({
    sourceToolName: 'read_file',
    uiKey: 'workspace_read_file',
    args: { locator: 'workspace:/draft.md' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

function successfulResult() {
  return {
    data: {
      source_kind: 'workspace_vfs',
      locator: 'workspace:/docs/final.md',
      inode: 'workspace:doc-1',
      content_type: 'text/markdown',
      node: {
        name: 'final.md',
        locator: 'workspace:/docs/final.md',
        inode: 'workspace:doc-1',
        type: 'document',
        source: 'workspace_node',
        is_virtual: false,
        parent_id: 'folder-1',
        updated_at: 1,
      },
      offset: 1,
      limit: 2_000,
      line_count: 1,
      total_line_count: 1,
      has_more: false,
    },
    observation: 'content',
  };
}

function successfulDocumentData() {
  return {
    documentId: 'workspace-document-1',
    docType: 'markdown',
    documentName: 'Architecture.md',
    truncatedByChars: false,
    totalTextLength: 8,
    nextOffset: null,
    presentation: {
      kind: 'blocks' as const,
      viewMode: 'preview' as const,
      viewLabel: '预览',
      items: [{ id: 'block-1', ordinal: 1, text: '正文' }],
    },
  };
}

describe('projectWorkspaceReadFilePresentation', () => {
  it('生命周期阶段只校验参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle', target: 'draft' },
      title: {
        text: {
          key: 'conversation.tool.workspace.file.readTarget',
          params: { target: 'draft' },
        },
      },
    });
  });

  it('生命周期快照允许 provider 同时传入空 inode，但 success 仍使用正式参数合同', () => {
    expect(project({ args: { locator: 'workspace:/draft.md', inode: '' } })).toMatchObject({
      data: { kind: 'lifecycle', target: 'draft' },
    });
    expect(project({
      args: { locator: 'workspace:/draft.md', inode: '' },
      status: 'error',
      phase: 'error',
    })).toMatchObject({
      data: { kind: 'lifecycle', target: 'draft' },
    });
    expect(() => project({
      args: { locator: 'workspace:/draft.md', inode: '' },
      status: 'success',
      phase: 'complete',
      result: successfulResult(),
    })).toThrow();
  });

  it('成功阶段严格接纳正式结果并生成读取摘要', () => {
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: successfulResult(),
      })
    ).toMatchObject({
      data: {
        kind: 'snapshot',
        locator: 'workspace:/docs/final.md',
        contentType: 'text/markdown',
        hasMore: false,
      },
      title: {
        text: { params: { target: 'final' } },
      },
    });
  });

  it('结构化 read_file 结果复用 DocumentView 展示数据', () => {
    expect(project({
      args: { locator: 'workspace:/docs/final.md', view: 'document' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source_kind: 'workspace_document',
          locator: 'workspace:/docs/final.md',
          inode: 'workspace:doc-1',
          content_type: 'application/vnd.linnya.document-view',
          document: {
            ...successfulDocumentData(),
          },
        },
        observation: '[#block-1] 正文',
      },
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        document: {
          documentName: 'Architecture.md',
          presentation: { kind: 'blocks' },
        },
      },
    });
  });

  it('拒绝在 read_file 正式结果中重新开放 metadata', () => {
    const result = successfulResult();
    expect(() =>
      project({
        status: 'success',
        result: {
          ...result,
          data: {
            ...result.data,
            metadata: { arbitrary: true },
          },
        },
      })
    ).toThrow();
  });

});
