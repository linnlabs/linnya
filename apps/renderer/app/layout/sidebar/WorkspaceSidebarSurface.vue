<!--
  apps/renderer/app/layout/sidebar/WorkspaceSidebarSurface.vue

  左侧工作区侧边栏组合面：负责串联 workspace、conversation、knowledge base 等跨 domain 能力。
  具体展示拆到 sidebar/components，避免 app-level 编排容器重新膨胀成大而全组件。
-->
<template>
  <div
    class="workspace-sidebar"
    :class="[
      `workspace-sidebar--${effectiveSidebarNav}`,
      `workspace-sidebar--${sidebarMode}`,
    ]"
  >
    <SidebarListNav
      v-if="effectiveSidebarNav === 'list'"
      :active-scene="activeScene"
      :is-plugin-store-active="isPluginStoreActive()"
      @new-conversation="handleNewConversation"
      @create-project="promptAndCreateProject"
      @knowledge-base-click="handleKnowledgeBaseClick"
      @plugin-store-click="handlePluginStoreClick"
    />

    <SidebarProjectNav
      v-else
      :project-name="projectNavProjectName"
      :sidebar-mode="sidebarMode"
      :chat-search-query="projectChatSearchQuery"
      :file-search-query="projectFileSearchQuery"
      :show-create-menu="showProjectCreateMenu"
      :create-options="projectCreateOptions"
      @back="handleBackToList"
      @set-mode="setSidebarMode"
      @new-conversation="handleNewConversation"
      @toggle-create-menu="toggleProjectCreateMenu"
      @close-create-menu="showProjectCreateMenu = false"
      @create-selection="handleProjectCreateSelection"
      @update:chat-search-query="projectChatSearchQuery = $event"
      @update:file-search-query="projectFileSearchQuery = $event"
    />

    <div v-if="projectsStore.isLoading" class="loading-state">
      <svg class="loading-icon spin" viewBox="0 0 24 24"><path d="M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8Z"/></svg>
      <p>{{ workspaceMessage('workspace.sidebar.state.loadingProjects') }}</p>
    </div>

    <div v-else-if="projectsStore.error" class="error-state">
      <svg class="error-icon" viewBox="0 0 24 24"><path d="M11 15h2v2h-2v-2zm0-8h2v6h-2V7z"/><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>
      <p>{{ workspaceMessage('workspace.sidebar.state.error') }}</p>
    </div>

    <SidebarContent
      v-else
      ref="sidebarContentRef"
      :sidebar-nav="effectiveSidebarNav"
      :sidebar-mode="sidebarMode"
      :current-scope="currentScope"
      :projects="projectsStore.projects"
      :is-workspace-scene="isWorkspaceScene"
      :project-chat-search-query="projectChatSearchQuery"
      :project-tree="treeStore.projectTree"
      :filtered-project-tree="filteredProjectTree"
      :current-project-name="currentProjectName"
      :is-filtering-project-files="isFilteringProjectFiles"
      :is-drag-over-root="isDragOverRoot"
      :should-show-project-tree-loading="shouldShowProjectTreeLoading"
      :is-project-setup-view="isProjectSetupView"
      :is-project-files-panel-visible="isProjectFilesPanelVisible"
      :is-project-expanded="isProjectExpanded"
      :get-conversation-reveal-pulse-key="getConversationRevealPulseKey"
      :workspace-message="workspaceMessage"
      @root-drag-over="handleRootDragOver"
      @root-drag-leave="handleRootDragLeave"
      @root-drop="handleRootDrop"
      @display-change="scheduleSidebarOverlayScrollUpdate"
      @project-chat-click="handleProjectChatClick"
      @open-project="handleOpenProject"
      @open-project-overview="handleOpenProjectOverview"
      @edit-project="promptEditSpecificProject"
      @delete-project="handleDeleteProject"
      @project-conversation-prefetch="handleProjectConversationPrefetch"
      @project-conversation-selected="handleProjectConversationSelected"
      @collapse-transition-start="handleProjectCollapseTransitionStart"
      @collapse-transition-end="handleProjectCollapseTransitionEnd"
      @tree-item-click="handleTreeItemClick"
      @create-file="handleCreateFile"
      @create-folder="createNewFolder"
      @show-context-menu="handleContextMenuRequest"
      @edit-active-project="promptEditProject"
      @ai-init-project="initializeExistingProjectWithAi"
    />

    <ContextMenu
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :item="contextMenu.item"
      :batch-selection="isBatchContextMenu"
      @close="contextMenu.visible = false"
      @select="handleMenuSelect"
    />

    <CreateProjectModal
      :show="showCreateProjectDialog"
      :is-edit-mode="isEditMode"
      :initial-data="editProjectData"
      @close="closeProjectDialog"
      @confirm="handleProjectDialogConfirm"
      @ai-create="handleAiCreateProject"
    />

    <AlertDialog
      :visible="showDeleteProjectDialog"
      :message="deleteDialogMessage"
      :is-confirmation="true"
      :title="workspaceMessage('workspace.sidebar.project.delete.title')"
      :confirm-text="workspaceMessage('workspace.sidebar.project.delete.confirm')"
      :cancel-text="workspaceMessage('workspace.sidebar.project.delete.cancel')"
      :is-dangerous-action="true"
      @confirm="handleConfirmDeleteProject"
      @cancel="handleCancelDeleteProject"
      @close="handleCancelDeleteProject"
    />

    <!-- 文件树“添加到知识库”统一弹窗：右键菜单与 More 菜单共用 -->
    <AddToKnowledgeBaseModal
      :show="showAddToKbModal"
      :documentName="targetDocumentName"
      @close="closeAddToKnowledgeBaseModal"
      @confirm="handleAddToKbConfirm"
    />

    <SidebarAssetPreview
      :image-preview="imagePreview"
      :text-preview="textPreview"
      @close-image="closeAssetImagePreview"
      @image-error="handleImagePreviewLoadError"
      @close-text="closeTextPreview"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { PROJECT_PLANNING_PROMPT_KEY } from '@app/schemas';
