import type {
  DirectProviderConnectionOnboardingCommand,
  DirectProviderConnectionOnboardingResponse,
  DirectProviderModelRegistrationCommand,
  DirectProviderModelRegistrationResponse,
} from '@app/schemas/provider-onboarding';

import { ProviderOnboardingError } from '../definitions/providerOnboardingError';
import type {
  ProviderOnboardingCatalogPort,
  ProviderOnboardingAccountPort,
  ProviderOnboardingAccountModelDiscoveryPort,
  ProviderOnboardingConfigurationPort,
  ProviderOnboardingIdFactory,
  ProviderOnboardingModelCatalogPort,
  ProviderOnboardingModelRemovalPort,
  ProviderOnboardingRuntimeBindingPort,
  ProviderOnboardingUseCase,
} from '../definitions/providerOnboardingPorts';
import { getLogger } from 'src/shared/logger';
import { buildDirectProviderModelRegistration } from '../functions/buildDirectProviderModelRegistration';
import { buildRefreshedDirectProviderModel } from '../functions/buildRefreshedDirectProviderModel';
import { findReusableDirectProviderEndpoint } from '../functions/findReusableDirectProviderEndpoint';
import { findStaleConfiguredProviderModels } from '../functions/findStaleConfiguredProviderModels';
import { isProviderModelRegistered } from '../functions/isProviderModelRegistered';
import { resolveProviderOnboardingAuthMethod } from '../functions/resolveProviderOnboardingAuthMethod';
import { resolveProviderOnboardingModelRuntimeBinding } from 'src/app-hosts/linnya/adapters/inference';
import type { CredentialReference, ModelConfig } from 'src/domains/model-catalog';
import type {
  ProviderConnectionDefinition,
  ProviderModelDefinition,
} from '@linnya/provider-catalog';
import { projectProviderAccountModelDefinition } from '../functions/projectProviderAccountModelDefinition';
import { selectInitialProviderModels } from '../functions/selectInitialProviderModels';

const logger = getLogger('ProviderOnboarding');

function isSameCredentialReference(left: CredentialReference, right: CredentialReference): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'none':
      return true;
    case 'environment_variable':
      return (
        right.kind === 'environment_variable' &&
        left.environment_variable === right.environment_variable
      );
    case 'stored_secret':
      return right.kind === 'stored_secret' && left.credential_id === right.credential_id;
    case 'provider_account':
      return right.kind === 'provider_account' && left.account_id === right.account_id;
    case 'host_managed':
      return right.kind === 'host_managed' && left.credential_id === right.credential_id;
  }
}

export interface CreateProviderOnboardingUseCaseDependencies {
  readonly providerCatalog: ProviderOnboardingCatalogPort;
  readonly runtimeBindings: ProviderOnboardingRuntimeBindingPort;
  readonly modelCatalog: ProviderOnboardingModelCatalogPort;
  readonly providerConfigurations: ProviderOnboardingConfigurationPort;
  readonly providerAccounts: ProviderOnboardingAccountPort;
  readonly accountModels: ProviderOnboardingAccountModelDiscoveryPort;
  readonly modelRemoval: ProviderOnboardingModelRemovalPort;
  readonly idFactory: ProviderOnboardingIdFactory;
}

