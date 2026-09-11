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

      const modelIds: string[] = [];
      let sharedEndpointResourceId: string | undefined;

      for (const [index, item] of command.models.entries()) {
        const modelId = dependencies.idFactory.create();
        modelIds.push(modelId);

        let endpointSelection: import('src/domains/model-catalog').InferenceEndpointSelection;
        let endpointId: string;

        if (reusableEndpoint) {
          endpointSelection = { kind: 'existing', inference_endpoint_id: reusableEndpoint.id };
          endpointId = reusableEndpoint.endpoint_id;
        } else if (index === 0) {
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
          if (!sharedEndpointResourceId) {
            throw new Error('批量注册的共享 endpoint 尚未建立');
          }
          endpointId = `${binding.endpoint_id}:${sharedEndpointResourceId}`;
          endpointSelection = {
            kind: 'existing',
            inference_endpoint_id: sharedEndpointResourceId,
          };
        }

        const model = buildCustomApiModelRegistration({
          modelId,
          endpointId,
          command,
          model: item,
          binding,
        });

        try {
          await dependencies.modelCatalog.registerUserModel(model, endpointSelection);
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
