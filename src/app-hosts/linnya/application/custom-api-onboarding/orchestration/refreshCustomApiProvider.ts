import type {
  CustomApiProviderRefreshCommand,
  CustomApiProviderRefreshResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError, ModelDiscoveryError } from 'src/domains/model-catalog';

import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import type { CustomApiProviderRefreshChanges } from '../definitions/customApiProviderRefreshTarget';
import { resolveCustomApiProviderRefreshTargets } from '../functions/resolveCustomApiProviderRefreshTargets';
import {
  buildCustomApiProviderRefreshDiff,
  selectCustomApiProviderRefreshChanges,
} from '../functions/planCustomApiProviderRefresh';

export async function refreshCustomApiProvider(
  command: CustomApiProviderRefreshCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiProviderRefreshResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  const targets = resolveCustomApiProviderRefreshTargets(
    command.provider_name,
    dependencies.modelCatalog.getCustomApiGroups(),
    dependencies.modelCatalog.getModels(),
    dependencies.modelCatalog.getInferenceEndpoints(),
    modelId => dependencies.providerMembership.getByModelConfigId(modelId) !== undefined
  );
  const changes: CustomApiProviderRefreshChanges[] = [];

  try {
    // 在第一次 await 前固定全部连接的凭据，不能把并发编辑后的新 Key 发往旧 URL。
    // 明文只存在于当前用例栈，不进入目录 DTO、日志或 Renderer。
    const requests = targets.map(target => {
      const apiKey = dependencies.modelCatalog.resolveInferenceEndpointCredential(
        target.endpoint.id
      );
      if (!apiKey) {
        throw new CustomApiOnboardingError(
          'custom_api_onboarding.credential_required',
          '该分组已保存的 API Key 不可用，请编辑供应商重新填写',
          401
        );
      }
      return { target, apiKey };
    });
    // 所有连接的完整快照都成功后才增删，后页或后一个连接失败不能删除旧模型。
    for (const { target, apiKey } of requests) {
      const discovered = await dependencies.modelDiscovery.discover({
        api_format: target.apiFormat,
        base_url: target.endpoint.base_url,
        api_key: apiKey,
      });
      changes.push(selectCustomApiProviderRefreshChanges(target, discovered.models));
    }
    const diff = buildCustomApiProviderRefreshDiff(
      command.provider_name,
      changes,
      changes.flatMap(change => change.addedModels.map(() => dependencies.idFactory.create()))
    );
    // 新 ID 的关闭偏好先保存；完整增删在目录的同一版本事务中发布。
    if (diff.added.length > 0) {
      await dependencies.modelPickerPreferences.setModelVisibilities(
        diff.added.map(model => ({ model_config_id: model.id, visible: false }))
      );
    }
    await dependencies.modelCatalog.applyCustomApiGroupModelDiff(
      command.provider_name,
      diff,
      revision
    );
    let recoveryPending = false;
    if (diff.removed.length > 0) {
      try {
        await dependencies.modelPickerPreferences.removeModelPreferences(diff.removed);
      } catch {
        // 目录已同步成功；孤儿偏好由启动 reconcile 清理，不能谎报整次刷新失败。
        recoveryPending = true;
      }
    }
    return {
      provider_name: command.provider_name,
      added_model_ids: diff.added.map(model => model.id),
      removed_model_ids: diff.removed,
      model_picker_preference_recovery_pending: recoveryPending,
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
