import type {
  CustomCapabilityProviderUpdateCommand,
  CustomApiProviderUpdateResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError } from 'src/domains/model-catalog';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { planCustomCapabilityProviderUpdate } from '../functions/planCustomCapabilityProviderUpdate';

export async function updateCustomCapabilityProvider(
  command: CustomCapabilityProviderUpdateCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiProviderUpdateResponse> {
  const catalog = dependencies.modelCatalog;
  const revision = catalog.getUserRevision();
  const plan = planCustomCapabilityProviderUpdate(
    command,
    catalog.getCustomApiGroups(),
    catalog.getModels(),
    catalog.getInferenceEndpoints(),
    dependencies.idFactory.create()
  );
  try {
    await catalog.rebindCustomApiGroup(
      command.current_provider_name,
      command.provider_name,
      plan.models,
      plan.endpoint,
      revision
    );
  } catch (error: unknown) {
    if (error instanceof ModelCatalogConflictError)
      throw new CustomApiOnboardingError(
        'custom_api_onboarding.configuration_changed',
        error.message,
        409
      );
    throw new CustomApiOnboardingError(
      'custom_api_onboarding.update_failed',
      '连接保存失败，请重试',
      500
    );
  }
  return { provider_name: command.provider_name, model_ids: plan.models.map(model => model.id) };
}
