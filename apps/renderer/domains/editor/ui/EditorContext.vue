<!-- src/renderer/components/EditorContext.vue -->

<template>
  <!-- 将内容直接放入 template 片段 -->
  <!-- slot 将渲染 EditorContent -->
    <slot :editor="editor"></slot>
</template>

<script setup>
// ================================================================================
// 导入区域：按类型分组
// ================================================================================

// --- Vue 核心库导入 ---
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch, onUpdated, getCurrentInstance } from 'vue'

// --- Tiptap 和 ProseMirror 相关导入 ---
// [REMOVED] - 大部分 Tiptap 扩展导入已被移至 editorFactory.js

// --- Pinia 状态管理导入 ---
import { useFileStore } from '../../../shared/stores/file'
import { useNotificationStore } from '@/app/notification'
import { useUIStore } from '../../../shared/stores/ui'
import { useFindReplaceStore } from '../features/FindReplace'

// --- 特性模块导入 ---
import {
  startCreatingAnnotation,
  confirmCreatingAnnotation,
} from '../features/Annotation'
import { resolveAnnotationRootBlockId } from '../features/Annotation/functions/rootBlockIdResolver'

// --- 核心应用模块导入 ---
import { createEditor } from '../core/editorFactory'
import { 
  loadContentIntoEditor, 
  gatherSaveData
} from '../services/editorService'
import { NODE_GROUPS } from '../extensions/core/schema'

// --- 共享模块导入 ---
// Components
// CharacterCountDisplay 已移至 AppLayout.vue
// Utils
import {
  ANNOTATION_LAYOUT_RECALC_REASON,
  requestAnnotationLayoutRecalculation,
} from '../features/Annotation/position/layoutRecalculationPolicy'
import {
  GET_BLOCK_VISIBILITY_REF_KEY,
  GET_BLOCK_VISIBILITY_STATE_KEY,
  OBSERVE_BLOCK_KEY,
  REGISTER_BLOCK_VISIBILITY_KEY,
  UNOBSERVE_BLOCK_KEY,
  UNREGISTER_BLOCK_VISIBILITY_KEY,
} from './composables/useBlockVisibilityManager'
import {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  RENDER_VIRTUALIZATION_ENGINE_KEY,
} from '../features/RenderVirtualization'
import { setupEditorVirtualizationRuntime } from './runtime/setupEditorVirtualizationRuntime'
import {
  ANNOTATIONS_BY_BLOCK_ID_KEY,
  ANNOTATION_PANEL_POSITION_MANAGER_KEY,
  ANNOTATION_RUNTIME_STORE_KEY,
  TRIGGER_ANNOTATION_CREATE_KEY,
} from '../features/Annotation/definitions/injectionKeys'
import { EDITOR_KEY } from '../core/tokens'
// +++ 块操作菜单：通过副作用导入自动注册，无需手动调用 +++
import '../features/blockActionMenu'
// 浮动工具栏：注册入口
import { registerCommonToolbarProvider, registerBlockToolbarProvider } from '../features/floating-toolbar/registry';
import { commonTextSelectionProvider } from '../features/floating-toolbar/providers/commonTextSelectionProvider';
import { tableToolbarProvider } from '../blocks/TableBlock/toolbar/tableToolbarProvider';
import { requestSave } from '../../workspace/services/file-manager/index';
// ✅ Workspace ref（短引用）快照同步：让“AI 引用段落”可以反解到 blockId 并跳转
import { setupBlockRefSnapshotSync } from '../shared/utils/blockRefSnapshotSync';
// ✅ 统一块跳转协议：大文档 placeholder 会先 hydrate 再滚动，普通文档走快路径。
import { scrollEditorToBlock as scrollEditorToBlockWithHandshake } from '../features/RenderVirtualization';
import { resolveCurrentEditorMessage } from '../functions/resolveCurrentEditorMessage';

// ================================================================================
// 状态与初始化区域
// ================================================================================

// --- UI 状态管理 ---
const uiStore = useUIStore()
const fileStore = useFileStore()
const notificationStore = useNotificationStore()
const findReplaceStore = useFindReplaceStore()
const editorMessage = resolveCurrentEditorMessage

