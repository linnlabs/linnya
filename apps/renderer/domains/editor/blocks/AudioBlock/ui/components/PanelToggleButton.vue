<template>
  <button 
    class="toggle-panel-button" 
    :title="isPanelVisible
      ? editorMessage('editor.audioBlock.action.hidePanel')
      : editorMessage('editor.audioBlock.action.showPanel')"
    @click="$emit('toggle')"
  >
    <ChevronIcon 
      direction="left" 
      class="chevron-icon" 
      :class="{ 'is-open': isPanelVisible }" 
    />
  </button>
</template>

<script setup>
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';

defineProps({
  isPanelVisible: { type: Boolean, required: true },
});

defineEmits(['toggle']);
const { editorMessage } = useEditorLocalization();
</script>
