import type { ProviderAccountAuthorizationErrorCode } from '@app/schemas/provider-account';

export class ProviderAccountAuthorizationError extends Error {
  readonly code:
    | ProviderAccountAuthorizationErrorCode
    | 'provider_account.request_failed'
    | 'provider_account.unsupported_connection';

  constructor(code: ProviderAccountAuthorizationError['code'], message: string) {
    super(message);
    this.name = 'ProviderAccountAuthorizationError';
    this.code = code;
  }
}
