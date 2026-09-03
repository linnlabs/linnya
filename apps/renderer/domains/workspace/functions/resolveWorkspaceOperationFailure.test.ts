import { describe, expect, it } from 'vitest';
import { resolveWorkspaceOperationFailure } from './resolveWorkspaceOperationFailure';
import type { WorkspaceMessageResolver } from '../definitions/workspaceMessages';

const workspaceMessage: WorkspaceMessageResolver = (key, params) => {
  if (key === 'workspace.project.operation.duplicateName') {
    return `项目名称 "${String(params?.projectName)}" 已存在，请换一个名称`;
  }
  if (key === 'workspace.project.operation.createFailed') {
    return '创建项目失败';
  }
  if (key === 'workspace.sidebar.node.nameConflict') {
    return `同一文件夹下已存在名为 "${String(params?.nodeName)}" 的项目`;
  }
  if (key === 'workspace.sidebar.node.renameFailed') {
    return '重命名失败';
  }
  return key;
};

describe('resolveWorkspaceOperationFailure', () => {
  it('uses a structured user-facing message before the legacy error string', () => {
    expect(resolveWorkspaceOperationFailure({
      error: 'Project name already exists: Demo',
      userMessage: {
        key: 'workspace.project.operation.duplicateName',
        params: { projectName: 'Demo' },
        fallback: 'Project already exists',
      },
    }, workspaceMessage, 'workspace.project.operation.createFailed')).toBe(
      '项目名称 "Demo" 已存在，请换一个名称',
    );
  });

  it('falls back to the operation message when the key is outside workspace catalog', () => {
    expect(resolveWorkspaceOperationFailure({
      error: 'Internal backend detail',
      userMessage: {
        key: 'knowledgeBase.settings.error.saveFailed',
        fallback: 'Save failed',
      },
    }, workspaceMessage, 'workspace.project.operation.createFailed')).toBe('创建项目失败');
  });

  it('resolves structured node operation failures from the workspace catalog', () => {
    expect(resolveWorkspaceOperationFailure({
      error: 'Workspace sibling name already exists: 报告',
      userMessage: {
        key: 'workspace.sidebar.node.nameConflict',
        params: { nodeName: '报告' },
        diagnostic: 'Workspace sibling name already exists: 报告',
      },
    }, workspaceMessage, 'workspace.sidebar.node.renameFailed')).toBe(
      '同一文件夹下已存在名为 "报告" 的项目',
    );
  });
});
