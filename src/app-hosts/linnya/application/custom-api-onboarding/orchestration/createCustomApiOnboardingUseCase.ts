import {
  type CustomApiModelRegistrationCommand,
  type CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';

import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type {
  CustomApiOnboardingIdFactory,
  CustomApiOnboardingModelCatalogPort,
  CustomApiOnboardingUseCase,
} from '../definitions/customApiOnboardingPorts';
import { buildCustomApiModelRegistration } from '../functions/buildCustomApiModelRegistration';
import { findReusableCustomApiEndpoint } from '../functions/findReusableCustomApiEndpoint';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

export interface CreateCustomApiOnboardingUseCaseDependencies {
  readonly modelCatalog: CustomApiOnboardingModelCatalogPort;
  readonly idFactory: CustomApiOnboardingIdFactory;
}

export function createCustomApiOnboardingUseCase(
  dependencies: CreateCustomApiOnboardingUseCaseDependencies
): CustomApiOnboardingUseCase {
  return Object.freeze({
    async registerModel(
      command: CustomApiModelRegistrationCommand
    ): Promise<CustomApiModelRegistrationResponse> {
      const binding = readCustomApiRuntimeBinding(command.api_format);

      // 显式新 Key 始终创建新的 credential boundary；未提交时才尝试复用已有自定义 endpoint。
      const reusableEndpoint = command.api_key
        ? undefined
        : findReusableCustomApiEndpoint(
            dependencies.modelCatalog.getInferenceEndpoints(),
            binding,
            command.base_url
          );
      if (!reusableEndpoint && !command.api_key) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.credential_required',
          '首次配置该 API 地址和格式时需要 API Key',
          400
        );
      }

      const modelItems = command.models && command.models.length > 0
        ? command.models
        : [
            {
              endpoint_model_id: command.endpoint_model_id!,
              display_name: command.display_name,
              context_window_tokens: command.context_window_tokens!,
              max_output_tokens: command.max_output_tokens!,
              supports_image_input: command.supports_image_input!,
            },
          ];

      const modelIds: string[] = [];
      let sharedEndpointResourceId: string | undefined;

      for (let i = 0; i < modelItems.length; i++) {
        const item = modelItems[i];
        const modelId = dependencies.idFactory.create();
        modelIds.push(modelId);

        let endpointSelection: import('src/domains/model-catalog').InferenceEndpointSelection;
        let endpointId: string;

        if (reusableEndpoint) {
          endpointSelection = { kind: 'existing', inference_endpoint_id: reusableEndpoint.id };
          endpointId = reusableEndpoint.endpoint_id;
        } else if (i === 0) {
          sharedEndpointResourceId = dependencies.idFactory.create();
          endpointId = `${binding.endpoint_id}:${sharedEndpointResourceId}`;
          endpointSelection = {
            kind: 'create',
            endpoint: {
              id: sharedEndpointResourceId,
              route_profile_id: binding.route_profile_id,
              endpoint_id: endpointId,
              base_url: command.base_url,
              auth_profile: binding.auth_profile,
              credential_secret: command.api_key,
            },
          };
        } else {
          endpointId = `${binding.endpoint_id}:${sharedEndpointResourceId!}`;
          endpointSelection = {
            kind: 'existing',
            inference_endpoint_id: sharedEndpointResourceId!,
          };
        }

        const singleCommand = {
          ...command,
          endpoint_model_id: item.endpoint_model_id,
          display_name: item.display_name,
          context_window_tokens: item.context_window_tokens,
          max_output_tokens: item.max_output_tokens,
          supports_image_input: item.supports_image_input,
        };

        const plan = buildCustomApiModelRegistration({
          modelId,
          endpointResourceId: sharedEndpointResourceId ?? reusableEndpoint?.id ?? 'endpoint',
          command: singleCommand,
          binding,
          reusableEndpoint,
        });

        const finalModel = {
          ...plan.model,
          inference_route: {
            ...plan.model.inference_route!,
            endpoint_id: endpointId,
          },
        };

        try {
          await dependencies.modelCatalog.registerUserModel(finalModel, endpointSelection);
        } catch (error: unknown) {
          console.error('[createCustomApiOnboardingUseCase] registerUserModel error', error);
          if (error instanceof CustomApiOnboardingError) throw error;
          throw new CustomApiOnboardingError(
            'custom_api_onboarding.registration_failed',
            error instanceof Error ? error.message : '自定义 API 模型注册失败',
            500
          );
        }
      }

      return {
        model_id: modelIds[0],
        ...(modelIds.length > 1 ? { model_ids: modelIds } : {}),
      };
    },
  });
}