import { useWorkspaceProjectsStore, useWorkspaceSelectionStore, useWorkspaceTreeStore } from '@/domains/workspace/store';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import { useConversationState } from '@/domains/conversation/store/conversationState';
import { useHistoryListStore } from '@/domains/conversation/history/store/historyListStore';
import { useUIStore } from '@/shared/stores/ui';
import { useFileStore } from '@/shared/stores/file';
import { useNotificationStore } from '@/app/notification';
import { saveDeactivateThen } from '@/domains/workspace/services/file-manager/index';
import { useLocalizedCreatableDocumentTypes } from '@/app/plugins/ui/useDocumentTypePresentation';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { getWorkspaceScopeKey, useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useSidebarConversationHistoryRevealStore } from '@/app/layout/store/sidebarConversationHistoryRevealStore';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';
import { useProjectOverviewModalStore } from '@/domains/workspace/features/project-overview/store/projectOverviewModalStore';
import { AlertDialog } from '@linnya/renderer-ui';
import AddToKnowledgeBaseModal from '@/domains/knowledgebase/ui/AddToKnowledgeBaseModal.vue';
import { useOverlayScrollViewport } from '@linnya/renderer-ui/scroll';
import {
  ContextMenu,
  CreateProjectModal,
  filterProjectTreeByName,
  isPluginStoreEntrySelected,
  shouldRetainExpandedProjects,
  useAddToKnowledgeBase,
  useContextMenu,
  useDocumentOperations,
  useProjectOperations,
  useSidebarDragDrop,
  useSidebarProjectExpansionStore,
} from '@/domains/workspace/ui/sidebar';
import SidebarAssetPreview from '@/app/layout/sidebar/components/SidebarAssetPreview.vue';
import SidebarContent from '@/app/layout/sidebar/components/SidebarContent.vue';
import SidebarListNav from '@/app/layout/sidebar/components/SidebarListNav.vue';
import SidebarProjectNav from '@/app/layout/sidebar/components/SidebarProjectNav.vue';
import { useSidebarAssetPreviewState } from '@/app/layout/sidebar/composables/useSidebarAssetPreviewState';
import { useSidebarFileTreeOpen } from '@/app/layout/sidebar/composables/useSidebarFileTreeOpen';
import { useSidebarProjectDelete } from '@/app/layout/sidebar/composables/useSidebarProjectDelete';
import { openProjectWorkspaceFromSidebar } from '@/app/layout/orchestration/openProjectWorkspaceFromSidebar';
import { workspaceGateway } from '@/shared/ipc/workspaceGateway';
import { useWorkspaceLocalization } from '@/domains/workspace/ui/useWorkspaceLocalization';
import { workspaceAssetImagePreviewApi } from '@/domains/workspace/features/asset-image-preview';
import { resolveCurrentLayoutMessage } from '@/app/layout/functions/resolveCurrentLayoutMessage';

