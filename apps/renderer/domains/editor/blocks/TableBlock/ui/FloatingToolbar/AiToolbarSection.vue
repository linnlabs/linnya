<template>
  <ToolbarGroup>
    <ToolbarButton 
      @click="handleAiFillAction" 
      class="ai-trigger" 
      :title="editorMessage('editor.tableBlock.toolbar.aiFillTitle')"
    >
      {{ editorMessage('editor.tableBlock.toolbar.aiFill') }}
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarGroup } from '@linnya/renderer-ui';
import ToolbarButton from './ToolbarButton.vue';
import { useEditorLocalization } from '../../../../ui/useEditorLocalization';

const emit = defineEmits(['action']);
const { editorMessage } = useEditorLocalization();

// Directly emit 'aiFill' action
const handleAiFillAction = () => {
  emit('action', 'aiFill'); 
};
</script>
