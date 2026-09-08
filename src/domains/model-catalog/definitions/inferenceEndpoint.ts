import type {
  InferenceAuthProfile,
  LanguageInferenceRouteProfileId,
} from '@app/schemas/model-inference';
import type { CredentialProtectionErrorCode } from 'src/shared/credential-protection';

export type EndpointCredentialStatus = 'available' | CredentialProtectionErrorCode;

export type CredentialReference =
  | { readonly kind: 'none' }
  | { readonly kind: 'environment_variable'; readonly environment_variable: string }
  | { readonly kind: 'stored_secret'; readonly credential_id: string }
  | { readonly kind: 'provider_account'; readonly account_id: string }
  | { readonly kind: 'host_managed'; readonly credential_id: 'linnya-cloud' };

export interface InferenceEndpoint {
  readonly id: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
  readonly endpoint_id: string;
  readonly base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly credential_reference: CredentialReference;
}

export interface InferenceEndpointView extends InferenceEndpoint {
  readonly credential_status: 'not_required' | 'configured' | 'missing' | 'unavailable';
}

export interface NewInferenceEndpoint {
  readonly id: string;
  readonly route_profile_id: LanguageInferenceRouteProfileId;
  readonly endpoint_id: string;
  readonly base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly credential_reference?: CredentialReference;
  readonly credential_secret?: string;
}

export type InferenceEndpointSelection =
  | {
      readonly kind: 'existing';
      readonly inference_endpoint_id: string;
      /** 正式 Provider 再次提交 Key 时，在同一 credential boundary 内替换 secret。 */
      readonly credential_secret?: string;
    }
  | { readonly kind: 'create'; readonly endpoint: NewInferenceEndpoint };

export interface EndpointCredentialCodec {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class EndpointCredentialUnavailableError extends Error {
  readonly code: Exclude<EndpointCredentialStatus, 'available'>;

  constructor(code: Exclude<EndpointCredentialStatus, 'available'>) {
    super(`endpoint credential 当前不可用: ${code}`);
    this.name = 'EndpointCredentialUnavailableError';
    this.code = code;
  }
}
