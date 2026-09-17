<template>
  <BaseDropdown
    ref="dropdown"
    :manual-mode="true"
    :is-open="openPopover !== null"
    class="slides-element-property-controls"
    @close="close()"
  >
    <template #trigger>
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
          <div class="slides-element-property-toolbar__font">
            <CustomNumberInput
              v-model="fontSize"
              variant="panel"
              :input-width="44"
              :aria-label="message('slides.elementProperties.fontSize')"
              :title="`${message('slides.elementProperties.fontSize')} (${SLIDES_MANUAL_FONT_SIZE_PT.min}–${SLIDES_MANUAL_FONT_SIZE_PT.max} pt)`"
              :min="SLIDES_MANUAL_FONT_SIZE_PT.min"
              :max="SLIDES_MANUAL_FONT_SIZE_PT.max"
              step="any"
              :disabled="busy"
              @change="commitNumber('fontSize')"
              @keydown.enter.prevent="commitNumber('fontSize')"
              @keydown.alt.down.stop.prevent="toggle('fontSize', $event)"
              @keydown.esc.stop.prevent="cancelNumber('fontSize', $event); close()"
            />
            <ToolbarButton
              data-property="fontSize"
              :label="message('slides.elementProperties.fontSize')"
              :active="openPopover === 'fontSize'"
              :aria-expanded="openPopover === 'fontSize'"
              aria-haspopup="listbox"
              :disabled="busy"
              @click="toggle('fontSize', $event)"
              @keydown.down.stop.prevent="toggle('fontSize', $event)"
            >
              <ChevronIcon
                direction="down"
                class="slides-element-property-toolbar__icon"
              />
            </ToolbarButton>
          </div>
          <ToolbarColorButton
            kind="text"
            data-property="text"
            :label="message('slides.elementProperties.textColor')"
            :color="currentTextColor"
            :expanded="openPopover === 'text'"
            :aria-controls="popoverId"
            :disabled="busy"
            @click="toggle('text', $event)"
          />
        </ToolbarGroup>
        <ToolbarGroup v-if="canEditFill || canEditSize">
          <ToolbarColorButton
            v-if="canEditFill"
            kind="background"
            data-property="fill"
            :label="message('slides.elementProperties.fillColor')"
            :color="currentFillColor ?? 'transparent'"
            :expanded="openPopover === 'fill'"
            :aria-controls="popoverId"
            :disabled="busy"
            @click="toggle('fill', $event)"
          />
          <ToolbarButton
            v-if="canEditSize"
            type="button"
            data-property="size"
            :aria-label="message('slides.elementProperties.size')"
            :label="message('slides.elementProperties.size')"
            :aria-expanded="openPopover === 'size'"
            :active="openPopover === 'size'"
            :aria-controls="popoverId"
            :disabled="busy"
            @click="toggle('size', $event)"
          >
            <ResizeIcon class="slides-element-property-toolbar__icon" />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup v-if="canDelete">
          <ToolbarButton
            type="button"
            data-property="delete"
            class="slides-element-property-toolbar__delete"
            :label="message(target.targetKind === 'frame' ? 'slides.elementProperties.deleteFrame' : 'slides.elementProperties.deleteElement')"
            :disabled="busy"
            @click="emit('delete-selected')"
          >
            <DeleteIcon class="slides-element-property-toolbar__icon" />
          </ToolbarButton>
        </ToolbarGroup>
      </FloatingToolbar>
    </template>
    <template #content>
      <div
        v-if="openPopover === 'fontSize' && position !== null"
        ref="fontMenu"
        class="slides-element-font-menu"
        :style="popoverStyle"
        @pointerdown.stop
        @keydown.stop
        @keydown.esc.stop.prevent="close(true)"
      >
        <!-- 整个工具条都属于内部点击，避免旧列表关闭刚打开的相邻属性；焦点归还由外层 BaseDropdown 负责。 -->
        <CustomSelect
          :model-value="target.textEditing?.fontSizePt"
          :options="ELEMENT_FONT_SIZE_OPTIONS"
          manual-mode
          :external-trigger-ref="toolbar?.element ?? null"
          :trigger-aria-label="message('slides.elementProperties.fontSize')"
          :options-motion-direction="popoverDirection"
          :options-max-height="`${Math.min(240, popoverPosition?.maxHeight ?? anchor.viewport.height - 16)}px`"
          :class-names="{ options: 'slides-element-font-menu__options' }"
          @update:model-value="selectFontSize"
          @close="close()"
        />
      </div>
      <DropdownPanel
        :id="popoverId"
        ref="popover"
        :show="openPopover !== null && openPopover !== 'fontSize' && position !== null"
        :direction="popoverDirection"
        class="slides-element-property-popover"
        :style="popoverStyle"
        role="group"
        tabindex="-1"
        :aria-label="message(openPopover === 'size' ? 'slides.elementProperties.size' : openPopover === 'text' ? 'slides.elementProperties.textColor' : 'slides.elementProperties.fillColor')"
        @pointerdown.stop
        @keydown.stop
        @keydown.esc.stop.prevent="dismissPopover"
      >
        <ElementColorControl
          v-if="openPopover === 'text' || openPopover === 'fill'"
          ref="colorControl"
          :key="openPopover"
          :color="openPopover === 'text' ? currentTextColor : currentFillColor"
          :kind="openPopover"
          :label="message(openPopover === 'text' ? 'slides.elementProperties.textColor' : 'slides.elementProperties.fillColor')"
          :disabled="busy"
          :overlay-host="colorOverlay"
          :menu-element="popover?.element ?? null"
          :menu-position="popoverPosition"
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
      </DropdownPanel>
      <div
        ref="colorOverlay"
        class="slides-element-color-overlay"
      />
    </template>
  </BaseDropdown>
