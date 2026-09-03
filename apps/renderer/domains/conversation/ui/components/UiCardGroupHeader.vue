<template>
  <div
    ref="rootElement"
    class="ui-card-group"
  >
    <div
      class="timeline-marker"
      :class="{ 'has-next': hasNext, 'is-expanded': isExpanded }"
      @click="$emit('toggle')"
    >
      <div class="timeline-line" />
      <div class="timeline-node">
        <div class="node-dot" />
        <ChevronIcon
          direction="right"
          class="node-chevron"
          :class="{ 'is-expanded': isExpanded }"
        />
      </div>
    </div>

    <div class="content-wrapper">
      <div
        class="ui-card-header"
        @click="$emit('toggle')"
      >
        <span
          class="ui-card-header-text"
          :class="{ 'is-streaming': isActive }"
          :data-header-text="headerText"
        >
          {{ headerText }}
        </span>
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronIcon } from '@linnya/renderer-ui/icons';
import type { ConversationCardGroupHeader } from '../../definitions/conversationPresentation';

const props = defineProps<{
  header: ConversationCardGroupHeader;
  isExpanded: boolean;
  isActive: boolean;
  hasNext: boolean;
}>();

defineEmits<{ toggle: [] }>();
const rootElement = ref<globalThis.HTMLElement | null>(null);
defineExpose({ rootElement });
const headerText = computed(() => props.header.headerText);
</script>