// --- 编辑器实例引用 ---
const editor = ref(null)
// +++ 新增：ref 快照同步的清理函数 +++
const cleanupBlockRefSnapshotSync = ref(null)

// --- 批注处理相关引用 ---
const cleanupBlockEventHandler = ref(null)

// 初始 Store 结构，提供最小化占位符
const initialStoreStructure = {
  annotations: ref([]),
  getAnnotationsByBlockId: () => [],
  addAnnotation: () => { console.warn("批注存储尚未完全初始化。"); return null; },
  removeAnnotation: () => { console.warn("批注存储尚未完全初始化。"); return false; },
  updateAnnotation: () => { console.warn("批注存储尚未完全初始化。"); return false; },
  initialize: () => {},
  cleanup: () => {}
}

// 批注存储和布局管理器实例引用
const annotationStoreInstance = ref(initialStoreStructure)
const layoutManagerInstance = ref(null)

// --- 编辑器初始内容配置 ---
const initialContent = {
  type: 'doc',
  content: [
    {
      type: 'rootBlock',
      content: [
        {
          type: 'baseBlock',
          attrs: {
            blockType: 'base',
          },
          content: [] // 空内容
        }
      ]
    }
  ]
}

// +++ 存储自动保存的清理函数 +++



// +++ 新增：滚动同步相关变量和函数，提升到 setup 顶层作用域 +++
let scrollContainer = null;
let isScrolling = false;
let animationFrameId = null;
let isSidebarAnimating = false;
let needsSidebarFinalLayoutRecalc = false;
const editorVirtualizationRuntime = setupEditorVirtualizationRuntime({
  getEditor: () => editor.value,
  getScrollRoot: () => scrollContainer instanceof HTMLElement ? scrollContainer : document.querySelector('.editor-shell'),
});
const blockVisibilityManager = editorVirtualizationRuntime.blockVisibilityManager;
const renderVirtualizationEngine = editorVirtualizationRuntime.renderVirtualizationEngine;

function scheduleAnnotationLayoutFrame() {
  if (animationFrameId !== null) return;
  animationFrameId = requestAnimationFrame(flushAnnotationLayoutFrame);
}

function flushAnnotationLayoutFrame() {
  animationFrameId = null;

  const shouldRecalcForSidebar = isSidebarAnimating || needsSidebarFinalLayoutRecalc;
  const shouldRecalcForScroll = isScrolling;
  if (!shouldRecalcForSidebar && !shouldRecalcForScroll) return;

  const reason = shouldRecalcForSidebar
    ? ANNOTATION_LAYOUT_RECALC_REASON.SIDEBAR_ANIMATION
    : ANNOTATION_LAYOUT_RECALC_REASON.SCROLL;
  void requestAnnotationLayoutRecalculation(layoutManagerInstance, reason);

  isScrolling = false;
  needsSidebarFinalLayoutRecalc = false;

  // 中文说明：侧栏动画期间需要逐帧跟随；普通滚动只在事件到达后调度一次。
  if (isSidebarAnimating) {
    scheduleAnnotationLayoutFrame();
  }
}

const handleScroll = () => {
  isScrolling = true;
  // 中文说明：RenderVirtualizationEngine 自己监听 editor-shell 滚动并决定
  // height-cache / DOM 采样路径。这里不再重复调度 engine，避免同一滚动帧
  // 跑两次窗口刷新；EditorContext 只保留批注布局刷新职责。
  scheduleAnnotationLayoutFrame();
};

const handleSidebarAnimationStart = () => {
  isSidebarAnimating = true;
  scheduleAnnotationLayoutFrame();
};

const handleSidebarAnimationEnd = () => {
  isSidebarAnimating = false;
  needsSidebarFinalLayoutRecalc = true;
  scheduleAnnotationLayoutFrame();
};

/**
 * Review/批注定位：监听 `locate-annotation` 事件并滚动到目标块
 *
 * 事件来源：
 * - ReviewDashboard 点击卡片，会派发 `window.dispatchEvent(new CustomEvent('locate-annotation', { detail: { annotationId } }))`
 *
 * 设计原则：
 * - 定位逻辑属于编辑器上下文（EditorContext），由它掌握 editor-shell / annotationStore / layoutManager
 * - 不依赖 Review 模块内部实现，保持低耦合
 */
