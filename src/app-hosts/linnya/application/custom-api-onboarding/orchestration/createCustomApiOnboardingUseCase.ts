import {
  type CustomApiModelRegistrationCommand,
  type CustomApiModelRegistrationResponse,
  type CustomApiProviderUpdateCommand,
  type CustomApiProviderUpdateResponse,
} from '@app/schemas/custom-api-onboarding';
import type { InferenceEndpointSelection, ModelConfig } from 'src/domains/model-catalog';

import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type {
  CustomApiOnboardingIdFactory,
  CustomApiOnboardingModelCatalogPort,
  CustomApiOnboardingPreferencesPort,
  CustomApiOnboardingProviderMembershipPort,
  CustomApiOnboardingUseCase,
} from '../definitions/customApiOnboardingPorts';
import { buildCustomApiModelRegistration } from '../functions/buildCustomApiModelRegistration';
import { buildCustomApiProviderModelUpdate } from '../functions/buildCustomApiProviderModelUpdate';
import { decideCustomApiProviderEndpoint } from '../functions/decideCustomApiProviderEndpoint';
import { findReusableCustomApiEndpoint } from '../functions/findReusableCustomApiEndpoint';
import { readCustomApiProviderName } from '../functions/readCustomApiProviderName';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

export interface CreateCustomApiOnboardingUseCaseDependencies {
  readonly modelCatalog: CustomApiOnboardingModelCatalogPort;
  readonly providerMembership: CustomApiOnboardingProviderMembershipPort;
  readonly modelPickerPreferences: CustomApiOnboardingPreferencesPort;
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

        let endpointSelection: InferenceEndpointSelection;
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
          // 先持久化显式选择，避免模型已进入目录、偏好却未保存而被默认开启。
          // 若后续注册失败，孤儿偏好由现有启动 reconcile 按模型身份清理。
          if (item.picker_enabled !== undefined) {
            await dependencies.modelPickerPreferences.setModelVisibility(
              modelId,
              item.picker_enabled
            );
          }
          await dependencies.modelCatalog.registerUserModel(model, endpointSelection);
        } catch (error: unknown) {
          console.error('[createCustomApiOnboardingUseCase] registration failed', error);
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

    async updateProvider(
      command: CustomApiProviderUpdateCommand
    ): Promise<CustomApiProviderUpdateResponse> {
      const catalogModels = dependencies.modelCatalog.getModels();
      const customModels = catalogModels.filter(
        model =>
          model.catalog_source === 'user' &&
          !dependencies.providerMembership.getByModelConfigId(model.id)
      );
      const groupModels = customModels.filter(
        model => readCustomApiProviderName(model) === command.current_provider_name
      );
      if (groupModels.length === 0) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.provider_not_found',
          '自定义模型分组不存在或已被删除',
          404
        );
      }
      const groupModelIds = new Set(groupModels.map(model => model.id));
      if (
        command.provider_name !== command.current_provider_name &&
        customModels.some(
          model =>
            !groupModelIds.has(model.id) &&
            readCustomApiProviderName(model) === command.provider_name
        )
      ) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.provider_name_conflict',
          '已存在同名的自定义模型分组',
          409
        );
      }

      const groupEndpointIds = new Set(groupModels.map(model => model.inference_endpoint_id));
      const groupEndpoints = dependencies.modelCatalog
        .getInferenceEndpoints()
        .filter(endpoint => groupEndpointIds.has(endpoint.id));
      if (
        groupEndpoints.length !== groupEndpointIds.size ||
        groupModels.some(model => !model.inference_route)
      ) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.provider_configuration_invalid',
          '自定义模型分组引用的推理连接无效',
          500
        );
      }

      const binding = readCustomApiRuntimeBinding(command.api_format);
      const decision = decideCustomApiProviderEndpoint({
        groupModelIds,
        groupEndpoints,
        catalogModels,
        binding,
        baseUrl: command.base_url,
        hasNewSecret: command.api_key !== undefined,
      });

      let endpointId: string;
      let endpointSelection: InferenceEndpointSelection;
      switch (decision.kind) {
        case 'credential_required':
          throw new CustomApiOnboardingError(
            'custom_api_onboarding.credential_required',
            '修改该分组的 API 地址或格式需要重新填写 API Key',
            400
          );
        case 'keep':
          endpointId = decision.endpoint.endpoint_id;
          endpointSelection = {
            kind: 'existing',
            inference_endpoint_id: decision.endpoint.id,
            ...(command.api_key ? { credential_secret: command.api_key } : {}),
          };
          break;
        case 'create_with_secret':
        case 'create_with_credential': {
          const endpointResourceId = dependencies.idFactory.create();
          endpointId = `${binding.endpoint_id}:${endpointResourceId}`;
          endpointSelection = {
            kind: 'create',
            endpoint: {
              id: endpointResourceId,
              route_profile_id: binding.route_profile_id,
              endpoint_id: endpointId,
              base_url: command.base_url,
              auth_profile: binding.auth_profile,
              ...(decision.kind === 'create_with_credential'
                ? { credential_reference: decision.credential_reference }
                : { credential_secret: command.api_key }),
            },
          };
          break;
        }
      }

      const updatedModels: ModelConfig[] = groupModels.map(model =>
        buildCustomApiProviderModelUpdate({
          model,
          providerName: command.provider_name,
          baseUrl: command.base_url,
          endpointId,
          binding,
        })
      );
      try {
        await dependencies.modelCatalog.rebindUserModels(updatedModels, endpointSelection);
      } catch (error: unknown) {
        console.error('[createCustomApiOnboardingUseCase] provider update failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.update_failed',
          '自定义模型分组更新失败',
          500
        );
      }
      return {
        provider_name: command.provider_name,
        model_ids: updatedModels.map(model => model.id),
      };
    },
  });
}
