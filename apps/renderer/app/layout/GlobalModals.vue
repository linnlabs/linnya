<!--
  全局模态框容器组件
  
  职责：
  - 集中管理所有 Teleport 到 body 的模态框
  - 包含设置、知识库、导出设置、更新对话框等
  - 包含查找替换面板和 Citation 浮层
-->
<template>
  <Teleport to="body">
    <!-- 设置模态框 -->
    <Transition name="settings-modal-fade">
      <SettingsModal v-if="uiStore.settingsModalVisible" />
    </Transition>
    

    <!-- 导出设置模态框 -->
    <ExportSettingsModal />
    
    <!-- 更新对话框 -->
    <UpdateRestartConfirmDialog />

    <!-- 查找替换面板 -->
    <FindReplacePanel />

    <!-- Citation 引用面板（Phase 2 新增） -->
    <CitationPanel />

    <!-- Citation Popover（Phase 3 新增） -->
    <CitationPopover
      :visible="citationStore.popoverVisible"
      :citation-id="citationStore.popoverCitation?.citationId || ''"
      :source-id="citationStore.popoverCitation?.sourceId || ''"
      :source-type="citationStore.popoverCitation?.sourceType || 'manual'"
      :source-available="Boolean(applicationSurface?.contribution.openSource)"
      :source-unavailable-reason="layoutMessage('layout.knowledgeSource.unavailable')"
      :title="citationStore.popoverCitation?.title || ''"
      :snippet="citationStore.popoverCitation?.snippet || ''"
      :snippets="citationStore.popoverCitation?.snippets"
      :authors="citationStore.popoverCitation?.authors"
      :date="citationStore.popoverCitation?.date"
      :url="citationStore.popoverCitation?.url"
      :position="citationStore.popoverPosition"
      :pinned="citationStore.popoverPinned"
      @close="citationStore.closePopover"
      @edit="handleCitationEdit"
      @jump-to-source="handleJumpToSource"
    />

    <!-- Citation EditPanel（Phase 3 新增） -->
    <CitationEditPanel
      :visible="citationStore.editPanelVisible"
      :citation-id="citationStore.editPanelCitation?.citationId || ''"
      :source-id="citationStore.editPanelCitation?.sourceId || ''"
      :source-type="citationStore.editPanelCitation?.sourceType || 'manual'"
      :initial-data="citationStore.editPanelCitation"
      @close="citationStore.closeEditPanel"
      @saved="handleCitationSaved"
    />

    <!-- 全局确认对话框（替代 window.confirm，避免 Windows 下焦点丢失问题） -->
    <AlertDialog
      :visible="confirmDialogState.visible"
      :title="confirmDialogState.title"
      :message="confirmDialogState.message"
      :sections="confirmDialogState.sections"
      :risk-message="confirmDialogState.riskMessage"
      :isConfirmation="true"
      :confirmText="confirmDialogState.confirmText"
      :cancelText="confirmDialogState.cancelText"
      :width="confirmDialogState.width"
      :isDangerousAction="confirmDialogState.isDangerousAction"
      :closeIsCancel="true"
      @confirm="resolveConfirmDialog"
      @cancel="cancelConfirmDialog"
      @close="cancelConfirmDialog"
    />

    <component
      v-if="applicationSurface?.contribution.globalModalComponent"
      :is="applicationSurface.contribution.globalModalComponent"
      :key="`${applicationSurface.pluginId}:${navigationScope.currentProjectId ?? 'linnya-assistant'}`"
    />

    <ProjectKnowledgeBaseModal
      :is-visible="projectKnowledgeBaseModalStore.visible"
      :project-id="projectKnowledgeBaseModalStore.projectId"
      :project-name="projectKnowledgeBaseModalStore.projectName"
      @close="projectKnowledgeBaseModalStore.close"
    />
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';
import { useApplicationSurface } from '@/app/plugins/composables';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { useNotificationStore } from '@/app/notification';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';
import { useUIStore } from '@/shared/stores/ui';
import { useNavigationScope } from '@/app/navigation';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { SettingsModal } from '@/domains/settings';
import { ExportSettingsModal } from '@/domains/workspace/features/import-export';
import { useProjectKnowledgeBaseModalStore } from '@/domains/workspace/features/project-overview/store/projectKnowledgeBaseModalStore';
import ProjectKnowledgeBaseModal from '@/domains/workspace/features/project-overview/ui/ProjectKnowledgeBaseModal.vue';
import UpdateRestartConfirmDialog from '@/app/update/ui/UpdateRestartConfirmDialog.vue';
import { FindReplacePanel } from '@/domains/editor/features/FindReplace';
import CitationPanel from '@/domains/editor/features/citation/ui/CitationPanel.vue';
import CitationPopover from '@/domains/editor/features/citation/ui/CitationPopover.vue';
import CitationEditPanel from '@/domains/editor/features/citation/ui/CitationEditPanel.vue';
import { useCitationPanelStore } from '@/domains/editor/features/citation/store/useCitationPanelStore';
import { getCitationByCitationId } from '@/domains/editor/features/citation/services/citationUpdateService';
import { AlertDialog } from '@linnya/renderer-ui';
import {
  cancelConfirmDialog,
  confirmDialogState,
  resolveConfirmDialog,
} from '@/shared/composables/confirmDialog';

