export class TodoUpdateFieldNotAllowedError extends Error {
  constructor(readonly field: string) {
    super(`Todo update field is not allowed: ${field}`);
    this.name = 'TodoUpdateFieldNotAllowedError';
  }
}

export class TodoUpdatePayloadInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TodoUpdatePayloadInvalidError';
  }
}
