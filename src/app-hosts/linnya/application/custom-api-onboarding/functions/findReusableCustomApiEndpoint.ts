import type { InferenceEndpointView } from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

/** 只复用同一自定义格式、规范化 URL、认证方式且凭据可用的内部 endpoint。 */
export function findReusableCustomApiEndpoint(
  endpoints: readonly InferenceEndpointView[],
  binding: CustomApiRuntimeBinding,
  baseUrl: string
): InferenceEndpointView | undefined {
  return endpoints.find(
    endpoint =>
      endpoint.route_profile_id === binding.route_profile_id &&
      (endpoint.endpoint_id === binding.endpoint_id ||
        endpoint.endpoint_id.startsWith(`${binding.endpoint_id}:`)) &&
      endpoint.base_url === baseUrl &&
      endpoint.auth_profile === binding.auth_profile &&
      endpoint.credential_status !== 'missing' && endpoint.credential_status !== 'unavailable'
  );
}
