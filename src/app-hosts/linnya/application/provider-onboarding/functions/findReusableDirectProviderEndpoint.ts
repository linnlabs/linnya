import type { InferenceEndpointView } from 'src/domains/model-catalog';
import type { ResolvedProviderOnboardingModelRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';

export type ReusableProviderCredentialPolicy =
  | {
      readonly kind: 'stored_secret';
      readonly credential_id?: string;
      readonly allow_missing: boolean;
    }
  | { readonly kind: 'provider_account'; readonly account_id: string };

/**
 * 只复用同一正式 Provider binding 创建且凭据可用的 endpoint。
 * 相同 URL 的自定义 API 不会因为地址碰巧一致而被吞并为正式 Provider 配置。
 */
export function findReusableDirectProviderEndpoint(
  endpoints: readonly InferenceEndpointView[],
  binding: ResolvedProviderOnboardingModelRuntimeBinding,
  credentialPolicy: ReusableProviderCredentialPolicy
): InferenceEndpointView | undefined {
  return endpoints.find(
    endpoint =>
      endpoint.route_profile_id === binding.route_profile_id &&
      (endpoint.endpoint_id === binding.endpoint_id ||
        endpoint.endpoint_id.startsWith(`${binding.endpoint_id}:`)) &&
      endpoint.base_url === binding.base_url &&
      endpoint.auth_profile === binding.auth_profile &&
      (credentialPolicy.kind === 'stored_secret'
        ? endpoint.credential_reference.kind === 'stored_secret' &&
          (!credentialPolicy.credential_id ||
            endpoint.credential_reference.credential_id === credentialPolicy.credential_id) &&
          (credentialPolicy.allow_missing
            || (endpoint.credential_status !== 'missing'
              && endpoint.credential_status !== 'unavailable'))
        : endpoint.credential_reference.kind === 'provider_account' &&
          endpoint.credential_reference.account_id === credentialPolicy.account_id)
  );
}
