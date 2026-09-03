import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWorkspaceEditFilePresentation } from './projectWorkspaceEditFilePresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWorkspaceEditFilePresentation({
    sourceToolName: 'edit_file',
    uiKey: 'edit_file',
    args: {
      locator: 'workspace:/draft.md',
      old_string: 'before',
      new_string: 'after',
    },
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
      documentId: 'doc-1',
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
      replaced: 2,
      diagnostics: [
        {
          severity: 'info',
          code: 'DOCUMENT_CHECK',
          message: '已复核',
        },
      ],
    },
    observation: '已编辑文件。',
  };
}

describe('projectWorkspaceEditFilePresentation', () => {
  it('参数尚未到达时投影为正在编辑文件的占位卡', () => {
    expect(project({ args: {} })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: {
        text: { key: 'conversation.tool.workspace.file.editLoading' },
      },
    });
  });

  it('生命周期阶段只校验参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle', target: 'draft' },
      title: {
        text: {
          key: 'conversation.tool.workspace.file.editTarget',
          params: { target: 'draft' },
        },
      },
    });
  });

  it('生命周期参数增量允许空 inode', () => {
    expect(project({
      args: { path: '/draft.md', inode: '', old_string: 'before', new_string: 'after' },
      phase: 'update',
    })).toMatchObject({ data: { kind: 'lifecycle', target: 'draft' } });
  });

  it('成功阶段严格接纳替换事实并生成文档标题', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: successfulResult(),
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        locator: 'workspace:/docs/final.md',
        replaced: 2,
        diagnosticCount: 1,
      },
      title: {
        text: {
          key: 'conversation.tool.workspace.file.editTarget',
          params: { target: 'final' },
        },
      },
    });
  });

  it('拒绝插件私有详情或 Markdown edits 穿透公共结果', () => {
    const result = successfulResult();
    for (const extra of [
      { presentationId: 'deck-1' },
      { versionId: 'version-1' },
      { edits: [] },
    ]) {
      expect(() => project({
        status: 'success',
        result: {
          ...result,
          data: { ...result.data, ...extra },
        },
      })).toThrow();
    }
  });

  it('旧 path 编辑事件按冻结合同回放，但投影统一输出 locator', () => {
    const live = successfulResult();
    const historical = {
      ...live,
      data: {
        ...live.data,
        source_kind: undefined,
        locator: undefined,
        path: '/docs/final.md',
        node: {
          ...live.data.node,
          locator: undefined,
          path: '/docs/final.md',
        },
      },
    };
    delete historical.data.source_kind;
    delete historical.data.locator;
    delete historical.data.node.locator;

    expect(project({
      args: {
        path: '/draft.md',
        old_string: 'before',
        new_string: 'after',
      },
      status: 'success',
      phase: 'complete',
      result: historical,
    })).toMatchObject({
      data: { kind: 'snapshot', locator: 'workspace:/docs/final.md' },
    });
  });
});
