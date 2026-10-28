export class ProjectNameConflictError extends Error {
  constructor(readonly projectName: string) {
    super(`Project name already exists: ${projectName}`);
    this.name = 'ProjectNameConflictError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class DefaultProjectDeleteBlockedError extends Error {
  constructor(readonly projectId: string) {
    super(`Default project cannot be deleted: ${projectId}`);
    this.name = 'DefaultProjectDeleteBlockedError';
  }
}