export function createProviderOnboardingUseCase(
  dependencies: CreateProviderOnboardingUseCaseDependencies
): ProviderOnboardingUseCase {
  const assertCatalogGeneration = (): void => {
    const generation = dependencies.providerCatalog.generation;
    if (
      dependencies.runtimeBindings.generation_id !== generation.id ||
      dependencies.runtimeBindings.source_sha256 !== generation.source_sha256
    ) {
      throw new ProviderOnboardingError(
        'provider_onboarding.catalog_generation_mismatch',
        'Provider 公开目录与运行时绑定不是同一代生成资产',
        500
      );
    }
  };

  const registerDirectProviderModel = async (
    command: DirectProviderModelRegistrationCommand,
    discoveredProviderModel?: ProviderModelDefinition
  ): Promise<DirectProviderModelRegistrationResponse> => {
    assertCatalogGeneration();

    const catalogEntry = dependencies.providerCatalog.getConnection(
      command.provider_connection_definition_id
    );
    if (!catalogEntry) {
      throw new ProviderOnboardingError(
        'provider_onboarding.provider_not_found',
        'Provider 不存在',
        404
      );
    }
    const { provider, connection } = catalogEntry;
    const acceptsBundledModel =
      connection.model_discovery === 'bundled' && discoveredProviderModel === undefined;
    const acceptsAccountModel =
      connection.model_discovery === 'account_catalog' && discoveredProviderModel !== undefined;
    if (connection.kind !== 'direct' || (!acceptsBundledModel && !acceptsAccountModel)) {
      throw new ProviderOnboardingError(
        'provider_onboarding.provider_not_supported',
        '当前入口只接受内置直连 Provider',
        400
      );
    }

    const providerModel =
      discoveredProviderModel ??
      connection.models.find(model => model.id === command.provider_model_id);
    if (!providerModel) {
      throw new ProviderOnboardingError(
        'provider_onboarding.model_not_found',
        '该 Provider 中不存在所选模型',
        404
      );
    }
    if (providerModel.id !== command.provider_model_id) {
      throw new ProviderOnboardingError(
        'provider_onboarding.model_not_found',
        '账号目录模型与注册命令不一致',
        404
      );
    }
    const binding = dependencies.runtimeBindings.get(connection.id);
    if (!binding) {
      throw new ProviderOnboardingError(
        'provider_onboarding.runtime_binding_missing',
        '该 Provider 尚未通过运行时准入',
        500
      );
    }
    const modelBinding = resolveProviderOnboardingModelRuntimeBinding(binding, providerModel.id);

    const authMethod = resolveProviderOnboardingAuthMethod(connection);
    if (!authMethod) {
      throw new ProviderOnboardingError(
        'provider_onboarding.provider_not_supported',
        '该 Provider 的认证方式尚未接入',
        400
      );
    }
    const providerAccountId =
      authMethod === 'provider_account'
        ? dependencies.providerAccounts.findConnectedAccountId(connection.id)
        : undefined;
    if (authMethod === 'provider_account' && !providerAccountId) {
      throw new ProviderOnboardingError(
        'provider_onboarding.authorization_required',
        `请先完成 ${connection.display_name} 登录`,
        400
      );
    }

    const configuredProvider =
      dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id);
    if (isProviderModelRegistered(configuredProvider, providerModel.id)) {
      throw new ProviderOnboardingError(
        'provider_onboarding.model_already_registered',
        '该模型已经添加，无需重复添加',
        409
      );
    }
    const inferenceEndpoints = dependencies.modelCatalog.getInferenceEndpoints();
    const configuredModels =
      configuredProvider?.models.map(model =>
        dependencies.modelCatalog.getModel(model.model_config_id)
      ) ?? [];
    if (configuredProvider && configuredModels.some(model => !model?.inference_endpoint_id)) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置引用的模型或推理连接无效',
        500
      );
    }
    const configuredEndpointIds = new Set(
      configuredModels.flatMap(model => model?.inference_endpoint_id ?? [])
    );
    const configuredEndpoints = inferenceEndpoints.filter(endpoint =>
      configuredEndpointIds.has(endpoint.id)
    );
    if (configuredProvider && configuredEndpoints.length !== configuredEndpointIds.size) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置引用的推理连接无效',
        500
      );
    }
    const configuredCredentialReference = configuredEndpoints[0]?.credential_reference;
    if (
      configuredCredentialReference &&
      configuredEndpoints.some(
        endpoint =>
          !isSameCredentialReference(endpoint.credential_reference, configuredCredentialReference)
      )
    ) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置存在多个凭据边界',
        500
      );
    }
    if (
      authMethod === 'api_key' &&
      configuredCredentialReference &&
      configuredCredentialReference.kind !== 'stored_secret'
    ) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置的凭据边界无效',
        500
      );
    }
    const reusableEndpoint = findReusableDirectProviderEndpoint(
      configuredEndpoints,
      modelBinding,
      providerAccountId
        ? { kind: 'provider_account', account_id: providerAccountId }
        : {
            kind: 'stored_secret',
            credential_id:
              configuredCredentialReference?.kind === 'stored_secret'
                ? configuredCredentialReference.credential_id
                : undefined,
            allow_missing: true,
          }
    );
    if (
      authMethod === 'api_key' &&
      configuredEndpoints.some(endpoint =>
        endpoint.credential_status === 'missing' || endpoint.credential_status === 'unavailable'
      ) &&
      !command.api_key
    ) {
      throw new ProviderOnboardingError(
        'provider_onboarding.credential_required',
        '该 Provider 的 API Key 已不可用，请重新填写',
        400
      );
    }
    if (authMethod === 'api_key' && !configuredProvider && !command.api_key) {
      throw new ProviderOnboardingError(
        'provider_onboarding.credential_required',
        '首次配置该 Provider 时需要 API Key',
        400
      );
    }

    const modelId = dependencies.idFactory.create();
    const endpointResourceId = reusableEndpoint?.id ?? dependencies.idFactory.create();
    const configuredProviderId = configuredProvider?.id ?? dependencies.idFactory.create();
    const registrationIntentId = dependencies.idFactory.create();
    const plan = buildDirectProviderModelRegistration({
      modelId,
      endpointResourceId,
      providerModel,
      binding: modelBinding,
      displayName: command.display_name,
      credentialSecret: command.api_key,
      credentialReference: providerAccountId
        ? { kind: 'provider_account', account_id: providerAccountId }
        : configuredCredentialReference?.kind === 'stored_secret'
          ? configuredCredentialReference
          : {
              kind: 'stored_secret',
              credential_id: `configured-provider:${configuredProviderId}`,
            },
      reusableEndpoint,
    });
    const inferenceEndpointId =
      plan.inferenceEndpoint.kind === 'existing'
        ? plan.inferenceEndpoint.inference_endpoint_id
        : plan.inferenceEndpoint.endpoint.id;

    let intentStarted = false;
    let stage: 'persist_intent' | 'register_model' = 'persist_intent';
    try {
      await dependencies.providerConfigurations.beginModelRegistration({
        intent_id: registrationIntentId,
        configured_provider_id: configuredProviderId,
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        inference_endpoint_id: inferenceEndpointId,
        provider_model_id: providerModel.id,
        model_config_id: modelId,
      });
      intentStarted = true;
      stage = 'register_model';
      await dependencies.modelCatalog.registerUserModel(plan.model, plan.inferenceEndpoint);
    } catch (error: unknown) {
      if (error instanceof ProviderOnboardingError) throw error;
      logger.warn('provider_model_registration.failed', {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        provider_model_id: providerModel.id,
        stage,
        failure_type: error instanceof Error ? error.name : 'unknown',
      });
      try {
        if (intentStarted) {
          await dependencies.providerConfigurations.cancelModelRegistration(registrationIntentId);
        }
      } catch (cancelError: unknown) {
        logger.warn('provider_model_registration.intent_cancel_failed', {
          provider_definition_id: provider.id,
          provider_connection_definition_id: connection.id,
          provider_model_id: providerModel.id,
          intent_id: registrationIntentId,
          failure_type: cancelError instanceof Error ? cancelError.name : 'unknown',
        });
        throw new ProviderOnboardingError(
          'provider_onboarding.registration_failed',
          'Provider 模型注册失败，配置将在下次启动时恢复',
          500
        );
      }
      throw new ProviderOnboardingError(
        'provider_onboarding.registration_failed',
        'Provider 模型注册失败',
        500
      );
    }
    try {
      await dependencies.providerConfigurations.completeModelRegistration(registrationIntentId);
    } catch (error: unknown) {
      logger.warn('模型已注册，Provider 归属将在下次启动时恢复', {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        provider_model_id: providerModel.id,
        model_config_id: modelId,
        intent_id: registrationIntentId,
        failure_type: error instanceof Error ? error.name : 'unknown',
      });
    }

    return {
      model_id: modelId,
      provider_definition_id: provider.id,
      provider_connection_definition_id: connection.id,
      provider_model_id: providerModel.id,
    };
  };

  const refreshRegisteredProviderModel = async (
    connection: ProviderConnectionDefinition,
    providerModel: ProviderModelDefinition,
    existingModel: ModelConfig
  ): Promise<boolean> => {
    if (!existingModel.inference_endpoint_id) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置引用的模型或推理连接无效',
        500
      );
    }
    const endpoint = dependencies.modelCatalog
      .getInferenceEndpoints()
      .find(candidate => candidate.id === existingModel.inference_endpoint_id);
    const binding = dependencies.runtimeBindings.get(connection.id);
    if (!endpoint || !binding) {
      throw new ProviderOnboardingError(
        'provider_onboarding.configuration_invalid',
        'Provider 配置引用的模型或推理连接无效',
        500
      );
    }
    const refreshedModel = buildRefreshedDirectProviderModel({
      existingModel,
      providerModel,
      binding: resolveProviderOnboardingModelRuntimeBinding(binding, providerModel.id),
      endpoint,
    });
    if (refreshedModel) await dependencies.modelCatalog.updateModel(refreshedModel);
    return refreshedModel !== undefined;
  };

  const useCase: ProviderOnboardingUseCase = {
    async configureDirectProvider(
      command: DirectProviderConnectionOnboardingCommand
    ): Promise<DirectProviderConnectionOnboardingResponse> {
      const catalogEntry = dependencies.providerCatalog.getConnection(
        command.provider_connection_definition_id
      );
      if (!catalogEntry) {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_found',
          'Provider 不存在',
          404
        );
      }
      const { provider, connection } = catalogEntry;
      if (
        connection.kind !== 'direct' ||
        connection.model_discovery !== 'bundled' ||
        resolveProviderOnboardingAuthMethod(connection) !== 'api_key'
      ) {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_supported',
          '当前入口只接受 API Key 直连 Provider',
          400
        );
      }
      if (dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id)) {
        throw new ProviderOnboardingError(
          'provider_onboarding.model_already_registered',
          '该 Provider 已连接，请在模型管理中选择模型',
          409
        );
      }

      const initialModels = selectInitialProviderModels(connection.models);
      if (initialModels.length === 0) {
        throw new ProviderOnboardingError(
          'provider_onboarding.model_not_found',
          '该 Provider 暂无可用模型',
          404
        );
      }
      const modelIds: string[] = [];
      for (const [index, model] of initialModels.entries()) {
        try {
          const result = await registerDirectProviderModel({
            provider_connection_definition_id: connection.id,
            provider_model_id: model.id,
            ...(index === 0 ? { api_key: command.api_key } : {}),
          });
          modelIds.push(result.model_id);
        } catch (error: unknown) {
          if (modelIds.length === 0) throw error;
          // Provider 已可用时，默认模型激活是接入后的便利动作；其余模型仍可在模型管理中继续激活。
          logger.warn('provider_onboarding.initial_models_partially_activated', {
            provider_definition_id: provider.id,
            provider_connection_definition_id: connection.id,
            activated_model_count: modelIds.length,
            failed_provider_model_id: model.id,
            failure_type: error instanceof Error ? error.name : 'unknown',
          });
          break;
        }
      }
      return {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        model_ids: modelIds,
      };
    },
    registerDirectProviderModel,

    async refreshRegisteredBundledProviderModels(providerConnectionDefinitionId: string) {
      assertCatalogGeneration();
      const catalogEntry = dependencies.providerCatalog.getConnection(
        providerConnectionDefinitionId
      );
      if (!catalogEntry) {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_found',
          'Provider 不存在',
          404
        );
      }
      const { provider, connection } = catalogEntry;
      if (connection.kind !== 'direct' || connection.model_discovery !== 'bundled') {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_supported',
          '当前刷新入口只接受 bundled 直连 Provider',
          400
        );
      }
      const configuredProvider =
        dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id);
      if (!configuredProvider) return;

      let updatedModelCount = 0;
      for (const configuredModel of configuredProvider.models) {
        const providerModel = connection.models.find(
          model => model.id === configuredModel.provider_model_id
        );
        if (!providerModel) continue;
        const existingModel = dependencies.modelCatalog.getModel(configuredModel.model_config_id);
        if (!existingModel) {
          throw new ProviderOnboardingError(
            'provider_onboarding.configuration_invalid',
            'Provider 配置引用的模型或推理连接无效',
            500
          );
        }
        if (await refreshRegisteredProviderModel(connection, providerModel, existingModel)) {
          updatedModelCount += 1;
        }
      }
      logger.info('provider_onboarding.bundled_models_refreshed', {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        registered_model_count: configuredProvider.models.length,
        updated_model_count: updatedModelCount,
      });
    },

    async synchronizeConnectedProviderModels(providerConnectionDefinitionId: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const catalogEntry = dependencies.providerCatalog.getConnection(
        providerConnectionDefinitionId
      );
      if (!catalogEntry) {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_found',
          'Provider 不存在',
          404
        );
      }
      const { provider, connection } = catalogEntry;
      if (
        connection.kind !== 'direct' ||
        connection.model_discovery !== 'account_catalog' ||
        resolveProviderOnboardingAuthMethod(connection) !== 'provider_account'
      ) {
        throw new ProviderOnboardingError(
          'provider_onboarding.provider_not_supported',
          '当前同步入口只接受已授权的账号型 Provider',
          400
        );
      }
      const providerAccountId = dependencies.providerAccounts.findConnectedAccountId(connection.id);
      if (!providerAccountId) {
        throw new ProviderOnboardingError(
          'provider_onboarding.authorization_required',
          `请先完成 ${connection.display_name} 登录`,
          400
        );
      }

      const providerModels = (
        await dependencies.accountModels.discoverModels(connection.id, providerAccountId, signal)
      ).map(projectProviderAccountModelDefinition);
      signal?.throwIfAborted();
      let registeredModelCount = 0;
      let updatedModelCount = 0;
      let existingModelCount = 0;
      logger.info('provider_model_synchronization.started', {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        discovered_model_count: providerModels.length,
      });
      for (const providerModel of providerModels) {
        // 不取消进行中的 durable 提交；只在两个完整模型操作之间停止。
        signal?.throwIfAborted();
        const configuredProvider =
          dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id);
        const configuredModel = configuredProvider?.models.find(
          model => model.provider_model_id === providerModel.id
        );
        if (configuredModel) {
          const existingModel = dependencies.modelCatalog.getModel(configuredModel.model_config_id);
          if (!existingModel) {
            throw new ProviderOnboardingError(
              'provider_onboarding.configuration_invalid',
              'Provider 配置引用的模型或推理连接无效',
              500
            );
          }
          if (await refreshRegisteredProviderModel(connection, providerModel, existingModel)) {
            updatedModelCount += 1;
          }
          existingModelCount += 1;
          continue;
        }
        await registerDirectProviderModel(
          {
            provider_connection_definition_id: connection.id,
            provider_model_id: providerModel.id,
          },
          providerModel
        );
        // 单模型 use case 会容忍归属提交失败并留给启动恢复；批量同步不能在身份未提交时继续创建第二条 endpoint。
        if (
          !isProviderModelRegistered(
            dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id),
            providerModel.id
          )
        ) {
          throw new ProviderOnboardingError(
            'provider_onboarding.registration_failed',
            'Provider 模型归属尚未完成，将在下次启动时恢复',
            500
          );
        }
        registeredModelCount += 1;
      }
      const staleModels = findStaleConfiguredProviderModels(
        dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id),
        providerModels
      );
      for (const staleModel of staleModels) {
        signal?.throwIfAborted();
        await dependencies.modelRemoval.remove(staleModel.model_config_id);
      }
      logger.info('provider_model_synchronization.completed', {
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        registered_model_count: registeredModelCount,
        updated_model_count: updatedModelCount,
        existing_model_count: existingModelCount,
        removed_model_count: staleModels.length,
      });
    },
  };

  return Object.freeze(useCase);
}
