<template>
  <Modal
    :is-visible="Boolean(draft)"
    title="编辑图片"
    width="560px"
    :close-on-overlay-click="!editor.state.busy.value"
    :close-on-esc="!editor.state.busy.value"
    @close="editor.dismiss()"
  >
    <template v-if="draft">
      <p>在原图上拖出裁剪范围，或用下方滑块精确调整。原图始终保留。</p>
      <div class="canvas-image-crop-stage">
        <div
          v-if="draft.asset"
          class="canvas-image-crop-source"
          @pointerdown="gesture.down"
          @pointermove="gesture.move"
          @pointerup="gesture.up"
          @pointercancel="gesture.cancel"
        >
          <img
            :src="draft.asset.dataUri"
            :alt="draft.data.alt"
            draggable="false"
          >
          <div
            class="canvas-image-crop-range"
            :style="cropStyle"
          />
        </div>
        <p
          v-else
          role="status"
        >
          正在读取图片…
        </p>
      </div>
      <fieldset
        class="canvas-image-edit-fields"
        :disabled="editor.state.busy.value"
      >
        <legend>裁剪边界</legend>
        <label
          v-for="side in sides"
          :key="side.id"
        >{{ side.label }}
          <input
            type="range"
            min="0"
            max="99"
            step="1"
            :value="insets[side.id]"
            @input="inset(side.id, $event)"
          >
          <output>{{ Math.round(insets[side.id]) }}%</output>
        </label>
        <BaseButton
          variant="secondary"
          :disabled="editor.state.busy.value"
          @click="editor.state.patch({ crop: null })"
        >
          恢复完整原图
        </BaseButton>
        <label>图注<CustomTextInput
          class="canvas-image-edit-text"
          :model-value="draft.data.caption"
          :disabled="editor.state.busy.value"
          @update:model-value="editor.state.patch({ caption: $event })"
        /></label>
        <label>替代文字<CustomTextInput
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
          替换图片
        </BaseButton>
        <input
          ref="picker"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          @change="replace"
        >
      </fieldset>
      <p
        v-if="editor.state.error.value"
        role="alert"
      >
        {{ editor.state.error.value }}
      </p>
    </template>
    <template #footer>
      <p
        v-if="editor.deliveryNotice.value"
        role="status"
      >
        {{ editor.deliveryNotice.value }}
        <BaseButton
          variant="secondary"
          @click="editor.retryDelivery()"
        >
          重试确认
        </BaseButton>
      </p>
      <div class="canvas-image-edit-actions">
        <BaseButton
          variant="secondary"
          :disabled="editor.state.busy.value"
          @click="editor.dismiss()"
        >
          取消
        </BaseButton>
        <BaseButton
          variant="primary"
          :disabled="editor.state.busy.value || !draft?.asset"
          @click="editor.apply()"
        >
          保存
        </BaseButton>
      </div>
    </template>
  </Modal>
  <p
    v-if="!draft && editor.state.error.value"
    role="alert"
  >
    {{ editor.state.error.value }}
  </p>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Modal, BaseButton, CustomTextInput } from '@linnya/renderer-ui';
import type { createCanvasImageEditing } from '../orchestration/createCanvasImageEditing';
import { createCanvasImageCropGesture } from '../orchestration/createCanvasImageCropGesture';
import { canvasImageCropInset, fullCanvasImageCrop } from '../functions/canvasImageCrop';
const props = defineProps<{ editor: ReturnType<typeof createCanvasImageEditing> }>();
const draft = computed(() => props.editor.state.draft.value), picker = ref<HTMLInputElement | null>(null);
const crop = computed(() => draft.value?.data.crop ?? fullCanvasImageCrop);
const gesture = createCanvasImageCropGesture(props.editor.state);
const cropStyle = computed(() => ({ left: `${crop.value.x * 100}%`, top: `${crop.value.y * 100}%`, width: `${crop.value.width * 100}%`, height: `${crop.value.height * 100}%` }));
const insets = computed(() => ({ left: crop.value.x * 100, top: crop.value.y * 100, right: (1 - crop.value.x - crop.value.width) * 100, bottom: (1 - crop.value.y - crop.value.height) * 100 }));
const sides = [{ id: 'left', label: '左' }, { id: 'top', label: '上' }, { id: 'right', label: '右' }, { id: 'bottom', label: '下' }] as const;
function inset(side: typeof sides[number]['id'], event: Event) { if (event.target instanceof HTMLInputElement) props.editor.state.patch({ crop: canvasImageCropInset(crop.value, side, event.target.valueAsNumber) }); }
function replace(event: Event) { if (event.target instanceof HTMLInputElement) { const file = event.target.files?.[0]; event.target.value = ''; if (file) void props.editor.replace(file); } }
onBeforeUnmount(gesture.dispose);
</script>