const props = defineProps({
  activeScene: {
    type: String,
    default: 'workspace',
  },
  sidebarNav: {
    type: String,
    default: 'list',
    validator: (value) => value === 'list' || value === 'project',
  },
  sidebarMode: {
    type: String,
    default: 'chat',
    validator: (value) => value === 'chat' || value === 'files',
  },
});

const emit = defineEmits([
  'linnya-assistant-click',
  'project-workspace-click',
  'knowledge-base-click',
  'plugin-store-click',
  'set-sidebar-nav',
  'set-sidebar-mode',
  'view-switch',
]);

const projectsStore = useWorkspaceProjectsStore();
const treeStore = useWorkspaceTreeStore();
const selectionStore = useWorkspaceSelectionStore();
const projectExpansionStore = useSidebarProjectExpansionStore();
const assistantStore = useAssistantStore();
const conversationState = useConversationState();
const historyListStore = useHistoryListStore();
const uiStore = useUIStore();
const fileStore = useFileStore();
const notificationStore = useNotificationStore();
const enabledPluginsStore = useEnabledPluginsStore();
const workspaceScopeStore = useWorkspaceScopeStore();
const sidebarHistoryRevealStore = useSidebarConversationHistoryRevealStore();
const projectOverviewModalStore = useProjectOverviewModalStore();
const { workspaceMessage } = useWorkspaceLocalization();

const isBatchContextMenu = computed(() => (
  contextMenu.value.item !== null
  && selectionStore.selectedNodeIds.size > 1
  && selectionStore.selectedNodeIds.has(contextMenu.value.item.id)
));

const {
  imagePreview,
  textPreview,
  closeTextPreview,
} = useSidebarAssetPreviewState();
const hasObservedLoadedProjectListForExpansion = ref(false);
const sidebarContentRef = ref(null);
const showProjectCreateMenu = ref(false);
const projectChatSearchQuery = ref('');
const projectFileSearchQuery = ref('');
const revealPulseScopeKey = ref(null);
const revealPulseKey = ref(0);
const projectHistoryDrawerReadyPromises = new Map();
const creatableDocumentTypes = useLocalizedCreatableDocumentTypes();

const showError = (message) => notificationStore.show(message, 'error');
const createProjectPlanningConversation = ({ projectId, projectName }) => {
  return conversationState.createConversation({
    title: resolveCurrentLayoutMessage('layout.sidebar.project.planningConversationTitle', { projectName }),
    autoActivate: true,
    metadata: {
      promptKey: PROJECT_PLANNING_PROMPT_KEY,
      projectId,
      isProjectSetup: true,
    },
  });
};

const {
  showCreateProjectDialog,
  isEditMode,
  editProjectData,
  promptAndCreateProject,
  promptEditProject,
  promptEditSpecificProject,
  closeProjectDialog,
  handleProjectDialogConfirm,
  handleAiCreateProject,
  initializeExistingProjectWithAi,
  deleteProject,
} = useProjectOperations(projectsStore, notificationStore, workspaceGateway, treeStore, {
  createProjectPlanningConversation,
});

const { isDragOverRoot, handleRootDragOver, handleRootDragLeave, handleRootDrop } = useSidebarDragDrop(showError);
const {
  showAddToKbModal,
  targetDocumentName,
  openAddToKnowledgeBaseModal,
  closeAddToKnowledgeBaseModal,
  handleAddToKbConfirm,
} = useAddToKnowledgeBase();

