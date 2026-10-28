import type { ProjectRecord } from '@app/schemas';
import { DEFAULT_PROJECT_SYSTEM_ROLE } from '../../../definitions/projectLifecycle';
import type { ProjectRow } from '../definitions/projectRow';

export function toProjectRecord(row: ProjectRow): ProjectRecord {
  const systemRole = row.system_role;
  return {
    ...row,
    system_role: systemRole,
    can_delete: systemRole !== DEFAULT_PROJECT_SYSTEM_ROLE,
  };
}
