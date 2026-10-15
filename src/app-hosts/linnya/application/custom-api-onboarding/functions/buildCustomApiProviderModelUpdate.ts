import {
  buildModelInferenceRoute,
  projectLanguageInferenceImageInputSupport,
} from '@app/schemas/model-inference';
import type { ModelConfig } from 'src/domains/model-catalog';

import type { CustomApiRuntimeBinding } from '../definitions/customApiRuntimeBinding';

export interface BuildCustomApiProviderModelUpdateInput {
  readonly model: ModelConfig;
  readonly providerName: string;
  readonly baseUrl: string;
  readonly endpointId: string;
  readonly binding: CustomApiRuntimeBinding;
}

/**
 * 分组连接编辑只替换连接事实：名称、地址、格式与 endpoint 身份。
 *
 * 模型 ID、容量、视觉声明和 usage/continuation 继续使用该模型已保存的事实。
 */
export function buildCustomApiProviderModelUpdate(
  input: BuildCustomApiProviderModelUpdateInput
): ModelConfig {
  const route = input.model.inference_route;
  if (!route) throw new Error(`自定义模型 ${input.model.id} 缺少 inference_route`);
  return {
    ...input.model,
    custom_provider_name: input.providerName,
    inference_route: buildModelInferenceRoute({
      profile_id: input.binding.route_profile_id,
      endpoint_id: input.endpointId,
      endpoint_model_id: route.endpoint_model_id,
      base_url: input.baseUrl,
      auth_profile: input.binding.auth_profile,
      context_window_tokens: route.context_window_tokens,
      max_output_tokens: route.max_output_tokens,
      input_support: projectLanguageInferenceImageInputSupport(
        input.binding.route_profile_id,
        input.model.capabilities.includes('image_input')
      ),
      usage: route.usage,
      continuation: route.continuation,
    }),
  };
}
