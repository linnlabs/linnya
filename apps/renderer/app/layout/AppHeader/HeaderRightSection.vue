<template>
  <div class="app-header-right" :style="appHeaderRightStyle">
    <section
      class="header-pane header-pane--main"
      :class="mainHeaderPaneClasses"
      :style="mainHeaderPaneStyle"
    >
      <div
        v-if="mainHeaderBreadcrumbSegments.length > 0"
        class="header-pane__title"
        :title="mainHeaderTitle"
      >
        <template v-for="(segment, index) in mainHeaderBreadcrumbSegments" :key="`main-${index}`">
          <button
            v-if="isMainParentConversationSegment(index)"
            class="breadcrumb-segment breadcrumb-segment--parent-action"
            type="button"
            :aria-label="conversationMessage('conversation.tool.subrunDetail.back')"
            @click="requestSubrunDetailReturnToParent"
          >
            {{ segment }}
          </button>
          <span v-else class="breadcrumb-segment">{{ segment }}</span>
          <span v-if="index < mainHeaderBreadcrumbSegments.length - 1" class="breadcrumb-separator">/</span>
        </template>
      </div>
      <div class="header-pane__actions">
        <!-- 对话窗口操作：对话在中间时，历史、概览属于中间 pane。 -->
        <template v-if="isConversationInMainPane">
          <div
            v-if="canShowProjectConversationHistory"
            class="project-workspace-actions"
          >
            <HoverTooltip
              :text="layoutMessage('layout.header.newConversation')"
              placement="bottom"
            >
              <button
                class="project-workspace-action"
                type="button"
                :aria-label="layoutMessage('layout.header.newConversation')"
                @click="handleStartNewConversation"
              >
                <AddIcon class="project-workspace-action-icon" />
              </button>
            </HoverTooltip>
            <HoverTooltip
              :text="layoutMessage('layout.header.history')"
              placement="bottom"
            >
              <button
                ref="historyToolButtonRef"
                class="project-workspace-action"
                :class="{ 'is-active': showHistoryDropdown }"
                type="button"
                :aria-label="layoutMessage('layout.header.history')"
                @click="handleOpenProjectHistory"
              >
                <HistoryIcon class="project-workspace-action-icon" />
              </button>
            </HoverTooltip>
          </div>
        </template>

        <!-- 对话工具组只保留 timeline；审阅归属 editor 文档工具。 -->
        <div v-if="isConversationInMainPane" class="global-tool-actions">
          <HoverTooltip
            :text="timelineButtonTooltip"
            placement="bottom"
          >
            <button
              class="project-workspace-action"
              :class="{ 'is-active': !isTimelineCollapsed }"
              :disabled="!canToggleTimeline"
              type="button"
              :aria-label="timelineButtonTooltip"
              @click="handleToggleTimeline"
            >
              <TimelineIcon class="project-workspace-action-icon" />
            </button>
          </HoverTooltip>
        </div>

        <!-- 文档窗口操作：文档在中间时，这些按钮跟随中间 pane，并位于交换按钮左侧。 -->
        <template v-if="isDocumentInMainPane">
          <HoverTooltip
            v-if="hasStandaloneDocumentMenu"
            :text="layoutMessage('layout.header.moreMenu')"
            placement="bottom"
            :disabled="showDocMenu"
          >
            <button
              ref="docMenuButtonRef"
              class="project-workspace-action"
              type="button"
              :aria-label="layoutMessage('layout.header.moreMenu')"
              @click.stop="toggleDocMenu"
            >
              <MoreIcon class="project-workspace-action-icon" direction="horizontal" />
            </button>
          </HoverTooltip>


        </template>

        <!-- 交换位置属于中间窗口；右侧栏开关固定在最右侧，避免跟随中间 pane 边界漂移。 -->
        <div v-if="hasWorkspaceFileSurface" class="workspace-layout-actions">
          <HoverTooltip :text="swapPaneTooltip" placement="bottom">
            <button
              class="project-workspace-action"
              type="button"
              :aria-label="layoutMessage('layout.header.swapPanes')"
              @click="handleSwapWorkspacePanes"
            >
              <SwapPaneIcon class="project-workspace-action-icon" />
            </button>
          </HoverTooltip>
        </div>
      </div>
    </section>

    <div
      v-if="shouldMountRightHeaderPane"
      class="header-pane header-pane--right"
      :class="rightHeaderPaneClasses"
      :style="rightHeaderPaneStyle"
    >
      <div
        class="header-pane__content"
        :style="rightHeaderPaneContentStyle"
      >
        <PaneDivider side="left" interaction-group="workspace-split" />

        <div
          v-if="rightHeaderBreadcrumbSegments.length > 0"
          class="header-pane__title"
          :title="rightHeaderTitle"
        >
          <template v-for="(segment, index) in rightHeaderBreadcrumbSegments" :key="`right-${index}`">
            <button
              v-if="isRightParentConversationSegment(index)"
              class="breadcrumb-segment breadcrumb-segment--parent-action"
              type="button"
              :aria-label="conversationMessage('conversation.tool.subrunDetail.back')"
              @click="requestSubrunDetailReturnToParent"
            >
              {{ segment }}
            </button>
            <span v-else class="breadcrumb-segment">{{ segment }}</span>
            <span v-if="index < rightHeaderBreadcrumbSegments.length - 1" class="breadcrumb-separator">/</span>
          </template>
        </div>

        <div class="header-pane__actions">
          <!-- 对话窗口操作：对话交换到右侧时，历史和时间轴跟随右 pane。 -->
          <div v-if="isConversationAssignedToRightPane" class="global-tool-actions">
            <HoverTooltip
              v-if="canShowProjectConversationHistory"
              :text="layoutMessage('layout.header.newConversation')"
              placement="bottom"
            >
              <button
                class="project-workspace-action"
                type="button"
                :aria-label="layoutMessage('layout.header.newConversation')"
                @click="handleStartNewConversation"
              >
                <AddIcon class="project-workspace-action-icon" />
              </button>
            </HoverTooltip>
            <HoverTooltip
              v-if="canShowProjectConversationHistory"
              :text="layoutMessage('layout.header.history')"
              placement="bottom"
            >
              <button
                ref="historyToolButtonRef"
                class="project-workspace-action"
                :class="{ 'is-active': showHistoryDropdown }"
                type="button"
                :aria-label="layoutMessage('layout.header.history')"
                @click="handleOpenProjectHistory"
              >
                <HistoryIcon class="project-workspace-action-icon" />
              </button>
            </HoverTooltip>
            <HoverTooltip
              :text="timelineButtonTooltip"
              placement="bottom"
            >
              <button
                class="project-workspace-action"
                :class="{ 'is-active': !isTimelineCollapsed }"
                :disabled="!canToggleTimeline"
                type="button"
                :aria-label="timelineButtonTooltip"
                @click="handleToggleTimeline"
              >
                <TimelineIcon class="project-workspace-action-icon" />
              </button>
            </HoverTooltip>
          </div>

          <!-- 文档窗口操作：文档在右侧时，审阅和文档菜单跟随右 pane。 -->
          <template v-if="isDocumentAssignedToRightPane">
            <HoverTooltip
              v-if="hasStandaloneDocumentMenu"
              :text="layoutMessage('layout.header.moreMenu')"
              placement="bottom"
              :disabled="showDocMenu"
            >
              <button
                ref="docMenuButtonRef"
                class="project-workspace-action"
                type="button"
                :aria-label="layoutMessage('layout.header.moreMenu')"
                @click.stop="toggleDocMenu"
              >
                <MoreIcon class="project-workspace-action-icon" direction="horizontal" />
              </button>
            </HoverTooltip>


          </template>
        </div>
      </div>
    </div>

    <div
      v-if="hasWorkspaceFileSurface"
      class="workspace-right-toggle"
      :style="workspaceRightToggleStyle"
    >
      <HoverTooltip :text="rightPaneToggleTooltip" placement="bottom">
        <button
          class="project-workspace-action"
          type="button"
          :disabled="!workspacePaneGeometry.canOccupyRightPane"
          :aria-label="layoutMessage('layout.header.rightPane.toggle')"
          @click="handleToggleWorkspaceRightPane"
        >
          <SidebarIcon class="project-workspace-action-icon project-workspace-action-icon--right-sidebar" />
        </button>
      </HoverTooltip>
    </div>

    <Teleport to="body">
      <transition name="app-header-menu-fade">
        <section
          v-if="activeHeaderTool"
          ref="headerToolPanelRef"
          class="header-tool-panel"
        >
          <header class="header-tool-panel__header">
            <span class="header-tool-panel__title">{{ activeHeaderToolTitle }}</span>
            <div class="header-tool-panel__actions">
              <button
                class="header-tool-panel__icon-button"
                type="button"
                :title="layoutMessage('layout.header.panel.close')"
                @click="activeHeaderTool = null"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <div class="header-tool-panel__body">
            <ReviewSidebar v-if="activeHeaderTool === 'review'" />
          </div>
        </section>
      </transition>
    </Teleport>

    <HistoryDropdown
      :is-visible="showHistoryDropdown"
      :button-ref="historyToolButtonRef"
      @close="showHistoryDropdown = false"
      @view-all="handleViewAllHistory"
    />

    <!-- 文档菜单 Teleport：触发按钮跟随文档 pane，菜单浮层统一挂到 body。 -->
    <Teleport to="body">
      <transition name="app-header-menu-fade">
        <div
          v-show="showDocMenu"
          ref="docMenuWrapperRef"
          class="app-header-doc-menu-wrapper"
        >
          <CustomSelect
            :model-value="null"
            :options="combinedDocMenuOptions"
            :manual-mode="true"
            variant="minimal"
            :bordered="false"
            :external-trigger-ref="docMenuButtonRef"
            @update:model-value="handleDocMenuSelect"
            @close="showDocMenu = false"
          />
        </div>
      </transition>
    </Teleport>

    <DocumentHistoryPanel
      v-if="showDocumentHistory && activeDocumentId && historyPreviewComponent"
      :key="activeDocumentId"
      :document-id="activeDocumentId"
      :preview-component="historyPreviewComponent"
      @close="showDocumentHistory = false"
    />

    <!-- 添加到知识库弹窗 -->
    <AddToKnowledgeBaseModal
      :show="showAddToKbModal"
      :documentName="currentDocumentName"
      @close="showAddToKbModal = false"
      @confirm="handleAddToKbConfirm"
    />

    <!-- Windows 窗口控制按钮 -->
    <div v-if="!isMac" class="window-controls windows-controls">
      <button
        class="control-button minimize-button"
        @click="handleWindowAction('minimize')"
        :title="layoutMessage('layout.header.window.minimize')"
      >
        <WindowActionIcon action="minimize" />
      </button>
      <button
        class="control-button maximize-button"
        @click="handleWindowAction('maximize')"
        :title="layoutMessage('layout.header.window.maximizeRestore')"
      >
        <WindowActionIcon action="maximize" :isMaximized="isWindowMaximized" />
      </button>
      <button
        class="control-button close-button"
        @click="handleWindowAction('close')"
        :title="layoutMessage('layout.header.panel.close')"
      >
        <CloseIcon />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useFileStore } from '@/shared/stores/file';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useSidebarLayoutWidth } from '@/app/layout/composables/useSidebarLayoutWidth';