</template>

<script setup lang="ts">
import { computed, ref, toRef, useId, type CSSProperties } from 'vue';
import { BaseDropdown, CustomSelect, DropdownPanel, type DropdownActions, CustomNumberInput, FloatingToolbar, ToolbarGroup, ToolbarButton, ToolbarColorButton } from '@linnya/renderer-ui';
import { ChevronIcon, DeleteIcon, ResizeIcon } from '@linnya/renderer-ui/icons';
import { SLIDES_MANUAL_FONT_SIZE_PT } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditableTarget } from '../../manualEditing';
import type { ElementPropertyAnchor } from '../definitions/elementPropertyToolbar';
import type { ElementPropertyOperation } from '../definitions/elementPropertyTypes';
import { ELEMENT_FONT_SIZE_OPTIONS } from '../definitions/fontSizeOptions';
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
const dropdown = ref<DropdownActions | null>(null);
const popover = ref<InstanceType<typeof DropdownPanel> | null>(null);
const fontMenu = ref<HTMLDivElement | null>(null);
const colorOverlay = ref<HTMLDivElement | null>(null);
const colorControl = ref<InstanceType<typeof ElementColorControl> | null>(null);
const popoverId = useId();
const { position, popoverPosition, openPopover, toggle, close, handleToolbarKeydown } = useElementPropertyToolbar({
  deleteSelected: () => emit('delete-selected'),
  dropdown,
  anchor: toRef(props, 'anchor'), hasHierarchy: toRef(props, 'hasHierarchy'),
  toolbarElement: computed(() => toolbar.value?.element ?? null), popoverElement: computed(() => fontMenu.value ?? popover.value?.element ?? null),
  auxiliaryElement: colorOverlay,
});
const { fontSize, width, height, commitNumber, cancelNumber, submitTextColor, submitFillColor } = useElementPropertyFields({
  target: toRef(props, 'target'), busy: computed(() => props.busy === true), submit: operation => emit('submit', operation),
});
const canEditTextStyle = computed(() => props.target.capabilities.includes('set_text_style'));
const canEditFill = computed(() => props.target.capabilities.includes('set_fill_color'));
const canEditSize = computed(() => props.target.capabilities.includes('set_visual_size'));
const canDelete = computed(() => props.target.capabilities.includes('delete'));
const currentTextColor = computed(() => props.target.textEditing?.color ?? '#000000');
const currentFillColor = computed(() => props.target.fill?.kind === 'solid' ? props.target.fill.color : null);
const popoverDirection = computed(() => popoverPosition.value && position.value && popoverPosition.value.top < position.value.top ? 'up' : 'down');
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
function selectFontSize(value: number): void {
  fontSize.value = value;
  commitNumber('fontSize');
  close(true);
}
function dismissPopover(): void {
  // 悬停展开不搬走主面板焦点，但 Escape 仍须先关闭最内层草稿。
  if (!colorControl.value?.dismissCustom()) close(true);
}
</script>
