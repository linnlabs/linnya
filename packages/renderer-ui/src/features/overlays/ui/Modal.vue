<template>
  <Teleport to="body">
    <Transition name="app-modal-fade">
      <div
        v-if="isVisible"
        class="modal-overlay"
        :class="{ 'modal-overlay--alert': layer === 'alert' }"
        @click.self="closeOnOverlayClick && close()"
      >
        <div
          class="modal-container"
          :style="containerStyle"
        >
          <div class="modal-header">
            <div class="modal-heading">
              <h2>{{ resolvedTitle }}</h2>
              <div
                v-if="$slots['title-extra']"
                class="modal-title-extra"
              >
                <slot name="title-extra" />
              </div>
            </div>
            <IconButton
              :label="closeLabel"
              size="md"
              class="modal-close"
              @click="close"
            >
              <CloseIcon />
            </IconButton>
          </div>
          <div
            class="modal-content"
            :class="`modal-content--${scrollMode}`"
          >
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="modal-footer"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import IconButton from '../../actions/ui/IconButton.vue';
import { computed } from 'vue';
import type { CSSProperties } from 'vue';
import { CloseIcon } from '../../../icons';
import { useSharedComponentLocalization } from '../../../localization';
import type { ModalProps, ModalSlots } from '../definitions/modal';
import { useEscapeLayer } from '../vue/useEscapeLayer';

defineOptions({ name: 'LinnyaModal' });

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

// Escape 只交给最后打开的浮层；closeOnEsc 为 false 时本层接住但不关闭，也不让下一层响应。
useEscapeLayer({
  active: () => props.isVisible,
  onEscape: () => {
    if (props.closeOnEsc) close();
  },
});
</script>
