import {
  createAiSdkInferenceCapability,
  type AiSdkInferenceCapabilityDependencies,
  type AiSdkInferenceCapabilityId,
  type AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';
import type { InferenceCapability } from '../../../definitions/inferenceCapability';
import { projectResolvedInferenceAttemptRouteToAiSdkRoute } from '../../../functions/projectResolvedInferenceAttemptRouteToAiSdkRoute';

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
    stream({ request, route, credential }) {
      return capability.stream({
        request,
        route: projectResolvedInferenceAttemptRouteToAiSdkRoute(route, id, surface),
        ...(credential
          ? { credential: { profile: credential.profile, secret: credential.secret } }
          : {}),
      });
    },
  };
}
