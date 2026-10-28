<template>
  <Teleport to="body">
    <Transition
      name="image-preview-modal-fade"
      :css="usesFadeTransition"
    >
      <div
        v-if="isRendered"
        class="image-preview-modal"
        :class="classNames.overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="displayedAlt"
        @click.self="emit('close')"
      >
        <slot
          v-if="!displayedSrc"
          name="placeholder"
        />
        <img
          v-else
          ref="imageRef"
          :src="displayedSrc"
          :alt="displayedAlt"
          :class="classNames.image"
          decoding="async"
          @error="emit('error')"
          @click.stop
        >
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ImagePreviewModalProps } from '../definitions/imagePreviewModal';
import {
  canRunImagePreviewTransition,
  IMAGE_PREVIEW_TRANSITION_NAME,
  resolveImagePreviewSourceImage,
} from '../functions/imagePreviewTransition';

const props = withDefaults(defineProps<ImagePreviewModalProps>(), {
  src: '',
  sourceElement: null,
  classNames: () => ({}),
});

const emit = defineEmits<{
  close: [];
  error: [];
}>();

defineSlots<{
  placeholder?: () => unknown;
}>();

// 内容与可见性由本组件持有：关闭过程中调用方已清空 src / alt，大图仍要保留到过渡结束。
const isRendered = ref(props.isVisible);
const displayedSrc = ref(props.src ?? '');
const displayedAlt = ref(props.alt);
// 共享元素过渡由 View Transitions 驱动，此时关闭 Vue 自带的淡入淡出类。
const usesFadeTransition = ref(true);
const imageRef = ref<HTMLImageElement | null>(null);

function syncDisplayedContent(): void {
  displayedSrc.value = props.src ?? '';
  displayedAlt.value = props.alt;
}

function setTransitionName(element: HTMLElement | null, active: boolean): void {
  if (element === null) return;
  if (active) element.style.setProperty('view-transition-name', IMAGE_PREVIEW_TRANSITION_NAME);
  else element.style.removeProperty('view-transition-name');
}

/** 缩略图 ⇄ 大图：两端各带同名元素，浏览器在它们之间补间位置、尺寸与内容。 */
async function runSharedElementTransition(source: HTMLImageElement, opening: boolean): Promise<void> {
  usesFadeTransition.value = false;
  const outgoing = opening ? source : imageRef.value;
  setTransitionName(outgoing, true);

  const transition = document.startViewTransition(async () => {
    setTransitionName(outgoing, false);
    isRendered.value = opening;
    await nextTick();
    if (opening) {
      const image = imageRef.value;
      setTransitionName(image, true);
      // 新状态里的大图必须已解码，否则过渡的目标帧是空的。
      await image?.decode().catch(() => undefined);
    } else {
      setTransitionName(source, true);
    }
  });

  try {
    await transition.finished;
  } catch {
    // 被新的过渡打断或跳过时，最终状态由最后一次调用决定。
  } finally {
    setTransitionName(source, false);
    setTransitionName(imageRef.value, false);
  }
}

async function applyVisibility(visible: boolean): Promise<void> {
  if (visible) syncDisplayedContent();
  const source = resolveImagePreviewSourceImage(props.sourceElement);
  if (canRunImagePreviewTransition(source) && (visible || imageRef.value !== null)) {
    await runSharedElementTransition(source, visible);
    return;
  }
  usesFadeTransition.value = true;
  isRendered.value = visible;
}

watch(() => props.isVisible, (visible) => {
  void applyVisibility(visible);
});

watch(() => [props.src, props.alt], () => {
  if (props.isVisible) syncDisplayedContent();
});

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
