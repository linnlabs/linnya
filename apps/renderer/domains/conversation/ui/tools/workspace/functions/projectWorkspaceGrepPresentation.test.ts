import { describe, expect, it } from 'vitest';
import type { ToolPresentationProjectorInput } from '../../types';
import { projectWorkspaceGrepPresentation } from './projectWorkspaceGrepPresentation';

function project(overrides: Partial<ToolPresentationProjectorInput>) {
  return projectWorkspaceGrepPresentation({
    sourceToolName: 'grep',
    uiKey: 'grep',
    args: { pattern: '合同' },
    result: undefined,
    status: 'loading',
    phase: 'start',
    ...overrides,
  });
}

describe('projectWorkspaceGrepPresentation', () => {
  it('生命周期阶段从 strict args 生成延迟本地化标题', () => {
    expect(project({ result: { invalid: true } })).toMatchObject({
      data: { kind: 'lifecycle', pattern: '合同' },
      title: {
        text: {
          key: 'conversation.tool.workspace.searchWithPattern',
          params: { pattern: '合同' },
        },
      },
    });
  });

  it('生命周期参数增量允许空 pattern 与 inode', () => {
    expect(project({
      args: { pattern: '', path: '/', inode: '' },
      phase: 'update',
    })).toMatchObject({
      data: { kind: 'lifecycle', pattern: '...' },
      title: { text: { params: { pattern: '...' } } },
    });
  });

  it('严格接纳成功结果并投影命中摘要', () => {
    expect(project({
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          source_kind: 'workspace_vfs',
          pattern: '合同',
          searched_locator: 'workspace:/',
          matches: [],
          total_count: 0,
          truncated: false,
          index: { available: false },
        },
        observation: 'grep: 未找到 "合同"。',
      },
    })).toMatchObject({
      data: { kind: 'snapshot', pattern: '合同', totalCount: 0, truncated: false },
    });
  });

  it('拒绝请求与结果 pattern 不一致', () => {
    expect(() => project({
      status: 'success',
      result: {
        data: {
          source_kind: 'workspace_vfs',
          pattern: '别的关键词',
          searched_locator: 'workspace:/',
          matches: [],
          total_count: 0,
          truncated: false,
        },
        observation: 'invalid',
      },
    })).toThrow(/does not match request/);
  });

  it('旧 path grep 事件继续严格回放', () => {
    expect(project({
      args: { pattern: '合同', path: '/' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          pattern: '合同',
          searched_path: '/',
          matches: [],
          total_count: 0,
          truncated: false,
          index: { available: false },
        },
        observation: 'grep: 未找到 "合同"。',
      },
    })).toMatchObject({
      data: { kind: 'snapshot', pattern: '合同', totalCount: 0 },
    });
  });
});
