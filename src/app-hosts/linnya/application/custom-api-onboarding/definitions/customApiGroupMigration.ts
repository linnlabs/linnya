import type { ModelCatalog } from 'src/domains/model-catalog';
import type { CustomApiOnboardingProviderMembershipPort } from './customApiOnboardingPorts';

export interface CustomApiGroupMigrationDependencies {
  readonly modelCatalog: Pick<
    ModelCatalog,
    'getModels' | 'getUserRevision' | 'migrateCustomApiGroups'
  >;
  readonly providerMembership: CustomApiOnboardingProviderMembershipPort;
}
