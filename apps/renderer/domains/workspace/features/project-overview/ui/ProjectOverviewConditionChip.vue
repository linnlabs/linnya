<!-- 工具条上的一个字段条件（如“已读：未勾选”），来自保存的筛选；只能清除，不在这里编辑。 -->
<template>
  <div class="project-overview-filter is-active project-overview-condition">
    <span class="project-overview-filter__trigger project-overview-condition__text" :title="text">
      <span class="project-overview-filter__text">{{ text }}</span>
    </span>
    <button
      type="button"
      class="project-overview-filter__clear"
      :aria-label="clearLabel"
      :data-linnya-tooltip="clearLabel"
      @click="emit('clear')"
    >
      <CloseIcon />
    </button>
  </div>
</template>

<script setup lang="ts">
import { CloseIcon } from '@linnya/renderer-ui/icons';

defineProps<{ text: string; clearLabel: string }>();
const emit = defineEmits<{ clear: [] }>();
</script>
