import { describe, expect, it } from 'vitest';
import {
  WorkspaceDefaultProjectDeleteBlockedError,
  WorkspaceNodeMoveCycleError,
  WorkspaceNodeNotFoundError,
  WorkspaceNodeTransferSameProjectError,
  WorkspaceProjectNameConflictError,
  WorkspaceSiblingNameConflictError,
} from '../../../../features/workspace/definitions/workspaceErrors';
import { createWorkspaceOperationFailure } from './workspace-operation-failure';

describe('createWorkspaceOperationFailure', () => {
  it('maps project name conflicts to a structured workspace message', () => {
    const result = createWorkspaceOperationFailure(
      new WorkspaceProjectNameConflictError('Demo'),
      'workspace.project.operation.createFailed',
    );

    expect(result.error).toBe('Project name already exists: Demo');
    expect(result.userMessage).toMatchObject({
      key: 'workspace.project.operation.duplicateName',
      params: { projectName: 'Demo' },
      diagnostic: 'Project name already exists: Demo',
    });
  });

  it('maps node conflicts without exposing backend diagnostics as the UI key', () => {
    const result = createWorkspaceOperationFailure(
      new WorkspaceSiblingNameConflictError('报告', 'project-1', null),
      'workspace.sidebar.node.renameFailed',
    );

    expect(result.error).toBe('Workspace sibling name already exists: 报告');
    expect(result.userMessage).toMatchObject({
      key: 'workspace.sidebar.node.nameConflict',
      params: { nodeName: '报告' },
    });
  });

  it('maps missing nodes and default project delete blocks', () => {
    expect(createWorkspaceOperationFailure(
      new WorkspaceNodeNotFoundError('node-1'),
      'workspace.sidebar.node.deleteFailed',
    ).userMessage?.key).toBe('workspace.sidebar.node.notFound');

    expect(createWorkspaceOperationFailure(
      new WorkspaceDefaultProjectDeleteBlockedError('project-1'),
      'workspace.project.operation.deleteFailed',
    ).userMessage?.key).toBe('workspace.project.operation.defaultProjectDeleteBlocked');
  });

  it('uses the operation fallback key for unknown errors', () => {
    const result = createWorkspaceOperationFailure(
      new Error('sqlite constraint failed'),
      'workspace.sidebar.node.createFileFailed',
    );

    expect(result.error).toBe('sqlite constraint failed');
    expect(result.userMessage?.key).toBe('workspace.sidebar.node.createFileFailed');
  });

  it('maps move invariants and cross-project transfer failures', () => {
    expect(createWorkspaceOperationFailure(
      new WorkspaceNodeMoveCycleError('folder-1', 'folder-2'),
      'workspace.sidebar.node.moveFailed',
    ).userMessage?.key).toBe('workspace.sidebar.node.moveCycle');

    expect(createWorkspaceOperationFailure(
      new WorkspaceNodeTransferSameProjectError('project-1'),
      'workspace.sidebar.node.transferFailed',
    ).userMessage?.key).toBe('workspace.sidebar.node.transferSameProject');
  });
});
