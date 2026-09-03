<!-- src/renderer/components/AnnotationPanel.vue -->
<!-- **
 * AnnotationPanel.vue
 * 
 * 批注展示组件，负责显示、编辑、删除批注
 * 职责：
 * 1. 批注面板UI渲染
 * 2. 批注状态转换的用户交互
 * 3. 批注的高亮管理
 */-->

<template>
  <!-- 批注面板列表 - 直接循环 visibleAnnotations -->
  <div
    v-for="panel in localAnnotations"
    :key="panel.id"
    class="annotation-panel"
    :class="{
      'is-visible': true,
      'is-editing': panel.state === AnnotationState.EDITING,
      'is-creating': panel.state === AnnotationState.CREATING,
      'is-resolved': panel.state === AnnotationState.RESOLVED
    }"
    :style="getPanelStyle(panel.position)"
    :data-block-id="panel.blockId"
    :data-annotation-id="panel.id"
    :data-state="panel.state"
    @pointerenter="onPanelPointerEnter(panel)"
    @pointerleave="onPanelPointerLeave(panel)"
  >
    <div class="annotation-content">
      <div class="annotation-body">
        <!-- 创建模式 -->
        <NewAnnotation
          v-if="panel.state === AnnotationState.CREATING"
          :panel="panel"
          :blockId="panel.blockId"
          @cancel="handleCancelCreating($event)"
          @save="handleConfirmCreating($event)"
          @height-change="onEditorHeightChanged"
          @ai-action="handleAiAction(panel.id)"
        />
        
        <!-- 编辑模式 -->
        <AnnotationEditor
          v-else-if="panel.state === AnnotationState.EDITING"
          :panel="panel"
          @cancel="handleCancelEditing($event)"
          @save="handleSaveEdit($event)"
          @editor-mounted="handleEditorMounted"
          @heightChanged="onEditorHeightChanged"
          @ai-action="handleAiAction(panel.id)"
        />
        
        <!-- 查看模式 -->
        <AnnotationDisplay
          v-else
          :panel="panel"
          @edit="startEditingAnnotation(panel.id)"
          @resolve="resolveAnnotation(panel.id)"
          @reopen="reopenAnnotation(panel.id)"
          @delete="deleteAnnotationById(panel.id, panel.blockId)"
          @ai-action="handleAiAction(panel.id)"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * @file AnnotationPanel.vue
 * @description Vue 组件，用于显示和管理批注，包括 AI 辅助内容生成功能。
 *
 * AI 服务调用说明 (handleAiAction 函数):
 * - 服务函数: assistantStore.executeAnnotationRun (统一的 AI 任务执行接口)
 * - 后端 API 端点: POST /api/v1/conversation/next
 * - 请求体 (Payload): { prompt: annotationContent, prompt_key: ANNOTATION_PROMPT_KEY, context_before, context_after, current_paragraph, metadata }
 * - 响应处理: 通过 streamHandlers.onStreamChunk 接收流式文本块，通过 onThought 接收思考内容（已从 SSE 事件中结构化提取）。
 *             思考内容由 assistantStore 统一管理显示，实际内容被插入到被批注块之后创建的新块中。
 * - 关联的 Prompt Key: ANNOTATION_PROMPT_KEY
 */
