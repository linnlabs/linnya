import {
  buildModelInferenceRoute,
  projectLanguageInferenceImageInputSupport,
} from '@app/schemas/model-inference';
import type { CustomApiModelRegistrationCommand } from '@app/schemas/custom-api-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

export interface BuildCustomApiModelRegistrationInput {
  readonly modelId: string;
  readonly endpointResourceId: string;
  readonly command: CustomApiModelRegistrationCommand;
  readonly binding: CustomApiRuntimeBinding;
  readonly reusableEndpoint?: InferenceEndpointView;
}

export interface CustomApiModelRegistrationPlan {
  readonly model: ModelConfig;
  readonly inferenceEndpoint: InferenceEndpointSelection;
}

/** 把用户选择的 API 格式投影为内部 typed route；不创建或保存 Provider 实体。 */
export function buildCustomApiModelRegistration(
  input: BuildCustomApiModelRegistrationInput
): CustomApiModelRegistrationPlan {
  const imageInputSupport = projectLanguageInferenceImageInputSupport(
    input.binding.route_profile_id,
    input.command.supports_image_input
  );
  const endpointId =
    input.reusableEndpoint?.endpoint_id ??
    `${input.binding.endpoint_id}:${input.endpointResourceId}`;
  const route = buildModelInferenceRoute({
    profile_id: input.binding.route_profile_id,
    endpoint_id: endpointId,
    endpoint_model_id: input.command.endpoint_model_id,
    base_url: input.command.base_url,
    auth_profile: input.binding.auth_profile,
    context_window_tokens: input.command.context_window_tokens,
    max_output_tokens: input.command.max_output_tokens,
    input_support: imageInputSupport,
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  });

  return {
    model: {
      id: input.modelId,
      model_name: input.command.endpoint_model_id,
      catalog_source: 'user',
      capabilities: input.command.supports_image_input ? ['chat', 'image_input'] : ['chat'],
      ui_visibility: [],
      display_name: input.command.display_name ?? input.command.endpoint_model_id,
      description: '用户通过自定义 API 添加的模型',
      billing_mode: 'byok',
      inference_route: route,
    },
    inferenceEndpoint: input.reusableEndpoint
      ? { kind: 'existing', inference_endpoint_id: input.reusableEndpoint.id }
      : {
          kind: 'create',
          endpoint: {
            id: input.endpointResourceId,
            route_profile_id: input.binding.route_profile_id,
            endpoint_id: endpointId,
            base_url: input.command.base_url,
            auth_profile: input.binding.auth_profile,
            credential_secret: input.command.api_key,
          },
        },
  };
}
