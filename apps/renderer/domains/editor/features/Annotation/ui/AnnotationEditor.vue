<!--/**
 * AnnotationEditor.vue
 * 
 * 批注编辑模式组件（优化版 - Notion风格）
 * 职责：
 * 1. 提供批注内容输入界面
 * 2. 使用全局指令 v-autoresize 处理文本框自动高度调整
 * 3. 提供AI、保存/取消按钮
 * 4. 高度变化时通知父组件
 */-->

<template>
  <div class="annotation-item annotation-editor">
    <!-- 头部：作者信息 + 操作按钮 -->
    <div class="annotation-meta">
      <div class="annotation-creator">
        <span class="annotation-author">{{ editorMessage('editor.annotation.author.user') }}</span>
      </div>
      
      <!-- 右侧区域：包含操作按钮 -->
      <div class="annotation-meta-right">
        <!-- 右侧操作按钮组 - 编辑模式下显示AI、取消和保存 -->
        <div class="annotation-icon-buttons">
          <!-- AI 按钮 -->
          <button
            class="icon-button ai-icon"
            @click="triggerAiAndSave"
            :title="editorMessage('editor.annotation.action.aiAndSave')"
            :aria-label="editorMessage('editor.annotation.action.aiAndSave')"
          >
            <AiIcon />
          </button>
          
          <!-- 取消按钮 -->
          <button
            class="icon-button cancel-icon"
            @click="onCancel('button')"
            :title="editorMessage('editor.annotation.action.cancelEdit')"
            :aria-label="editorMessage('editor.annotation.action.cancelEdit')"
          >
            <NoIcon />
          </button>
          
          <!-- 保存按钮 -->
          <button
            class="icon-button save-icon"
            @click="onSave('button')"
            :disabled="!editedContent.trim()"
            :title="editorMessage('editor.annotation.action.save')"
            :aria-label="editorMessage('editor.annotation.action.save')"
          >
            <OkIcon />
          </button>
        </div>
      </div>
    </div>
    
    <!-- 编辑框：使用全局指令 v-autoresize -->
    <textarea 
      v-model="editedContent"
      class="annotation-textarea"
      v-autoresize
      :placeholder="editorMessage('editor.annotation.placeholder.edit')"
      @keydown="handleKeyDown"
      @autoresize="onAutoResize"
      ref="textareaRef"
    ></textarea>
  </div>
</template>

<script setup>
import { ref, watchEffect, onMounted, nextTick } from 'vue'
import { AiIcon } from '@linnya/renderer-ui/icons';
import { OkIcon } from '@linnya/renderer-ui/icons';
import { CloseIcon as NoIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../ui/useEditorLocalization';

const props = defineProps({
  panel: { type: Object, required: true }
})

const emit = defineEmits(['cancel', 'save', 'heightChanged', 'editor-mounted', 'ai-action'])
const { editorMessage } = useEditorLocalization();

// 本地 ref 用于存储编辑中的内容
// 使用本地 ref (editedContent) 而不是直接修改 props.panel.content 是为了：
// 1. **隔离编辑状态**：用户的实时输入只修改本地副本，不直接影响 useAnnotationStore 中的原始数据。
// 2. **支持取消操作**：如果用户取消编辑，原始数据未被更改，可以轻松恢复。
// 3. **明确保存点**：只有在用户点击保存时，才将本地编辑的内容通过 'save' 事件传递出去，
//    由父组件调用相应命令更新 useAnnotationStore。
const editedContent = ref('');
// 添加对 textarea 的引用
const textareaRef = ref(null);

// 使用 watchEffect 监听 props.panel.content 的变化，初始化或重置 editedContent
// 主要作用是在组件因状态变为 'editing' 而首次渲染时，
// 或者在外部（理论上不应发生）导致 panel.content 变化时，
// 将存储在 useAnnotationStore 中的原始批注内容复制到本地的 editedContent 中，
// 作为用户编辑的起点。
watchEffect(() => {
  editedContent.value = props.panel.content || ''; // 当 panel 或 content 变化时更新
});

// 组件挂载后自动聚焦文本框
onMounted(() => {
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.focus();
      // 将光标移到文本末尾
      const textLength = editedContent.value.length;
      textareaRef.value.setSelectionRange(textLength, textLength);
      // 通知父组件编辑器已挂载
      emit('editor-mounted', textareaRef.value);
    }
  });
});

// 修改：取消编辑逻辑，增加触发来源参数
function onCancel(trigger = 'button') { // 默认为 'button'
  // 修改：在事件负载中包含触发来源和 annotationId
  emit('cancel', { 
    annotationId: props.panel.id,
    trigger: trigger // 'esc' or 'button'
  });
}

// 修改：保存编辑逻辑，增加触发来源参数
function onSave(trigger = 'button') { // 默认为 'button'
  // 内容不为空才触发保存
  if (!editedContent.value.trim()) return;

  // 修改：在事件负载中包含触发来源
  emit('save', {
    annotationId: props.panel.id,
    content: editedContent.value, // 使用本地 ref 的值
    trigger: trigger // 'enter' or 'button'
  });
}

/**
 * 当 autoResize 指令执行完高度调整后，会 dispatch 一个 'autoresize' 事件
 * 这里通过 @autoresize="onAutoResize" 来捕获
 */
function onAutoResize(event) {
  const newHeight = event.detail.height
  // 通知父组件高度变化，并附带 annotationId 和 blockId
  emit('heightChanged', { 
    height: newHeight, 
    annotationId: props.panel.id, 
    blockId: props.panel.blockId 
  }) // 传递包含更多信息的对象
}

// 修改：处理键盘事件
function handleKeyDown(event) {
  // Esc 键 - 取消编辑
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel('esc');
    return;
  }
  
  // Enter 键按下但没有按 Shift 键 - 保存批注
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); // 阻止默认的回车换行
    
    // 有内容才保存
    if (editedContent.value.trim()) {
      onSave('enter'); // <--- 传递 'enter' 作为触发来源
    }
  }
  // Shift+Enter 组合键 - 允许默认行为（插入换行符）

  // --- 新增：处理 Ctrl+Alt+A 快捷键 ---
  if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    triggerAiAndSave();
    return;
  }
  // --- 结束新增 ---
}

// --- 新增：触发 AI 并保存的方法 ---
function triggerAiAndSave() {
  console.log("[AnnotationEditor] triggerAiAndSave called");
  // 1. 先触发 AI 动作
  emit('ai-action');
  // 2. 检查是否有内容，如果有则触发保存（使用 'enter' 触发器以利用光标逻辑）
  if (editedContent.value.trim()) {
     console.log("[AnnotationEditor] Calling onSave('enter') after AI action.");
     onSave('enter'); // 触发保存和光标移动
  } else {
     console.log("[AnnotationEditor] Content is empty, only triggering AI action.");
     // 如果内容为空，AI 触发了，但不会自动保存/关闭编辑状态
     // 可以根据需求调整这里的行为，比如即使为空也强制保存（转换为确认状态）
  }
}
// --- 结束新增 ---
</script>