import { ref, inject, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { 
  AnnotationState,
  startEditingAnnotation as startEditingAnnotationCommand,
  cancelEditingAnnotation as cancelEditingAnnotationCommand,
  saveEditAnnotation as saveEditAnnotationCommand,
  resolveAnnotation as resolveAnnotationCommand,
  reopenAnnotation as reopenAnnotationCommand
} from '../commands/AnnoStateCommands';
import {
  deleteAnnotation as deleteAnnotationCommand
} from '../commands/AnnoDeleteCommands';
import highlightState from '../AnnoHighlightState';
import AnnotationDisplay from './AnnotationDisplay.vue';
import AnnotationEditor from './AnnotationEditor.vue';
import NewAnnotation from './NewAnnotation.vue';
import {
  cancelCreatingAnnotation,
  confirmCreatingAnnotation
} from '../commands/AnnoCreateCommands';
import { PositionUtils } from '../../../extensions/position/PositionUtils';
import { getAnnotationStructuredContext } from '../config/contextConfig';
import {
  positionCursorAtBlockEndWithHandshake,
  positionTextSelectionWithHandshake,
} from '../../RenderVirtualization';
import { EDITOR_KEY } from '../../../core/tokens';
import { useAnnotationVirtualizationKeepAlive } from './useAnnotationVirtualizationKeepAlive';
import { ANNOTATION_PROMPT_KEY } from '@app/schemas';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';
import {
  ANNOTATION_PANEL_POSITION_MANAGER_KEY,
  ANNOTATION_RUNTIME_STORE_KEY,
} from '../definitions/injectionKeys';
// import { appendAnnotationReply } from '../commands/AnnoReplyCommands'; // API 已保留，DEV 入口移除
// +++ 新增：导入 Assistant Store +++
import { useAssistantStore } from '../../../../conversation/store/assistantStore';

// 注入共享状态。
// 中文说明：批注面板只依赖 Annotation feature 暴露的窄契约，不再消费字符串 key。
const storeProvider = inject(ANNOTATION_RUNTIME_STORE_KEY, ref(null));
const panelPositionManagerProvider = inject(ANNOTATION_PANEL_POSITION_MANAGER_KEY, ref(null));
// 注入来自 EditorContext 的编辑器实例引用 (如果需要直接访问)
const editor = inject(EDITOR_KEY, ref(null));

// 本地状态
const localAnnotations = ref([]);
// 移除本地的 isAiGenerating 状态，改用全局指示器
// const isAiGenerating = ref(false);

// 监听annotations变化
watch(() => {
    const currentStore = storeProvider.value;
    const currentAnnotations = currentStore?.annotations;
    return currentAnnotations;
}, (newArrayProxy, oldArrayProxy) => {
    if (newArrayProxy && Array.isArray(newArrayProxy)) {
        localAnnotations.value = [...newArrayProxy];
    } else {
        localAnnotations.value = [];
    }
}, { deep: true, immediate: true });

const annotationVirtualizationKeepAlive = useAnnotationVirtualizationKeepAlive({
  editor,
  annotations: localAnnotations,
  activeStates: [AnnotationState.CREATING, AnnotationState.EDITING],
});

// --- 新增：在 setup 中创建 PositionUtils 实例 ---
let positionUtils = null; 
watch(editor, (newEditor) => {
  if (newEditor) {
    positionUtils = new PositionUtils(newEditor);
  } else {
    positionUtils = null;
  }
}, { immediate: true });
// --- 结束新增 ---

async function positionEditorCursorAtBlockEnd(blockId) {
  if (!editor.value || editor.value.isDestroyed) return false;
  const result = await positionCursorAtBlockEndWithHandshake(editor.value, blockId);
  if (!result.ok) {
    console.error(`[AnnotationPanel] 定位光标到块 ${blockId} 末尾失败: ${result.reason}`);
  }
  return result.ok;
}

// 开始编辑批注
const startEditingAnnotation = (annotationId) => {
  // 在方法内部检查 storeProvider 是否可用
  if (!storeProvider.value || !panelPositionManagerProvider.value) {
     console.warn('[AnnotationPanel] Store or PanelPositionManager not available for starting edit.');
     return;
  }
  startEditingAnnotationCommand({
    annotationId,
    annotationStore: storeProvider.value,
  });
  // 临时直接修改状态，直到命令重构完成
  const anno = storeProvider.value.getAnnotationById(annotationId);
  if (anno) {
    anno.state = AnnotationState.EDITING;
  }

  // 新增：在状态变更为 'editing' 后，主动触发一次布局重算
  // 这确保了即使编辑器组件的高度与显示组件相同，也能正确处理重叠
  nextTick(() => {
    // 1. 使该面板的高度缓存失效，以便重叠检测器能获取到最新的、正确的编辑器高度
    panelPositionManagerProvider.value.invalidateLayoutCacheForAnnotation(annotationId);
    // 2. 只处理重叠，不改变面板的理想位置，避免面板跳动
    panelPositionManagerProvider.value.handleOverlapsOnly();
  });
};

// --- 修改：取消编辑批注处理 ---
const handleCancelEditing = (payload) => {
  // 检查 store 是否可用
  if (!storeProvider.value) return;

  const annotationId = payload.annotationId;
  const trigger = payload.trigger;

  // 调用取消编辑命令
  cancelEditingAnnotationCommand({
    annotationId,
    annotationStore: storeProvider.value,
  });

  // 临时直接修改状态，直到命令重构完成 (这部分可能可以移除，如果命令已正确更新状态)
  const anno = storeProvider.value.getAnnotationById(annotationId);
  if (anno && anno.state === AnnotationState.EDITING) {
    anno.state = AnnotationState.CONFIRMED; // 或恢复到之前的状态
  }

  // 如果是由 Esc 键触发，则移动光标
  if (trigger === 'esc' && anno && anno.blockId && editor.value) {
    nextTick(() => { // 使用 nextTick 确保状态更新后执行
      void positionEditorCursorAtBlockEnd(anno.blockId).catch((e) => {
        console.error(`[AnnotationPanel] 定位光标到块 ${anno.blockId} 末尾时出错:`, e);
      });
    });
  }
};

// 修改：保存编辑的批注处理
const handleSaveEdit = (payload) => {
  // 检查 store 和 manager 是否可用
  if (!storeProvider.value || !panelPositionManagerProvider.value) return;

  const { annotationId, content, trigger } = payload;
  const anno = storeProvider.value.getAnnotationById(annotationId);
  const blockId = anno?.blockId;

  if (!blockId) {
     console.error(`[AnnotationPanel] 保存批注失败: 找不到 blockId for annotation ${annotationId}`);
     return;
  }

  // 调用保存命令
  saveEditAnnotationCommand({
    annotationId: annotationId,
    content: content,
    annotationStore: storeProvider.value,
    blockId,
    panelPositionManager: panelPositionManagerProvider.value
  });

  // 如果是由 Enter 键触发，则移动光标
  if (trigger === 'enter' && blockId && editor.value) {
    nextTick(() => { // 使用 nextTick 确保状态更新后执行
      void positionEditorCursorAtBlockEnd(blockId).catch((e) => {
        console.error(`[AnnotationPanel] 定位光标到块 ${blockId} 末尾时出错:`, e);
      });
    });
  }
};

// 删除批注
const deleteAnnotationById = (id, blockId) => {
  // 在方法内部检查 storeProvider 和 managerProvider 是否可用
  if (!storeProvider.value || !panelPositionManagerProvider.value) {
    return;
  }
  if (!blockId) {
    const anno = storeProvider.value.getAnnotationById(id);
    blockId = anno?.blockId;
    if (!blockId) {
      console.error(`[AnnotationPanel] 删除批注失败：找不到 blockId for annotation ${id}`);
      return;
    }
  }

  try {
    deleteAnnotationCommand({
      annotationId: id,
      blockId,
      panelPositionManager: panelPositionManagerProvider.value,
      annotationStore: storeProvider.value,
    });

    // 清除高亮状态
    highlightState.clearPanelHighlight(id, blockId);
    highlightState.clearBlockHighlight(blockId);
  } catch (error) {
    console.error(`[AnnotationPanel] 删除批注过程中出错:`, error);
  }
};

// 标记批注为已解决
const resolveAnnotation = (annotationId) => {
  // 在方法内部检查 storeProvider 是否可用
  if (!storeProvider.value) {
    return;
  }
  return resolveAnnotationCommand({
    annotationId,
    annotationStore: storeProvider.value,
  });
};

// 重新打开已解决的批注
const reopenAnnotation = (annotationId) => {
  // 在方法内部检查 storeProvider 是否可用
  if (!storeProvider.value) {
    return;
  }
  return reopenAnnotationCommand({
    annotationId,
    annotationStore: storeProvider.value,
  });
};

// 获取面板样式
const getPanelStyle = (position) => {
  if (!position || typeof position.top !== 'number' || typeof position.left !== 'number') {
    // 提供默认隐藏样式
    return { position: 'absolute', top: '0px', left: '-9999px', opacity: 0, pointerEvents: 'none' };
  }
  // 直接使用 store 中的 position 数据格式化为 CSS
  return {
    position: 'absolute',
    top: `${position.top}px`,
    left: `${position.left}px`,
    opacity: 1,
    pointerEvents: 'auto'
  };
};

// 处理面板指针进入事件
const onPanelPointerEnter = (panel) => {
  annotationVirtualizationKeepAlive.setPanelHoverState(panel?.id, true);
  if (panel.blockId) {
    highlightState.highlightPanel(panel.id, panel.blockId);
  }
};

// 处理面板指针离开事件
const onPanelPointerLeave = (panel) => {
  annotationVirtualizationKeepAlive.setPanelHoverState(panel?.id, false);
  if (panel.blockId) {
    highlightState.clearPanelHighlight(panel.id, panel.blockId);
  }
};

// 处理编辑器挂载事件
const handleEditorMounted = (textareaElement) => {
  const panelElement = textareaElement.closest('.annotation-panel');
  const annotationId = panelElement?.dataset.annotationId;
  if (annotationId) {
    nextTick(() => {
      if (textareaElement) {
        textareaElement.focus();
      }
    });
  }
};

// 处理编辑器高度变化
const onEditorHeightChanged = async (payload) => {
  const blockId = payload?.blockId;
  const height = payload?.height;
  const panel = localAnnotations.value.find(p => p.blockId === blockId && (p.state === AnnotationState.CREATING || p.state === AnnotationState.EDITING));
  const annotationId = panel?.id;

  const isManagerAvailable = !!panelPositionManagerProvider.value;

  if (!annotationId || !blockId || !isManagerAvailable) {
    console.warn('[AnnotationPanel] Cannot process height change: Missing annotationId, blockId, or panelPositionManager.', { annotationId, blockId, isManagerAvailable });
    return;
  }

  try {
    panelPositionManagerProvider.value.invalidateLayoutCacheForAnnotation(annotationId);
    // 只处理重叠，不改变面板的理想位置，这更高效，也能避免面板跳动
    await panelPositionManagerProvider.value.handleOverlapsOnly();
  } catch (error) {
    console.error(`[AnnotationPanel] Error calling handleOverlapsOnly in onEditorHeightChanged:`, error);
  }
};

// --- 修改：取消创建批注处理 ---
const handleCancelCreating = (payload) => {
  // 检查 store 和 manager 是否可用
  if (!storeProvider.value || !panelPositionManagerProvider.value) return;

  const blockId = payload.blockId;
  const trigger = payload.trigger;

  // 调用取消创建命令
  cancelCreatingAnnotation({ 
    blockId, 
    annotationStore: storeProvider.value, 
    panelPositionManager: panelPositionManagerProvider.value 
  });

  // 如果是由 Esc 键触发，则移动光标
  if (trigger === 'esc' && blockId && editor.value) {
      nextTick(() => { // 使用 nextTick 确保状态更新后执行
        void positionEditorCursorAtBlockEnd(blockId).catch((e) => {
          console.error(`[AnnotationPanel] 定位光标到块 ${blockId} 末尾时出错:`, e);
        });
      });
  }
};

// 修改：确认创建批注处理
const handleConfirmCreating = (payload) => {
  // 检查 store 和 manager 是否可用
  if (!storeProvider.value || !panelPositionManagerProvider.value) return;

  const { blockId, content, trigger } = payload;

  // 调用确认创建命令
  confirmCreatingAnnotation({
    blockId: blockId,
    content: content,
    annotationStore: storeProvider.value,
    panelPositionManager: panelPositionManagerProvider.value
  });

  // 如果是由 Enter 键触发，则移动光标
  if (trigger === 'enter' && blockId && editor.value) {
      nextTick(() => { // 使用 nextTick 确保状态更新后执行
        void positionEditorCursorAtBlockEnd(blockId).catch((e) => {
          console.error(`[AnnotationPanel] 定位光标到块 ${blockId} 末尾时出错:`, e);
        });
      });
  }
};

// --- 修改：核心 AI 触发函数 ---
async function handleAiAction(annotationId) {
  // 1. 检查依赖项
  if (!storeProvider.value || !editor.value || !positionUtils) {
    console.error('[AnnotationPanel] AI Action 依赖项未就绪。');
    return;
  }

  // 2. 获取批注数据和上下文
  const anno = storeProvider.value.getAnnotationById(annotationId);
  if (!anno || !anno.blockId) {
    console.error(`[AnnotationPanel] 找不到批注或 blockId: ${annotationId}`);
    return;
  }
  const { content: annotationContent, blockId } = anno;

  const context = await getAnnotationStructuredContext(editor.value, blockId);
  if (!context || !context.current_block_content) {
    console.error(`[AnnotationPanel] 获取批注上下文失败。`);
    return;
  }
  const { 
    context_before: contextBefore, 
    current_block_content: currentBlockContent, 
    context_after: contextAfter 
  } = context;

  // 块的创建被移动到 onStreamChunk 回调中，以确保只有在AI返回内容时才创建
  let insertionPos = -1;

  // 为元数据获取目标位置
  const targetRootBlock = positionUtils.findRootBlockById(blockId);
  if (!targetRootBlock) {
    console.error(`[AnnotationPanel] AI Action: 找不到目标块: ${blockId}`);
    return;
  }

  // 4. 调用统一的 assistantStore.executeAnnotationRun
  const assistantStore = useAssistantStore();
  
  assistantStore.executeAnnotationRun({
    prompt: annotationContent,
    mode: 'agent',
    options: {
      promptKey: ANNOTATION_PROMPT_KEY,
      context: {
        contextBefore,
        contextAfter,
      },
      current_paragraph: currentBlockContent,
      metadata: {
        targetPosition: targetRootBlock.pos
      }
    },
    streamHandlers: {
      onStreamChunk: (textChunk) => {
        if (!editor.value) return;
        try {
          // 首次收到数据块时，创建新块
          if (insertionPos === -1) {
            const targetRootBlock = positionUtils.findRootBlockById(blockId);
            if (!targetRootBlock) {
              console.error(`[AnnotationPanel] AI Action: 找不到目标块: ${blockId}`);
              return;
            }
            const targetEndPos = targetRootBlock.pos + targetRootBlock.node.nodeSize;
            const newNode = editor.value.state.schema.node('rootBlock', { id: generateRootBlockId() }, [
              editor.value.state.schema.node('baseBlock', { id: generateBlockId(), blockType: 'base' })
            ]);
            editor.value.view.dispatch(editor.value.state.tr.insert(targetEndPos, newNode));
            // 设置初始插入点
            insertionPos = targetEndPos + 2;
          }
          
          // 插入流式文本
          const tr = editor.value.state.tr.insertText(textChunk, insertionPos);
          editor.value.view.dispatch(tr);
          insertionPos += textChunk.length;
        } catch (e) {
          console.error("[AnnotationPanel] 插入内容块时出错:", e);
        }
      },
      onStreamEnd: (success) => {
        if (success && editor.value && !editor.value.isDestroyed) {
          nextTick(async () => {
            if (!editor.value || editor.value.isDestroyed) return;
            // 只有在实际插入了内容（即 insertionPos 已被设置）时才移动光标
            if (insertionPos !== -1) {
              try {
                // 中文说明：AI 批注可能在大文档 placeholder 邻近创建新块，最终光标必须先走 hydrate 协议。
                const result = await positionTextSelectionWithHandshake(editor.value, insertionPos);
                if (!result.ok) {
                  console.warn('[AnnotationPanel] AI 插入后光标 hydrate 失败:', result);
                }
              } catch (e) {
                console.error("[AnnotationPanel] 设置最终光标位置失败:", e);
              }
            }
          });
        }
      },
      onError: (message, type) => {
        console.error(`[AnnotationPanel] AI 任务出错 (${type}):`, message);
      }
    }
  }).catch(error => {
    if (error.name !== 'AbortError') {
      console.error('[AnnotationPanel] 调用 executeAnnotationRun 失败:', error);
    }
  });
}

// 组件挂载时的初始化
onMounted(() => {
  // 添加全局点击监听器，用于自动保存编辑中的批注
  window.addEventListener('mousedown', handleGlobalMouseDown);
});

// 组件卸载前清理
onBeforeUnmount(() => {
  // 移除事件监听器
  window.removeEventListener('mousedown', handleGlobalMouseDown);
});

// 全局点击处理函数
const handleGlobalMouseDown = (event) => {
  // 查找当前正在编辑中或创建中的批注
  const editingPanel = localAnnotations.value.find(panel => 
    panel.state === AnnotationState.EDITING || panel.state === AnnotationState.CREATING
  );
  
  if (!editingPanel) return; // 没有编辑中的面板，不需要处理
  
  // 检查点击是否在编辑中的批注面板内
  const clickedElement = event.target;
  // 向上查找最近的 annotation-panel 元素
  let panelElement = clickedElement.closest('.annotation-panel');
  
  // 如果点击不在任何面板内，或者点击在不同的面板内，则自动保存
  if (!panelElement || panelElement.dataset.annotationId !== editingPanel.id) {
    if (editingPanel.state === AnnotationState.EDITING) {
      // 保存编辑中的批注
      handleSaveEdit({
        annotationId: editingPanel.id,
        content: editingPanel.content,
        trigger: 'button'
      });
    } else if (editingPanel.state === AnnotationState.CREATING) {
      // 如果内容不为空，保存新创建的批注
      if (editingPanel.content && editingPanel.content.trim()) {
        handleConfirmCreating({
          blockId: editingPanel.blockId,
          content: editingPanel.content,
          trigger: 'button'
        });
      } else {
        // 内容为空则取消创建
        handleCancelCreating({
          blockId: editingPanel.blockId,
          trigger: 'button'
        });
      }
    }
  }
};
</script>
