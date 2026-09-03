<template>
  <Teleport to="body">
    <Transition name="app-modal-fade">
      <div
        v-if="isVisible"
        class="modal-overlay"
        :class="{ 'modal-overlay--alert': layer === 'alert' }"
        @click.self="closeOnOverlayClick && close()"
      >
        <div class="modal-container" :style="containerStyle">
          <div class="modal-header">
            <h2>{{ resolvedTitle }}</h2>
            <button
              class="modal-close"
              :aria-label="closeLabel"
              :title="closeLabel"
              @click="close"
            >
              <CloseIcon />
            </button>
          </div>
          <div
            class="modal-content"
            :class="`modal-content--${scrollMode}`"
          >
            <slot></slot>
          </div>
          <div
            v-if="$slots.footer"
            class="modal-footer"
          >
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { CSSProperties } from 'vue';
import { CloseIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import type { ModalProps, ModalSlots } from '../definitions/modal';

const props = withDefaults(defineProps<ModalProps>(), {
  isVisible: false,
  title: '',
  width: '500px',
  maxWidth: '90%',
  height: '',
  maxHeight: '540px',
  minHeight: 'auto',
  closeOnOverlayClick: true,
  closeOnEsc: true,
  layer: 'base',
  scrollMode: 'content',
});

const emit = defineEmits<{
  close: [];
}>();

defineSlots<ModalSlots>();

const { sharedComponentMessage } = useSharedComponentLocalization();
const resolvedTitle = computed(() => props.title || sharedComponentMessage('shared.modal.title'));
const closeLabel = computed(() => sharedComponentMessage('shared.modal.close'));

const containerStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    width: props.width,
    maxWidth: props.maxWidth,
  };

  if (props.height) {
    style.height = props.height;
    // 固定高度也必须服从当前视口，避免标题、操作区或正文被推出屏幕。
    style.maxHeight = 'calc(100dvh - 32px)';
  } else {
    style.maxHeight = `min(${props.maxHeight}, calc(100dvh - 32px))`;
    style.minHeight = props.minHeight;
  }

  return style;
});

const close = (): void => {
  emit('close');
};

const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && props.isVisible && props.closeOnEsc) {
    close();
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>
