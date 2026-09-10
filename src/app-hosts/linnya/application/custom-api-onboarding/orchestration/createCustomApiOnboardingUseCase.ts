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

      for (let i = 0; i < modelItems.length; i++) {
        const item = modelItems[i];
        const modelId = dependencies.idFactory.create();
        modelIds.push(modelId);
        const endpointResourceId = reusableEndpoint?.id ?? (i === 0 ? dependencies.idFactory.create() : modelIds[0]);
        
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
          endpointResourceId,
          command: singleCommand,
          binding,
          reusableEndpoint,
        });

        try {
          await dependencies.modelCatalog.registerUserModel(plan.model, plan.inferenceEndpoint);
        } catch (error: unknown) {
          if (error instanceof CustomApiOnboardingError) throw error;
          throw new CustomApiOnboardingError(
            'custom_api_onboarding.registration_failed',
            '自定义 API 模型注册失败',
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