async function scrollEditorToBlock(blockId) {
  if (typeof blockId !== 'string' || blockId.trim().length === 0) return;

  const container = scrollContainer instanceof HTMLElement
    ? scrollContainer
    : document.querySelector('.editor-shell');
  if (!(container instanceof HTMLElement)) return;

  const currentEditor = editor.value;
  if (!currentEditor?.state?.doc || !currentEditor?.view) return;

  const result = await scrollEditorToBlockWithHandshake(currentEditor, blockId, {
    select: 'node',
    scrollBehavior: 'smooth',
    scrollBlock: 'start',
    scrollContainer: container,
    scrollMarginTop: 80,
  });
  if (!result.ok) return;

  // 标记一次滚动，触发布局系统在下一帧重算批注面板位置
  isScrolling = true;
}

function handleLocateAnnotationEvent(evt) {
  // 只处理 CustomEvent 且带 detail.annotationId 的情况
  if (!(evt instanceof CustomEvent)) return;
  const detail = evt.detail;
  if (!detail || typeof detail !== 'object') return;

  const maybeId = detail.annotationId;
  if (typeof maybeId !== 'string' || maybeId.trim().length === 0) return;

  const store = annotationStoreInstance.value;
  if (!store || typeof store.getAnnotationById !== 'function') {
    console.warn('[EditorContext] locate-annotation: annotationStore.getAnnotationById 不可用');
    return;
  }

  const annotation = store.getAnnotationById(maybeId);
  if (!annotation || typeof annotation.blockId !== 'string') {
    console.warn('[EditorContext] locate-annotation: 未找到批注或 blockId 无效', { annotationId: maybeId });
    return;
  }

  scrollEditorToBlock(annotation.blockId);
}

// +++ 新增：监听文件加载事件以更新字符数 +++
// [REMOVED] This is now handled within the IPC handler
// const cleanupFileContentListener = ref(null);

// ================================================================================
// 提供依赖注入区域
// ================================================================================

// 为子组件提供编辑器实例。
// 中文说明：统一走 InjectionKey，避免字符串 key 重名或消费端用类型断言绕过注入契约。
provide(EDITOR_KEY, editor)

// 提供旧 BlockView 可见性管理入口。
// 中文说明：这条链路服务非虚拟化小文档路径，使用 typed key 避免旧字符串注入继续扩散。
provide(OBSERVE_BLOCK_KEY, (el) => {
  if (layoutManagerInstance.value && layoutManagerInstance.value.observeBlock) {
    layoutManagerInstance.value.observeBlock(el);
  }
});
provide(UNOBSERVE_BLOCK_KEY, (el) => {
  if (layoutManagerInstance.value && layoutManagerInstance.value.unobserveBlock) {
    layoutManagerInstance.value.unobserveBlock(el);
  }
});
provide(GET_BLOCK_VISIBILITY_STATE_KEY, blockVisibilityManager.getBlockVisibilityState);
provide(GET_BLOCK_VISIBILITY_REF_KEY, blockVisibilityManager.getBlockVisibilityRef);
provide(REGISTER_BLOCK_VISIBILITY_KEY, blockVisibilityManager.registerBlockVisibility);
provide(UNREGISTER_BLOCK_VISIBILITY_KEY, blockVisibilityManager.unregisterBlockVisibility);
provide(RENDER_VIRTUALIZATION_ENGINE_KEY, renderVirtualizationEngine);
provide(RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY, renderVirtualizationEngine.keepAlivePort);

// 提供批注相关服务。
// 中文说明：Annotation feature 的运行态契约由 feature 自己的 InjectionKey 声明，
// EditorContext 只负责把当前 editor 实例创建出的 store/布局器接入进来。
provide(ANNOTATION_RUNTIME_STORE_KEY, annotationStoreInstance)
provide(ANNOTATION_PANEL_POSITION_MANAGER_KEY, layoutManagerInstance)
provide(ANNOTATIONS_BY_BLOCK_ID_KEY, computed(() => {
  return annotationStoreInstance.value
    ? annotationStoreInstance.value.getAnnotationsByBlockId
    : () => []
}))

