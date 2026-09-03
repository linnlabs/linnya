import type {
  AiSdkInferenceCapabilityId,
  AiSdkInferenceRoute,
  AiSdkInferenceSurface,
} from '@linnlabs/linnkit-provider-ai-sdk';
import type { ResolvedInferenceAttemptRoute } from '../definitions/inferenceCapability';

/** Linnya Host route 只在 capability/surface 已完成 admission 后投影为 package 窄合同。 */
export function projectResolvedInferenceAttemptRouteToAiSdkRoute(
  route: ResolvedInferenceAttemptRoute,
  capabilityId: AiSdkInferenceCapabilityId,
  surface: AiSdkInferenceSurface
): AiSdkInferenceRoute {
  if (route.capability_id !== capabilityId || route.api_surface !== surface) {
    throw new Error('[AiSdkInference] Host route 与 adapter capability 不一致。');
  }
  return {
    model_id: route.model_id,
    request_profile: route.route_profile_id,
    capability_id: capabilityId,
    surface,
    endpoint_id: route.endpoint_id,
    endpoint_model_id: route.endpoint_model_id,
    base_url: route.base_url,
    ...(route.headers ? { headers: route.headers } : {}),
  };
}
