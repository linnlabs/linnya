import type { ConversationControlProject, ProjectRecord } from '@app/schemas';

export function projectControlRecord(record: ProjectRecord): ConversationControlProject {
  return {
    project_id: record.id,
    name: record.name,
    description: record.description,
    icon: record.icon,
    system_role: record.system_role,
    can_delete: record.can_delete,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}
