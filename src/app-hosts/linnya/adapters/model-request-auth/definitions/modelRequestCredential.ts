import type { InferenceAuthProfile } from 'src/domains/model-catalog';

export interface ModelRequestCredential {
  readonly profile: Exclude<InferenceAuthProfile, 'none'>;
  readonly secret: string;
  /** 与 credential owner 绑定的附属认证头；不包含 Provider 主认证头。 */
  readonly request_headers?: Readonly<Record<string, string>>;
}

export interface ModelRequestCredentialRequest {
  readonly model_id: string;
  readonly endpoint_id: string;
  readonly auth_profile: Exclude<InferenceAuthProfile, 'none'>;
}

export interface ModelRequestCredentialResolver {
  resolve(request: ModelRequestCredentialRequest): Promise<ModelRequestCredential>;
}

export class ModelRequestCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRequestCredentialError';
  }
}
