import { buildModelInferenceRoute } from '@app/schemas/model-inference';
import type { OllamaModelRegistrationCommand } from '@app/schemas/ollama-onboarding';
import type {
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';

export interface BuildOllamaModelRegistrationInput {
  readonly modelId: string;
  readonly endpointResourceId: string;
  readonly command: OllamaModelRegistrationCommand;
  readonly reusableEndpoint?: InferenceEndpointView;
}

export interface OllamaModelRegistrationPlan {
  readonly model: ModelConfig;
  readonly inferenceEndpoint: InferenceEndpointSelection;
}

export function buildOllamaModelRegistration(
  input: BuildOllamaModelRegistrationInput
): OllamaModelRegistrationPlan {
  const baseUrl = `${input.command.service_url}/v1`;
  const endpointId =
    input.reusableEndpoint?.endpoint_id ??
    `${input.command.provider_connection_definition_id}:${input.endpointResourceId}`;
  const route = buildModelInferenceRoute({
    profile_id: 'openai_compatible_chat',
    endpoint_id: endpointId,
    endpoint_model_id: input.command.endpoint_model_id,
    base_url: baseUrl,
    auth_profile: 'none',
    context_window_tokens: input.command.context_window_tokens,
    max_output_tokens: input.command.max_output_tokens,
    input_support: { user_image: false, tool_result_image: false },
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'unavailable' },
  });
  return {
    model: {
      id: input.modelId,
      model_name: input.command.endpoint_model_id,
      catalog_source: 'user',
      capabilities: ['chat'],
      ui_visibility: [],
      display_name: input.command.display_name ?? input.command.endpoint_model_id,
      description: '用户通过 Ollama 添加的本地模型',
      billing_mode: 'byok',
      inference_route: route,
    },
    inferenceEndpoint: input.reusableEndpoint
      ? { kind: 'existing', inference_endpoint_id: input.reusableEndpoint.id }
      : {
          kind: 'create',
          endpoint: {
            id: input.endpointResourceId,
            route_profile_id: 'openai_compatible_chat',
            endpoint_id: endpointId,
            base_url: baseUrl,
            auth_profile: 'none',
          },
        },
  };
}