const {
  openDocumentByNodeType,
  createNewFile,
  createNewFolder,
} = useDocumentOperations(treeStore, uiStore, fileStore, notificationStore);

const {
  handleTreeItemClick,
  openAssetImagePreview,
  openAssetFilePreview,
  closeAssetImagePreview,
  handleImagePreviewLoadError,
} = useSidebarFileTreeOpen({
  treeStore,
  selectionStore,
  projectsStore,
  assistantStore,
  enabledPluginsStore,
  notificationStore,
  workspaceGateway,
  imagePreviewApi: workspaceAssetImagePreviewApi,
  openDocumentByNodeType,
  imagePreview,
  textPreview,
  workspaceMessage,
});

const { contextMenu, handleContextMenuRequest, handleMenuSelect } = useContextMenu(treeStore, fileStore, notificationStore, {
  openAssetImagePreview,
  openAssetFilePreview,
  createNewFile,
  createNewFolder,
  onAddToKnowledgeBase: (item) => {
    openAddToKnowledgeBaseModal(item?.name || workspaceMessage('workspace.sidebar.node.untitledDocument'));
  },
});

// 中文说明：
// - 右键菜单与 TreeItem 的 More 菜单必须共用同一份 action 分发逻辑（避免维护两套）
// - TreeItem 仅负责 UI（菜单展示/定位），业务动作统一在 app 组合面的 useContextMenu 内处理
provide('workspaceHandleMenuSelect', (payload) => handleMenuSelect(payload));

const sidebarMode = computed(() => props.sidebarMode);
const currentScope = computed(() => workspaceScopeStore.currentScope);
const effectiveSidebarNav = computed(() => {
  if (props.sidebarNav === 'project' && currentScope.value.kind === 'project') {
    return 'project';
  }

  return 'list';
});
const isWorkspaceScene = computed(() => props.activeScene === 'workspace');
const hasScrollableSidebarContent = computed(() => !projectsStore.isLoading && !projectsStore.error);

const readExposedElementRef = (exposedValue) => {
  return exposedValue && typeof exposedValue === 'object' && 'value' in exposedValue
    ? exposedValue.value
    : exposedValue ?? null;
};
const sidebarContentHostRef = computed(() => readExposedElementRef(sidebarContentRef.value?.sidebarContentHostRef));
const sidebarContentViewportMountRef = computed(() => readExposedElementRef(sidebarContentRef.value?.sidebarContentViewportMountRef));
const sidebarContentViewportRef = ref(null);

const projectCreateOptions = computed(() => [
  { value: 'folder', text: workspaceMessage('workspace.sidebar.fileTree.newFolder') },
  { isSeparator: true },
  ...creatableDocumentTypes.value.map((documentType) => ({
    value: documentType.createRequestType,
    text: documentType.localizedText.label,
  })),
]);

const projectNavProjectName = computed(() => {
  if (currentScope.value.kind !== 'project') return workspaceMessage('workspace.sidebar.project.fallbackName');
  const project = projectsStore.projects.find((item) => item.id === currentScope.value.projectId);
  return project ? project.name : workspaceMessage('workspace.sidebar.project.fallbackName');
});

const currentProjectName = computed(() => {
  if (!projectsStore.activeProjectId) return workspaceMessage('workspace.sidebar.projectFiles.fallbackName');
  const project = projectsStore.projects.find((item) => item.id === projectsStore.activeProjectId);
  return project ? project.name : workspaceMessage('workspace.sidebar.projectFiles.fallbackName');
});

