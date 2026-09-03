import {
  buildModelInferenceRoute,
  projectLanguageInferenceImageInputSupport,
} from '@app/schemas/model-inference';
import type {
  CredentialReference,
  InferenceEndpointSelection,
  InferenceEndpointView,
  ModelConfig,
} from 'src/domains/model-catalog';
import type { ProviderModelDefinition } from '@linnya/provider-catalog';
import type { ResolvedProviderOnboardingModelRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';

export interface BuildDirectProviderModelRegistrationInput {
  readonly modelId: string;
  readonly endpointResourceId: string;
  readonly providerModel: ProviderModelDefinition;
  readonly binding: ResolvedProviderOnboardingModelRuntimeBinding;
  readonly displayName?: string;
  readonly credentialSecret?: string;
  readonly credentialReference?: CredentialReference;
  readonly reusableEndpoint?: InferenceEndpointView;
}

export interface DirectProviderModelRegistrationPlan {
  readonly model: ModelConfig;
  readonly inferenceEndpoint: InferenceEndpointSelection;
}

/** 把已准入的 Provider/模型资料投影为 Model Catalog 的原子注册计划。 */
export function buildDirectProviderModelRegistration(
  input: BuildDirectProviderModelRegistrationInput
): DirectProviderModelRegistrationPlan {
  const modelSupportsImageInput = input.providerModel.capabilities.image_input;
  const imageInputSupport = projectLanguageInferenceImageInputSupport(
    input.binding.route_profile_id,
    modelSupportsImageInput
  );
  const endpointId =
    input.reusableEndpoint?.endpoint_id ??
    `${input.binding.endpoint_id}:${input.endpointResourceId}`;
  const route = buildModelInferenceRoute({
    profile_id: input.binding.route_profile_id,
    endpoint_id: endpointId,
    endpoint_model_id: input.providerModel.id,
    base_url: input.binding.base_url,
    auth_profile: input.binding.auth_profile,
    context_window_tokens: input.providerModel.context_window_tokens,
    max_output_tokens: input.providerModel.max_output_tokens,
    input_support: imageInputSupport,
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  });

  return {
    model: {
      id: input.modelId,
      model_name: input.providerModel.id,
      catalog_source: 'user',
      capabilities: modelSupportsImageInput ? ['chat', 'image_input'] : ['chat'],
      ui_visibility: [],
      display_name: input.displayName ?? input.providerModel.display_name,
      description: '用户通过正式 Provider 添加的模型',
      billing_mode: 'byok',
      inference_route: route,
    },
    inferenceEndpoint: input.reusableEndpoint
      ? {
          kind: 'existing',
          inference_endpoint_id: input.reusableEndpoint.id,
          credential_secret: input.credentialSecret,
        }
      : {
          kind: 'create',
          endpoint: {
            id: input.endpointResourceId,
            route_profile_id: input.binding.route_profile_id,
            endpoint_id: endpointId,
            base_url: input.binding.base_url,
            auth_profile: input.binding.auth_profile,
            credential_reference: input.credentialReference,
            credential_secret: input.credentialSecret,
          },
        },
  };
}