provide(TRIGGER_ANNOTATION_CREATE_KEY, handleCreateAnnotationRequest)

// ================================================================================
// 辅助函数区域
// ================================================================================

// --- 批注相关函数 ---
// 创建批注请求处理
async function handleCreateAnnotationRequest(blockId) {
  if (!annotationStoreInstance.value || !layoutManagerInstance.value) {
    console.error("[EditorContext] 存储或管理器尚未准备好，无法创建批注。")
    return null
  }

  const rootBlockId = resolveAnnotationRootBlockId(editor.value, blockId)
  if (!rootBlockId) {
    console.error('[EditorContext] 创建批注失败：无法解析 rootBlockId', { blockId })
    return null
  }
    
  try {
    return await startCreatingAnnotation({
      blockId: rootBlockId,
      annotationStore: annotationStoreInstance.value,
      panelPositionManager: layoutManagerInstance.value
    })
  } catch (error) {
    console.error(`[EditorContext] 调用 startCreatingAnnotation 命令时出错:`, error)
    return null
  }
}

// +++ 新增：处理创建带内容的批注请求 +++
async function handleCreateAnnotationWithContent(event) {
  console.log('🔥 [EditorContext] handleCreateAnnotationWithContent 被调用了！', event);
  
  const { blockId, content, author } = event;
  if (!blockId || !content) {
    console.warn('[EditorContext] handleCreateAnnotationWithContent: 缺少 blockId 或 content');
    return;
  }
  const rootBlockId = resolveAnnotationRootBlockId(editor.value, blockId)
  if (!rootBlockId) {
    console.warn('[EditorContext] handleCreateAnnotationWithContent: 无法解析 rootBlockId', { blockId })
    return
  }

  console.log('🔥 [EditorContext] 为 blockId:', rootBlockId, '创建批注，内容:', content);
  notificationStore.show(editorMessage('editor.annotation.toast.creating'), 'info');

  try {
    // 直接调用 Annotation 命令创建并填充批注
    // a. 开始创建过程，这会在UI上显示一个空的输入框
    console.log('🔥 [EditorContext] 调用 startCreatingAnnotation...');
    const annotationId = await startCreatingAnnotation({
      blockId: rootBlockId,
      author,
      annotationStore: annotationStoreInstance.value,
      panelPositionManager: layoutManagerInstance.value
    });
    
    if (annotationId) {
      console.log('🔥 [EditorContext] startCreatingAnnotation 成功，annotationId:', annotationId);
      // b. 确认创建，并填入转录内容
      console.log('🔥 [EditorContext] 调用 confirmCreatingAnnotation...');
      const confirmedId = await confirmCreatingAnnotation({
        blockId: rootBlockId,
        content: content,
        annotationStore: annotationStoreInstance.value,
        panelPositionManager: layoutManagerInstance.value,
      });
      
      if (confirmedId) {
        console.log('🔥 [EditorContext] confirmCreatingAnnotation 成功，confirmedId:', confirmedId);
        notificationStore.show(editorMessage('editor.annotation.toast.created'), 'success', 2000);
      } else {
        throw new Error(editorMessage('editor.annotation.error.confirmFailed'));
      }
    } else {
       throw new Error(editorMessage('editor.annotation.error.startFailed'));
  }
  } catch (error) {
    console.error('[EditorContext] 创建批注时出错:', error);
    notificationStore.show(
      editorMessage('editor.annotation.toast.createFailed'),
      'error',
    );
  }
}

// --- 全局键盘事件处理 ---
function handleGlobalKeyDown(event) {
  // 检测 Ctrl+J 或 Cmd+J
  if ((event.ctrlKey || event.metaKey) && event.key === 'j') {
    // 检查编辑器实例是否存在且有 view 和 view.dom
    if (editor.value && editor.value.view && editor.value.view.dom) {
      // 检查事件的目标是否在编辑器 DOM 内部
      const editorDOM = editor.value.view.dom;
      if (editorDOM.contains(event.target)) {
        // 如果事件发生在编辑器内部，则不阻止默认行为，
        // 让 ProseMirror 的 handleKeyDown 处理
        return;
      }
    }
    // 如果事件发生在编辑器外部，或者编辑器还没准备好，则阻止浏览器默认行为
    event.preventDefault();
  }
}