const uiStore = useUIStore();
const citationStore = useCitationPanelStore();
const projectKnowledgeBaseModalStore = useProjectKnowledgeBaseModalStore();
const navigationScope = useNavigationScope();
const navigation = getWorkspaceNavigationPort();
const applicationSurface = useApplicationSurface('knowledge-base');
const layoutStore = useLayoutStore();
const notifications = useNotificationStore();
const enabledPlugins = useEnabledPluginsStore();
const { layoutMessage } = useLayoutLocalization();
let sourceNavigation: AbortController | null = null;
function cancelSourceNavigation() { sourceNavigation?.abort(); sourceNavigation = null; }
onBeforeUnmount(cancelSourceNavigation);
watch([applicationSurface, () => enabledPlugins.hasLoaded], ([surface, hasLoaded]) => {
  cancelSourceNavigation();
  if (hasLoaded && !surface) {
    projectKnowledgeBaseModalStore.close();
    if (layoutStore.state.scene.kind === 'knowledge-base') {
      void navigation.openWorkspace(navigationScope.currentScope);
    }
  }
}, { immediate: true });
watch(() => navigationScope.currentScope, cancelSourceNavigation);
watch(() => layoutStore.state.scene.kind, scene => { if (scene !== 'knowledge-base') cancelSourceNavigation(); });

/**
 * 处理编辑引用
 */
function handleCitationEdit(citationId: string, sourceId: string) {
  const editor = uiStore.getEditor();
  if (!editor) return;

  // 获取引用数据
  const citation = getCitationByCitationId(editor.state.doc, citationId);
  if (citation) {
    citationStore.openEditPanel(citation);
  }
}

/**
 * 处理跳转到来源
 */
async function handleJumpToSource(sourceId: string) {
  const surface = applicationSurface.value;
  if (!surface?.contribution.openSource) return;
  const citation = citationStore.popoverCitation;
  const target = Object.freeze({
    sourceId,
    containerId: citation?.kbId ?? undefined,
    projectId: navigationScope.currentProjectId,
  });
  cancelSourceNavigation();
  const controller = new AbortController();
  sourceNavigation = controller;
  citationStore.closePopover();
  try {
    await navigation.openKnowledgeBase();
    if (controller.signal.aborted || applicationSurface.value !== surface
      || layoutStore.state.scene.kind !== 'knowledge-base') return;
    await surface.contribution.openSource(target, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error('[GlobalModals] 来源跳转失败:', error);
      notifications.show(error instanceof Error ? error.message : layoutMessage('layout.knowledgeSource.openFailed'), 'error', 4000);
    }
  } finally {
    if (sourceNavigation === controller) sourceNavigation = null;
  }
}

/**
 * 处理引用保存完成
 */
function handleCitationSaved(count: number) {
  console.log(`[GlobalModals] 已更新 ${count} 处引用`);
}
</script>
