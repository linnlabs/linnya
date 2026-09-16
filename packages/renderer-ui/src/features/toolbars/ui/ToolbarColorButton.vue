<template>
  <ToolbarButton
    :label="label"
    :disabled="disabled"
    :active="expanded || active"
    :aria-expanded="expanded"
    class="linnya-toolbar-color-button"
  >
    <span
      class="linnya-toolbar-color-button__symbol"
      aria-hidden="true"
    >
      <template v-if="kind === 'text'">A</template>
      <EditIcon
        v-else
        class="linnya-toolbar-color-button__icon"
      />
      <span
        class="linnya-toolbar-color-button__indicator"
        :style="{ backgroundColor: color }"
      />
    </span>
  </ToolbarButton>
</template>

<script setup lang="ts">
import { EditIcon } from '../../../icons';
import type { ToolbarColorButtonProps } from '../definitions/toolbar';
import ToolbarButton from './ToolbarButton.vue';
defineProps<ToolbarColorButtonProps>();
</script>
