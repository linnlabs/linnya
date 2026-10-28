import type { ProjectRecord } from '@app/schemas';
import {
  DefaultProjectDeleteBlockedError,
  ProjectNameConflictError,
} from '../../../definitions/projectErrors';
import type { ProjectRow } from '../definitions/projectRow';

export function assertProjectNameAvailable(
  existing: ProjectRow | undefined,
  currentProjectId?: string
): void {
  if (existing && existing.id !== currentProjectId)
    throw new ProjectNameConflictError(existing.name);
}

export function assertProjectDeletable(project: ProjectRecord): void {
  if (!project.can_delete) throw new DefaultProjectDeleteBlockedError(project.id);
}
