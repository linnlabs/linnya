import {
  buildModelInferenceRoute,
  findLanguageInferenceRouteProfileForRoute,
  projectLanguageInferenceImageInputSupport,
  type InferenceAuthProfile,
  type ModelInferenceRoute,
} from '@app/schemas/model-inference';
import type { ConfigurableLanguageRouteProfileId } from '../definitions/configurableLanguageRouteProfile';
import { isConfigurableLanguageRouteProfileId } from '../registry/customLanguageApiFormats';

interface BuildCustomLanguageModelRouteInput {
  readonly profile_id: ConfigurableLanguageRouteProfileId;
  readonly endpoint_id: string;
  readonly endpoint_model_id: string;
  readonly base_url: string;
  readonly auth_profile: InferenceAuthProfile;
  readonly context_window_tokens: number;
  readonly max_output_tokens: number;
  readonly supports_image_input: boolean;
}

export function buildConfigurableLanguageModelRoute(
  input: BuildCustomLanguageModelRouteInput
): ModelInferenceRoute {
  return buildModelInferenceRoute({
    profile_id: input.profile_id,
    endpoint_id: input.endpoint_id,
    endpoint_model_id: input.endpoint_model_id,
    base_url: input.base_url,
    auth_profile: input.auth_profile,
    context_window_tokens: input.context_window_tokens,
    max_output_tokens: input.max_output_tokens,
    input_support: projectLanguageInferenceImageInputSupport(
      input.profile_id,
      input.supports_image_input
    ),
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  });
}

export function resolveConfigurableLanguageRouteProfileId(
  route: Pick<ModelInferenceRoute, 'api_surface' | 'capability_id'>
): ConfigurableLanguageRouteProfileId {
  const profile = findLanguageInferenceRouteProfileForRoute(route);
  if (isConfigurableLanguageRouteProfileId(profile.id)) return profile.id;
  throw new Error(`设置页不支持编辑该 route profile: ${profile.id}`);
}
