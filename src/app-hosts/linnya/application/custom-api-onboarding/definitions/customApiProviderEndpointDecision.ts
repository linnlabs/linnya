import type {
  CredentialReference,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from './customApiRuntimeBinding';

export type CustomApiProviderEndpointDecision =
  /** 连接未变化且不会影响分组外模型：保留原 endpoint，必要时在原边界内替换 Key。 */
  | { readonly kind: 'keep'; readonly endpoint: InferenceEndpointView }
  /** 为分组新建 endpoint 与独立 credential。 */
  | { readonly kind: 'create_with_secret' }
  /** 为分组新建 endpoint，并沿用分组唯一且可用的现有 credential。 */
  | { readonly kind: 'create_with_credential'; readonly credential_reference: CredentialReference }
  | { readonly kind: 'credential_required' };

export interface DecideCustomApiProviderEndpointInput {
  readonly groupModelIds: ReadonlySet<string>;
  readonly groupEndpoints: readonly InferenceEndpointView[];
  readonly catalogEndpoints: readonly InferenceEndpointView[];
  readonly catalogModels: readonly Pick<ModelConfig, 'id' | 'inference_endpoint_id'>[];
  readonly otherGroupEndpointIds: ReadonlySet<string>;
  readonly binding: CustomApiRuntimeBinding;
  readonly baseUrl: string;
  readonly hasNewSecret: boolean;
}
