import {
  buildModelInferenceRoute,
  projectLanguageInferenceImageInputSupport,
} from '@app/schemas/model-inference';
import type {
  CustomApiModelItem,
  CustomApiModelRegistrationCommand,
} from '@app/schemas/custom-api-onboarding';
import type { ModelConfig } from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

export interface BuildCustomApiModelRegistrationInput {
  readonly modelId: string;
  readonly endpointId: string;
  readonly command: CustomApiModelRegistrationCommand;
  readonly model: CustomApiModelItem;
  readonly binding: CustomApiRuntimeBinding;
}

export type CustomApiModelRegistration = ModelConfig & {
  readonly inference_route: NonNullable<ModelConfig['inference_route']>;
};

/** 把用户选择的 API 格式投影为内部 typed route；不创建或保存 Provider 实体。 */
export function buildCustomApiModelRegistration(
  input: BuildCustomApiModelRegistrationInput
): CustomApiModelRegistration {
  const imageInputSupport = projectLanguageInferenceImageInputSupport(
    input.binding.route_profile_id,
    input.model.supports_image_input
  );
  const route = buildModelInferenceRoute({
    profile_id: input.binding.route_profile_id,
    endpoint_id: input.endpointId,
    endpoint_model_id: input.model.endpoint_model_id,
    base_url: input.command.base_url,
    auth_profile: input.binding.auth_profile,
    context_window_tokens: input.model.context_window_tokens,
    max_output_tokens: input.model.max_output_tokens,
    input_support: imageInputSupport,
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  });

  return {
    id: input.modelId,
    model_name: input.model.endpoint_model_id,
    catalog_source: 'user',
    capabilities: input.model.supports_image_input ? ['chat', 'image_input'] : ['chat'],
    ui_visibility: [],
    display_name: input.model.display_name ?? input.model.endpoint_model_id,
    description: '用户通过自定义 API 添加的模型',
    billing_mode: 'byok',
    custom_provider_name: input.command.provider_name,
    inference_route: route,
  };
}
