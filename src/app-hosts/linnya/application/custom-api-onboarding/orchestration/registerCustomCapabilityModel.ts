import { assertCustomApiGroupModelKind } from '../functions/assertCustomApiGroupModelKind';
import type {
  CustomCapabilityModelCommand,
  CustomApiModelRegistrationResponse,
} from '@app/schemas/custom-api-onboarding';
import { ModelCatalogConflictError } from 'src/domains/model-catalog';
import type { CustomApiOnboardingDependencies } from '../definitions/customApiOnboardingPorts';
import { CustomApiOnboardingError } from '../definitions/customApiOnboardingError';
import { buildCustomCapabilityRegistration } from '../functions/buildCustomCapabilityRegistration';

export async function registerCustomCapabilityModel(
  command: CustomCapabilityModelCommand,
  dependencies: CustomApiOnboardingDependencies
): Promise<CustomApiModelRegistrationResponse> {
  const revision = dependencies.modelCatalog.getUserRevision();
  assertCustomApiGroupModelKind(
    command.provider_name,
    command.api_format,
    dependencies.modelCatalog.getCustomApiGroups(),
    dependencies.modelCatalog.getInferenceEndpoints()
  );
  const registration = buildCustomCapabilityRegistration(
    command,
    dependencies.idFactory.create(),
    dependencies.idFactory.create()
  );
  try {
    await dependencies.modelCatalog.registerCustomApiModels(
      command.provider_name,
      [registration],
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
      'custom_api_onboarding.registration_failed',
      '模型保存失败，请检查连接配置',
      500
    );
  }
  return { model_id: registration.model.id };
}
