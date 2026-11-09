import { PROJECT_OVERVIEW_CHANNEL, ProjectOverviewRequestSchema } from '@app/schemas';
import { readProjectOverview } from 'src/app-hosts/linnya/application/project-overview';
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
}
