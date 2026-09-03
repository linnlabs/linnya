<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue';

// 布局组件
import AppLayout from './layout/AppLayout.vue';

// 四个 scene 互斥，按当前 scene 加载，避免把非首屏业务页面合进应用入口。
const WorkspaceStage = defineAsyncComponent(() => import('./pages/WorkspaceStage/WorkspaceStage.vue'));
const ProjectSetupPage = defineAsyncComponent(() => import('./pages/ProjectSetupPage/ProjectSetupPage.vue'));
const KnowledgeBasePage = defineAsyncComponent(() => import('./pages/KnowledgeBasePage/KnowledgeBasePage.vue'));
const PluginStorePage = defineAsyncComponent(() => import('./pages/PluginStorePage/PluginStorePage.vue'));

// Stores
import { useLayoutStore } from './layout/store/layoutStore';

// 其他
import FloatingToolbarContainer from '../domains/editor/features/floating-toolbar/ui/FloatingToolbarContainer.vue';
import CommandApprovalPageOwner from '../domains/conversation/features/command-approval/ui/CommandApprovalPageOwner.vue';
import { initFileManager, syncFileManagerHandlers } from '../domains/workspace/services/file-manager/setup';
import { requestSave } from '../domains/workspace/services/file-manager/index';
import { prepareWindowClose } from './lifecycle/orchestration/prepareWindowClose';
import { createWorkspaceNavigation } from './layout/orchestration/workspaceNavigation';
import { registerWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { createWorkspaceContext } from './layout/orchestration/workspaceContext';
import { registerWorkspaceContextPort } from '@/shared/ports/workspaceContextPort';
import { createWorkspaceDocumentExport } from './layout/orchestration/workspaceDocumentExport';
import { registerWorkspaceDocumentExportPort } from '@/shared/ports/workspaceDocumentExportPort';
import { createWorkspaceReferenceContent } from './layout/orchestration/workspaceReferenceContent';
import { registerWorkspaceReferenceContentPort } from '@/shared/ports/workspaceReferenceContentPort';
import { createWorkspaceMutationEffects } from './layout/orchestration/workspaceMutationEffects';
import { registerWorkspaceMutationEffectsPort } from '@/shared/ports/workspaceMutationEffectsPort';
import { createWorkspaceNodeDeletion } from './layout/orchestration/workspaceNodeDeletion';
import { registerWorkspaceNodeDeletionPort } from '@/shared/ports/workspaceNodeDeletionPort';
import { createWorkspaceNodeTransfer } from './layout/orchestration/workspaceNodeTransfer';
import { registerWorkspaceNodeTransferPort } from '@/shared/ports/workspaceNodeTransferPort';
import { createDocumentSurfaceRuntime } from './layout/orchestration/documentRuntime';
import { registerDocumentSurfaceRuntimePort } from '@/shared/ports/documentSurfaceRuntimePort';
import { createMarkdownDocumentEditorRuntime } from './layout/orchestration/markdownDocumentEditorRuntime';
import { registerMarkdownDocumentEditorRuntimePort } from '@/shared/ports/markdownDocumentEditorRuntimePort';
import { useWorkspaceVfsRuntimeContextSync } from './layout/composables/useWorkspaceVfsRuntimeContextSync';
import { useWorkspaceMutationSubscription } from './layout/composables/useWorkspaceMutationSubscription';
import { ensureBuiltinRendererPluginsRegistered } from './plugins/builtin';
import { useEnabledPluginsStore } from './plugins/enabledPluginsStore';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import { useActiveDocumentPluginAvailabilityGuard } from './plugins/useActiveDocumentPluginAvailabilityGuard';
import {
  getRuntimeRendererPluginLoaderDiagnostics,
  loadRuntimeRendererPlugins,
} from './plugins/loader/runtimeRendererPluginLoader';
import { describeRendererPluginRegistryForDiagnostics } from './plugins/registry';
import { registerConversationResourceLinkPort } from '@/domains/conversation/features/resource-link';
import { createConversationResourceLinkPort } from './workflows/conversation-resource-link/orchestration/createConversationResourceLinkPort';

const layoutStore = useLayoutStore();
let disposeWindowCloseRequest = () => {};
ensureBuiltinRendererPluginsRegistered();
const enabledPluginsStore = useEnabledPluginsStore();
enabledPluginsStore.seedFromRegisteredRendererPlugins();
registerWorkspaceNavigationPort(createWorkspaceNavigation());
registerWorkspaceContextPort(createWorkspaceContext());
registerWorkspaceDocumentExportPort(createWorkspaceDocumentExport());
registerWorkspaceReferenceContentPort(createWorkspaceReferenceContent());
registerWorkspaceMutationEffectsPort(createWorkspaceMutationEffects());
const workspaceNodeDeletion = createWorkspaceNodeDeletion();
registerWorkspaceNodeDeletionPort(workspaceNodeDeletion);
registerWorkspaceNodeTransferPort(createWorkspaceNodeTransfer());
registerDocumentSurfaceRuntimePort(createDocumentSurfaceRuntime());
registerMarkdownDocumentEditorRuntimePort(createMarkdownDocumentEditorRuntime());
registerConversationResourceLinkPort(createConversationResourceLinkPort());
useWorkspaceVfsRuntimeContextSync();
useWorkspaceMutationSubscription();
useActiveDocumentPluginAvailabilityGuard();
const unsubscribePluginChanges = enabledPluginsStore.subscribeToBackendChanges({
  async afterRefresh() {
    console.info('[App.vue] plugin-runtime-change-sync-start', {
      enabledPluginIds: Array.from(enabledPluginsStore.enabledPluginIds),
      pluginStates: enabledPluginsStore.states,
      registryBeforeLoad: describeRendererPluginRegistryForDiagnostics(),
    });
    await loadRuntimeRendererPlugins();
    await syncFileManagerHandlers(enabledPluginsStore.enabledPluginIds);
    const currentProjectId = useWorkspaceScopeStore().currentProjectId;
    if (layoutStore.state.sidebarMode === 'files' && currentProjectId) {
      await workspaceNodeDeletion.ensureProjectPageSelection(currentProjectId);
    }
    console.info('[App.vue] plugin-runtime-change-sync-success', {
      enabledPluginIds: Array.from(enabledPluginsStore.enabledPluginIds),
      registryAfterLoad: describeRendererPluginRegistryForDiagnostics(),
      loader: getRuntimeRendererPluginLoaderDiagnostics(),
    });
  },
});
const scene = computed(() => layoutStore.state.scene);
const isWorkspaceStageView = computed(() => scene.value.kind === 'workspace');
const isProjectSetupView = computed(() => scene.value.kind === 'project-setup');
const isKnowledgeBaseView = computed(() => scene.value.kind === 'knowledge-base');
const isPluginStoreView = computed(() => scene.value.kind === 'plugin-store');

// 初始状态检查
console.log('[App.vue] Initializing with scene:', scene.value.kind);

// 新增：在组件挂载后设置IPC监听
onMounted(async () => {
  console.log('[App.vue] 组件已挂载，准备设置更新检测');
  console.log('[App.vue] 当前场景:', scene.value.kind);
  initFileManager();

  const windowCloseApiAvailable = window.electronAPI
    && typeof window.electronAPI.onWindowCloseRequest === 'function'
    && typeof window.electronAPI.markWindowCloseRendererReady === 'function'
    && typeof window.electronAPI.completeWindowClosePreparation === 'function';
  if (windowCloseApiAvailable) {
    // 关闭协议不能等待插件初始化；插件加载卡住时，用户仍必须能保存当前状态并安全退出。
    disposeWindowCloseRequest = window.electronAPI.onWindowCloseRequest(async (request) => {
      console.log('[App.vue] 收到窗口关闭请求');
      const result = await prepareWindowClose({
        requestSave: () => requestSave('before-unload'),
        reportUnexpectedFailure: (error) => {
          console.error('[App.vue] 窗口关闭前保存发生未预期异常:', error);
        },
      });
      console.log(result === 'ready'
        ? '[App.vue] 窗口关闭准备完成'
        : '[App.vue] 保存失败，保持窗口打开');
      window.electronAPI.completeWindowClosePreparation(request.request_id, result);
    });
    window.electronAPI.markWindowCloseRendererReady();
  } else {
    console.error('[App.vue] 窗口关闭协议不可用，renderer 不会声明就绪');
  }
  
  // 中文说明：必须先读取后端插件启用态，再按这份启用态加载 renderer contribution。
  // 反过来会让“后端已启用、前端未注册”的状态变得难以判断。
  try {
    console.info('[App.vue] plugin-runtime-init-start', {
      registryBeforeInit: describeRendererPluginRegistryForDiagnostics(),
    });
    await enabledPluginsStore.initialize();
    console.info('[App.vue] plugin-runtime-state-loaded', {
      enabledPluginIds: Array.from(enabledPluginsStore.enabledPluginIds),
      pluginStates: enabledPluginsStore.states,
      diagnostics: enabledPluginsStore.diagnostics,
    });
    await loadRuntimeRendererPlugins();
    console.info('[App.vue] plugin-runtime-renderer-loaded', {
      registryAfterLoad: describeRendererPluginRegistryForDiagnostics(),
      loader: getRuntimeRendererPluginLoaderDiagnostics(),
    });
    await syncFileManagerHandlers(enabledPluginsStore.enabledPluginIds);
    const currentProjectId = useWorkspaceScopeStore().currentProjectId;
    if (layoutStore.state.sidebarMode === 'files' && currentProjectId) {
      await workspaceNodeDeletion.ensureProjectPageSelection(currentProjectId);
    }
    console.info('[App.vue] plugin-runtime-init-success', {
      enabledPluginIds: Array.from(enabledPluginsStore.enabledPluginIds),
      registryAfterInit: describeRendererPluginRegistryForDiagnostics(),
    });
  } catch (error) {
    console.error('[App.vue] plugin-runtime-init-failed', {
      error,
      enabledPluginIds: Array.from(enabledPluginsStore.enabledPluginIds),
      pluginStates: enabledPluginsStore.states,
      registry: describeRendererPluginRegistryForDiagnostics(),
      loader: getRuntimeRendererPluginLoaderDiagnostics(),
    });
  }
  
});

onBeforeUnmount(() => {
  disposeWindowCloseRequest();
  disposeWindowCloseRequest = () => {};
  unsubscribePluginChanges();
});
</script>

<template>
  <CommandApprovalPageOwner />
  <AppLayout>
    <!-- 页面组件负责组装领域组件，App.vue 只根据 layout scene 做顶层分发 -->
    <WorkspaceStage v-if="isWorkspaceStageView" />
    <ProjectSetupPage v-else-if="isProjectSetupView" />
    <KnowledgeBasePage v-else-if="isKnowledgeBaseView" />
    <PluginStorePage v-else-if="isPluginStoreView" />
  </AppLayout>
  <FloatingToolbarContainer />
</template>
