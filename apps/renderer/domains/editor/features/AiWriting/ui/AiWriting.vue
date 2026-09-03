<template>
  <Teleport to="body">
    <Transition name="ai-writing-fade">
      <div
        ref="writingContainerRef"
        v-if="isVisible"
        class="ai-writing-container-horizontal"
        :style="positionStyle"
      >
        <div class="ai-writing-inner-horizontal">
          <!-- 左侧入口图标：使用 Linnya 渐变图标替换原来的 ✨ -->
          <span class="ai-writing-icon-horizontal">
            <LinnyaIcon class="ai-writing-linnya-icon" />
          </span>
          <textarea
            ref="inputRef"
            v-model="inputText"
            class="ai-writing-textarea-horizontal"
            :placeholder="editorMessage('editor.aiWriting.placeholder')"
            rows="1"
            @input="autoResizeTextarea"
            @keydown="handleKeyDown"
          ></textarea>
          <!-- Add Buttons -->
          <div class="ai-writing-buttons-horizontal">
            <button
              class="ai-writing-button ai-writing-cancel-button"
              @click="handleCancel"
              :title="editorMessage('editor.aiWriting.cancel')"
            >
              <CloseIcon />
            </button>
            <button
              class="ai-writing-button ai-writing-submit-button"
              @click="handleSubmit"
              :title="editorMessage('editor.aiWriting.submit')"
              :disabled="!inputText.trim()"
            >
              <EnterLeftIcon />
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount, inject, toRef } from "vue";
import { useUIStore } from "../../../../../shared/stores/ui";
import { TextSelection } from "prosemirror-state";
import { CloseIcon } from '@linnya/renderer-ui/icons';
import { EnterLeftIcon } from '@linnya/renderer-ui/icons';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import { positionTextSelectionWithHandshake } from "../../RenderVirtualization";
import { useAiWritingVirtualizationKeepAlive } from "./useAiWritingVirtualizationKeepAlive";
import { EDITOR_KEY } from "../../../core/tokens";
import { useEditorLocalization } from "../../../ui/useEditorLocalization";
import { applyTextareaAutoResize } from '@linnya/renderer-ui';

const props = defineProps({
  isVisible: {
    type: Boolean,
    default: false,
  },
  position: {
    type: Object,
    default: () => ({ top: 0, left: 0, width: "auto" }), // Added width default
  },
  targetBlockId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["submit", "cancel"]);

const inputText = ref("");
const inputRef = ref(null);
const writingContainerRef = ref(null);
const { editorMessage } = useEditorLocalization();

// --- 注入编辑器实例 ---
const editor = inject(EDITOR_KEY, ref(null));
// --- 获取 UI Store 实例 ---
const uiStore = useUIStore();

// --- Add a flag to track how cancellation was initiated ---
let cancelInitiatedBySpace = false;

useAiWritingVirtualizationKeepAlive({
  editor,
  isVisible: toRef(props, "isVisible"),
  targetBlockId: toRef(props, "targetBlockId"),
});

// Compute position style including width, excluding left
const positionStyle = computed(() => {
  // width 和 maxWidth 由 CSS 控制, left 将由JS动态设置
  return {
    top: `${props.position.top}px`,
  };
});

// --- Function to update horizontal position and width ---
const updateHorizontalPosition = () => {
  if (!writingContainerRef.value || !props.isVisible) return;

  const targetElement = document.querySelector(".main-flow"); // Changed from '.editor-shell'
  if (!targetElement) {
    console.warn(
      "[AiWriting] Target element for centering (.main-flow) not found.",
    );
    // Fallback: center to viewport if target is not found
    const viewportWidth = window.innerWidth;
    const maxWidth = 740; // 最大宽度
    const padding = 40; // 左右留白
    const availableWidth = viewportWidth - padding * 2;
    const actualWidth = Math.min(availableWidth, maxWidth);
    
    writingContainerRef.value.style.width = `${actualWidth}px`;
    writingContainerRef.value.style.left = `${viewportWidth / 2 - actualWidth / 2}px`;
    return;
  }

  const targetRect = targetElement.getBoundingClientRect();
  const maxWidth = 740; // 最大宽度
  const padding = 40; // 左右留白，确保输入框不会紧贴边缘
  
  // 计算基于编辑区域的可用宽度
  const availableWidth = targetRect.width - padding * 2;
  const actualWidth = Math.min(availableWidth, maxWidth);
  
  // 设置宽度
  writingContainerRef.value.style.width = `${actualWidth}px`;
  
  // 计算居中位置
  let newLeft = targetRect.left + targetRect.width / 2 - actualWidth / 2;
  newLeft = Math.round(newLeft); // Round to nearest whole pixel

  writingContainerRef.value.style.left = `${newLeft}px`;
};

// Auto-resize textarea height
const autoResizeTextarea = () => {
  const textarea = inputRef.value;
  if (textarea) {
    applyTextareaAutoResize(textarea, {
      minHeight: 20,
      maxHeight: 100,
      scrollToBottomWhenCursorAtEnd: true,
    });
  }
};

// Handle click outside
const handleClickOutside = (event) => {
  if (
    writingContainerRef.value &&
    !writingContainerRef.value.contains(event.target)
  ) {
    // --- Ensure flag is false for click outside cancel ---
    cancelInitiatedBySpace = false;
    handleCancel();
  }
};

// --- 修改：通用 Keydown 处理器 ---
const handleKeyDown = (event) => {
  // 首先检查 IME 是否正在组合
  if (event.isComposing) {
    // 如果正在组合，则不执行任何自定义快捷键逻辑，
    // 让 IME 完全处理按键（例如空格选词）
    return;
  }

  // --- 只有在非 IME 组合状态下才执行以下逻辑 ---

  // 1. 处理空格键 (取消 + 插入空格)
  if (
    event.key === " " &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    if (inputText.value.trim() === "") {
      event.preventDefault();
      const triggerPos = uiStore.aiPromptTriggerPos;
      if (
        editor.value &&
        typeof triggerPos === "number" &&
        triggerPos !== null
      ) {
        try {
          const tr = editor.value.state.tr.insertText(" ", triggerPos);
          // --- Cursor is already positioned after space insertion ---
          tr.setSelection(TextSelection.create(tr.doc, triggerPos + 1));
          editor.value.view.dispatch(tr);
          // --- Mark cancellation type ---
          cancelInitiatedBySpace = true;
          handleCancel(); // Call cancel AFTER space insertion
        } catch (e) {
          console.error("[AiWriting] Error inserting space on cancel:", e);
          // Still attempt to cancel even if space insertion fails
          cancelInitiatedBySpace = true; // Mark it so cursor logic in handleCancel knows
          handleCancel();
        }
      } else {
        console.warn(
          "[AiWriting] Cannot insert space: Editor not available or trigger position invalid.",
        );
        // Attempt to cancel anyway
        cancelInitiatedBySpace = true;
        handleCancel();
      }
      return; // Stop processing
    }
  }

  // 2. 处理 Enter 键 (提交)
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSubmit();
    return;
  }

  // 3. 处理 Escape 键 (取消)
  if (event.key === "Escape") {
    event.preventDefault();
    // --- Ensure flag is false for Esc cancel ---
    cancelInitiatedBySpace = false;
    handleCancel();
    return;
  }
};
// --- 结束修改 ---

