export class QuotaIdRequiredError extends Error {
  constructor(readonly operation: string) {
    super(`Quota id is required: ${operation}`);
    this.name = 'QuotaIdRequiredError';
  }
}

export class QuotaPolicyNotFoundError extends Error {
  constructor(readonly quotaId: string) {
    super(`Quota policy not found: ${quotaId}`);
    this.name = 'QuotaPolicyNotFoundError';
  }
}
