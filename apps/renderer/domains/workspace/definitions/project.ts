import type { ProjectSystemRole } from '@app/schemas';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  systemRole: ProjectSystemRole | null;
  canDelete: boolean;
  createdAt: number;
  updatedAt: number;
}
