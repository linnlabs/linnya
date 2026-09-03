import type { WorkspaceScope } from '@/shared/stores/workspaceScopeStore';

export type SidebarSceneKind = 'workspace' | 'knowledge-base' | 'plugin-store' | 'project-setup';

interface AssistantSelectionInput {
  activeScene: SidebarSceneKind;
  currentScope: WorkspaceScope;
}

interface ProjectSelectionInput {
  activeScene: SidebarSceneKind;
  currentScope: WorkspaceScope;
  projectId: string;
}

export function isAssistantEntrySelected(input: AssistantSelectionInput): boolean {
  return input.activeScene === 'workspace' && input.currentScope.kind === 'linnya-assistant';
}

export function isPluginStoreEntrySelected(activeScene: SidebarSceneKind): boolean {
  return activeScene === 'plugin-store';
}

export function isProjectChatEntrySelected(input: ProjectSelectionInput): boolean {
  return (
    input.activeScene === 'workspace'
    && input.currentScope.kind === 'project'
    && input.currentScope.projectId === input.projectId
  );
}
