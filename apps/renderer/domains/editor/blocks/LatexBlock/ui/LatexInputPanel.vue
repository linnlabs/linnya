<template>
  <Transition name="latex-panel-fade">
    <div
      ref="panelContainerRef"
      v-if="latexStore.isPanelVisible"
      class="latex-input-panel"
      :style="panelStyle"
      @keydown.esc.prevent="handleCancel"
    >
      <div class="latex-panel-main-content">
        <textarea
          ref="inputRef"
          :value="latexStore.currentSource" 
          @input="handleInput"
          @keydown.enter="handleEnterKey"
          class="latex-panel-textarea"
          :placeholder="editorMessage('editor.latexBlock.input.placeholder')"
          spellcheck="false"
        ></textarea>
        <div class="latex-panel-buttons">
          <button @click="handleSubmit" class="latex-panel-button submit" :disabled="!latexStore.isSourceValid">{{ editorMessage('editor.latexBlock.input.confirm') }}</button>
          <button @click="handleCancel" class="latex-panel-button cancel">{{ editorMessage('editor.latexBlock.input.cancel') }}</button>
        </div>
      </div>
      <div v-if="!latexStore.isSourceValid && latexStore.currentSource.trim() !== ''" class="latex-panel-error">
        {{ editorMessage('editor.latexBlock.input.invalidFormula') }}
      </div>
      <!-- ++ 新增符号面板 ++ -->
      <SymbolPalette @insert-symbol="handleInsertSymbol" />
    </div>
  </Transition>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { useLatexEditorStore } from '../store/latexEditor';
import { computePosition, offset, flip, shift, autoUpdate } from '@floating-ui/dom';
import { NodeFinder } from '../../../extensions/position/NodeFinder';
import SymbolPalette from './SymbolPalette.vue'; // ++ 导入符号面板组件 ++
import { useEditorLocalization } from '../../../ui/useEditorLocalization';
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

// --- Store and Editor ---
const latexStore = useLatexEditorStore();
const { editorMessage } = useEditorLocalization();

// --- Refs ---
const panelContainerRef = ref(null);
const inputRef = ref(null);

// --- Computed Properties ---
const panelStyle = computed(() => ({
  position: 'fixed', // Use fixed for positioning relative to viewport
  top: `${latexStore.panelPosition.top}px`,
  left: `${latexStore.panelPosition.left}px`,
  zIndex: 1100, // Ensure it's above other elements
}));

// --- Event Handlers ---
const handleInput = (event) => {
  latexStore.updateSource(event.target.value);
  autoResizeTextarea(); // Resize on input
};

/**
 * ++ 新增：处理符号插入的函数 ++
 * @param {object} symbolData - 包含 { insert: string, moveCursor?: number } 的对象
 */
const handleInsertSymbol = (symbolData) => {
  const { insert, moveCursor } = symbolData;
  const textarea = inputRef.value;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const currentText = textarea.value;

  // 构造新文本
  const newText = currentText.substring(0, start) + insert + currentText.substring(end);
  
  // 更新 store
  latexStore.updateSource(newText);
  
  // 使用 nextTick 确保 DOM 更新后再设置光标和焦点
  nextTick(() => {
    // 计算新的光标位置
    const newCursorPos = start + insert.length + (moveCursor || 0);
    
    textarea.value = newText; // 强制更新 textarea 值，防止延迟
    textarea.selectionStart = newCursorPos;
    textarea.selectionEnd = newCursorPos;
    textarea.focus(); // 重新聚焦
    autoResizeTextarea(); // 调整大小
  });
};

const handleEnterKey = (event) => {
  if (!event.shiftKey) {
    // 只按了 Enter：阻止默认换行并提交
    event.preventDefault(); 
    handleSubmit();
  } else {
    // 按了 Shift+Enter：允许默认换行
    // 触发一次 resize 检查，因为默认换行可能需要调整高度
    nextTick(() => {
        autoResizeTextarea();
    });
  }
};

// +++ Define a reusable focus restoration function +++
const restoreEditorFocus = (editor, nodeIdToFocusAfter) => {
  if (!editor) return;

  nextTick(() => { 
    if (nodeIdToFocusAfter) {
      try {
        const nodeFinder = new NodeFinder(editor);
        const nodeInfo = nodeFinder.findNodeById(nodeIdToFocusAfter);

        if (nodeInfo) {
          const posAfter = nodeInfo.pos + nodeInfo.node.nodeSize;
          editor.chain().focus().setTextSelection(posAfter).run();
        } else {
          editor.commands.focus(); 
        }
      } catch (error) {
        console.error('[LatexInputPanel] Error restoring focus:', error);
        editor.commands.focus(); // Fallback
      }
    } else {
      editor.commands.focus();
    }
  });
};

