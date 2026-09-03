import type { WorkspaceMessageResolver } from '@/domains/workspace/definitions/workspaceMessages';

export type ProjectMenuAction = 'overview' | 'edit' | 'delete';

export interface ProjectMenuProject {
  canDelete: boolean;
  systemRole?: 'default' | null;
}

export interface ProjectMenuOption {
  value: ProjectMenuAction;
  text: string;
  variant?: 'danger';
  disabled?: boolean;
}

export function isDefaultWorkspaceProject(project: ProjectMenuProject): boolean {
  return project.systemRole === 'default';
}

export function isProjectDeleteDisabled(project: ProjectMenuProject): boolean {
  return !project.canDelete;
}

export function buildProjectMenuOptions(
  project: ProjectMenuProject | null | undefined,
  message: WorkspaceMessageResolver,
): ProjectMenuOption[] {
  return [
    { value: 'overview', text: message('workspace.sidebar.project.menu.overview') },
    { value: 'edit', text: message('workspace.sidebar.project.menu.edit') },
    {
      value: 'delete',
      text: message('workspace.sidebar.project.menu.delete'),
      variant: 'danger',
      disabled: project ? isProjectDeleteDisabled(project) : true,
    },
  ];
}