// ================================================================================
// 生命周期钩子区域
// ================================================================================

// --- 组件挂载钩子 ---
onMounted(async () => {
  console.log('--- [EditorContext] 1. onMounted started.');

  // +++ 新增: 注册通用文本选区浮动工具栏 Provider +++
  registerCommonToolbarProvider(commonTextSelectionProvider);
  // +++ 新增: 注册表格浮动工具栏 Provider（覆盖通用工具栏） +++
  registerBlockToolbarProvider('table', tableToolbarProvider);

  // 添加全局键盘事件监听
  document.addEventListener('keydown', handleGlobalKeyDown, { capture: true })

  // 监听批注定位事件（Review/批注列表等模块复用）
  window.addEventListener('locate-annotation', handleLocateAnnotationEvent)
  // 监听 AppLayout 发出的侧栏动画事件。动画期间批注布局需要逐帧跟随，结束后停止 rAF。
  window.addEventListener('sidebar-anim-start', handleSidebarAnimationStart)
  window.addEventListener('sidebar-anim-end', handleSidebarAnimationEnd)
  
  // 将 notificationStore 挂载到全局
  window.__APP_NOTIFICATION_STORE__ = notificationStore;
  
  // --- 滚动同步逻辑已移至 setup 顶层作用域 ---

  // --- 新的初始化流程 ---
  // 1. 直接启动具备"监听"能力的服务。它们会等待编辑器实例。
  console.log('--- [EditorContext] 1.5. Setting up services...');
  // 2. 创建编辑器。完成后它会自动将实例发布到 uiStore。
  console.log('--- [EditorContext] 2. Calling createEditor...');
  const onEditorReady = (readyEditor) => {
    console.log('--- [EditorContext] Editor is ready.');
    editorVirtualizationRuntime.installShellRuntimeBridges();
  };

  editor.value = createEditor({
    initialContent,
    fileStore,
    uiStore,
    notificationStore,
    annotationStoreInstance,
    layoutManagerInstance,
    cleanupBlockEventHandler,
    handleCreateAnnotationWithContent,
    onReadyCallback: onEditorReady,
    findReplaceStore
  });

  editorVirtualizationRuntime.scheduleEditorCreatedRefresh();

  // ------------------------------------------------------------------------------
  // Workspace ref 快照同步（关键能力）
  // ------------------------------------------------------------------------------
  // 中文说明：
  // - AI 可能会在回答中输出 [#ref] 来引用文档段落
  // - ref 由 blockId 确定性生成，因此只要维护当前文档的 blockId 列表快照，就能反解 ref -> blockId
  // - 快照同步挂在 EditorContext（文档生命周期）中，避免分散在对话/工具等模块里（高内聚低耦合）
  try {
    if (editor.value) {
      cleanupBlockRefSnapshotSync.value = setupBlockRefSnapshotSync({
        editor: editor.value,
        getDocumentId: () => fileStore.currentFilePath,
        debounceMs: 300,
      });
    }
  } catch (e) {
    console.warn('[EditorContext] 安装 blockRefSnapshotSync 失败：', e);
  }
  
  // 挂载批注创建函数到全局应用实例
  const appInstance = window.__APP_INSTANCE__;
  if (appInstance) {
    appInstance.config.globalProperties.$triggerAnnotationCreate = handleCreateAnnotationRequest;
  }

  // +++ 注意：窗口关闭监听器已移至 App.vue，因为它是应用级别的事件 +++
  
  // +++ 新增：在编辑器DOM可用后，设置滚动监听 +++
  await nextTick();
  // 中文说明：EditorContext 是编辑器子树，mounted 可能早于外层 DocumentSurface
  // 真正插入 document。等到下一帧后再解析 editor-shell，避免把父级挂载时序误判
  // 为缺少滚动容器。
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const editorElement = editor.value?.view?.dom?.closest('.editor-shell') ?? document.querySelector('.editor-shell');
  if (editorElement) {
    scrollContainer = editorElement;
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    // 中文说明：engine 在 setup 阶段可能早于 .editor-shell 挂载，首次 refresh
    // 会因为没有 scrollRoot 而只能发布空窗口。scroll 容器 ready 后主动同步一次，
    // 避免大文档 pending 必须等用户滚轮/点击后才开始 hydrate/project。
    editorVirtualizationRuntime.syncScrollRootReady();
  } else {
    console.warn('[EditorContext] 未找到 .editor-shell 元素，无法设置滚动监听。');
  }

  // 这个 watch 不直接依赖于 annotationStore 的内部方法，可以保留在此处
  watch(() => fileStore.clearEditorRequested, (newValue) => {
    if (newValue === true) {
      if (editor.value) {
        editor.value.commands.clearContent(false);
      }
      fileStore.clearEditorRequested = false;
    }
  });



  // +++ 侧边栏过渡结束事件监听已移除，批注面板现在通过 CSS 变量自动丝滑跟随 +++

  await nextTick();
  console.log('--- [EditorContext] 6. onMounted finished.');
})