// Focus and resize when visible
watch(
  () => props.isVisible,
  (newValue) => {
    if (newValue) {
      inputText.value = "";
      nextTick(() => {
        // 1. 先更新容器宽度和位置
        updateHorizontalPosition();
        
        // 2. 然后再处理内部元素
        if (inputRef.value) {
          inputRef.value.focus();
          autoResizeTextarea();
        }

        setTimeout(() => {
          document.addEventListener("click", handleClickOutside, {
            capture: true,
          });
        }, 0);
        // Add resize listener when visible
        window.addEventListener("resize", updateHorizontalPosition);
      });
    } else {
      // Reset height when hidden
      if (inputRef.value) {
        inputRef.value.style.height = "auto";
        inputRef.value.style.overflowY = "hidden";
      }
      document.removeEventListener("click", handleClickOutside, {
        capture: true,
      });
      // Remove resize listener when hidden
      window.removeEventListener("resize", updateHorizontalPosition);
    }
  },
);

// +++ 新增：监听左侧侧边栏状态变化 +++
// 当左侧侧边栏状态改变时，更新输入框宽度
watch(
  () => uiStore.sidebarVisible,
  () => {
    if (props.isVisible) {
      // 使用 nextTick 确保 DOM 已更新
      nextTick(() => {
        updateHorizontalPosition();
      });
    }
  }
);

// Handle submit
const handleSubmit = () => {
  const text = inputText.value.trim();
  if (text) {
    emit("submit", {
      prompt: text,
      blockId: props.targetBlockId,
    });
    // 提交成功后不再需要在这里隐藏，交由 handleKeyDown 处理
  }
};

// Handle cancel
const handleCancel = () => {
  // 1. Get the position *before* it's reset in the store
  const savedTriggerPos = uiStore.aiPromptTriggerPos;
  // Check the flag we set in handleKeyDown or know is false otherwise
  const wasCancelledBySpace = cancelInitiatedBySpace;
  cancelInitiatedBySpace = false; // Reset flag for next time

  // 2. Hide the prompt (this resets uiStore.aiPromptTriggerPos)
  uiStore.hideAiPrompt();
  // 3. Cleanup listener (needs to happen regardless of cursor repositioning)
  document.removeEventListener("click", handleClickOutside, { capture: true });

  // 4. After hiding, reposition the cursor using nextTick
  nextTick(async () => {
    if (
      editor.value &&
      typeof savedTriggerPos === "number" &&
      savedTriggerPos !== null
    ) {
      try {
        // Always focus the editor first
        editor.value.commands.focus();

        // Only explicitly set selection if cancel wasn't from the space key action
        // Because the space key action already placed the cursor correctly after the space
        if (!wasCancelledBySpace) {
          console.log(
            `[AiWriting handleCancel] Repositioning cursor (Esc/Button/Click) to: ${savedTriggerPos}`,
          );
          // 中文说明：Prompt 关闭时目标块可能已经是 placeholder，恢复光标必须走 hydrate-before-selection 协议。
          const result = await positionTextSelectionWithHandshake(editor.value, savedTriggerPos);
          if (!result.ok) {
            console.warn("[AiWriting handleCancel] 恢复光标 hydrate 失败:", result);
          }
        } else {
          console.log(
            `[AiWriting handleCancel] Cursor already positioned by space key action. Ensuring focus.`,
          );
          // For space cancel, just ensure focus, cursor is already at savedTriggerPos + 1
        }
      } catch (e) {
        console.error(
          "[AiWriting handleCancel] Error focusing/repositioning cursor:",
          e,
        );
      }
    } else {
      console.warn(
        "[AiWriting handleCancel] Cannot reposition cursor: Editor or savedTriggerPos invalid.",
        { editorExists: !!editor.value, savedTriggerPos },
      );
      // Fallback: just focus the editor if possible
      if (editor.value) {
        editor.value.commands.focus();
      }
    }
  });
  // emit('cancel'); // Still likely unnecessary
};

// Cleanup on before unmount
onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside, { capture: true });
  // Ensure resize listener is removed on unmount
  window.removeEventListener("resize", updateHorizontalPosition);
});
</script>
