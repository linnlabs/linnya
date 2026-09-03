/**
 * Workspace sidebar 的 app-level 公开入口。
 *
 * 中文说明：
 * - app/layout 可以组合 workspace 侧边栏能力，但不应该散落依赖内部文件路径；
 * - 这里仅暴露侧边栏组合面实际需要的窄能力，避免 workspace domain 变成通用杂物出口。
 */

export { default as FileTreeView } from './file-tree/FileTreeView.vue';
export { default as CreateProjectModal } from './components/CreateProjectModal.vue';
export { default as ContextMenu } from './components/ContextMenu.vue';

export { useProjectOperations } from './composables/useProjectOperations.js';
export { useContextMenu } from './composables/useContextMenu.js';
export { useSidebarDragDrop } from './composables/useSidebarDragDrop.js';
export { useDocumentOperations } from './composables/useDocumentOperations';
export { useAddToKnowledgeBase } from './composables/useAddToKnowledgeBase';
export { useFixedDropdownPosition } from './composables/useFixedDropdownPosition';

export {
  isAssistantEntrySelected,
  isPluginStoreEntrySelected,
  isProjectChatEntrySelected,
} from './functions/sidebarEntrySelection';
export {
  buildProjectMenuOptions,
  isDefaultWorkspaceProject,
  isProjectDeleteDisabled,
} from './functions/projectMenuModel';
export type {
  ProjectMenuAction,
  ProjectMenuOption,
  ProjectMenuProject,
} from './functions/projectMenuModel';
export { shouldRetainExpandedProjects } from './functions/projectExpansionRetention';
export { filterProjectTreeByName } from '../../functions/filterProjectTreeByName';
export { useSidebarProjectExpansionStore } from './store/sidebarProjectExpansionStore';
