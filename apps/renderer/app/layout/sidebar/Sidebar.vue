<!--
  apps/renderer/app/layout/sidebar/Sidebar.vue
  
  布局壳组件：只负责侧边栏的定位、尺寸、动画和拖拽调整宽度。
  跨 domain 的侧边栏组合由 WorkspaceSidebarSurface 处理。
-->
<template>
  <aside 
    class="sidebar-shell" 
    :style="{ width: `${uiStore.sidebarWidth}px` }"
  >
    <!-- App 组合层：拼接 workspace 项目/文件能力与 conversation 对话能力 -->
    <WorkspaceSidebarSurface
      :active-scene="layoutStore.state.scene.kind"
      :sidebar-nav="layoutStore.state.sidebarNav"
      :sidebar-mode="layoutStore.state.sidebarMode"
      @linnya-assistant-click="handleLinnyaAssistantClick"
      @project-workspace-click="handleProjectWorkspaceClick"
      @knowledge-base-click="handleKnowledgeBaseClick"
      @plugin-store-click="handlePluginStoreClick"
      @set-sidebar-nav="handleSetSidebarNav"
      @set-sidebar-mode="handleSetSidebarMode"
      @view-switch="handleViewSwitch"
    />
    
    <PaneDivider
      class="sidebar-shell__divider"
      side="right"
      interactive
      :label="layoutMessage('layout.pane.resizeSidebar')"
      :min="SIDEBAR_WIDTH_LIMITS.min"
      :max="SIDEBAR_WIDTH_LIMITS.max"
      :value="uiStore.sidebarWidth"
      @resize-start="startResize"
      @resize-to="resizeTo"
    />
  </aside>
</template>

<script setup lang="ts">
import { onUnmounted } from 'vue';
import { SIDEBAR_WIDTH_LIMITS, useUIStore } from '@/shared/stores/ui';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { getWorkspaceNodeDeletionPort } from '@/shared/ports/workspaceNodeDeletionPort';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';

// App 组合面
import WorkspaceSidebarSurface from '@/app/layout/sidebar/WorkspaceSidebarSurface.vue';
import PaneDivider from '@/app/layout/components/PaneDivider.vue';

// Composables - 布局级别的宽度调整逻辑（从 app/layout 引入）
import { useSidebarResize } from '@/app/layout/composables/useSidebarResize';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

const uiStore = useUIStore();
const layoutStore = useLayoutStore();
const navigation = getWorkspaceNavigationPort();
const nodeDeletion = getWorkspaceNodeDeletionPort();
const workspaceScopeStore = useWorkspaceScopeStore();
const { layoutMessage } = useLayoutLocalization();

const { startResize, resizeTo, cleanup: cleanupResize } = useSidebarResize({
  getWidth: () => uiStore.sidebarWidth,
  minWidth: SIDEBAR_WIDTH_LIMITS.min,
  maxWidth: SIDEBAR_WIDTH_LIMITS.max,
  direction: 'right',
  setWidth: (width) => uiStore.setSidebarWidth(width),
});

// ============================================================================
// 视图导航事件处理（布局层负责调用 uiStore）
// ============================================================================

/**
 * 进入 Linnya 助手对话工作区
 */
const handleLinnyaAssistantClick = () => {
  console.log('[Sidebar Shell] 切换到 Linnya 助手工作台');
  layoutStore.setSidebarNav('list');
  navigation.openWorkspace({ kind: 'linnya-assistant' });
};

/**
 * 处理项目对话入口点击事件
 */
const handleProjectWorkspaceClick = (projectId: string) => {
  console.log('[Sidebar Shell] 切换到项目对话:', projectId);
  navigation.openWorkspace({ kind: 'project', projectId });
};

/**
 * 处理"知识库"点击事件
 */
const handleKnowledgeBaseClick = () => {
  layoutStore.setSidebarNav('list');
  void navigation.openKnowledgeBase();
};

/**
 * 处理"插件"点击事件
 */
const handlePluginStoreClick = () => {
  layoutStore.setSidebarNav('list');
  void navigation.openPluginStore();
};

const handleSetSidebarNav = (nav: 'list' | 'project') => {
  layoutStore.setSidebarNav(nav);
};

const handleSetSidebarMode = (mode: 'chat' | 'files') => {
  layoutStore.setSidebarMode(mode);
  const projectId = workspaceScopeStore.currentProjectId;
  if (mode === 'files' && projectId) {
    void nodeDeletion.ensureProjectPageSelection(projectId).catch((error: unknown) => {
      console.warn('[Sidebar] 打开项目文件页失败：', error);
    });
  }
};

/**
 * 处理视图切换（通用）
 */
const handleViewSwitch = (view: string, payload?: Record<string, unknown>) => {
  console.log('[Sidebar Shell] 视图切换:', view, payload);
  // 可以根据 view 类型调用不同的 uiStore 方法
  // 目前保留扩展性
};

onUnmounted(() => {
  cleanupResize();
});
</script>