const filteredProjectTree = computed(() => {
  return filterProjectTreeByName(treeStore.projectTree, projectFileSearchQuery.value);
});
const isFilteringProjectFiles = computed(() => projectFileSearchQuery.value.trim().length > 0);
const shouldShowProjectTreeLoading = computed(() => {
  if (!treeStore.isLoading) return false;
  const activeProjectId = projectsStore.activeProjectId;
  if (!activeProjectId) return true;

  return treeStore.loadedProjectId !== activeProjectId || treeStore.projectTree.length === 0;
});
const isProjectSetupView = computed(() => props.activeScene === 'project-setup');
const isProjectFilesPanelVisible = computed(() => {
  return isProjectSetupView.value || Boolean(projectsStore.activeProjectId);
});
const {
  showDeleteProjectDialog,
  deleteDialogMessage,
  handleDeleteProject,
  handleConfirmDeleteProject,
  handleCancelDeleteProject,
} = useSidebarProjectDelete({
  getProjects: () => projectsStore.projects,
  deleteProject,
  workspaceMessage,
});

const {
  init: initSidebarOverlayScroll,
  scheduleUpdate: scheduleSidebarOverlayScrollUpdate,
  beginStructureTransition: beginSidebarOverlayScrollStructureTransition,
  finishStructureTransition: finishSidebarOverlayScrollStructureTransition,
  destroy: destroySidebarOverlayScroll,
} = useOverlayScrollViewport({
  bindings: {
    hostRef: sidebarContentHostRef,
    viewportMountRef: sidebarContentViewportMountRef,
    viewportRef: sidebarContentViewportRef,
  },
});

const isPluginStoreActive = () => {
  return isPluginStoreEntrySelected(props.activeScene);
};

const isProjectExpanded = (projectId) => {
  return projectExpansionStore.isProjectExpanded(projectId);
};

const getConversationRevealPulseKey = (scope) => {
  return revealPulseScopeKey.value === getWorkspaceScopeKey(scope) ? revealPulseKey.value : 0;
};

const ensureSidebarOverlayScroll = async () => {
  if (!hasScrollableSidebarContent.value) {
    destroySidebarOverlayScroll();
    return;
  }

  await nextTick();
  initSidebarOverlayScroll();
};

const handleProjectCollapseTransitionStart = () => {
  beginSidebarOverlayScrollStructureTransition();
};

const handleProjectCollapseTransitionEnd = () => {
  finishSidebarOverlayScrollStructureTransition();
};

const ensureProjectHistoryReadyForDrawer = async (projectId) => {
  const scope = { kind: 'project', projectId };
  if (historyListStore.hasLoadedScope(scope)) {
    return;
  }
  const pendingReady = projectHistoryDrawerReadyPromises.get(projectId);
  if (pendingReady) {
    await pendingReady;
    return;
  }

  // 中文说明：项目列表里的历史对话是按需挂载的；先预热列表，避免抽屉展开时先闪一下“加载中”。
  const readyPromise = historyListStore.loadScopeList(scope, {
    refresh: false,
    loadAll: true,
    limit: 100,
  }).finally(() => {
    projectHistoryDrawerReadyPromises.delete(projectId);
  });
  projectHistoryDrawerReadyPromises.set(projectId, readyPromise);
  await readyPromise;
};

const ensureViewSwitchSafety = async () => {
  // 中文说明：必须作为单个编排任务执行，避免 requestSave/deactivate 被其他任务插队打断。
  await saveDeactivateThen(async () => {}, { throwOnSaveFailure: true });
};

const rememberExpandedProject = (projectId) => {
  projectExpansionStore.expandProject(projectId);
};

const toggleExpandedProject = (projectId) => {
  projectExpansionStore.toggleProject(projectId);
};

const setSidebarMode = (mode) => {
  showProjectCreateMenu.value = false;
  emit('set-sidebar-mode', mode);
};

const handleNewConversation = async () => {
  try {
    if (currentScope.value.kind === 'project') {
      startDraftConversation({ kind: 'project', projectId: currentScope.value.projectId });
      emit('project-workspace-click', currentScope.value.projectId);
      return;
    }

    startDraftConversation({ kind: 'linnya-assistant' });
    emit('linnya-assistant-click');
  } catch (error) {
    console.warn('[WorkspaceSidebarSurface] 新建对话失败：', error);
  }
};

const handleProjectChatClick = async (projectId) => {
  if (!isProjectExpanded(projectId)) {
    await ensureProjectHistoryReadyForDrawer(projectId);
  }

  toggleExpandedProject(projectId);
};

