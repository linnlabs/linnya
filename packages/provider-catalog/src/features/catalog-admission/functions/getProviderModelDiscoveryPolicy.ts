import type { ProviderModelDiscoveryPolicy } from '../../../definitions/providerModelDiscoveryPolicy';
import { PROVIDER_ADMISSION_POLICIES } from '../registry/providerAdmissionPolicies';

/** 复用目录唯一的 connection 声明，Host 不再维护第二份供应商清单。 */
export function getProviderModelDiscoveryPolicy(
  connectionId: string
): ProviderModelDiscoveryPolicy | undefined {
  return PROVIDER_ADMISSION_POLICIES.find(
    policy =>
      (policy.provider_connection_definition_id ?? policy.provider_definition_id) === connectionId
  )?.online_model_discovery;
}
