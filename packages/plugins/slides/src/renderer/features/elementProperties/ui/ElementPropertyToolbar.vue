<template>
  <FloatingToolbar
    ref="toolbar"
    :show="true"
    :position="position ?? { top: 0, left: 0 }"
    class="slides-element-property-toolbar"
    :style="{ visibility: position ? 'visible' : 'hidden', maxWidth: `${anchor.viewport.width - 16}px` }"
    role="group"
    :aria-label="message('slides.elementProperties.label')"
    @pointerdown.stop
    @keydown="handleToolbarKeydown"
  >
    <ToolbarGroup v-if="canEditTextStyle">
      <label class="slides-element-property-toolbar__font">
        <span>{{ message('slides.elementProperties.fontSize') }}</span>
        <CustomNumberInput
          v-model="fontSize"
          variant="panel"
          :input-width="52"
          min="1"
          max="400"
          step="1"
          :disabled="busy"
          @change="commitNumber('fontSize')"
          @keydown.enter.prevent="commitNumber('fontSize')"
          @keydown.esc.stop.prevent="cancelNumber('fontSize', $event)"
        />
      </label>
      <button
        type="button"
        class="slides-element-property-toolbar__button"
        data-property="text"
        :aria-label="message('slides.elementProperties.textColor')"
        :title="message('slides.elementProperties.textColor')"
        :aria-expanded="openPopover === 'text'"
        :aria-controls="popoverId"
        :disabled="busy"
        @click="toggle('text', $event)"
      >
        <TextColorIcon class="slides-element-property-toolbar__icon" />
        <span
          class="slides-element-property-toolbar__color"
          :style="{ backgroundColor: currentTextColor }"
        />
      </button>
    </ToolbarGroup>
    <ToolbarGroup v-if="canEditFill || canEditSize">
      <button
        v-if="canEditFill"
        type="button"
        class="slides-element-property-toolbar__button"
        data-property="fill"
        :aria-label="message('slides.elementProperties.fillColor')"
        :title="message('slides.elementProperties.fillColor')"
        :aria-expanded="openPopover === 'fill'"
        :aria-controls="popoverId"
        :disabled="busy"
        @click="toggle('fill', $event)"
      >
        <BackgroundColorIcon class="slides-element-property-toolbar__icon" />
        <span
          class="slides-element-property-toolbar__color"
          :style="{ backgroundColor: currentFillColor ?? 'transparent' }"
        />
      </button>
      <button
        v-if="canEditSize"
        type="button"
        class="slides-element-property-toolbar__button"
        data-property="size"
        :aria-label="message('slides.elementProperties.size')"
        :title="message('slides.elementProperties.size')"
        :aria-expanded="openPopover === 'size'"
        :aria-controls="popoverId"
        :disabled="busy"
        @click="toggle('size', $event)"
      >
        <ResizeIcon class="slides-element-property-toolbar__icon" />
      </button>
    </ToolbarGroup>
    <ToolbarGroup v-if="canDeleteFrame">
      <button
        type="button"
        class="slides-element-property-toolbar__button slides-element-property-toolbar__button--delete"
        :aria-label="message('slides.elementProperties.deleteFrame')"
        :title="message('slides.elementProperties.deleteFrame')"
        :disabled="busy"
        @click="submitDelete"
      >
        <DeleteIcon class="slides-element-property-toolbar__icon" />
        {{ message('slides.elementProperties.deleteGroup') }}
      </button>
    </ToolbarGroup>
  </FloatingToolbar>
  <div
    v-if="openPopover && position"
    :id="popoverId"
    ref="popover"
    class="slides-element-property-popover"
    :style="popoverStyle"
    role="group"
    tabindex="-1"
    :aria-label="message(openPopover === 'size' ? 'slides.elementProperties.size' : openPopover === 'text' ? 'slides.elementProperties.textColor' : 'slides.elementProperties.fillColor')"
    @pointerdown.stop
    @keydown.stop
    @keydown.esc.stop.prevent="close(true)"
  >
    <ElementColorControl
      v-if="openPopover === 'text' || openPopover === 'fill'"
      :key="openPopover"
      :color="openPopover === 'text' ? currentTextColor : currentFillColor"
      :kind="openPopover"
      :label="message(openPopover === 'text' ? 'slides.elementProperties.textColor' : 'slides.elementProperties.fillColor')"
      :disabled="busy"
      @select="selectColor"
    />
    <template v-else>
      <label class="slides-element-property-popover__field">
        <span>{{ message('slides.elementProperties.width') }}</span>
        <CustomNumberInput
          v-model="width"
          variant="panel"
          :input-width="72"
          min="0.05"
          step="0.05"
          :disabled="busy"
          @change="commitNumber('width')"
          @keydown.enter.prevent="commitNumber('width')"
          @keydown.esc.stop.prevent="cancelNumber('width', $event); close(true)"
        />
      </label>
      <label class="slides-element-property-popover__field">
        <span>{{ message('slides.elementProperties.height') }}</span>
        <CustomNumberInput
          v-model="height"
          variant="panel"
          :input-width="72"
          min="0.05"
          step="0.05"
          :disabled="busy"
          @change="commitNumber('height')"
          @keydown.enter.prevent="commitNumber('height')"
          @keydown.esc.stop.prevent="cancelNumber('height', $event); close(true)"
        />
      </label>
      <span class="slides-element-property-popover__hint">{{ message('slides.elementProperties.sizeHint') }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef, useId, type CSSProperties } from 'vue';
