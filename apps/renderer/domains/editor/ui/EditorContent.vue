<!-- src/renderer/app/core/EditorContent.vue -->
<template>
  <div
    class="editor-main-content"
    ref="editorMainContentRef"
  >
    <!-- 主内容区域 -->
    <editor-content :editor="editorForContent" />

    <!-- 表格交互管理器 -->
    <TableInteractionManager :editor="editor" />

    <!-- AI 写作输入框 -->
    <AiWriting
      :isVisible="uiStore.aiPromptVisible"
      :position="uiStore.aiPromptPosition"
      :targetBlockId="uiStore.aiPromptTargetBlockId"
      @submit="handleAiPromptSubmit"
      @cancel="uiStore.hideAiPrompt"
    />

    <!-- 移除旧的本地AI指示器，改用全局指示器 -->

    <div v-if="uiStore.debugPanelVisible && isDevelopment" class="debug-panel">
      <div class="debug-panel-header">
        <h3>{{ editorMessage('editor.debugPanel.title') }}</h3>
        <button @click="uiStore.toggleDebugPanel()" class="close-button">
          ×
        </button>
      </div>
      <div class="debug-panel-content">
        <div class="debug-actions">
          <button @click="logDocumentStructureHandler">
            {{ editorMessage('editor.debugPanel.action.documentStructure') }}
          </button>
          <button @click="logCurrentNodeHandler">
            {{ editorMessage('editor.debugPanel.action.currentNode') }}
          </button>
          <button @click="logSelectionInfo">
            {{ editorMessage('editor.debugPanel.action.selectionInfo') }}
          </button>
          <!-- <button @click="testAnnotationPanel">测试批注面板</button> -->
        </div>
        <div class="debug-output">
          <pre>{{ debugOutput }}</pre>
        </div>
      </div>
    </div>

    <!-- 文档级修订工具栏：
         注意：为保证淡入淡出过渡生效，这里不再对组件本身使用 v-if 挂载/卸载，
         而是始终挂载组件，仅通过 visible prop 控制内部的 <transition> + v-if。
         这样 visible 从 false -> true / true -> false 时，才会正确触发进入/离开动画。 -->
    <RevisionGlobalToolbar
      :visible="showRevisionGlobalToolbar"
      :pending-count="pendingRevisionBlockCount"
      :insert-count="globalRevisionStats.insertCount"
      :delete-count="globalRevisionStats.deleteCount"
      :projection-deferred="isPendingProjectionDeferred"
      @accept-all="handleAcceptAllRevisionsInDocument"
      @reject-all="handleRejectAllRevisionsInDocument"
    />

    <!--
      大文档 Shell / 渲染虚拟化路径的块级修订 overlay。
      中文说明：Shell NodeView 不再创建每块一个 Vue BlockChrome，因此块级 pending UI
      由 editor 级单例层承载；普通小文档仍由 BlockChrome 渲染，避免双份 UI。
    -->
    <RevisionOverlayLayer :editor="editor" />

    <!--
      阶段 3：BlockChrome 中央化宿主。
      中文说明：块级轻 UI 和批注面板挂载层由 Host 承载，具体业务规则仍回到各 feature。
    -->
    <BlockChromeHost v-if="editorForContent" :editor="editorForContent" />

  </div>
</template>

<script setup lang="ts">
/**
 * @file EditorContent.vue
 * @description 核心组件，渲染 Tiptap 编辑器并处理通用内容生成的 AI 提示提交。
 *
 * AI 服务调用说明（AiWriting 简化链路）:
 * - 服务函数：通过 AiWritingController 直接调用 unifiedApiService.generateTextStream（不再经过 assistantStore / 侧边栏编排器）。
 * - 后端 API 端点：POST /api/v1/conversation/next (SSE)。
 * - 请求体 (Payload)：{ conversation_id, new_events: [user_input], options: { mode, model_id, context_before, context_after, promptKey } }。
 * - 响应处理：
 *   - 前端只消费 SSE `final_answer_chunk` 的纯文本增量，并通过 `handlers.onTextChunk(rawText)` 写入编辑器；
 *   - 原始文本仍由 WasmStreamingParser 解析成块事件，最终由 processQueue 更新编辑器内容。
 * - 重要约束：该链路不会在侧边栏创建对话/任务记录，也不会发送侧边栏消息。
 */
