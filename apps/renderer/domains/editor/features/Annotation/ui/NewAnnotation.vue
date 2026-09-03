<!-- /**
 * NewAnnotation.vue
 * 
 * 新建批注组件（优化版 - Notion风格）
 * 职责：
 * 1. 提供批注内容输入界面
 * 2. 处理文本框自动高度调整
 * 3. 提供AI、保存/取消按钮
 */-->

<template>
  <div 
    class="annotation-item new-annotation" 
    :data-block-id="blockId"
    :data-annotation-id="panel.id"
    :data-state="'creating'"
    @pointerenter="onPanelPointerEnter"
    @pointerleave="onPanelPointerLeave"
  >
    <!-- 头部：作者信息 + 操作按钮 -->
    <div class="annotation-meta">
      <div class="annotation-creator">
        <span class="annotation-author">{{ editorMessage('editor.annotation.author.user') }}</span>
      </div>
      
      <!-- 右侧区域：包含操作按钮 -->
      <div class="annotation-meta-right">
        <!-- 右侧操作按钮组 -->
        <div class="annotation-icon-buttons">
          <!-- AI 按钮 -->
          <button 
            class="icon-button ai-icon" 
            @click="triggerAiAndConfirm"
            :title="editorMessage('editor.annotation.action.aiAndCreate')"
            :aria-label="editorMessage('editor.annotation.action.aiAndCreate')"
          >
            <AiIcon />
          </button>
          
          <!-- 取消按钮 -->
          <button 
            class="icon-button cancel-icon" 
            @click="onCancel('button')"
            :title="editorMessage('editor.annotation.action.cancelCreate')"
            :aria-label="editorMessage('editor.annotation.action.cancelCreate')"
          >
            <NoIcon />
          </button>
          
          <!-- 保存按钮 -->
          <button 
            class="icon-button save-icon" 
            @click="onSave('button')"
            :disabled="!panel.content.trim()"
            :title="editorMessage('editor.annotation.action.create')"
            :aria-label="editorMessage('editor.annotation.action.create')"
          >
            <OkIcon />
          </button>
        </div>
      </div>
    </div>
    
    <!-- 编辑框 -->
    <textarea 
      v-model="panel.content" 
      class="annotation-textarea"
      :placeholder="editorMessage('editor.annotation.placeholder.create')"
      @input="onInput"
      @keydown="handleKeyDown"
      ref="textareaRef"
      v-autoresize
      @autoresize="onTextareaResize"
    ></textarea>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed, inject } from 'vue';
import highlightState from '../AnnoHighlightState';
import autoResize from '../utils/autoResize';
import { AiIcon } from '@linnya/renderer-ui/icons';
import { OkIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon as NoIcon } from '@linnya/renderer-ui/icons';
import {
  ANNOTATION_PANEL_POSITION_MANAGER_KEY,
  ANNOTATION_RUNTIME_STORE_KEY,
} from '../definitions/injectionKeys';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

// 局部注册自定义指令
const directives = { autoResize };

// 定义props
const props = defineProps({
  panel: {
    type: Object,
    required: true
  },
  blockId: {
    type: String,
    required: true
  }
});

// 注入依赖。
// 中文说明：新建批注 UI 只消费 Annotation feature 的窄契约，避免字符串 key 和隐式大对象扩散。
const storeProvider = inject(ANNOTATION_RUNTIME_STORE_KEY, ref(null));
const panelPositionManagerProvider = inject(ANNOTATION_PANEL_POSITION_MANAGER_KEY, ref(null));

// 定义事件
const emit = defineEmits(['cancel', 'save', 'input', 'height-change', 'ai-action']);
const { editorMessage } = useEditorLocalization();

// 本地状态
const textareaRef = ref(null);

// 添加计算属性来检查依赖项状态
const isStoreReady = computed(() => !!storeProvider.value);
const isCalculatorReady = computed(() => !!panelPositionManagerProvider.value);
const areDependenciesReady = computed(() => isStoreReady.value && isCalculatorReady.value);