import { CustomNumberInput, FloatingToolbar, ToolbarGroup } from '@linnya/renderer-ui';
import { BackgroundColorIcon, DeleteIcon, ResizeIcon, TextColorIcon } from '@linnya/renderer-ui/icons';
import type { ManualEditableTarget } from '../../manualEditing';
import type { ElementPropertyAnchor } from '../definitions/elementPropertyToolbar';
import type { ElementPropertyOperation } from '../definitions/elementPropertyTypes';
import { useElementPropertyFields } from '../orchestration/useElementPropertyFields';
import { useElementPropertyToolbar } from '../orchestration/useElementPropertyToolbar';
import { useElementPropertyLocalization } from './useElementPropertyLocalization';
import ElementColorControl from './ElementColorControl.vue';

const props = defineProps<{
  target: ManualEditableTarget;
  anchor: ElementPropertyAnchor;
  hasHierarchy: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ submit: [operation: ElementPropertyOperation]; 'delete-selected': [] }>();
const { elementPropertyMessage: message } = useElementPropertyLocalization();
const toolbar = ref<InstanceType<typeof FloatingToolbar> | null>(null);
const popover = ref<HTMLDivElement | null>(null);
const popoverId = useId();
const { position, popoverPosition, openPopover, toggle, close, handleToolbarKeydown } = useElementPropertyToolbar({
  deleteSelected: () => emit('delete-selected'),
  anchor: toRef(props, 'anchor'), hasHierarchy: toRef(props, 'hasHierarchy'),
  toolbarElement: computed(() => toolbar.value?.element ?? null), popoverElement: popover,
});
const { fontSize, width, height, commitNumber, cancelNumber, submitTextColor, submitFillColor, submitDelete } = useElementPropertyFields({
  target: toRef(props, 'target'), busy: computed(() => props.busy === true), submit: operation => emit('submit', operation),
});
const canEditTextStyle = computed(() => props.target.capabilities.includes('set_text_style'));
const canEditFill = computed(() => props.target.capabilities.includes('set_fill_color'));
const canEditSize = computed(() => props.target.capabilities.includes('set_visual_size'));
const canDeleteFrame = computed(() => props.target.targetKind === 'frame' && props.target.capabilities.includes('delete'));
const currentTextColor = computed(() => props.target.textEditing?.color ?? '#000000');
const currentFillColor = computed(() => props.target.fill?.kind === 'solid' ? props.target.fill.color : null);
const popoverStyle = computed<CSSProperties>(() => ({
  left: `${popoverPosition.value?.left ?? 0}px`, top: `${popoverPosition.value?.top ?? 0}px`,
  visibility: popoverPosition.value ? 'visible' : 'hidden',
  maxWidth: `${props.anchor.viewport.width - 16}px`, maxHeight: `${popoverPosition.value?.maxHeight ?? props.anchor.viewport.height - 16}px`,
}));
function selectColor(color: string): void {
  if (openPopover.value === 'text') submitTextColor(color);
  else if (openPopover.value === 'fill') submitFillColor(color);
  close(true);
}
</script>
