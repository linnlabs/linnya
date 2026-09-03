import type {
  OllamaModelRegistrationCommand,
  OllamaModelRegistrationResponse,
} from '@app/schemas/ollama-onboarding';
import { getLogger } from 'src/shared/logger';

import { OllamaOnboardingError } from '../definitions/ollamaOnboardingError';
import type {
  OllamaOnboardingCatalogPort,
  OllamaOnboardingConfigurationPort,
  OllamaOnboardingIdFactory,
  OllamaOnboardingModelCatalogPort,
  OllamaOnboardingUseCase,
} from '../definitions/ollamaOnboardingPorts';
import { buildOllamaModelRegistration } from '../functions/buildOllamaModelRegistration';

const logger = getLogger('OllamaOnboarding');

export interface CreateOllamaOnboardingUseCaseDependencies {
  readonly providerCatalog: OllamaOnboardingCatalogPort;
  readonly modelCatalog: OllamaOnboardingModelCatalogPort;
  readonly providerConfigurations: OllamaOnboardingConfigurationPort;
  readonly idFactory: OllamaOnboardingIdFactory;
}

export function createOllamaOnboardingUseCase(
  dependencies: CreateOllamaOnboardingUseCaseDependencies
): OllamaOnboardingUseCase {
  return Object.freeze({
    async registerModel(
      command: OllamaModelRegistrationCommand
    ): Promise<OllamaModelRegistrationResponse> {
      const catalogEntry = dependencies.providerCatalog.getConnection(
        command.provider_connection_definition_id
      );
      if (!catalogEntry) {
        throw new OllamaOnboardingError(
          'ollama_onboarding.provider_not_found',
          'Ollama Provider 不存在',
          404
        );
      }
      const { provider, connection } = catalogEntry;
      if (connection.kind !== 'local_runtime' || connection.model_discovery !== 'local_runtime') {
        throw new OllamaOnboardingError(
          'ollama_onboarding.provider_not_supported',
          '当前入口只接受本地运行时 Provider',
          400
        );
      }

      const configuredProvider =
        dependencies.providerConfigurations.getByProviderConnectionDefinitionId(connection.id);
      const configuredModel = configuredProvider
        ? dependencies.modelCatalog.getModel(configuredProvider.models[0]?.model_config_id ?? '')
        : undefined;
      const configuredEndpoint = configuredProvider
        ? dependencies.modelCatalog
            .getInferenceEndpoints()
            .find(endpoint => endpoint.id === configuredModel?.inference_endpoint_id)
        : undefined;
      const expectedBaseUrl = `${command.service_url}/v1`;
      const reusableEndpoint =
        configuredEndpoint &&
        configuredEndpoint.route_profile_id === 'openai_compatible_chat' &&
        (configuredEndpoint.endpoint_id === connection.id ||
          configuredEndpoint.endpoint_id.startsWith(`${connection.id}:`)) &&
        configuredEndpoint.base_url === expectedBaseUrl &&
        configuredEndpoint.auth_profile === 'none' &&
        configuredEndpoint.credential_status === 'not_required'
          ? configuredEndpoint
          : undefined;
      if (configuredProvider && !reusableEndpoint) {
        throw new OllamaOnboardingError(
          'ollama_onboarding.configuration_mismatch',
          '当前 Ollama Provider 已绑定另一服务地址',
          409
        );
      }

      const modelId = dependencies.idFactory.create();
      const endpointResourceId = reusableEndpoint?.id ?? dependencies.idFactory.create();
      const configuredProviderId = configuredProvider?.id ?? dependencies.idFactory.create();
      const intentId = dependencies.idFactory.create();
      const plan = buildOllamaModelRegistration({
        modelId,
        endpointResourceId,
        command,
        reusableEndpoint,
      });
      const inferenceEndpointId =
        plan.inferenceEndpoint.kind === 'existing'
          ? plan.inferenceEndpoint.inference_endpoint_id
          : plan.inferenceEndpoint.endpoint.id;

      let intentStarted = false;
      try {
        await dependencies.providerConfigurations.beginModelRegistration({
          intent_id: intentId,
          configured_provider_id: configuredProviderId,
          provider_definition_id: provider.id,
          provider_connection_definition_id: connection.id,
          inference_endpoint_id: inferenceEndpointId,
          provider_model_id: command.endpoint_model_id,
          model_config_id: modelId,
        });
        intentStarted = true;
        await dependencies.modelCatalog.registerUserModel(plan.model, plan.inferenceEndpoint);
      } catch (error: unknown) {
        if (error instanceof OllamaOnboardingError) throw error;
        try {
          if (intentStarted) {
            await dependencies.providerConfigurations.cancelModelRegistration(intentId);
          }
        } catch {
          throw new OllamaOnboardingError(
            'ollama_onboarding.registration_failed',
            'Ollama 模型注册失败，配置将在下次启动时恢复',
            500
          );
        }
        throw new OllamaOnboardingError(
          'ollama_onboarding.registration_failed',
          'Ollama 模型注册失败',
          500
        );
      }
      try {
        await dependencies.providerConfigurations.completeModelRegistration(intentId);
      } catch (error: unknown) {
        logger.warn('模型已注册，Ollama Provider 归属将在下次启动时恢复', {
          provider_definition_id: provider.id,
          provider_connection_definition_id: connection.id,
          provider_model_id: command.endpoint_model_id,
          model_config_id: modelId,
          intent_id: intentId,
          failure_type: error instanceof Error ? error.name : 'unknown',
        });
      }
      return {
        model_id: modelId,
        provider_definition_id: provider.id,
        provider_connection_definition_id: connection.id,
        provider_model_id: command.endpoint_model_id,
      };
    },
  });
}
