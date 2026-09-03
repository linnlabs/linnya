import type { ProviderAccountAuthorizationErrorCode } from '@app/schemas/provider-account';

export class ProviderAccountAuthorizationError extends Error {
  constructor(
    readonly code: ProviderAccountAuthorizationErrorCode,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'ProviderAccountAuthorizationError';
  }
}
