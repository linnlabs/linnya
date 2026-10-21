import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import {
  projectWorkspaceWriteFilePresentation,
  projectWorkspaceWriteFileCompactStep,
} from './projectWorkspaceWriteFilePresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWorkspaceWriteFilePresentation({
    sourceToolName: 'write_file',
    uiKey: 'write_file',
    args: { locator: 'workspace:/draft.md', content: '# Draft' },
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
      operation: 'update',
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
      diagnostics: [
        {
          severity: 'warning',
          code: 'DOCUMENT_CHECK',
          message: '需要复核',
        },
      ],
      diagnosticsTruncatedCount: 2,
    },
    observation: '已写入文件。',
  };
}

describe('projectWorkspaceWriteFilePresentation', () => {
  it('参数尚未到达时投影为正在创建文件的占位卡', () => {
    expect(project({ args: {} })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: {
        text: { key: 'conversation.tool.workspace.file.createLoading' },
      },
    });
  });

  it('生命周期阶段只校验参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle', target: 'draft' },
      title: {
        text: {
          key: 'conversation.tool.workspace.file.writeTarget',
          params: { target: 'draft' },
        },
      },
    });
  });

  it('生命周期参数增量允许空 inode', () => {
    expect(
      project({
        args: { path: '/draft.md', inode: '', content: '# Draft' },
        phase: 'update',
      })
    ).toMatchObject({ data: { kind: 'lifecycle', target: 'draft' } });
  });

  it('成功阶段严格接纳公共写入事实并生成文档链接', () => {
    const result = successfulResult();
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: { ...result, data: { ...result.data, text_metrics: { characters: 100, han_characters: 60 } } },
      })
    ).toMatchObject({
      data: {
        kind: 'snapshot',
        locator: 'workspace:/docs/final.md',
        operation: 'update',
        diagnosticCount: 3,
      },
      title: {
        text: { params: { target: 'final' } },
      },
    });
  });

  it('创建文件时在 header 中展示延迟本地化的新建标签', () => {
    const result = successfulResult();
    expect(
      project({
        status: 'success',
        phase: 'complete',
        result: {
          ...result,
          data: { ...result.data, operation: 'create' },
        },
      })
    ).toMatchObject({
      title: {
        tag: {
          text: { key: 'conversation.tool.workspace.document.createdTag' },
          variant: 'success',
        },
      },
    });
  });

  it('新增目录在实时/历史成功投影和紧凑轨迹中可见，旧回执不虚构目录', () => {
    const result = successfulResult();
    const created = {
      ...result,
      data: {
        ...result.data,
        operation: 'create',
        created_folders: [{ locator: 'workspace:/docs', inode: 'workspace:folder-1' }],
      },
    };
    const input = {
      sourceToolName: 'write_file',
      uiKey: 'write_file',
      toolCallId: 'create-folders',
      args: { locator: 'workspace:/docs/final.md', content: 'report' },
      result: created,
      status: 'success' as const,
      phase: 'complete' as const,
    };
    expect(project(input)).toMatchObject({
      data: { createdFolders: created.data.created_folders },
      title: {
        tag: {
          text: {
            key: 'conversation.tool.workspace.document.createdWithFoldersTag',
            params: { count: 1 },
          },
        },
      },
    });
    expect(projectWorkspaceWriteFileCompactStep(input)).toMatchObject({
      title: { key: 'conversation.tool.workspace.compact.writeWithFolders', params: { count: 1 } },
    });
    expect(project({ status: 'success', result })).toMatchObject({ data: { createdFolders: [] } });
    expect(() =>
      projectWorkspaceWriteFileCompactStep({
        ...input,
        result: { ...created, data: { ...created.data, created_folders: ['invalid'] } },
      })
    ).toThrow();
    expect(
      projectWorkspaceWriteFileCompactStep({
        ...input,
        status: 'error',
        phase: 'error',
        result: undefined,
      })
    ).toMatchObject({ title: { key: 'conversation.tool.workspace.compact.write' } });
  });

  it('拒绝插件私有详情或 Markdown edits 穿透公共结果', () => {
    const result = successfulResult();
    for (const extra of [{ presentationId: 'deck-1' }, { versionId: 'version-1' }, { edits: [] }]) {
      expect(() =>
        project({
          status: 'success',
          result: {
            ...result,
            data: { ...result.data, ...extra },
          },
        })
      ).toThrow();
    }
  });

  it('旧 path 写入事件按冻结合同回放，但投影统一输出 locator', () => {
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

    expect(
      project({
        args: { path: '/draft.md', content: '# Draft' },
        status: 'success',
        phase: 'complete',
        result: historical,
      })
    ).toMatchObject({
      data: { kind: 'snapshot', locator: 'workspace:/docs/final.md' },
    });
    expect(
      projectWorkspaceWriteFileCompactStep({
        sourceToolName: 'write_file',
        uiKey: 'write_file',
        toolCallId: 'historical-write',
        args: { path: '/draft.md', content: '# Draft' },
        status: 'success',
        phase: 'complete',
        result: historical,
      })
    ).toMatchObject({ title: { key: 'conversation.tool.workspace.compact.write' } });
  });
});
