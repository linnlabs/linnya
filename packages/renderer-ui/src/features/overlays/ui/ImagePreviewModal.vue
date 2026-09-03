<template>
  <Teleport to="body">
    <Transition name="image-preview-modal-fade">
      <div
        v-if="isVisible"
        class="image-preview-modal"
        :class="classNames.overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="alt"
        @click.self="emit('close')"
      >
        <slot
          v-if="!src"
          name="placeholder"
        />
        <img
          v-else
          :src="src"
          :alt="alt"
          :class="classNames.image"
          loading="lazy"
          decoding="async"
          @error="emit('error')"
          @click.stop
        >
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { ImagePreviewModalProps } from '../definitions/imagePreviewModal';

const props = withDefaults(defineProps<ImagePreviewModalProps>(), {
  src: '',
  classNames: () => ({}),
});

const emit = defineEmits<{
  close: [];
  error: [];
}>();

defineSlots<{
  placeholder?: () => unknown;
}>();

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.isVisible) {
    emit('close');
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