// --- 组件卸载前钩子 ---
onBeforeUnmount(async () => {
  console.log('[EditorContext] Component onBeforeUnmount hook triggered. Attempting to save current file if needed.');
  
  // +++ 在组件卸载前尝试保存 +++
  // 这可以捕获例如切换视图（如果 EditorContext 被卸载的话）导致的"页面切换"
  const shouldSave =
    !!(editor.value && !editor.value.isDestroyed && fileStore.currentFilePath) &&
    fileStore.isDirty

  if (shouldSave) {
    console.log('[EditorContext] onBeforeUnmount: 文件已修改，尝试保存...');
    await requestSave('view-switch');
    // 注意：这里的 await 可能不会完全阻塞组件卸载，取决于保存操作的异步性
    // 但它会尽力在卸载前完成或启动保存操作。
  }
  
  // 移除全局键盘事件监听
  document.removeEventListener('keydown', handleGlobalKeyDown, { capture: true })

  // 移除批注定位事件监听
  window.removeEventListener('locate-annotation', handleLocateAnnotationEvent)
  window.removeEventListener('sidebar-anim-start', handleSidebarAnimationStart)
  window.removeEventListener('sidebar-anim-end', handleSidebarAnimationEnd)
  
  // 侧边栏过渡结束事件监听器已移除
  
  // +++ 新增：清理滚动监听和rAF循环 +++
  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', handleScroll);
  }
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  editorVirtualizationRuntime.cleanup();

  // 清理块事件处理器
  if (cleanupBlockEventHandler.value) {
    cleanupBlockEventHandler.value()
    cleanupBlockEventHandler.value = null
  }
  
  // 清理批注服务
  if (annotationStoreInstance.value) {
    if (typeof annotationStoreInstance.value.cleanup === 'function') {
      annotationStoreInstance.value.cleanup()
    }
    annotationStoreInstance.value = null
  }
  
  // 清理布局管理器
  if (layoutManagerInstance.value) {
    if (typeof layoutManagerInstance.value.cleanup === 'function') {
      layoutManagerInstance.value.cleanup()
    }
    layoutManagerInstance.value = null
  }
  
  // 销毁编辑器
  if (editor.value) {
    editor.value.destroy()
    editor.value = null
  }
  uiStore.setEditorInstance(null);

  // 清理 ref 快照同步
  if (cleanupBlockRefSnapshotSync.value && typeof cleanupBlockRefSnapshotSync.value === 'function') {
    try {
      cleanupBlockRefSnapshotSync.value()
    } catch (e) {
      console.warn('[EditorContext] 清理 blockRefSnapshotSync 失败：', e);
    }
    cleanupBlockRefSnapshotSync.value = null
  }

  // 清理自动保存
})

// ================================================================================
// 生命周期钩子区域结束
// ================================================================================
</script>