// 监听textarea自动调整大小事件
const onTextareaResize = (event) => {
  handleResizeLogic(event.detail.height);
};

// 保存新批注
const onSave = (trigger = 'button') => {
  if (!storeProvider.value) {
    console.warn(`[NewAnnotation] Store not available when trying to save.`);
    return;
  }
  if (!props.panel.content.trim()) return;
  emit('save', {
    content: props.panel.content,
    blockId: props.blockId,
    trigger: trigger
  });
};

// 取消创建
const onCancel = (trigger = 'button') => {
  // 清除高亮状态
  if (props.blockId) {
    highlightState.clearPanelHighlight(null, props.blockId);
    highlightState.clearBlockHighlight(props.blockId);
  }
  
  emit('cancel', {
    blockId: props.blockId,
    trigger: trigger
  });
};

// 输入内容变化
const onInput = (event) => {
  emit('input', event.target.value);
};

// 处理面板指针进入事件
const onPanelPointerEnter = () => {
  if (props.blockId) {
    highlightState.highlightPanel(null, props.blockId);
    highlightState.highlightBlock(props.blockId);
  }
};

// 处理面板指针离开事件
const onPanelPointerLeave = () => {
  if (props.blockId) {
    highlightState.clearPanelHighlight(null, props.blockId);
    highlightState.clearBlockHighlight(props.blockId);
  }
};

// 组件挂载后自动聚焦文本框
onMounted(() => {
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus();
      handleResizeLogic(textareaRef.value.scrollHeight);
    } else {
      console.warn(`[NewAnnotation] Textarea ref not available on mount.`);
    }
  });
});

// watch 观察依赖项变化
watch(isStoreReady, (newVal, oldVal) => {
    if (newVal && isCalculatorReady.value) {
         triggerResizeRecalculation();
    }
});

watch(isCalculatorReady, (newVal, oldVal) => {
    if (newVal && isStoreReady.value) {
         triggerResizeRecalculation();
    }
});

// 封装一个触发重新计算的函数
const triggerResizeRecalculation = () => {
   if(textareaRef.value){
       handleResizeLogic(textareaRef.value.scrollHeight);
   }
};

// 将 onTextareaResize 的核心逻辑提取出来
const handleResizeLogic = (height) => {
    emit('height-change', {
        blockId: props.blockId,
        height: height
    });

    if (isCalculatorReady.value) {
        try {
            panelPositionManagerProvider.value.recalculateAllPositions(false);
        } catch (error) {
            console.error(`[NewAnnotation] Error during resize handling:`, error);
        }
    } else {
        console.warn(`[NewAnnotation] Calculator not available during resize handling.`);
    }
};

// 处理键盘事件
const handleKeyDown = (event) => {
  // Esc 键 - 取消创建批注
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel('esc');
    return;
  }
  
  // Enter 键按下但没有按 Shift 键 - 保存批注
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); // 阻止默认的回车换行
    
    // 内容不为空则保存
    if (props.panel.content.trim()) {
      onSave('enter');
    }
  }
  // Shift+Enter 组合键 - 允许默认行为（插入换行符）

  // --- 新增：处理 Ctrl+Alt+A 快捷键 ---
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    triggerAiAndConfirm();
    return;
  }
  // --- 结束新增 ---
};

// --- 新增：触发 AI 并确认的方法 ---
function triggerAiAndConfirm() {
  console.log("[NewAnnotation] triggerAiAndConfirm called");
  // 1. 先触发 AI 动作
  emit('ai-action');
  // 2. 检查是否有内容，如果有则触发保存/确认（使用 'enter' 触发器以利用光标逻辑）
  if (props.panel.content.trim()) {
      console.log("[NewAnnotation] Calling onSave('enter') after AI action.");
      onSave('enter'); // 触发确认和光标移动
  } else {
      console.log("[NewAnnotation] Content is empty, only triggering AI action.");
      // 如果内容为空，AI 触发了，但不会自动创建/关闭创建状态
      // 可以根据需求调整，比如即使为空也强制确认（创建空批注）
  }
}
// --- 结束新增 ---
</script>
