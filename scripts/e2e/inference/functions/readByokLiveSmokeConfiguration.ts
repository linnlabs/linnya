import type {
  ByokLiveSmokeConfiguration,
  ByokLiveSmokeTargetDescriptor,
} from '../definitions/byokLiveSmoke';
import { formalProviderRuntimeManifestRegistry } from '@linnya/provider-catalog/runtime-bindings';
import { projectByokLiveSmokeTargetDescriptors } from './projectByokLiveSmokeTargetDescriptors';

const TARGET_SELECTION_ENVIRONMENT_VARIABLE = 'LINNYA_BYOK_TARGETS';

const BYOK_LIVE_SMOKE_TARGETS = projectByokLiveSmokeTargetDescriptors(
  formalProviderRuntimeManifestRegistry.bindings
);

function selectedDescriptors(
  environment: NodeJS.ProcessEnv
): readonly ByokLiveSmokeTargetDescriptor[] {
  const rawSelection = environment[TARGET_SELECTION_ENVIRONMENT_VARIABLE]?.trim();
  if (!rawSelection) return [];
  if (rawSelection === 'all') return BYOK_LIVE_SMOKE_TARGETS;

  const requestedIds = [
    ...new Set(
      rawSelection
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
    ),
  ];
  const invalidIds = requestedIds.filter(
    requestedId => !BYOK_LIVE_SMOKE_TARGETS.some(target => target.id === requestedId)
  );
  if (invalidIds.length > 0) {
    throw new Error(
      `BYOK live smoke 包含未知 target：${invalidIds.join(', ')}；可选值：${BYOK_LIVE_SMOKE_TARGETS.map(target => target.id).join(', ')}, all`
    );
  }
  return BYOK_LIVE_SMOKE_TARGETS.filter(target => requestedIds.includes(target.id));
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`BYOK live smoke 缺少环境变量：${name}`);
  return value;
}

export function missingByokLiveSmokeEnvironmentVariables(
  environment: NodeJS.ProcessEnv
): readonly string[] {
  const descriptors = selectedDescriptors(environment);
  if (descriptors.length === 0) return [TARGET_SELECTION_ENVIRONMENT_VARIABLE];
  return [
    ...new Set(
      descriptors.flatMap(descriptor => [
        descriptor.credentialEnvironmentVariable,
        descriptor.modelEnvironmentVariable,
      ])
    ),
  ].filter(name => !environment[name]?.trim());
}

export function readByokLiveSmokeConfiguration(
  environment: NodeJS.ProcessEnv
): ByokLiveSmokeConfiguration {
  const missing = missingByokLiveSmokeEnvironmentVariables(environment);
  if (missing.length > 0) {
    throw new Error(`BYOK live smoke 缺少环境变量：${missing.join(', ')}`);
  }

  const targets = selectedDescriptors(environment).map(descriptor => ({
    id: descriptor.id,
    name: descriptor.name,
    capability_id: descriptor.capability_id,
    surface: descriptor.surface,
    endpoint_id: descriptor.endpoint_id,
    endpoint_model_id: requiredValue(environment, descriptor.modelEnvironmentVariable),
    base_url:
      environment[descriptor.baseUrlEnvironmentVariable]?.trim() || descriptor.defaultBaseUrl,
    auth_profile: descriptor.auth_profile,
    credential: requiredValue(environment, descriptor.credentialEnvironmentVariable),
  }));

  return { targets };
}
