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

export class ProjectNotEmptyError extends Error {
  constructor(readonly projectId: string) {
    super(
      `Project is not empty: ${projectId}. Linked content must be handled by its owner before deletion.`
    );
    this.name = 'ProjectNotEmptyError';
  }
}

export class ProjectDeleteBlockedError extends Error {
  constructor(
    readonly projectId: string,
    message = `Project deletion is blocked by a database rule: ${projectId}`
  ) {
    super(message);
    this.name = 'ProjectDeleteBlockedError';
  }
}

export class DefaultProjectDeleteBlockedError extends ProjectDeleteBlockedError {
  constructor(projectId: string) {
    super(projectId, `Default project cannot be deleted: ${projectId}`);
    this.name = 'DefaultProjectDeleteBlockedError';
  }
}
