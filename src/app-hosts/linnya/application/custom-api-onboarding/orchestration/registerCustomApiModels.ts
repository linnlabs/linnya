import type {
  CustomApiModelRegistrationCommand,
  CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError } from 'src/domains/model-catalog';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { planCustomApiModelRegistration } from '../functions/planCustomApiModelRegistration';

export async function registerCustomApiModels(
  command: CustomApiModelRegistrationCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiModelRegistrationResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  const firstModelId = dependencies.idFactory.create();
  const endpointResourceId = dependencies.idFactory.create();
  const { registrations, preferences } = planCustomApiModelRegistration(
    command,
    dependencies.modelCatalog.getInferenceEndpoints(),
    {
      endpointResourceId,
      modelIds: command.models.map((_item, index) =>
        index === 0 ? firstModelId : dependencies.idFactory.create()
      ),
    }
  );
  try {
    // 两个持久化 owner 不能假装拥有分布式事务：先保存不可见的新 ID 偏好，
    // 再一次发布整批目录。目录失败只留下孤儿偏好，启动 reconcile 会清理它们。
    if (preferences.length > 0)
      await dependencies.modelPickerPreferences.setModelVisibilities(preferences);
    await dependencies.modelCatalog.registerCustomApiModels(
      command.provider_name,
      registrations,
      revision
    );
  } catch (error: unknown) {
    if (error instanceof ModelCatalogConflictError) {
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.configuration_changed',
        error.message,
        409
      );
    }
    // 凭据存储或上游错误内容不属于 Renderer 的公开错误合同。
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.registration_failed',
      '自定义 API 模型注册失败',
      500
    );
  }
  const ids = registrations.map(item => item.model.id);
  return { model_id: ids[0], ...(ids.length > 1 ? { model_ids: ids } : {}) };
}
