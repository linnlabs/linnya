<template>
  <div class="ai-assistant-table-context table-context-wrapper">
    <button
      v-if="store.isActive"
      class="table-mode-close-button"
      :title="closeTitle"
      @click="handleClose"
    >
      <CloseIcon />
    </button>

    <TableAiContext
      v-if="context"
      class="table-context-embedded"
      :column-refs="context.columnRefs"
      :selection-range="context.selectionRange"
      :output-column-range="context.outputColumnRange"
      :active-column-refs="context.activeColumnRefs"
      @column-ref-click="handleColumnRefClick"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import TableAiContext from '../../../blocks/TableBlock/ui/TableAiContext.vue';
import type {
  TableAiComposerPort,
  TableAiModeColumnReference,
} from '../definitions/tableAiMode';
import {
  activateTableAiColumnReference,
} from '../orchestration/tableAiColumnReferenceRuntime';
import { useTableAiModeStore } from '../store/tableAiModeStore';

const props = defineProps<{
  composer: TableAiComposerPort;
  closeTitle: string;
}>();

const emit = defineEmits<{
  requestClose: [];
}>();

const store = useTableAiModeStore();
const context = computed(() => store.activeContext);

const handleColumnRefClick = (columnRef: TableAiModeColumnReference): void => {
  const color = activateTableAiColumnReference(columnRef);
  if (!color) return;

  const refKey = columnRef.reference;
  const inserted = props.composer.insertColumnReference({
    refKey,
    label: `{{${refKey}}}`,
    color,
  });

  if (!inserted) {
    console.warn(`[TableAiComposerContext] 插入列引用失败: ${refKey}`);
  }
};

const handleClose = (): void => {
  emit('requestClose');
};
</script>
