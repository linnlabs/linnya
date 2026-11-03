<template>
  <div
    class="ai-assistant-quote-preview__pill"
    :aria-label="presentation.label"
    @mouseenter="hover.enter()"
    @mouseleave="hover.leave()"
  >
    <button
      ref="anchor"
      type="button"
      class="ai-assistant-quote-preview__pill-text ai-assistant-quote-preview__pill-action"
      @click="activate"
      @focus="hover.enter(true)"
      @keydown.esc="hover.escape()"
    >
      {{ presentation.preview }}
    </button>
    <button
      type="button"
      class="ai-assistant-quote-preview__pill-close"
      :aria-label="removeLabel"
      @click.stop="$emit('remove')"
    >
      <CloseIcon />
    </button>
  </div>
  <Teleport to="body">
    <div
      v-if="hover.open.value"
      ref="panel"
      class="conversation-reference-hover"
      :style="hover.position.value"
      @mouseenter="hover.stay()"
      @mouseleave="hover.leave()"
      @focusin="hover.stay()"
      @keydown.esc.stop.prevent="hover.escape()"
    >
      <DropdownPanel
        :show="true"
        direction="up"
        class="conversation-reference-hover__content"
      >
        <component
          :is="presentation.previewComponent"
          v-if="presentation.previewComponent"
          :reference="reference"
        />
        <template v-else>
          <strong>{{ presentation.label }}</strong><p>{{ reference.previewText || reference.text }}</p>
        </template>
        <p
          v-if="error"
          role="alert"
        >
          {{ error }}
        </p>
      </DropdownPanel>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { DropdownPanel } from '@linnya/renderer-ui';
import { CloseIcon } from '@linnya/renderer-ui/icons';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import type { ConversationReferenceChipPresentation } from '../definitions/conversationReferenceChip';
import { createComposerReferenceHover } from '../orchestration/createComposerReferenceHover';
const props = defineProps<{ reference: ConversationReferenceChipInput; presentation: ConversationReferenceChipPresentation; removeLabel: string }>();
defineEmits<{ remove: [] }>();
const anchor = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null), error = ref<string | null>(null);
const hover = createComposerReferenceHover({ anchor: () => anchor.value, panel: () => panel.value });
async function activate() { if (!props.presentation.activate) { hover.enter(true); return; } try { await props.presentation.activate(); hover.close(); } catch (failure) { error.value = failure instanceof Error ? failure.message : String(failure); hover.enter(true); } }
watch(() => props.reference, () => { hover.close(); error.value = null; });
onBeforeUnmount(hover.dispose);
</script>
