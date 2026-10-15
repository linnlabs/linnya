import type {
  CustomApiProviderRefreshCommand,
  CustomApiProviderRefreshResponse,
} from '@app/schemas/custom-api-onboarding';
import {
  ModelCatalogConflictError,
  ModelDiscoveryError,
  type UserModelRegistration,
} from 'src/domains/model-catalog';

import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import type {
  CustomApiProviderRefreshTarget,
  NewCustomApiDiscoveredModel,
} from '../definitions/customApiProviderRefreshTarget';
import { resolveCustomApiProviderRefreshTargets } from '../functions/resolveCustomApiProviderRefreshTargets';
import { selectNewCustomApiModels } from '../functions/selectNewCustomApiModels';
import { buildCustomApiModelRegistration } from '../functions/buildCustomApiModelRegistration';
import { readCustomApiRuntimeBinding } from '../registry/customApiRuntimeBindingRegistry';

export async function refreshCustomApiProvider(
  command: CustomApiProviderRefreshCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiProviderRefreshResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  const targets = resolveCustomApiProviderRefreshTargets(
    command.provider_name,
    dependencies.modelCatalog.getModels(),
    dependencies.modelCatalog.getInferenceEndpoints(),
    modelId => dependencies.providerMembership.getByModelConfigId(modelId) !== undefined
  );
  const additions: {
    target: CustomApiProviderRefreshTarget;
    models: NewCustomApiDiscoveredModel[];
  }[] = [];

  try {
    // 在第一次 await 前固定全部连接的凭据，不能把并发编辑后的新 Key 发往旧 URL。
    // 明文只存在于当前用例栈，不进入目录 DTO、日志或 Renderer。
    const requests = targets.map(target => {
      const apiKey = dependencies.modelCatalog.resolveCredential(target.credentialModelId);
      if (!apiKey) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.credential_required',
          '该分组已保存的 API Key 不可用，请编辑供应商重新填写',
          401
        );
      }
      return { target, apiKey };
    });
    // 全部分组连接查询成功后才写目录，网络或鉴权失败时保持原列表和偏好。
    for (const { target, apiKey } of requests) {
      const discovered = await dependencies.modelDiscovery.discover({
        api_format: target.apiFormat,
        base_url: target.endpoint.base_url,
        api_key: apiKey,
      });
      additions.push({
        target,
        models: selectNewCustomApiModels(discovered.models, target.existingRemoteModelIds),
      });
    }

    const registrations: UserModelRegistration[] = [];
    for (const { target, models } of additions) {
      const binding = readCustomApiRuntimeBinding(target.apiFormat);
      for (const item of models) {
        const modelId = dependencies.idFactory.create();
        const model = buildCustomApiModelRegistration({
          modelId,
          endpointId: target.endpoint.endpoint_id,
          command: {
            api_format: target.apiFormat,
            base_url: target.endpoint.base_url,
            provider_name: command.provider_name,
            models: [item],
          },
          model: item,
          binding,
        });
        // 新发现的模型默认关闭，由用户显式启用；已有模型及其偏好完全不写回。
        registrations.push({
          model,
          endpoint: {
            kind: 'existing',
            inference_endpoint_id: target.endpoint.id,
          },
        });
      }
    }
    if (registrations.length > 0) {
      await dependencies.modelPickerPreferences.setModelVisibilities(
        registrations.map(({ model }) => ({ model_config_id: model.id, visible: false }))
      );
      await dependencies.modelCatalog.registerUserModels(registrations, revision);
    }
    return {
      provider_name: command.provider_name,
      added_model_ids: registrations.map(item => item.model.id),
    };
  } catch (error: unknown) {
    if (error instanceof CustomApiOnboardingError) throw error;
    if (error instanceof ModelCatalogConflictError) {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.configuration_changed',
        error.message,
        409
      );
    }
    // 远端响应可能包含认证信息，不将原始错误正文或请求头回传 Renderer。
    const authenticationFailed =
      error instanceof ModelDiscoveryError && error.code === 'model_discovery.auth_failed';
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.refresh_failed',
      authenticationFailed
        ? '已保存的 API Key 鉴权失败，请编辑供应商检查 Key'
        : '刷新模型列表失败，请检查服务连接后重试',
      error instanceof ModelDiscoveryError ? error.statusCode : 500
    );
  }
}