import { useWorkspacePaneGeometry } from '@/app/layout/composables/useWorkspacePaneGeometry';
import { useWorkspaceProjectsStore, useWorkspaceTreeStore } from '@/domains/workspace/store';
import { useNotificationStore } from '@/app/notification';
import { useKnowledgeBaseStore } from '@/domains/knowledgebase/stores/knowledgeBase';
import { useDocumentActionMenu, useDocumentTypeAvailabilityByActiveType } from '@/app/plugins/composables';
import { DocumentHistoryPanel, useHistoryMessages } from '@/domains/document-history';
import { getDocumentTypeByActiveType, getDocumentTypeByNodeType } from '@/app/plugins/registry';
import type { DocumentActionMenuOptionValue } from '@/app/plugins/types';
import { CustomSelect, HoverTooltip, type CustomSelectOption } from '@linnya/renderer-ui';
import { resolveWorkspaceNodeDisplayName } from '@/domains/workspace/functions/resolveWorkspaceNodeDisplayName';
import { WindowActionIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { MoreIcon } from '@linnya/renderer-ui/icons';
import { AddIcon } from '@linnya/renderer-ui/icons';
import { HistoryIcon } from '@linnya/renderer-ui/icons';
import { SwapPaneIcon } from '@linnya/renderer-ui/icons';
import { SidebarIcon } from '@linnya/renderer-ui/icons';
import { TimelineIcon } from '@linnya/renderer-ui/icons';
import AddToKnowledgeBaseModal from '@/domains/knowledgebase/ui/AddToKnowledgeBaseModal.vue';
import { addCurrentDocumentToKb } from '@/domains/knowledgebase/services/addCurrentDocumentToKb';
import { useKnowledgeBaseLocalization } from '@/domains/knowledgebase/ui/useKnowledgeBaseLocalization';
import ReviewSidebar from '@/domains/editor/features/Review/ui/ReviewSidebar.vue';
import HistoryDropdown from '@/domains/conversation/history/components/HistoryDropdown.vue';
import PaneDivider from '@/app/layout/components/PaneDivider.vue';
import { useAssistantStore } from '@/domains/conversation/store/assistantStore';
import {
  requestSubrunDetailReturnToParent,
  useSubrunDetailSurfaceScope,
} from '@/domains/conversation/features/subrun-detail';
import { useConversationLocalization } from '@/domains/conversation/ui/useConversationLocalization';
import { computeHeaderPaneGeometry } from '@/app/layout/functions/headerPaneGeometry';
import { revealSidebarConversationHistory } from '@/app/layout/orchestration/revealSidebarConversationHistory';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import { projectConversationHeaderBreadcrumbSegments } from '@/domains/conversation/functions/conversationTitlePresentation';
import { startDraftConversation } from '@/domains/conversation/services/orchestration/startDraftConversation';

const props = defineProps<{
  isMac: boolean;
  isWindowMaximized: boolean;
}>();

const uiStore = useUIStore();
const layoutStore = useLayoutStore();
const assistantStore = useAssistantStore();
const subrunDetailScope = useSubrunDetailSurfaceScope();
const navigation = getWorkspaceNavigationPort();
const workspaceScopeStore = useWorkspaceScopeStore();
const projectsStore = useWorkspaceProjectsStore();
const { sidebarOccupiedWidth } = useSidebarLayoutWidth();
const {
  geometry: workspacePaneGeometry,
  hasWorkspaceFileSurface,
} = useWorkspacePaneGeometry();
const { layoutMessage } = useLayoutLocalization();
const { conversationMessage } = useConversationLocalization();
const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();
const scene = computed(() => layoutStore.state.scene);
const activeDocumentType = computed(() => layoutStore.state.activeDocument?.type ?? null);
const activeDocumentId = computed(() => layoutStore.state.activeDocument?.id ?? null);
const documentAvailability = useDocumentTypeAvailabilityByActiveType(activeDocumentType);
const historyPreviewComponent = computed(() => documentAvailability.value?.state === 'enabled'
  ? documentAvailability.value.documentType.historyPreviewComponent : undefined);
const showDocumentHistory = ref(false);
const { message: historyMessage } = useHistoryMessages();
const pluginDocumentActionMenu = useDocumentActionMenu(activeDocumentType);
watch([activeDocumentId, historyPreviewComponent], () => { showDocumentHistory.value = false; showDocMenu.value = false; });
const canShowProjectConversationHistory = computed(() => {
  return scene.value.kind === 'workspace' && workspaceScopeStore.currentProjectId !== null;
});
const isWorkspaceRightPaneVisible = computed(() => {
  return workspacePaneGeometry.value.rightPaneOccupiedWidth > 0;
});
const rightPaneToggleTooltip = computed(() => {
  if (!workspacePaneGeometry.value.canOccupyRightPane) {
    return layoutMessage('layout.header.rightPane.windowTooNarrow');
  }
  return isWorkspaceRightPaneVisible.value
    ? layoutMessage('layout.header.rightPane.collapse')
    : layoutMessage('layout.header.rightPane.expand');
});
const swapPaneTooltip = computed(() => {
  return layoutStore.state.layoutMode === 'chat-centric'
    ? layoutMessage('layout.header.swap.documentToMain')
    : layoutMessage('layout.header.swap.conversationToMain');
});
const fileStore = useFileStore();
const treeStore = useWorkspaceTreeStore();
const notificationStore = useNotificationStore();
const kbStore = useKnowledgeBaseStore();

const rightPaneContentWidth = computed(() => {
  if (!hasWorkspaceFileSurface.value) return 0;
  return workspacePaneGeometry.value.rightPaneWidth;
});

const rightPaneFrameWidth = computed(() => {
  return workspacePaneGeometry.value.rightPaneOccupiedWidth;
});

const isDocumentInMainPane = computed(() => {
  return layoutStore.state.activeDocument !== null && layoutStore.state.layoutMode === 'editor-centric';
});
const isDocumentAssignedToRightPane = computed(() => {
  return layoutStore.state.activeDocument !== null && layoutStore.state.layoutMode === 'chat-centric';
});
const isFileSurfaceAssignedToRightPane = computed(() => {
  return hasWorkspaceFileSurface.value && layoutStore.state.layoutMode === 'chat-centric';
});
const isConversationInMainPane = computed(() => {
  return (
    scene.value.kind === 'workspace'
    && layoutStore.state.layoutMode === 'chat-centric'
  );
});
const isConversationAssignedToRightPane = computed(() => {
  return (
    scene.value.kind === 'workspace'
    && hasWorkspaceFileSurface.value
    && layoutStore.state.layoutMode === 'editor-centric'
  );
});
const shouldMountRightHeaderPane = computed(() => {
  return isFileSurfaceAssignedToRightPane.value || isConversationAssignedToRightPane.value;
});
const shouldShowRightHeaderPane = computed(() => rightPaneFrameWidth.value > 0);

const headerPaneGeometry = computed(() => computeHeaderPaneGeometry({
  isMac: props.isMac,
  isWindowMaximized: props.isWindowMaximized,
  sidebarOccupiedWidth: sidebarOccupiedWidth.value,
  rightPaneWidth: rightPaneFrameWidth.value,
}));

const appHeaderRightStyle = computed<CSSProperties>(() => ({
  '--app-header-trailing-chrome-width': `${headerPaneGeometry.value.trailingChromeWidth}px`,
}));

const mainHeaderPaneStyle = computed<CSSProperties>(() => ({
  left: `${headerPaneGeometry.value.mainPaneLeft}px`,
  right: `${headerPaneGeometry.value.mainPaneRight}px`,
}));

const rightHeaderPaneStyle = computed<CSSProperties>(() => ({
  right: `${headerPaneGeometry.value.rightPaneRight}px`,
  width: `${headerPaneGeometry.value.rightPaneWidth}px`,
}));

const rightHeaderPaneContentStyle = computed<CSSProperties>(() => ({
  width: `${rightPaneContentWidth.value}px`,
}));

const mainHeaderPaneClasses = computed(() => ({
  'header-pane--rightmost': hasWorkspaceFileSurface.value && !shouldShowRightHeaderPane.value,
}));

const rightHeaderPaneClasses = computed(() => ({
  'header-pane--rightmost': hasWorkspaceFileSurface.value,
  'header-pane--visible': shouldShowRightHeaderPane.value,
}));

const workspaceRightToggleStyle = computed<CSSProperties>(() => ({
  right: `calc(${headerPaneGeometry.value.trailingChromeWidth}px + var(--app-header-edge-inset))`,
}));

const documentBreadcrumbPath = computed(() => {
  const documentId = fileStore.currentFilePath;
  if (!documentId) return [];

  const path: string[] = [];
  let currentNode = treeStore.findNodeById(documentId);

  if (!currentNode) {
    return fileStore.fileDisplayName ? [fileStore.fileDisplayName] : [];
  }

  while (currentNode) {
    path.unshift(resolveWorkspaceNodeDisplayName(currentNode, currentNode.name));
    if (!currentNode.parentId) {
      break;
    }
    currentNode = treeStore.findNodeById(currentNode.parentId);
  }

  return path;
});

const projectName = computed(() => projectsStore.activeProject?.name || layoutMessage('layout.header.untitledProject'));
const documentBreadcrumbSegments = computed(() => {
  const breadcrumb = documentBreadcrumbPath.value;
  return breadcrumb.length > 0 ? [projectName.value, ...breadcrumb] : [projectName.value];
});

const conversationBreadcrumbSegments = computed(() => {
  return projectConversationHeaderBreadcrumbSegments({
    conversation: assistantStore.activeConversation,
    subrunTitle: subrunDetailScope.value?.description ?? null,
  });
});

const setupBreadcrumbSegments = computed(() => {
  if (scene.value.kind !== 'project-setup') return [];
  const projectId = workspaceScopeStore.currentProjectId;
  const project = projectsStore.projects.find((p) => p.id === projectId);
  const name = project?.name || projectsStore.activeProject?.name || layoutMessage('layout.header.untitledProject');
  return [layoutMessage('layout.header.projectSetup'), name];
});

const mainHeaderBreadcrumbSegments = computed(() => {
  if (scene.value.kind === 'project-setup') {
    return setupBreadcrumbSegments.value;
  }
  if (isDocumentInMainPane.value) {
    return documentBreadcrumbSegments.value;
  }
  if (isConversationInMainPane.value) {
    return conversationBreadcrumbSegments.value;
  }
  return [];
});

const rightHeaderBreadcrumbSegments = computed(() => {
  if (isDocumentAssignedToRightPane.value) {
    return documentBreadcrumbSegments.value;
  }
  if (isConversationAssignedToRightPane.value) {
    return conversationBreadcrumbSegments.value;
  }
  return [];
});

const mainHeaderTitle = computed(() => mainHeaderBreadcrumbSegments.value.join(' / '));
const rightHeaderTitle = computed(() => rightHeaderBreadcrumbSegments.value.join(' / '));

function isMainParentConversationSegment(index: number): boolean {
  return index === 0 && isConversationInMainPane.value && subrunDetailScope.value !== null;
}

function isRightParentConversationSegment(index: number): boolean {
  return index === 0 && isConversationAssignedToRightPane.value && subrunDetailScope.value !== null;
}

type HeaderTool = 'review';

const activeHeaderTool = ref<HeaderTool | null>(null);
const showHistoryDropdown = ref(false);
const historyToolButtonRef = ref<HTMLElement | null>(null);
const headerToolPanelRef = ref<HTMLElement | null>(null);
const canToggleTimeline = computed(() => assistantStore.hasRenderableMessages);
const isTimelineCollapsed = computed(() => assistantStore.isTimelineCollapsed);
const timelineButtonTooltip = computed(() => {
  if (!canToggleTimeline.value) {
    return layoutMessage('layout.header.timeline.empty');
  }
  return isTimelineCollapsed.value
    ? layoutMessage('layout.header.timeline.expand')
    : layoutMessage('layout.header.timeline.collapse');
});

const activeHeaderToolTitle = computed(() => {
  return layoutMessage('layout.header.review');
});

const currentHeaderToolButton = computed(() => {
  if (activeHeaderTool.value === 'review') {
    return docMenuButtonRef.value;
  }
  return null;
});

const positionHeaderToolPanel = () => {
  const triggerEl = currentHeaderToolButton.value;
  const panelEl = headerToolPanelRef.value;
  if (!triggerEl || !panelEl) return;

  const triggerRect = triggerEl.getBoundingClientRect();
  const panelRect = panelEl.getBoundingClientRect();
  const gap = 8;
  const viewportPadding = 8;
  const desiredLeft = triggerRect.right - panelRect.width;
  const maxLeft = window.innerWidth - panelRect.width - viewportPadding;
  const left = Math.max(viewportPadding, Math.min(desiredLeft, maxLeft));

  panelEl.style.top = `${triggerRect.bottom + gap}px`;
  panelEl.style.left = `${left}px`;
};

const handleToggleTimeline = () => {
  if (!canToggleTimeline.value) return;
  assistantStore.toggleTimelineCollapsed();
};

const handleHeaderToolOutsidePointerDown = (event: PointerEvent) => {
  if (!activeHeaderTool.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (headerToolPanelRef.value?.contains(target)) return;
  if (historyToolButtonRef.value?.contains(target)) return;
  if (docMenuButtonRef.value?.contains(target)) return;
  activeHeaderTool.value = null;
};

const handleHeaderToolKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && (activeHeaderTool.value || showHistoryDropdown.value)) {
    activeHeaderTool.value = null;
    showHistoryDropdown.value = false;
  }
};