import {
  ref,
  inject,
  computed,
  watch,
  nextTick,
} from "vue";
import type { Editor } from "@tiptap/vue-3";
import { EditorContent } from "@tiptap/vue-3";
import { EDITOR_KEY } from "../core/tokens";
import TableInteractionManager from "../blocks/TableBlock/ui/TableInteractionManager.vue";

// 导入菜单栏组件
// import MenuBar from './MenuBar.vue'
import {
  logDocumentStructure,
  logCurrentNode,
} from "../shared/utils/NodeUtils";
import { PositionUtils } from "../extensions/position/PositionUtils";
// 导入UI Store
import { useUIStore } from "../../../shared/stores/ui";
import { useEditorDocumentSettingsStore } from "../features/DocumentSettings";
// 导入新组件
import AiWriting from "../features/AiWriting/ui/AiWriting.vue";
import RevisionGlobalToolbar from "../features/Revision/ui/RevisionGlobalToolbar.vue";
import RevisionOverlayLayer from "../features/Revision/ui/overlay/RevisionOverlayLayer.vue";
import BlockChromeHost from "./blockChromeHost/BlockChromeHost.vue";
import { useDocumentRevisionToolbar } from "../features/Revision/ui/useDocumentRevisionToolbar";
import type { StreamingState } from "../services/useStreamingHandlers";
import { ANNOTATION_PANEL_POSITION_MANAGER_KEY } from "../features/Annotation/definitions/injectionKeys";

// +++ 新增：导入 composables +++
import { useStreamingHandlers } from "../services/useStreamingHandlers";
import { useAiWritingController } from "../services/useAiWritingController";
import { useMouseInteractions } from "../services/useMouseInteractions";
import { usePanelPositioning } from "../services/usePanelPositioning";
import type { PanelPositioningOptions } from "../services/usePanelPositioning";
import { useCitationClickPopover } from "../features/citation/ui/useCitationClickPopover";
import { useEditorLocalization } from "./useEditorLocalization";

// 从 EditorContext 中注入编辑器实例。
// 中文说明：这里使用 typed InjectionKey，让缺失 provider 的问题在类型层暴露，
// 避免通过字符串 key + 类型断言把注入契约藏起来。
const emptyEditorRef = ref<Editor | null>(null);
const editor = inject(EDITOR_KEY, emptyEditorRef);
// 注入面板位置管理器（可能不存在）
type PanelPositionManagerRef = PanelPositioningOptions["panelPositionManager"];
const panelPositionManager = inject<PanelPositionManagerRef | null>(
  ANNOTATION_PANEL_POSITION_MANAGER_KEY,
  null
);

// 使用 UI Store 来控制菜单栏的显示
const uiStore = useUIStore(); // Ensure uiStore is instantiated
const editorDocumentSettings = useEditorDocumentSettingsStore();
const { editorMessage } = useEditorLocalization();

/**
 * 同步拼写检查开关到编辑器 DOM
 * 中文说明：红色波浪线来自浏览器原生 spellcheck；这里确保设置项切换后立即生效。
 */
async function syncSpellcheckAttributeToEditorDom() {
  const currentEditor = editor.value;
  if (!currentEditor?.view?.dom) return;

  // 等待 DOM 渲染稳定后再写入属性，避免首次创建时 view.dom 尚未挂载
  await nextTick();
  currentEditor.view.dom.setAttribute('spellcheck', editorDocumentSettings.spellcheckEnabled ? 'true' : 'false');
}

// 当 editor 实例出现/切换时，立即同步一次
watch(
  () => editor.value,
  () => {
    void syncSpellcheckAttributeToEditorDom();
  },
  { immediate: true }
);

