<template>
  <div
    v-if="accessories.length > 0"
    class="conversation-input-accessories"
  >
    <div
      v-for="accessory in accessories"
      :key="accessory.key"
      class="conversation-input-accessory"
    >
      <component
        :is="accessory.component"
        :composer="accessory.composer"
        :disabled="disabled"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ConversationInputAccessoryViewModel } from '../definitions/conversationInputAccessoryViewModel';

defineProps<{
  readonly accessories: readonly ConversationInputAccessoryViewModel[];
  readonly disabled: boolean;
}>();
</script>
