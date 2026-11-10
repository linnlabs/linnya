<template>
  <Modal
    :is-visible="Boolean(draft)"
    :title="t('canvas.selection.editImage')"
    width="560px"
    :close-on-overlay-click="!editor.state.busy.value"
    :close-on-esc="!editor.state.busy.value"
    @close="editor.dismiss()"
  >
    <template v-if="draft">
      <p class="canvas-image-edit-hint">
        {{ t('canvas.imageEdit.hint') }}
      </p>
      <div class="canvas-image-crop-stage">
        <div
          v-if="draft.asset"
          class="canvas-image-crop-source"
          @pointerdown="gesture.down"
          @pointermove="gesture.move"
          @pointerup="gesture.up"
          @pointercancel="gesture.cancel"
        >
          <img :src="draft.asset.dataUri" :alt="draft.data.alt" draggable="false" />
          <div class="canvas-image-crop-range" :style="cropStyle" />
        </div>
        <p v-else role="status">{{ t('canvas.imageEdit.loading') }}</p>
      </div>
      <fieldset class="canvas-image-edit-fields" :disabled="editor.state.busy.value">
        <legend class="canvas-image-edit-legend">{{ t('canvas.imageEdit.legend') }}</legend>
        <label v-for="side in sides" :key="side.id" class="canvas-image-edit-row">
          <span class="canvas-image-edit-label">{{ t(`canvas.side.${side.id}`) }}</span>
          <CustomSlider
            class="canvas-image-edit-slider"
            :model-value="insets[side.id]"
            :min="0"
            :max="99"
            :step="1"
            variant="compact"
            :aria-label="t('canvas.imageEdit.cropSide', { side: t(`canvas.side.${side.id}`) })"
            @update:model-value="inset(side.id, $event)"
          />
          <output>{{ Math.round(insets[side.id]) }}%</output>
        </label>
        <BaseButton
          variant="secondary"
          :disabled="editor.state.busy.value"
          @click="editor.state.patch({ crop: null })"
        >
          {{ t('canvas.imageEdit.reset') }}
        </BaseButton>
        <label class="canvas-image-edit-row">
          <span class="canvas-image-edit-label">{{ t('canvas.imageEdit.caption') }}</span
          ><CustomTextInput
            class="canvas-image-edit-text"
            :model-value="draft.data.caption"
            :disabled="editor.state.busy.value"
            @update:model-value="editor.state.patch({ caption: $event })"
        /></label>
        <label class="canvas-image-edit-row">
          <span class="canvas-image-edit-label">{{ t('canvas.imageEdit.alt') }}</span
          ><CustomTextInput
            class="canvas-image-edit-text"
            :model-value="draft.data.alt"
            :disabled="editor.state.busy.value"
            @update:model-value="editor.state.patch({ alt: $event })"
        /></label>
        <BaseButton
          variant="secondary"
          :disabled="editor.state.busy.value"
          @click="picker?.click()"
        >
          {{ t('canvas.imageEdit.replace') }}
        </BaseButton>
        <input
          ref="picker"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="replace"
        />
      </fieldset>
      <p v-if="editor.state.error.value" role="alert">
        {{ editor.state.error.value }}
      </p>
    </template>
    <template #footer>
      <p v-if="editor.deliveryNotice.value" role="status">
        {{ editor.deliveryNotice.value }}
        <BaseButton variant="secondary" @click="editor.retryDelivery()">
          {{ t('canvas.status.retryConfirm') }}
        </BaseButton>
      </p>
      <ActionButtons
        :primary-action-text="t('canvas.imageEdit.apply')"
        :secondary-action-text="t('canvas.imageEdit.cancel')"
        :is-primary-action-disabled="editor.state.busy.value || !draft?.asset"
        :is-secondary-action-disabled="editor.state.busy.value"
        @primary-click="editor.apply()"
        @secondary-click="editor.dismiss()"
      />
    </template>
  </Modal>
  <p v-if="!draft && editor.state.error.value" role="alert">
    {{ editor.state.error.value }}
  </p>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  ActionButtons,
  BaseButton,
  CustomSlider,
  CustomTextInput,
  Modal,
} from '@linnya/renderer-ui';
import { canvasText as t } from '../../localization';
import type { createCanvasImageEditing } from '../orchestration/createCanvasImageEditing';
import { createCanvasImageCropGesture } from '../orchestration/createCanvasImageCropGesture';
import { canvasImageCropInset, fullCanvasImageCrop } from '../functions/canvasImageCrop';
const props = defineProps<{ editor: ReturnType<typeof createCanvasImageEditing> }>();
const draft = computed(() => props.editor.state.draft.value),
  picker = ref<HTMLInputElement | null>(null);
const crop = computed(() => draft.value?.data.crop ?? fullCanvasImageCrop);
const gesture = createCanvasImageCropGesture(props.editor.state);
const cropStyle = computed(() => ({
  left: `${crop.value.x * 100}%`,
  top: `${crop.value.y * 100}%`,
  width: `${crop.value.width * 100}%`,
  height: `${crop.value.height * 100}%`,
}));
const insets = computed(() => ({
  left: crop.value.x * 100,
  top: crop.value.y * 100,
  right: (1 - crop.value.x - crop.value.width) * 100,
  bottom: (1 - crop.value.y - crop.value.height) * 100,
}));
const sides = [{ id: 'left' }, { id: 'top' }, { id: 'right' }, { id: 'bottom' }] as const;
function inset(side: (typeof sides)[number]['id'], value: number) {
  props.editor.state.patch({ crop: canvasImageCropInset(crop.value, side, value) });
}
function replace(event: Event) {
  if (event.target instanceof HTMLInputElement) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void props.editor.replace(file);
  }
}
onBeforeUnmount(gesture.dispose);
</script>