const handleProjectConversationPrefetch = (projectId) => {
  if (isProjectExpanded(projectId)) return;
  void ensureProjectHistoryReadyForDrawer(projectId);
};

const handleOpenProject = async (projectId) => {
  try {
    await openProjectWorkspaceFromSidebar(projectId);
    emit('set-sidebar-nav', 'project');
    return true;
  } catch (error) {
    console.warn('[WorkspaceSidebarSurface] 打开项目态已取消：', error);
    return false;
  }
};

const handleOpenProjectOverview = async (projectId) => {
  const project = projectsStore.projects.find((item) => item.id === projectId);
  if (!project) return;

  projectOverviewModalStore.open({
    projectId,
    projectName: project.name,
  });
};

const handleBackToList = () => {
  showProjectCreateMenu.value = false;
  emit('set-sidebar-nav', 'list');
};

const toggleProjectCreateMenu = () => {
  showProjectCreateMenu.value = !showProjectCreateMenu.value;
};

const handleProjectCreateSelection = async (value) => {
  if (!value) return;

  try {
    if (value === 'folder') {
      await createNewFolder();
      return;
    }

    await createNewFile({ type: value });
  } finally {
    showProjectCreateMenu.value = false;
  }
};

const handleProjectConversationSelected = (projectId) => {
  projectsStore.markActiveProject(projectId);
  rememberExpandedProject(projectId);
};

const handleKnowledgeBaseClick = async () => {
  try {
    await ensureViewSwitchSafety();
    emit('knowledge-base-click');
  } catch (error) {
    console.warn('[WorkspaceSidebarSurface] 切换知识库已取消：', error);
  }
};

const handlePluginStoreClick = async () => {
  try {
    await ensureViewSwitchSafety();
    emit('plugin-store-click');
  } catch (error) {
    console.warn('[WorkspaceSidebarSurface] 切换插件页已取消：', error);
  }
};

const handleCreateFile = async (payload) => {
  const type = payload?.type || 'document';
  await createNewFile({ type });
};

onMounted(() => {
  projectsStore.loadProjects();
  void ensureSidebarOverlayScroll();
});

onBeforeUnmount(() => {
  destroySidebarOverlayScroll();
});

watch(
  [
    hasScrollableSidebarContent,
    effectiveSidebarNav,
    sidebarMode,
    () => projectsStore.projects.length,
    () => treeStore.projectTree.length,
    () => assistantStore.activeConversationId,
  ],
  async () => {
    if (!hasScrollableSidebarContent.value) {
      destroySidebarOverlayScroll();
      return;
    }
    await ensureSidebarOverlayScroll();
    scheduleSidebarOverlayScrollUpdate();
  },
  { flush: 'post' },
);

watch(
  () => sidebarHistoryRevealStore.latestRequest,
  async (request) => {
    if (!request) return;

    const scopeKey = getWorkspaceScopeKey(request.scope);
    revealPulseScopeKey.value = scopeKey;
    revealPulseKey.value += 1;

    if (request.scope.kind === 'project') {
      projectChatSearchQuery.value = '';
      await ensureProjectHistoryReadyForDrawer(request.scope.projectId);
      rememberExpandedProject(request.scope.projectId);
      emit('set-sidebar-nav', 'project');
      emit('set-sidebar-mode', 'chat');
    } else {
      emit('set-sidebar-nav', 'list');
    }

    await nextTick();
    scheduleSidebarOverlayScrollUpdate();
  },
);

watch(
  [
    () => projectsStore.isLoading,
    () => projectsStore.projects.map((project) => project.id),
  ],
  ([isLoadingProjects, projectIds]) => {
    if (!shouldRetainExpandedProjects({
      isLoadingProjects,
      projectIds,
      hasObservedLoadedProjectList: hasObservedLoadedProjectListForExpansion.value,
    })) {
      return;
    }

    hasObservedLoadedProjectListForExpansion.value = true;
    projectExpansionStore.retainExistingProjects(projectIds);
  },
  { immediate: true, flush: 'post' },
);
</script>
