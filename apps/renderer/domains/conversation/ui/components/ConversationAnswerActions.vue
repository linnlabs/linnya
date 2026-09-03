<template>
  <div
    class="conversation-answer-actions"
    :class="[
      `conversation-answer-actions--${variant}`,
      variant === 'turn' ? 'turn-actions-row' : 'card-actions-row',
      { 'is-disabled': disabled },
    ]"
    @mouseenter="$emit('mouseenter')"
  >
    <button
      :class="variant === 'turn' ? 'turn-action-button' : 'card-action-button'"
      type="button"
      :title="saveTitle"
      :disabled="disabled || isSaving"
      @click.stop="$emit('save')"
    >
      <!-- 虚拟 row 内的反馈只更新稳定原生节点，避免指令直接 patch 图标组件根 vnode。 -->
      <span
        class="answer-action-icon save-action-icon"
        :hidden="showSavedText"
      >
        <DocumentRightIcon />
      </span>
      <span
        class="action-text"
        :hidden="!showSavedText"
      >{{ savedStatusText }}</span>
    </button>

    <button
      :class="[
        variant === 'turn' ? 'turn-action-button' : 'card-action-button',
        'conversation-answer-copy-button',
      ]"
      type="button"
      :title="copyTitle"
      :disabled="disabled"
      @click.stop="$emit('copy')"
    >
      <span
        class="answer-action-icon copy-action-icon"
        :hidden="showCopiedText"
      >
        <CopyIcon />
      </span>
      <span
        class="action-text"
        :hidden="!showCopiedText"
      >{{ copiedText }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { CopyIcon } from '@linnya/renderer-ui/icons';
import { DocumentRightIcon } from '@linnya/renderer-ui/icons';

withDefaults(defineProps<{
  variant: 'card' | 'turn';
  copyTitle: string;
  saveTitle: string;
  copiedText: string;
  savedStatusText: string;
  showCopiedText: boolean;
  showSavedText: boolean;
  isSaving: boolean;
  disabled?: boolean;
}>(), { disabled: false });

defineEmits<{
  copy: [];
  save: [];
  mouseenter: [];
}>();
</script>
