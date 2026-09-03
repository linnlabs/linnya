export const DEFAULT_PROJECT_SYSTEM_ROLE = 'default';
export const DEFAULT_PROJECT_NAME = '默认项目';
export const DEFAULT_PROJECT_DESCRIPTION = '您的第一个项目';

export type ProjectSystemRole = typeof DEFAULT_PROJECT_SYSTEM_ROLE;

export interface WorkspaceProject {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  system_role: ProjectSystemRole | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  can_delete: boolean;
}

export interface WorkspaceProjectRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  system_role: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}