// 当用户在设置中切换时，实时同步到编辑器 DOM
watch(
  () => editorDocumentSettings.spellcheckEnabled,
  () => {
    void syncSpellcheckAttributeToEditorDom();
  }
);

// 开发环境标志
const isDevelopment = import.meta.env.DEV;

// 调试面板状态
const debugOutput = ref("");

// 定义主内容区域引用
const editorMainContentRef = ref<HTMLElement | null>(null);

// ==================== 文档级修订工具栏状态 ====================
//
// 设计目标：
// - 当整篇文档存在多个待处理修订时，在底部展示“拒绝全部 / 接受全部”工具栏
// - 不重新实现文档扫描逻辑，只复用 RevisionStore 的状态与命令

// 文档级修订逻辑已由 useDocumentRevisionToolbar 管理，避免在此处直接依赖 RevisionStore

// 通过 editor 实例获取 RevisionStore（使用基于 Editor 的单例）并派生文档级状态（由 composable 承担）
const {
  showRevisionGlobalToolbar,
  pendingRevisionBlockCount,
  globalRevisionStats,
  isPendingProjectionDeferred,
  handleAcceptAllRevisionsInDocument,
  handleRejectAllRevisionsInDocument,
} = useDocumentRevisionToolbar({ editor });

// +++ 使用 composables +++
// 面板定位管理（panelPositionManager 可能为空）
if (panelPositionManager) {
  usePanelPositioning({ editor, panelPositionManager });
}

// 鼠标交互管理
useMouseInteractions({ editor, editorContainerRef: editorMainContentRef });
useCitationClickPopover({ editor, editorContainerRef: editorMainContentRef });

// 使用导入的 logDocumentStructure 函数
const logDocumentStructureHandler = () => {
  if (!editor.value) return;
  debugOutput.value = editorMessage('editor.debugPanel.analyzingDocumentStructure');

  setTimeout(() => {
    logDocumentStructure(editor.value);
    debugOutput.value = editorMessage('editor.debugPanel.documentStructureLogged');
  }, 10);
};

// 使用 PositionUtils 获取当前节点信息
const logCurrentNodeHandler = () => {
  if (!editor.value) return;
  debugOutput.value = editorMessage('editor.debugPanel.analyzingCurrentNode');

  // 使用 PositionUtils 获取当前选区信息
  const posUtils = new PositionUtils(editor.value);
  const selectionInfo = posUtils.getSelectionInfo();
  // console.log('[EditorContent] 当前选区信息:', selectionInfo);

  // 使用 logCurrentNode 输出当前节点信息
  setTimeout(() => {
    logCurrentNode(editor.value);
    debugOutput.value = editorMessage('editor.debugPanel.currentNodeLogged');
  }, 10);
};

// 新增：添加加载状态
const aiError = ref<Error | null>(null);

// +++ 使用流式处理 composable +++
const streamingState: StreamingState = {
  wasmStreamingParser: null,
  aiError,
};

const { handlers, initializeParser } = useStreamingHandlers(editor, streamingState);

// +++ 使用 AI 写作控制器 composable +++
const { handleAiPromptSubmit } = useAiWritingController({
  editor,
  uiStore,
  handlers,
  initializeParser,
  message: editorMessage,
});

// 选区信息调试：打印当前选区的详细信息
const logSelectionInfo = () => {
  if (!editor.value) return;
  const posUtils = new PositionUtils(editor.value);
  const selectionInfo = posUtils.getSelectionInfo();
  // eslint-disable-next-line no-console
  console.log("[EditorContent] 当前选区信息:", selectionInfo);
};

// 为 EditorContent 组件准备的 editor 引用（解包 Ref，符合其 prop 类型要求）
const editorForContent = computed<Editor | undefined>(() => {
  return editor.value ?? undefined;
});

// handleAiPromptSubmit 已通过 composable 提供
</script>
