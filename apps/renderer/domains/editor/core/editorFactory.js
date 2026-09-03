// src/renderer/app/core/editorFactory.js
// 该文件负责创建和配置 Tiptap 编辑器实例。
// 通过将扩展、插件和生命周期钩子集中在此，可以简化 EditorContext.vue，
// 使其更专注于上下文提供和生命周期管理。

// ================================================================================
// 导入区域：按类型分组
// ================================================================================

// --- Tiptap 和 ProseMirror 相关导入 ---
import { Editor } from '@tiptap/vue-3'
import { nextTick } from 'vue'
import { createMarkdownSerializer } from '../../../shared/utils/markdownSerializer'
import { countTextUnitsZhEn } from '../../../shared/utils/textUnits'
import { useEditorDocumentSettingsStore } from '../features/DocumentSettings'
import { resolveCurrentEditorMessage } from '../functions/resolveCurrentEditorMessage'
import { buildEditorMarkdownSerializerLabels } from '../functions/markdownSerializerLabels'

// --- 特性模块导入 ---
import {
  setupBlockEventHandler,
  useAnnotationLayoutManager,
  useAnnotationStore,
} from '../features/Annotation'
import {
  ANNOTATION_LAYOUT_RECALC_REASON,
  requestAnnotationLayoutRecalculation,
} from '../features/Annotation/position/layoutRecalculationPolicy'
import { setupRevisionBlockEventHandler } from '../features/Revision'

// --- 核心模块导入 ---
import { getAllExtensions } from './extensionRegistry'
import { dragMoveBlock } from '../extensions/core/commands/MoveCommands'
import { scheduleInitialEditorFocus } from './initialFocusPolicy'

// --- 首开性能采集 ---
import { markPerf, measurePerf, setTimingValue } from '../ui/services/editorOpenPerf'
// 内存采样工具：副作用导入，挂载 window.__EDITOR_MEMORY_PERF__
import '../ui/services/editorMemoryPerf'
// 压测工具：副作用导入，仅挂载 window.__EDITOR_PERF_BENCH__
import '../ui/services/editorPerfBenchmark'
// Revision 调试工具：副作用导入，挂载 window.__REVISION_TEST__
import '../features/Revision/store/__devRevisionTest'
// 虚拟化诊断工具：副作用导入，挂载 window.__EDITOR_VIRTUALIZATION_DIAG__
import '../features/RenderVirtualization/debug/renderVirtualizationDiagnostics'

// 中文备注：文本长度口径必须统一，禁止在各处复制粘贴不同实现。
// 这里统一使用 shared/utils/textUnits.ts：中文按“字”，英文/数字按“词”。

// ================================================================================
// 编辑器创建函数
// ================================================================================

/**
 * 创建 Tiptap 编辑器实例
 * @param {object} options - 创建编辑器的选项
 * @param {object} options.initialContent - 编辑器的初始内容
 * @param {import('../shared/stores/file').useFileStore} options.fileStore - File Store
 * @param {import('../shared/stores/ui').useUIStore} options.uiStore - UI Store
 * @param {import('@/app/notification').useNotificationStore} options.notificationStore - Notification Store
 * @param {import('vue').Ref<object|null>} options.annotationStoreInstance - 批注存储实例的 Ref
 * @param {import('vue').Ref<object|null>} options.layoutManagerInstance - 布局管理器实例的 Ref
 * @param {import('vue').Ref<Function|null>} options.cleanupBlockEventHandler - 块事件处理器清理函数的 Ref
 * @param {Function} options.handleCreateAnnotationWithContent - 创建带内容批注的处理函数
 * @param {Function} options.onReadyCallback - 编辑器准备就绪后的回调函数
 * @returns {Editor}
 */
