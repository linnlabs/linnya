<!--
  应用主布局组件
  
  职责：
  - 组装应用的整体布局结构
  - 协调各布局区域（头部、侧边栏、内容区域）
  - 通过 slot 渲染页面内容
  
  拆分说明：
  - 全局快捷键：useGlobalKeyboardShortcuts
  - 主题管理：useThemeManager
  - 侧边栏动画事件：useSidebarAnimationEvents
  - CSS 变量管理：useCssVariables
  - 全局模态框：GlobalModals.vue
  - 全局样式：styles/index.css
-->
<template>
  <div
    class="app-layout"
    :class="{
      'file-dropdown-is-open': uiStore.isFileDropdownOpen,
      'block-hover-enabled': editorDocumentSettings.blockHoverEnabled,
    }"
  >
    <!-- 头部导航栏 -->
    <AppHeader />
    
    <!-- 左侧边栏 -->
    <transition name="sidebar-fade">
      <Sidebar v-show="uiStore.sidebarVisible" />
    </transition>
    
    <!-- 主体容器 -->
    <div class="main-container">
      <!-- 内容区域 -->
      <div 
        class="content-area" 
        :style="contentAreaStyle" 
        @transitionend="emitSidebarTransitionEnd"
      >
        <!-- 菜单栏 -->
        <MenuBar v-if="editorDocumentSettings.menuBarVisible && isEditorChromeActive" />
      
        <!-- 目录侧边栏 (仅编辑器视图) -->
        <OutlineSidebar 
          v-if="isEditorChromeActive"
        />

        <!-- 目录切换按钮：组件在编辑器视图内常驻，内部用 v-show 跟随 hasHeadings。
             这样大文档加载时 `hasHeadings=true` 只触发显隐，不额外触发组件挂载。 -->
        <OutlineToggleButton 
          v-if="isEditorChromeActive"
        />

        <!-- 主内容区域 -->
        <div
          class="editor-shell"
          :class="{
            [documentShellClass]: !!documentShellClass,
            'for-non-editor': shellDocumentType !== 'editor',
            // 项目初始化视图：需要占满可用高度，由内部自己管理布局与滚动
            'for-project-setup': isProjectSetupScene,
            // 知识库视图：独立全屏页面，外层只传递高度，滚动由知识库列表/详情页内部管理
            'for-knowledge-base': isKnowledgeBaseScene,
            // 插件视图：独立整页管理页，滚动由 editor-shell 统一管理
            'for-plugin-store': isPluginStoreScene,
            // 对话居中工作台：全屏无留白，由对话主导页内部管理布局
            'for-chat-centric': isWorkspaceScene && !isWorkspaceDocumentActive,
            'for-workspace-stage': isWorkspaceStageActive,
          }"
        >
          <div class="scroll-content-wrapper">
            <slot></slot>
            <!-- 批注层 (仅编辑器视图) -->
            <div v-if="isEditorChromeActive" class="annotation-layer" />
          </div>
        </div>
        
        <!-- 字数显示 (仅编辑器视图) -->
        <CharacterCount 
          v-if="isEditorChromeActive && editorDocumentSettings.characterCountVisible"
          :count="editorDocumentSettings.characterCount"
          @width-change="editorDocumentSettings.setCharacterCountActualWidth"
        />
      </div>
    </div>
    
    <!-- 全局模态框 -->
    <GlobalModals />

    <!-- 全局 LaTeX 输入面板 -->
    <LatexInputPanel />
    
    <!-- 通知栏 -->
    <GlobalNotificationBar :reserved-trailing-width="notificationReservedTrailingWidth" />
    
    <!-- 块操作菜单 -->
    <BlockActionMenu />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { useLayoutStore } from './store/layoutStore';
import { useEditorDocumentSettingsStore } from '@/domains/editor/features/DocumentSettings';

// 布局组件
import AppHeader from './AppHeader/index.vue';
import Sidebar from './sidebar/Sidebar.vue';
import GlobalModals from './GlobalModals.vue';

