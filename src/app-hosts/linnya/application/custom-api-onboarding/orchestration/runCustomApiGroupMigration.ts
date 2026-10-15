import type { CustomApiGroupMigrationDependencies } from '../definitions/customApiGroupMigration';
import { projectCustomApiGroupMigrations } from '../functions/projectCustomApiGroupMigrations';

/** 启动编排只交付已确认的旧模型归属；Catalog 负责原子迁移，并保留已有空分组。 */
export async function runCustomApiGroupMigration(
  dependencies: CustomApiGroupMigrationDependencies
): Promise<void> {
  const revision = dependencies.modelCatalog.getUserRevision();
  const groups = projectCustomApiGroupMigrations(
    dependencies.modelCatalog.getModels(),
    modelId => dependencies.providerMembership.getByModelConfigId(modelId) !== undefined
  );
  await dependencies.modelCatalog.migrateCustomApiGroups(groups, revision);
}
