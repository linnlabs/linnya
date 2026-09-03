export class LocalCommandExecutionOwnerError extends Error {
  constructor(
    message: string,
    readonly causes: readonly unknown[],
  ) {
    super(message);
    this.name = 'LocalCommandExecutionOwnerError';
  }
}