// 编辑器 chrome 只在 editor 文档激活时出现，按现有 v-if 条件延迟加载。
const MenuBar = defineAsyncComponent(() => import('@/domains/editor/ui/MenuBar.vue'));
const OutlineSidebar = defineAsyncComponent(() => import('@/domains/editor/features/outline/OutlineSidebar.vue'));
const OutlineToggleButton = defineAsyncComponent(() => import('@/domains/editor/features/outline/OutlineToggleButton.vue'));
const LatexInputPanel = defineAsyncComponent(() => import('@/domains/editor/blocks/LatexBlock/ui/LatexInputPanel.vue'));
const BlockActionMenu = defineAsyncComponent(() => import('@/domains/editor/features/blockActionMenu/ui/BlockActionMenu.vue'));

// 共享组件
import { GlobalNotificationBar } from '@/app/notification';
import { CharacterCount } from '@linnya/renderer-ui';

// Composables
import { 
  useGlobalKeyboardShortcuts, 
  useThemeManager, 
  useSidebarAnimationEvents,
  useCssVariables,
  useStartupWorkspaceScope,
  useSidebarSelectionVisibility,
} from './composables';
import { getDocumentTypeByActiveType } from '@/app/plugins/registry';

// Store
const uiStore = useUIStore();
// 持久化数据会绕过 action 直接恢复，布局挂载前先收敛到当前侧栏契约。
uiStore.normalizeSidebarWidth();
const editorDocumentSettings = useEditorDocumentSettingsStore();
const layoutStore = useLayoutStore();
const scene = computed(() => layoutStore.state.scene);
const isWorkspaceScene = computed(() => scene.value.kind === 'workspace');
const isProjectSetupScene = computed(() => scene.value.kind === 'project-setup');
const isKnowledgeBaseScene = computed(() => scene.value.kind === 'knowledge-base');
const isPluginStoreScene = computed(() => scene.value.kind === 'plugin-store');
const isWorkspaceStageActive = computed(() => isWorkspaceScene.value);
const activeDocumentType = computed(() => layoutStore.state.activeDocument?.type ?? null);
const isWorkspaceDocumentActive = computed(() => {
  return isWorkspaceScene.value && layoutStore.state.activeDocument !== null;
});
// 中文说明：activeDocument 会在知识库/插件/项目初始化这些 bypass scene 中保留，
// 方便回到工作区时恢复文档上下文；但外壳 CSS 不能继承文档画布 class，
// 否则某个文档类型的外壳样式可能覆盖其他插件页的滚动规则。
const shellDocumentType = computed(() => (
  isWorkspaceDocumentActive.value ? activeDocumentType.value : null
));
const documentShellClass = computed(() => {
  const documentType = shellDocumentType.value;
  if (!documentType) return '';
  return getDocumentTypeByActiveType(documentType)?.shellClass ?? '';
});
// 中文说明：独立 MarkdownEditorPage 已由 WorkspaceStage 承接；平台 Markdown editor chrome
// 只属于历史独立编辑页，不能在 workspace 文档 pane 上重复挂载。
const isEditorChromeActive = computed(() => false);
const notificationReservedTrailingWidth = computed(() => {
  const hasEditorCharacterCount =
    (isEditorChromeActive.value || shellDocumentType.value === 'editor') &&
    editorDocumentSettings.characterCountVisible;
  if (!hasEditorCharacterCount) {
    return 0;
  }
  return editorDocumentSettings.characterCountActualWidth + 10;
});

// 初始化 composables
useGlobalKeyboardShortcuts();
useThemeManager();
useStartupWorkspaceScope();
useSidebarSelectionVisibility();
const { emitSidebarTransitionEnd } = useSidebarAnimationEvents();
const { contentAreaStyle } = useCssVariables();

// 启动时初始化逻辑
onMounted(() => {
  console.log('[ANIMATION_DEBUG] AppLayout MOUNTED');

  // 首次安装检测：确保左侧侧边栏默认打开
  // 因为 sidebarVisible 被持久化，pinia persist 恢复后可能不是默认值；
  // 此处通过独立标记判断"首次安装"，强制打开侧边栏以提供良好的初始体验。
  const FIRST_LAUNCH_KEY = 'linnya-first-launch-done';
  if (!localStorage.getItem(FIRST_LAUNCH_KEY)) {
    console.log('[AppLayout] 首次安装检测：默认打开左侧侧边栏');
    uiStore.setSidebarVisible(true);
    localStorage.setItem(FIRST_LAUNCH_KEY, '1');
  }

});
</script>