watch(activeHeaderTool, (tool) => {
  if (tool) {
    nextTick(() => {
      positionHeaderToolPanel();
    });
  }
});

watch(
  () => scene.value.kind,
  (sceneKind) => {
    if (sceneKind !== 'workspace') {
      activeHeaderTool.value = null;
      showHistoryDropdown.value = false;
    }
  }
);

onMounted(() => {
  window.addEventListener('resize', positionHeaderToolPanel);
  document.addEventListener('pointerdown', handleHeaderToolOutsidePointerDown, true);
  document.addEventListener('keydown', handleHeaderToolKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', positionHeaderToolPanel);
  document.removeEventListener('pointerdown', handleHeaderToolOutsidePointerDown, true);
  document.removeEventListener('keydown', handleHeaderToolKeydown);
});

const handleOpenProjectHistory = () => {
  activeHeaderTool.value = null;
  showHistoryDropdown.value = !showHistoryDropdown.value;
};

const handleStartNewConversation = () => {
  activeHeaderTool.value = null;
  showHistoryDropdown.value = false;
  startDraftConversation(workspaceScopeStore.currentScope);
};

const handleViewAllHistory = async () => {
  showHistoryDropdown.value = false;
  activeHeaderTool.value = null;

  const projectId = workspaceScopeStore.currentProjectId;
  try {
    await revealSidebarConversationHistory(
      projectId ? { kind: 'project', projectId } : workspaceScopeStore.currentScope,
    );
  } catch (error) {
    console.warn('[HeaderRightSection] 跳转左侧历史对话已取消：', error);
  }
};

const handleSwapWorkspacePanes = () => {
  navigation.toggleWorkspacePanePlacement();
};

const handleToggleWorkspaceRightPane = () => {
  if (!workspacePaneGeometry.value.canOccupyRightPane) return;
  navigation.toggleWorkspaceRightPaneVisibility();
};

// ==================== 文档级“更多”菜单状态 ====================

// 是否显示文档菜单
const showDocMenu = ref(false);
// “更多”按钮引用
const docMenuButtonRef = ref<HTMLElement | null>(null);
// 菜单容器引用
const docMenuWrapperRef = ref<HTMLElement | null>(null);

// 当前激活文档对应的 Workspace 节点（用于判断文档类型）
const currentDocumentNode = computed(() => {
  const documentId = fileStore.currentFilePath;
  if (!documentId) return null;
  return treeStore.findNodeById(documentId);
});

// 是否为 Markdown 文档：
// - 导出/加知识库菜单是 platform Markdown 文档能力；
// - 判断来源必须走 document type registry，避免 host 通过排除某个插件类型来猜测。
const isMarkdownDocument = computed(() => {
  const node = currentDocumentNode.value;
  if (node) {
    return getDocumentTypeByNodeType(node.type)?.activeDocumentType === 'editor';
  }

  // 如果节点信息缺失，只根据 layout activeDocument 类型判断，避免回到旧视图双源。
  const activeType = activeDocumentType.value;
  return typeof activeType === 'string' && getDocumentTypeByActiveType(activeType)?.activeDocumentType === 'editor';
});

// 是否有激活的 Markdown 文档（用于控制菜单显示）
const hasActiveDocument = computed(() => !!fileStore.currentFilePath && isMarkdownDocument.value);
const hasStandaloneDocumentMenu = computed(() => {
  return scene.value.kind === 'workspace' && combinedDocMenuOptions.value.length > 0;
});

watch(hasActiveDocument, (canShow) => {
  if (!canShow && activeHeaderTool.value === 'review') {
    activeHeaderTool.value = null;
  }
});

// 文档菜单选项：这些是 platform Markdown 能力。插件文档的操作由
// documentActionMenu contribution 提供，Host 不根据具体插件类型推测。
const docMenuOptions = computed<CustomSelectOption<Exclude<DocMenuValue, null>>[]>(() => {
  if (!hasActiveDocument.value) return [];
  return [
    {
      value: 'export',
      text: layoutMessage('layout.header.documentMenu.export'),
      children: [
        { value: 'export-txt', text: layoutMessage('layout.header.documentMenu.exportTxt') },
        { value: 'export-markdown', text: layoutMessage('layout.header.documentMenu.exportMarkdown') },
        { value: 'export-pdf', text: layoutMessage('layout.header.documentMenu.exportPdf') },
        { value: 'export-docx', text: layoutMessage('layout.header.documentMenu.exportDocx') },
      ],
    },
    { value: 'review-document', text: layoutMessage('layout.header.documentMenu.review') },
    { value: 'add-to-kb', text: layoutMessage('layout.header.documentMenu.addToKnowledgeBase') },
  ];
});

const combinedDocMenuOptions = computed<CustomSelectOption<DocumentActionMenuOptionValue>[]>(() => [
  ...(historyPreviewComponent.value ? [{ value: 'document-history', text: historyMessage('history.title') }] : []),
  ...docMenuOptions.value,
  ...(pluginDocumentActionMenu.value?.isAvailable() ? pluginDocumentActionMenu.value.getOptions() : []),
]);

// ==================== 添加到知识库相关状态 ====================

// 是否显示"添加到知识库"弹窗
const showAddToKbModal = ref(false);

// 当前文档名称（用于弹窗展示）
const currentDocumentName = computed(() => {
  const node = currentDocumentNode.value;
  if (node) return resolveWorkspaceNodeDisplayName(node, layoutMessage('layout.header.untitledDocument'));
  return layoutMessage('layout.header.untitledDocument');
});

// 处理"添加到知识库"确认
const handleAddToKbConfirm = async (kbId: string) => {
  showAddToKbModal.value = false;

  // 获取编辑器实例
  const editor = uiStore.getEditor();
  if (!editor) {
    notificationStore.show(layoutMessage('layout.header.addToKnowledgeBase.editorUnavailable'), 'error', 3000);
    return;
  }

  // 调用核心服务函数
  const result = await addCurrentDocumentToKb({
    targetKbId: kbId,
    documentName: currentDocumentName.value,
    editor,
    kbStore,
    message: knowledgeBaseMessage,
  });

  if (result.success) {
    notificationStore.show(
      layoutMessage('layout.header.addToKnowledgeBase.success', { fileName: result.fileName }),
      'success',
      3000
    );
  } else {
    notificationStore.show(layoutMessage('layout.header.addToKnowledgeBase.failed'), 'error', 3000);
  }
};

const handleWindowAction = (action: 'minimize' | 'maximize' | 'close') => {
  const electronApi = window.electronAPI;
  if (electronApi) {
    electronApi.windowAction(action);
  } else {
    console.error('electronAPI not available');
  }
};

// ==================== 文档级“更多”菜单逻辑 ====================

// 切换文档菜单显示状态
const toggleDocMenu = () => {
  showDocMenu.value = !showDocMenu.value;
};

type DocMenuValue =
  | 'export'
  | 'add-to-kb'
  | 'review-document'
  | 'export-txt'
  | 'export-markdown'
  | 'export-pdf'
  | 'export-docx'
  | null;

// 处理文档菜单选项选择
const handleDocMenuSelect = async (value: unknown) => {
  showDocMenu.value = false;
  if (value === 'document-history' && historyPreviewComponent.value) { showDocumentHistory.value = true; return; }
  const menu = pluginDocumentActionMenu.value;
  if (menu?.isAvailable() && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
    await menu.select(value);
    return;
  }

  // 安全兜底：如果当前不是 Markdown 文档，则不执行任何操作
  if (!hasActiveDocument.value) {
    showDocMenu.value = false;
    return;
  }

  // 文档导出相关操作仅对 Markdown 文档开放
  switch (value) {
    case 'add-to-kb':
      // 打开"添加到知识库"弹窗
      showAddToKbModal.value = true;
      break;
    case 'review-document':
      activeHeaderTool.value = 'review';
      break;
    case 'export-txt':
      uiStore.setExportSettingsVisible(true, 'txt');
      break;
    case 'export-markdown':
      uiStore.setExportSettingsVisible(true, 'markdown');
      break;
    case 'export-pdf':
      uiStore.setExportSettingsVisible(true, 'pdf');
      break;
    case 'export-docx':
      uiStore.setExportSettingsVisible(true, 'docx');
      break;
    default:
      // 预留：未来可在此扩展其他文档级操作（如修订模式、文档属性等）
      break;
  }

  showDocMenu.value = false;
};

// 计算并设置下拉菜单位置（参考侧边栏更多菜单的实现）
const positionDocMenu = () => {
  const triggerEl = docMenuButtonRef.value;
  const wrapperEl = docMenuWrapperRef.value;
  if (!triggerEl || !wrapperEl) return;

  const triggerRect = triggerEl.getBoundingClientRect();
  const wrapperRect = wrapperEl.getBoundingClientRect();

  let top = triggerRect.bottom + 4;
  let left = triggerRect.left;

  // 右侧溢出时向左对齐
  if (left + wrapperRect.width > window.innerWidth) {
    left = triggerRect.right - wrapperRect.width;
  }

  // 下方溢出时显示在按钮上方
  if (top + wrapperRect.height > window.innerHeight) {
    top = triggerRect.top - wrapperRect.height - 4;
  }

  wrapperEl.style.top = `${top}px`;
  wrapperEl.style.left = `${left}px`;
};

// 监听菜单打开，计算位置
watch(showDocMenu, (isOpen) => {
  if (isOpen) {
    nextTick(() => {
      positionDocMenu();
    });
  }
});

</script>
