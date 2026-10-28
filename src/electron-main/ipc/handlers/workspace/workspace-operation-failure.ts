import { DefaultProjectDeleteBlockedError, ProjectNameConflictError, ProjectNotFoundError } from 'src/domains/projects';
import {
  createOperationFailure,
  createUserFacingMessage,
  type OperationFailure,
  type UserFacingMessageParams,
} from '@app/schemas';
import {
  WorkspaceDocumentLifecycleProviderMissingError,
  WorkspaceFolderDuplicateUnsupportedError,
  WorkspaceNodeMissingProjectError,
  WorkspaceNodeMoveCycleError,
  WorkspaceNodeNotFoundError,
  WorkspaceNodeParentNotFolderError,
  WorkspaceNodeParentNotFoundError,
  WorkspaceNodeParentProjectMismatchError,
  WorkspaceNodeSubtreeProjectMismatchError,
  WorkspaceNodeTransferSameProjectError,
  WorkspaceSiblingNameConflictError,
  WorkspaceSourceDocumentMissingError,
} from '../../../../features/workspace/definitions/workspaceErrors';

export type WorkspaceOperationFallbackKey =
  | 'workspace.project.operation.createFailed'
  | 'workspace.project.operation.updateFailed'
  | 'workspace.project.operation.deleteFailed'
  | 'workspace.sidebar.node.createFileFailed'
  | 'workspace.sidebar.node.createFolderFailed'
  | 'workspace.sidebar.node.deleteFailed'
  | 'workspace.sidebar.node.renameFailed'
  | 'workspace.sidebar.node.moveFailed'
  | 'workspace.sidebar.node.transferFailed'
  | 'workspace.sidebar.node.duplicateFailed'
  | 'workspace.sidebar.node.operationFailed';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  error: unknown,
  key: string,
  params?: UserFacingMessageParams,
): OperationFailure {
  const diagnostic = getErrorMessage(error);
  return createOperationFailure(
    diagnostic,
    createUserFacingMessage(key, {
      params,
      diagnostic,
    }),
  );
}

export function createWorkspaceOperationFailure(
  error: unknown,
  fallbackKey: WorkspaceOperationFallbackKey,
): OperationFailure {
  if (error instanceof ProjectNameConflictError) {
    return failure(error, 'workspace.project.operation.duplicateName', {
      projectName: error.projectName,
    });
  }

  if (error instanceof ProjectNotFoundError) {
    return failure(error, 'workspace.project.operation.projectNotFound');
  }

  if (error instanceof DefaultProjectDeleteBlockedError) {
    return failure(error, 'workspace.project.operation.defaultProjectDeleteBlocked');
  }

  if (error instanceof WorkspaceSiblingNameConflictError) {
    return failure(error, 'workspace.sidebar.node.nameConflict', {
      nodeName: error.nodeName,
    });
  }

  if (error instanceof WorkspaceNodeNotFoundError) {
    return failure(error, 'workspace.sidebar.node.notFound');
  }

  if (error instanceof WorkspaceNodeParentNotFoundError) {
    return failure(error, 'workspace.sidebar.node.parentNotFound');
  }

  if (error instanceof WorkspaceNodeParentNotFolderError) {
    return failure(error, 'workspace.sidebar.node.parentNotFolder');
  }

  if (error instanceof WorkspaceNodeParentProjectMismatchError) {
    return failure(error, 'workspace.sidebar.node.parentProjectMismatch');
  }

  if (error instanceof WorkspaceNodeMoveCycleError) {
    return failure(error, 'workspace.sidebar.node.moveCycle');
  }

  if (error instanceof WorkspaceNodeTransferSameProjectError) {
    return failure(error, 'workspace.sidebar.node.transferSameProject');
  }

  if (error instanceof WorkspaceNodeSubtreeProjectMismatchError) {
    return failure(error, 'workspace.sidebar.node.subtreeProjectMismatch');
  }

  if (error instanceof WorkspaceNodeMissingProjectError) {
    return failure(error, 'workspace.sidebar.node.missingProject');
  }

  if (error instanceof WorkspaceFolderDuplicateUnsupportedError) {
    return failure(error, 'workspace.sidebar.node.duplicateFolderUnsupported');
  }

  if (error instanceof WorkspaceDocumentLifecycleProviderMissingError) {
    return failure(error, 'workspace.sidebar.node.documentTypeUnavailable', {
      documentType: error.nodeType,
    });
  }

  if (error instanceof WorkspaceSourceDocumentMissingError) {
    return failure(error, 'workspace.sidebar.node.sourceDocumentMissing');
  }

  return failure(error, fallbackKey);
}
