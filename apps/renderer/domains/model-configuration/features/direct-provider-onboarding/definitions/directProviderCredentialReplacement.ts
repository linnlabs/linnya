import type { DirectProviderCredentialReplacementCommand } from '@app/schemas/provider-onboarding';

export type DirectProviderCredentialReplacementResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issue: 'api_key_required' };

export interface DirectProviderCredentialGateway {
  replaceCredential(command: DirectProviderCredentialReplacementCommand): Promise<void>;
}