// +++ NEW: Central Submit Handler +++
const handleSubmit = () => {
  const editor = latexStore.editorInstance;
  
  if (!editor) {
    console.warn('[LatexInputPanel] Cannot submit: Editor instance missing.');
    latexStore.hidePanel(); 
    return;
  }
  
  const success = latexStore.submitCurrentLatex(); 
  
  latexStore.hidePanel(); 
  
  if (success) {
    nextTick(() => {
       editor.view.focus(); 
    });
  }
};

const handleCancel = async () => {
  const editor = latexStore.editorInstance;
  const nodeId = latexStore.targetNodeId;
  const originalSourceValue = latexStore.originalSource;
  const currentSourceValue = latexStore.currentSource;

  if (nodeId && editor) {
    const nodeFinder = new NodeFinder(editor);
    const nodeInfo = nodeFinder.findNodeById(nodeId);

    if (nodeInfo) {
      if (originalSourceValue === '' && currentSourceValue === '') {
        if (nodeInfo.node.type.name === 'inlineLatex') {
          editor.chain().focus().deleteRange({ from: nodeInfo.pos, to: nodeInfo.pos + nodeInfo.node.nodeSize }).run();
        } else if (nodeInfo.node.type.name === 'latexBlock') {
          if (editor.commands.setBaseBlock) {
            editor.chain().focus().setTextSelection(nodeInfo.pos + 1).setBaseBlock().run();
          } else {
            console.warn('[LatexInputPanel] setBaseBlock command not available for cancel revert.');
          }
        } else {
          console.warn(`[LatexInputPanel] Unknown node type (${nodeInfo.node.type.name}) encountered during cancel for empty node.`);
        }
      }
    }
  }

  await latexStore.cancelEdit();

  restoreEditorFocus(editor, nodeId);
};

// Handle click outside
const handleClickOutside = (event) => {
  if (panelContainerRef.value && !panelContainerRef.value.contains(event.target)) {
    if (latexStore.referenceElement && latexStore.referenceElement.contains(event.target)) {
      return; 
    }
    handleSubmit();
  }
};

// --- Utilities ---
const autoResizeTextarea = () => {
  const textarea = inputRef.value;
  if (textarea) {
    applyTextareaAutoResize(textarea);
  }
};

// --- Watchers and Lifecycle ---
watch(() => latexStore.isPanelVisible, (isVisible) => {
   if (isVisible) {
    nextTick(() => {
      setTimeout(() => {
        if (inputRef.value) {
          inputRef.value.focus();
          inputRef.value.select();
          nextTick(() => {
              autoResizeTextarea();
              setTimeout(() => {
                  if (inputRef.value) {
                      autoResizeTextarea();
                  }
              }, 50);
          });
        } else {
          console.warn('[LatexInputPanel] inputRef not available in focus timeout.');
        }
      }, 10);
      computeInitialPosition();
      setTimeout(() => document.addEventListener('click', handleClickOutside, { capture: true }), 0);
    });
  } else {
    document.removeEventListener('click', handleClickOutside, { capture: true });
  }
});

watch(() => latexStore.currentSource, (newSource, oldSource) => {
    if (newSource !== oldSource) {
      nextTick(() => {
          autoResizeTextarea();
      });
    }
}, { immediate: false });

// ++ 新增：计算初始位置的函数 ++
const computeInitialPosition = () => {
  if (latexStore.referenceElement && panelContainerRef.value) {
    if (!(latexStore.referenceElement instanceof Element)) {
      console.warn('[LatexInputPanel] Reference element is not a valid DOM element');
      latexStore.updatePosition({
        top: window.innerHeight / 2 - 150, // Fallback position
        left: window.innerWidth / 2 - 200
      });
      return;
    }

    computePosition(latexStore.referenceElement, panelContainerRef.value, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(6), flip(), shift({ padding: 5 })],
    }).then(({ x, y }) => {
      latexStore.updatePosition({ top: y, left: x });
    }).catch(err => {
      console.error('[LatexInputPanel] Error computing initial position:', err);
      latexStore.updatePosition({ // Fallback position on error
        top: window.innerHeight / 2 - 150,
        left: window.innerWidth / 2 - 200
      });
    });
  } else {
    console.warn('[LatexInputPanel] Cannot compute initial position: Reference element or panel container missing.');
    latexStore.updatePosition({ // Fallback position if elements missing
      top: window.innerHeight / 2 - 150,
      left: window.innerWidth / 2 - 200
    });
  }
};

// ++ 在 onBeforeUnmount 中确保移除 click listener ++
onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside, { capture: true });
});

</script>