export function createEditor({
  initialContent,
  fileStore,
  uiStore,
  notificationStore,
  annotationStoreInstance,
  layoutManagerInstance,
  cleanupBlockEventHandler,
  handleCreateAnnotationWithContent,
  onReadyCallback,
  findReplaceStore,
  audioStore
}) {
  // 字符统计防抖定时器
  let charCountTimer = null;
  const editorDocumentSettings = useEditorDocumentSettingsStore();

  const editor = new Editor({
    content: fileStore.currentFilePath ? undefined : initialContent,
    extensions: getAllExtensions({ layoutManagerInstance, findReplaceStore, audioStore }),
    
    editorProps: {
      attributes: {
        // 控制浏览器原生拼写检查（红色波浪线）
        // 注意：该属性作用于 ProseMirror 的 contenteditable 根节点
        spellcheck: editorDocumentSettings.spellcheckEnabled ? 'true' : 'false',
      },
      clipboardTextSerializer: (slice, view) => {
        // 检查是否包含 RootBlock，如果是则使用 markdownSerializer 以避免双重换行问题
        // 因为 RootBlock -> BaseBlock 的嵌套结构会导致默认的 textBetween 生成多余的换行符
        let hasRootBlock = false
        slice.content.forEach(node => {
          if (node.type.name === 'rootBlock') hasRootBlock = true
        })

        if (hasRootBlock) {
          try {
            // 尝试使用 markdownSerializer 序列化
            // 注意：我们需要一个临时 Doc 节点来容纳这些块
            const doc = view.state.schema.topNodeType.create(null, slice.content)
            // 剪贴板纯文本：禁用特殊字符转义，避免外部应用显示反斜杠（例如 \\[8\\]）
            const serializer = createMarkdownSerializer({
              escapeSpecialChars: false,
              labels: buildEditorMarkdownSerializerLabels(resolveCurrentEditorMessage),
            })
            return serializer.serialize(doc)
          } catch (e) {
            console.warn('[Editor] Markdown serialization failed, falling back to textBetween', e)
          }
        }
        
        // 默认行为：使用 textBetween
        return slice.content.textBetween(0, slice.content.size, '\n\n')
      }
    },

    onUpdate: ({ editor: updatedEditor }) => {
      // pending 注入批处理期间跳过所有 onUpdate 副作用
      // 标志由 workspacePending.ts 在注入前/后设置
      if (updatedEditor._isPendingRevisionBatch) return;

      // 字符统计：防抖处理，避免连续输入时频繁执行 getText() + countTextUnitsZhEn()
      if (charCountTimer) clearTimeout(charCountTimer);
      charCountTimer = setTimeout(() => {
        charCountTimer = null;
        if (updatedEditor.isDestroyed) return;
        const plainText = updatedEditor.getText();
        const units = countTextUnitsZhEn(plainText);
        editorDocumentSettings.setCharacterCount(units);
      }, 500);

      // 文档更新时，触发批注位置重算
      if (layoutManagerInstance.value) {
        nextTick(() => {
          void requestAnnotationLayoutRecalculation(
            layoutManagerInstance,
            ANNOTATION_LAYOUT_RECALC_REASON.DOCUMENT_CHANGE
          );
        });
      }
    },
    
    onTransaction({ editor: txEditor, transaction }) {
      // pending 注入批处理期间跳过 dirty 标记和通知
      if (txEditor._isPendingRevisionBatch) return;

      if (transaction.docChanged && !transaction.getMeta('internal')) {
        fileStore.setDirty(true);
      }

      // 检查用户通知元数据并使用 nextTick
      const notificationMeta = transaction.getMeta('userNotification');
      if (notificationMeta && notificationMeta.message) {
        nextTick(() => {
          notificationStore.show(
            notificationMeta.message, 
            notificationMeta.type || 'warning', 
            notificationMeta.duration || 3000
          );
        });
      }
    },
    
    onCreate: async ({ editor: createdEditor }) => {
      console.log('--- [EditorFactory] 3. Editor onCreate hook started.');
      markPerf('editorReady:start');
      // 1. **首先**创建和挂载事件总线
      const eventBusInstance = {
        listeners: {},
        on(event, callback) {
          if (!this.listeners[event]) {
            this.listeners[event] = [];
          }
          this.listeners[event].push(callback);
        },
        off(event, callback) {
          if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(l => l !== callback);
          }
        },
        emit(event, ...args) {
          if (this.listeners[event]) {
            this.listeners[event].forEach(callback => callback(...args));
          }
        }
      };
      createdEditor.eventBus = eventBusInstance;
      
      // 2. **然后**设置依赖 eventBus 的其他服务
      // 监听块移动请求
      createdEditor.on('requestBlockMove', ({ sourceId, targetIndex, validationResult }) => {
        if (!createdEditor || !createdEditor.view) return;
        const moveCommand = dragMoveBlock({ sourceId, targetIndex, validationResult });
        const moveResult = moveCommand({
          state: createdEditor.state,
          dispatch: createdEditor.view.dispatch,
          editor: createdEditor
        });
        createdEditor.emit('blockDragEnd', { id: sourceId, success: !!moveResult });
      });

      // 创建批注存储和布局管理器实例
      const realStore = useAnnotationStore({ editor: createdEditor });
      const manager = useAnnotationLayoutManager({ annotationStore: realStore, editor: createdEditor });
      
      realStore.initialize();
      
      annotationStoreInstance.value = realStore;
      layoutManagerInstance.value = manager;
      
      createdEditor.annotationStore = realStore;
      createdEditor.panelPositionManager = manager;

      uiStore.setEditorInstance(createdEditor);
      
      // 注册 editor 域的 Table AI 高亮能力，不在工厂复制模式状态。
      try {
        const { setupTableAiHighlightRuntime } = await import('../blocks/TableBlock/integrations/setup');
        const cleanup = setupTableAiHighlightRuntime({
          editor: createdEditor,
          editorId: 'main'
        });
        console.log('[EditorFactory] Table AI 高亮运行时已注册，编辑器ID: main');
        console.log('[EditorFactory] 编辑器实例:', !!createdEditor);
        console.log('[EditorFactory] 编辑器view:', !!createdEditor.view);
        console.log('[EditorFactory] 编辑器state:', !!createdEditor.state);
        
        // 存储清理函数，以便在编辑器销毁时调用
        if (cleanup && typeof cleanup === 'function') {
          createdEditor._tableBlockCleanup = cleanup;
        }
      } catch (error) {
        console.warn('[EditorFactory] TableBlock AI集成注册失败，可能是开发环境问题:', error);
      }
      
      // 现在可以安全地设置块事件处理器了
      cleanupBlockEventHandler.value = setupBlockEventHandler(createdEditor, realStore, manager);

      // 为 Revision 模块挂载块级生命周期监听器（基于统一的 block-operation 事件）
      // 注意：这里不需要额外的 cleanup ref，因为监听器与 editor 生命周期一致
      setupRevisionBlockEventHandler(createdEditor);

      // 性能说明：
      // rootBlock 的实时位置由 ProseMirror doc position 按需计算，MoveCommands 等运行时逻辑
      // 不依赖 attrs.position。这里避免在首次打开时对每个 rootBlock dispatch 一次属性写入，
      // 否则超大文档会在 onCreate 阶段产生 O(N) 次 transaction 与 DOM 协调。
      
      // 小文档保持首开自动聚焦；超长文档 / Shell 模式跳过，避免首开阶段额外 selection transaction。
      scheduleInitialEditorFocus({
        editor: createdEditor,
        onComplete: () => {
          // 性能采集：首屏可交互（聚焦策略完成）
          markPerf('editorReady:end');
          measurePerf('editorReady:start', 'editorReady:end', 'editorReadyMs');
        }
      });

      const initialText = createdEditor.getText();
      const units = countTextUnitsZhEn(initialText);
      editorDocumentSettings.setCharacterCount(units);

      // 设置事件总线监听器
      if (createdEditor.eventBus) {
        createdEditor.eventBus.on('create-annotation-with-content', handleCreateAnnotationWithContent);
      }

      // 为了保持兼容性，仍然检查并调用回调
      if (typeof onReadyCallback === 'function') {
        onReadyCallback(createdEditor);
      }
    },
    
    autofocus: true,
  });

  // 开发调试：绑定 editor 到 window，供控制台调试工具使用
  if (typeof window !== 'undefined') {
    window.__TIPTAP_EDITOR__ = editor
  }

  return editor;
} 
