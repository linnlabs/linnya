import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWorkspaceListFilesPresentation } from './projectWorkspaceListFilesPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWorkspaceListFilesPresentation({
    sourceToolName: 'list_files',
    uiKey: 'list_files',
    args: {},
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectWorkspaceListFilesPresentation', () => {
  it('生命周期阶段只校验参数，不读取 success result', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: { text: { key: 'conversation.tool.workspace.files.list' } },
    });
  });

  it('生命周期阶段允许参数增量携带空 inode', () => {
    expect(project({
      args: {
        locator: 'workspace:/',
        inode: '',
        limit: 80,
        offset: 0,
        include_system_nodes: false,
      },
      phase: 'update',
      status: 'loading',
    })).toMatchObject({ data: { kind: 'lifecycle' } });
  });

  it('严格接纳成功结果并投影分页摘要', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source_kind: 'workspace_vfs',
          locator: 'workspace:/',
          entries: [],
          documents: [],
          total_count: 0,
          offset: 0,
          has_more: false,
          include_system_nodes: false,
        },
        observation: 'Files / 下没有可见条目。',
      },
    })).toMatchObject({
      data: { kind: 'snapshot', locator: 'workspace:/', totalCount: 0, hasMore: false },
    });
  });

  it('拒绝分页关系不一致的成功结果', () => {
    expect(() => project({
      status: 'success',
      result: {
        data: {
          source_kind: 'workspace_vfs',
          locator: 'workspace:/',
          entries: [],
          documents: [],
          total_count: 1,
          offset: 0,
          has_more: false,
          include_system_nodes: false,
        },
        observation: 'invalid',
      },
    })).toThrow();
  });

  it('旧 path 事件只通过 historical replay 合同恢复为 locator 展示', () => {
    expect(project({
      args: { path: '/' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          path: '/',
          entries: [],
          documents: [],
          total_count: 0,
          offset: 0,
          has_more: false,
          include_system_nodes: false,
        },
        observation: 'Files / 下没有可见条目。',
      },
    })).toMatchObject({
      data: { kind: 'snapshot', locator: 'workspace:/', totalCount: 0 },
    });
  });
});
