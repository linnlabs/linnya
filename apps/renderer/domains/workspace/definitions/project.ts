export type WorkspaceProjectSystemRole = 'default';

export interface Project {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  systemRole: WorkspaceProjectSystemRole | null;
  canDelete: boolean;
  createdAt: number;
  updatedAt: number;
}
