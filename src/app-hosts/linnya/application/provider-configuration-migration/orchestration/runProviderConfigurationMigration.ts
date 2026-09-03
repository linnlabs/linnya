import type {
  ProviderConfigurationMigrationBindingPort,
  ProviderConfigurationMigrationCatalogPort,
  ProviderConfigurationMigrationIdFactory,
  ProviderConfigurationMigrationModelCatalogPort,
  ProviderConfigurationMigrationRegistryPort,
  ProviderConfigurationMigrationReport,
} from '../definitions/providerConfigurationMigrationPorts';
import { projectLegacyFormalProviderConfigurations } from '../functions/projectLegacyFormalProviderConfigurations';

export interface RunProviderConfigurationMigrationDependencies {
  readonly providerCatalog: ProviderConfigurationMigrationCatalogPort;
  readonly runtimeBindings: ProviderConfigurationMigrationBindingPort;
  readonly modelCatalog: ProviderConfigurationMigrationModelCatalogPort;
  readonly providerConfigurations: ProviderConfigurationMigrationRegistryPort;
  readonly idFactory: ProviderConfigurationMigrationIdFactory;
}

/** 开发期一次性迁移；完成标记与结果同一次 Provider Configuration 写入提交。 */
export async function runProviderConfigurationMigration(
  dependencies: RunProviderConfigurationMigrationDependencies
): Promise<ProviderConfigurationMigrationReport> {
  if (!dependencies.providerConfigurations.needsLegacyFormalProviderMigration()) {
    return { migrated_provider_count: 0, migrated_model_count: 0, skipped_provider_ids: [] };
  }
  const projection = projectLegacyFormalProviderConfigurations({
    providers: dependencies.providerCatalog.list(),
    bindings: dependencies.runtimeBindings,
    models: dependencies.modelCatalog.getModels(),
    endpoints: dependencies.modelCatalog.getInferenceEndpoints(),
    createId: () => dependencies.idFactory.create(),
  });
  await dependencies.providerConfigurations.completeLegacyFormalProviderMigration(
    projection.configuredProviders
  );
  return {
    migrated_provider_count: projection.configuredProviders.length,
    migrated_model_count: projection.configuredProviders.reduce(
      (count, provider) => count + provider.models.length,
      0
    ),
    skipped_provider_ids: projection.skippedProviderIds,
  };
}
