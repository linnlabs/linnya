<template>
  <ConversationChatSurface
    :variant="variant"
    :empty-composer-placement="emptyComposerPlacement"
    :is-active="isActive"
    empty-heading="Linnya"
    :empty-description="startupEmptySubtitle"
  >
    <template #empty-mark>
      <div class="linnya-assistant-empty-logo empty-logo">
        <LinnyaIcon class="linnya-assistant-empty-logo-icon empty-logo-icon" />
      </div>
    </template>
  </ConversationChatSurface>
</template>

<script setup lang="ts">
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import ConversationChatSurface from './ConversationChatSurface.vue';
import { useStartupEmptySubtitle } from './composables/useStartupEmptySubtitle';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '../definitions/conversationPresentation';

withDefaults(defineProps<{
  variant?: ConversationSurfaceVariant;
  emptyComposerPlacement?: ConversationEmptyComposerPlacement;
  isActive?: boolean;
}>(), {
  variant: 'regular',
  emptyComposerPlacement: 'center',
  isActive: true,
});

const startupEmptySubtitle = useStartupEmptySubtitle();
</script>
