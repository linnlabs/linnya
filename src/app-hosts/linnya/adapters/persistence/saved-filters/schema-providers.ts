import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { PROJECT_SAVED_FILTER_SCHEMAS } from './savedFilters.schema';

export function getProjectSavedFilterSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'project-saved-filters', getSchema: () => [...PROJECT_SAVED_FILTER_SCHEMAS] }];
}
