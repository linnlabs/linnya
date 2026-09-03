export class WorkspaceProjectNameConflictError extends Error {
  constructor(readonly projectName: string) {
    super(`Project name already exists: ${projectName}`);
    this.name = 'WorkspaceProjectNameConflictError';
  }
}

export class WorkspaceProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Workspace project not found: ${projectId}`);
    this.name = 'WorkspaceProjectNotFoundError';
  }
}

export class WorkspaceDefaultProjectDeleteBlockedError extends Error {
  constructor(readonly projectId: string) {
    super(`Default workspace project cannot be deleted: ${projectId}`);
    this.name = 'WorkspaceDefaultProjectDeleteBlockedError';
  }
}

export class WorkspaceSiblingNameConflictError extends Error {
  constructor(
    readonly nodeName: string,
    readonly projectId: string | null,
    readonly parentId: string | null,
  ) {
    super(`Workspace sibling name already exists: ${nodeName}`);
    this.name = 'WorkspaceSiblingNameConflictError';
  }
}

export class WorkspaceNodeNotFoundError extends Error {
  constructor(readonly nodeId: string) {
    super(`Workspace node not found or deleted: ${nodeId}`);
    this.name = 'WorkspaceNodeNotFoundError';
  }
}

export class WorkspaceNodeParentNotFoundError extends Error {
  constructor(readonly parentId: string) {
    super(`Workspace node parent not found or deleted: ${parentId}`);
    this.name = 'WorkspaceNodeParentNotFoundError';
  }
}

export class WorkspaceNodeParentNotFolderError extends Error {
  constructor(readonly parentId: string) {
    super(`Workspace node parent is not a folder: ${parentId}`);
    this.name = 'WorkspaceNodeParentNotFolderError';
  }
}

export class WorkspaceNodeParentProjectMismatchError extends Error {
  constructor(readonly parentId: string) {
    super(`Workspace node parent belongs to another project: ${parentId}`);
    this.name = 'WorkspaceNodeParentProjectMismatchError';
  }
}

export class WorkspaceNodeMoveCycleError extends Error {
  constructor(readonly nodeId: string, readonly parentId: string) {
    super(`Workspace node cannot move into itself or its descendant: ${nodeId} -> ${parentId}`);
    this.name = 'WorkspaceNodeMoveCycleError';
  }
}

export class WorkspaceNodeTransferSameProjectError extends Error {
  constructor(readonly projectId: string) {
    super(`Workspace node is already in target project: ${projectId}`);
    this.name = 'WorkspaceNodeTransferSameProjectError';
  }
}

export class WorkspaceNodeSubtreeProjectMismatchError extends Error {
  constructor(readonly nodeId: string) {
    super(`Workspace node subtree crosses project boundaries: ${nodeId}`);
    this.name = 'WorkspaceNodeSubtreeProjectMismatchError';
  }
}

export class WorkspaceNodeMissingProjectError extends Error {
  constructor(readonly nodeId: string) {
    super(`Workspace node is missing project id: ${nodeId}`);
    this.name = 'WorkspaceNodeMissingProjectError';
  }
}

export class WorkspaceFolderDuplicateUnsupportedError extends Error {
  constructor(readonly nodeId: string) {
    super(`Workspace folder duplicate is unsupported: ${nodeId}`);
    this.name = 'WorkspaceFolderDuplicateUnsupportedError';
  }
}

export class WorkspaceDocumentLifecycleProviderMissingError extends Error {
  constructor(
    readonly nodeType: string,
    readonly operation: 'create' | 'duplicate',
  ) {
    super(`Workspace document lifecycle provider missing: ${operation}; nodeType=${nodeType}`);
    this.name = 'WorkspaceDocumentLifecycleProviderMissingError';
  }
}

export class WorkspaceSourceDocumentMissingError extends Error {
  constructor(readonly nodeId: string) {
    super(`Workspace source document missing: ${nodeId}`);
    this.name = 'WorkspaceSourceDocumentMissingError';
  }
}
