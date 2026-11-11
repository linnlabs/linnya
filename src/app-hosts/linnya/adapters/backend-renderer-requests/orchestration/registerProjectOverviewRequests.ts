import {
  PROJECT_OVERVIEW_CHANNEL,
  PROJECT_OVERVIEW_MATCH_CHANNEL,
  PROJECT_OVERVIEW_SET_FIELD_CHANNEL,
  PROJECT_SAVED_FILTERS_CHANNEL,
  ProjectOverviewMatchRequestSchema,
  ProjectOverviewRequestSchema,
  ProjectOverviewSetFieldRequestSchema,
  ProjectSavedFiltersRequestSchema,
  SEMANTIC_SCHEMA_MANAGE_CHANNEL,
  SemanticSchemaManageRequestSchema,
} from '@app/schemas';
import {
  handleProjectSavedFilters,
  matchProjectFields,
  readProjectOverview,
  setProjectField,
} from 'src/app-hosts/linnya/application/project-overview';
import { manageSemanticSchema } from 'src/app-hosts/linnya/application/semantic-schema';
import type { BackendRuntimeOwner } from '../../../backend-runtime/orchestration/backendRuntimeOwner';
import type { BackendRendererRequestRegistryPort } from '../definitions/backendRendererRequest';

export function registerProjectOverviewRequests(
  runtimeOwner: BackendRuntimeOwner,
  registry: BackendRendererRequestRegistryPort,
): void {
  const databaseService = runtimeOwner.getServices().databaseService;
  if (!databaseService) throw new Error('Project overview requires database service');
  registry.handle(PROJECT_OVERVIEW_CHANNEL, request => readProjectOverview(
    databaseService.getDb(),
    ProjectOverviewRequestSchema.parse(request),
  ));
  registry.handle(PROJECT_SAVED_FILTERS_CHANNEL, request => handleProjectSavedFilters(
    databaseService.getDb(),
    ProjectSavedFiltersRequestSchema.parse(request),
  ));
  registry.handle(PROJECT_OVERVIEW_MATCH_CHANNEL, request => matchProjectFields(
    databaseService.getDb(),
    ProjectOverviewMatchRequestSchema.parse(request),
  ));
  registry.handle(SEMANTIC_SCHEMA_MANAGE_CHANNEL, request => manageSemanticSchema(
    databaseService.getDb(),
    SemanticSchemaManageRequestSchema.parse(request),
  ));
  registry.handle(PROJECT_OVERVIEW_SET_FIELD_CHANNEL, request => setProjectField(
    databaseService.getDb(),
    ProjectOverviewSetFieldRequestSchema.parse(request),
  ));
}
