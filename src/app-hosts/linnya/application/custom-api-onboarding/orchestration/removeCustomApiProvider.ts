import type {
  CustomApiProviderRemovalCommand,
  CustomApiProviderRemovalResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError } from 'src/domains/model-catalog';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { selectCustomApiProviderModels } from '../functions/selectCustomApiProviderModels';
import { requireCustomApiGroup } from '../functions/requireCustomApiGroup';

export async function removeCustomApiProvider(
  command: CustomApiProviderRemovalCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiProviderRemovalResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  requireCustomApiGroup(command.provider_name, dependencies.modelCatalog.getCustomApiGroups());
  const ids = selectCustomApiProviderModels(
    command.provider_name,
    dependencies.modelCatalog.getModels(),
    modelId => dependencies.providerMembership.getByModelConfigId(modelId) !== undefined
  ).map(model => model.id);
  try {
    await dependencies.modelCatalog.removeCustomApiGroup(command.provider_name, revision);
  } catch (error: unknown) {
    if (error instanceof ModelCatalogConflictError)
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.configuration_changed',
        error.message,
        409
      );
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.removal_failed',
      '自定义模型分组删除失败',
      500
    );
  }
  let recoveryPending = false;
  try {
    if (ids.length > 0) await dependencies.modelPickerPreferences.removeModelPreferences(ids);
  } catch {
    // 删除已提交；偏好残留由启动 identity reconcile 清理，不能误报整个删除失败。
    recoveryPending = true;
  }
  return { removed_model_ids: ids, model_picker_preference_recovery_pending: recoveryPending };
}
