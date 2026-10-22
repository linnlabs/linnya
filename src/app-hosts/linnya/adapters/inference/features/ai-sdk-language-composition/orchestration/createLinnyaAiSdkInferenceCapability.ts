import {
  createAiSdkInferenceCapability,
  type AiSdkInferenceCapabilityDependencies,
  type AiSdkInferenceCapabilityId,
  type AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';
import type { InferenceCapability } from '../../../definitions/inferenceCapability';
import { projectResolvedInferenceAttemptRouteToAiSdkRoute } from '../../../functions/projectResolvedInferenceAttemptRouteToAiSdkRoute';
import { createLinnyaProviderFailureClassifier } from '../../provider-failure-policy';

/** 把 Linnya 的 Catalog route/credential 投影到 package 合同；package 不反向依赖 Host schema。 */
export function createLinnyaAiSdkInferenceCapability(
  id: AiSdkInferenceCapabilityId,
  surface: AiSdkInferenceSurface,
  dependencies: AiSdkInferenceCapabilityDependencies
): InferenceCapability {
  const capability = createAiSdkInferenceCapability(id, surface, dependencies);
  return {
    id: capability.id,
    api_surface: capability.api_surface,
    stream({ request, route, credential, provider_connection_definition_id }) {
      return capability.stream({
        request,
        // 闭包只绑定本次正式身份；并发连接共享同一codec时不会继承其它产品的错误规则。
        provider_failure_classifier: createLinnyaProviderFailureClassifier(provider_connection_definition_id),
        route: projectResolvedInferenceAttemptRouteToAiSdkRoute(route, id, surface),
        ...(credential
          ? { credential: { profile: credential.profile, secret: credential.secret } }
          : {}),
      });
    },
  };
}
