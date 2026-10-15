import type {
  CustomApiProviderUpdateCommand,
  CustomApiProviderUpdateResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError } from 'src/domains/model-catalog';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { planCustomApiProviderUpdate } from '../functions/planCustomApiProviderUpdate';

export async function updateCustomApiProvider(
  command: CustomApiProviderUpdateCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiProviderUpdateResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  const plan = planCustomApiProviderUpdate(
    command,
    dependencies.modelCatalog.getCustomApiGroups(),
    dependencies.modelCatalog.getModels(),
    dependencies.modelCatalog.getInferenceEndpoints(),
    modelId => dependencies.providerMembership.getByModelConfigId(modelId) !== undefined,
    dependencies.idFactory.create()
  );
  try {
    await dependencies.modelCatalog.rebindCustomApiGroup(
      command.current_provider_name,
      command.provider_name,
      plan.models,
      plan.endpoint,
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
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.update_failed',
      '自定义模型分组更新失败',
      500
    );
  }
  return { provider_name: command.provider_name, model_ids: plan.models.map(model => model.id) };
}
