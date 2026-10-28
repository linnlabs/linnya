import type { ProjectRecord } from '@app/schemas';
import type { Project } from '../definitions/project';

export function toProject(dto: ProjectRecord): Project {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    icon: dto.icon,
    systemRole: dto.system_role,
    canDelete: dto.can_delete,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
