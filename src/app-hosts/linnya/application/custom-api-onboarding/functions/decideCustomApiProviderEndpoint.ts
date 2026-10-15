import type {
  CredentialReference,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

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
  readonly catalogModels: readonly Pick<ModelConfig, 'id' | 'inference_endpoint_id'>[];
  readonly binding: CustomApiRuntimeBinding;
  readonly baseUrl: string;
  readonly hasNewSecret: boolean;
}

function isCredentialUsable(endpoint: InferenceEndpointView): boolean {
  return (
    endpoint.credential_status === 'configured' || endpoint.credential_status === 'not_required'
  );
}

/**
 * 决定一次分组连接编辑落到哪个 endpoint。
 *
 * 编辑只能影响该分组的模型：被其他模型共享的 endpoint 不在原位改 Key；地址或格式变化总是新建
 * endpoint，旧 endpoint 在没有引用后由 Model Catalog 同事务清理。
 */
export function decideCustomApiProviderEndpoint(
  input: DecideCustomApiProviderEndpointInput
): CustomApiProviderEndpointDecision {
  const [onlyEndpoint] = input.groupEndpoints;
  const connectionUnchanged =
    input.groupEndpoints.length === 1 &&
    onlyEndpoint !== undefined &&
    onlyEndpoint.route_profile_id === input.binding.route_profile_id &&
    onlyEndpoint.base_url === input.baseUrl &&
    onlyEndpoint.auth_profile === input.binding.auth_profile;

  if (connectionUnchanged) {
    const endpointExclusive = input.catalogModels.every(
      model => model.inference_endpoint_id !== onlyEndpoint.id || input.groupModelIds.has(model.id)
    );
    if (input.hasNewSecret && endpointExclusive) return { kind: 'keep', endpoint: onlyEndpoint };
    if (!input.hasNewSecret) {
      return isCredentialUsable(onlyEndpoint)
        ? { kind: 'keep', endpoint: onlyEndpoint }
        : { kind: 'credential_required' };
    }
  }

  if (input.hasNewSecret) return { kind: 'create_with_secret' };

  const firstReference = onlyEndpoint?.credential_reference;
  const sharesOneUsableCredential =
    firstReference?.kind === 'stored_secret' &&
    input.groupEndpoints.every(
      endpoint =>
        endpoint.credential_reference.kind === 'stored_secret' &&
        endpoint.credential_reference.credential_id === firstReference.credential_id &&
        isCredentialUsable(endpoint)
    );
  return sharesOneUsableCredential
    ? { kind: 'create_with_credential', credential_reference: firstReference }
    : { kind: 'credential_required' };
}
