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
        @mousedown="preserveCanvasFocus"
        @keydown="handleToolbarKeydown"
      >
        <ToolbarGroup v-if="ai">
          <ToolbarButton
            class="slides-element-property-toolbar__ai"
            data-property="ai"
            :label="message('slides.elementProperties.askAi')"
            @click="emit('ai')"
          >
            <LinnyaIcon class="slides-element-property-toolbar__icon" />
            <span>AI</span>
          </ToolbarButton>
        </ToolbarGroup>
        <template v-if="multiple">
          <ToolbarGroup>
            <span class="slides-element-property-toolbar__count">{{ message('slides.elementProperties.selectionCount', { count: selectionCount ?? 1 }) }}</span>
          </ToolbarGroup>
          <ToolbarGroup v-if="!readonly && arrangeable">
            <ToolbarButton
              v-for="item in SELECTION_ALIGNMENTS"
              :key="item.action"
              :data-arrange="item.action"
              :label="message(`slides.elementProperties.arrange.${item.action}`)"
              :disabled="busy"
              @click="emit('arrange', item.action)"
            >
              <component
                :is="item.icon"
                class="slides-element-property-toolbar__icon"
              />
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarGroup v-if="!readonly && arrangeable">
            <ToolbarButton
              v-for="item in SELECTION_DISTRIBUTIONS"
              :key="item.action"
              :data-arrange="item.action"
              :label="message(`slides.elementProperties.arrange.${item.action}`)"
              :disabled="busy || (selectionCount ?? 1) < 3"
              @click="emit('arrange', item.action)"
            >
              <component
                :is="item.icon"
                class="slides-element-property-toolbar__icon"
              />
            </ToolbarButton>
          </ToolbarGroup>
        </template>
        <ToolbarGroup v-if="canEditTextStyle">
          <div class="slides-element-property-toolbar__font">
            <CustomNumberInput
              v-model="fontSize"
              variant="panel"
              :input-width="60"
              input-class="slides-element-property-toolbar__font-input"
              :aria-label="message('slides.elementProperties.fontSize')"
              :title="`${message('slides.elementProperties.fontSize')} (${SLIDES_MANUAL_FONT_SIZE_PT.min}–${SLIDES_MANUAL_FONT_SIZE_PT.max} pt)`"
              :min="SLIDES_MANUAL_FONT_SIZE_PT.min"
              :max="SLIDES_MANUAL_FONT_SIZE_PT.max"
              step="any"
              :placeholder="textStyle?.fontSizePt === null ? message('slides.elementProperties.mixed') : undefined"
              :disabled="busy"
              @change="commitNumber('fontSize')"
              @keydown.enter.prevent="commitNumber('fontSize')"
              @keydown.alt.down.stop.prevent="toggle('fontSize', $event)"
              @keydown.esc.stop.prevent="cancelNumber('fontSize', $event); close()"
            />
            <ToolbarButton
              class="slides-element-property-toolbar__font-trigger"
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
                class="slides-element-property-toolbar__font-chevron"
              />
            </ToolbarButton>
          </div>
          <ToolbarButton
            v-for="style in emphasisStyles"
            :key="style.field"
            :data-property="style.field"
            :label="message(style.label)"
            :active="textStyle?.[style.field] === true"
            :aria-pressed="textStyle?.[style.field] === null ? 'mixed' : textStyle?.[style.field] === true"
            :disabled="busy"
            @click="submitTextStyle({ [style.field]: textStyle?.[style.field] !== true })"
          >
            <component
              :is="style.icon"
              class="slides-element-property-toolbar__icon"
            />
          </ToolbarButton>
          <ToolbarButton
            v-if="!textSelection"
            data-property="alignment"
            :label="message('slides.elementProperties.alignment')"
            :active="openPopover === 'alignment'"
            :aria-expanded="openPopover === 'alignment'"
            aria-haspopup="menu"
            :disabled="busy"
            @click="toggle('alignment', $event)"
          >
            <AlignIcon
              class="slides-element-property-toolbar__icon"
              :alignment="currentTextAlign"
            />
            <ChevronIcon
              direction="down"
              class="slides-element-property-toolbar__caret"
            />
          </ToolbarButton>
          <ToolbarColorButton
            kind="text"
            data-property="text"
            :label="message('slides.elementProperties.textColor')"
            :color="currentTextColor ?? 'transparent'"
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
        <slot
          v-if="!multiple && !readonly"
          name="object"
        />
        <ToolbarGroup v-if="!readonly && (showArrange || !multiple)">
          <ToolbarButton
            v-if="showArrange"
            data-property="arrange"
            :label="message('slides.elementProperties.arrange')"
            :active="openPopover === 'arrange'"
            :aria-expanded="openPopover === 'arrange'"
            aria-haspopup="menu"
            :disabled="busy"
            @click="toggle('arrange', $event)"
          >
            <ArrangeIcon class="slides-element-property-toolbar__icon" />
          </ToolbarButton>
          <ToolbarButton
            data-property="more"
            :label="message('slides.elementProperties.more')"
            :active="openPopover === 'more'"
            :aria-expanded="openPopover === 'more'"
            aria-haspopup="menu"
            :disabled="busy"
            @click="toggle('more', $event)"
          >
            <MoreIcon
              direction="horizontal"
              class="slides-element-property-toolbar__icon"
            />
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
        v-if="openPopover !== null && LIST_POPOVERS.has(openPopover) && position !== null"
        ref="fontMenu"
        class="slides-element-font-menu"
        :style="popoverStyle"
        @pointerdown.stop
        @keydown.stop
        @keydown.esc.stop.prevent="close(true)"
      >
        <!-- 整个工具条都属于内部点击，避免旧列表关闭刚打开的相邻属性；焦点归还由外层 BaseDropdown 负责。 -->
        <CustomSelect
          v-if="openPopover === 'fontSize'"
          :model-value="textStyle?.fontSizePt ?? undefined"
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
        <CustomSelect
          v-else
          :model-value="openPopover === 'alignment' ? `text-align:${currentTextAlign}` : null"
          :options="menuOptions"
          manual-mode
          semantic-role="menu"
          :external-trigger-ref="toolbar?.element ?? null"
          :trigger-aria-label="menuLabel"
          :options-motion-direction="popoverDirection"
          :class-names="{ options: 'slides-element-font-menu__options slides-element-property-menu' }"
          @update:model-value="selectMenuItem"
          @close="close()"
        />
      </div>
      <DropdownPanel
        :id="popoverId"
        ref="popover"
        :show="openPopover !== null && !LIST_POPOVERS.has(openPopover) && position !== null"
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
import { BoldIcon, ItalicIcon, UnderlineIcon, AlignIcon, ChevronIcon, DeleteIcon, ResizeIcon, LinnyaIcon, MoreIcon } from '@linnya/renderer-ui/icons';
import {
  AlignObjectsBottomIcon, AlignObjectsCenterIcon, AlignObjectsLeftIcon, AlignObjectsMiddleIcon, AlignObjectsRightIcon, AlignObjectsTopIcon,
  ArrangeIcon, DistributeHorizontalIcon, DistributeVerticalIcon,
} from '../../../shared/icons';
import { arrangeMenu, moreMenu, textAlignmentMenu } from '../functions/elementPropertyMenus';
import { SLIDES_MANUAL_FONT_SIZE_PT, type SlidesTextSelectionStyle, type SlidesTextStylePatch } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditableTarget } from '../../manualEditing';
import { preserveCanvasFocus } from '../../editingInteraction';
import type { ElementPropertyAnchor } from '../definitions/elementPropertyToolbar';
import type { ElementArrangement, ElementLayerAvailability, ElementLayerDirection, ElementPropertyMenuValue, ElementPropertyOperation } from '../definitions/elementPropertyTypes';
import { ELEMENT_FONT_SIZE_OPTIONS } from '../definitions/fontSizeOptions';
import { useElementPropertyFields } from '../orchestration/useElementPropertyFields';
import { useElementPropertyToolbar } from '../orchestration/useElementPropertyToolbar';
import { useElementPropertyLocalization } from './useElementPropertyLocalization';
import ElementColorControl from './ElementColorControl.vue';

const props = defineProps<{
  target: ManualEditableTarget;
  anchor: ElementPropertyAnchor;
  busy?: boolean;
  textSelection?: SlidesTextSelectionStyle;
  /** 选中对象可以交给 AI 时显示入口。 */
  ai?: boolean;
  /** 文稿暂时不能手动写入：只保留 AI 入口。 */
  readonly?: boolean;
  /** 多选时 target 是选区外框，浮条换成选区对齐、分布、更多与删除。 */
  selectionCount?: number;
  /** 所有选中对象都能移动时才提供排列。 */
  arrangeable?: boolean;
  /** 单选时的同级图层可用方向；null 表示不提供图层动作。 */
  layer?: ElementLayerAvailability | null;
  canCopy?: boolean;
}>();
const emit = defineEmits<{ submit: [operation: ElementPropertyOperation]; 'delete-selected': []; 'text-style': [patch: SlidesTextStylePatch]; ai: [];
  arrange: [action: ElementArrangement]; layer: [direction: ElementLayerDirection]; copy: []; duplicate: [] }>();
defineSlots<{ object?(): unknown }>();
const SELECTION_ALIGNMENTS = [
  { action: 'left', icon: AlignObjectsLeftIcon }, { action: 'center', icon: AlignObjectsCenterIcon }, { action: 'right', icon: AlignObjectsRightIcon },
  { action: 'top', icon: AlignObjectsTopIcon }, { action: 'middle', icon: AlignObjectsMiddleIcon }, { action: 'bottom', icon: AlignObjectsBottomIcon },
] as const;
const SELECTION_DISTRIBUTIONS = [
  { action: 'distributeX', icon: DistributeHorizontalIcon }, { action: 'distributeY', icon: DistributeVerticalIcon },
] as const;
const LIST_POPOVERS: ReadonlySet<string> = new Set(['fontSize', 'alignment', 'arrange', 'more']);
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
  anchor: toRef(props, 'anchor'),
  toolbarElement: computed(() => toolbar.value?.element ?? null), popoverElement: computed(() => fontMenu.value ?? popover.value?.element ?? null),
  auxiliaryElement: colorOverlay,
});
const { textStyle, fontSize, width, height, commitNumber, cancelNumber, submitTextColor, submitFillColor, submitTextStyle } = useElementPropertyFields({
  textSelection: toRef(props, 'textSelection'), submitTextSelection: patch => emit('text-style', patch),
  target: toRef(props, 'target'), busy: computed(() => props.busy === true), submit: operation => emit('submit', operation),
});
const emphasisStyles = [
  { field: 'bold', label: 'slides.elementProperties.bold', icon: BoldIcon },
  { field: 'italic', label: 'slides.elementProperties.italic', icon: ItalicIcon },
  { field: 'underline', label: 'slides.elementProperties.underline', icon: UnderlineIcon },
] as const;
const multiple = computed(() => (props.selectionCount ?? 1) > 1);
const currentTextAlign = computed(() => props.target.textEditing?.textAlign === 'center' ? 'center'
  : props.target.textEditing?.textAlign === 'right' ? 'right' : 'left');
const canEditTextStyle = computed(() => !props.readonly && !multiple.value && (props.textSelection !== undefined || props.target.capabilities.includes('set_text_style')));
const canEditFill = computed(() => !props.readonly && !multiple.value && props.textSelection === undefined && props.target.capabilities.includes('set_fill_color'));
const canEditSize = computed(() => !props.readonly && !multiple.value && props.textSelection === undefined && props.target.capabilities.includes('set_visual_size'));
const showArrange = computed(() => props.textSelection === undefined && !multiple.value && props.arrangeable === true);
const menuOptions = computed(() => openPopover.value === 'alignment' ? textAlignmentMenu(message)
  : openPopover.value === 'arrange' ? arrangeMenu(message, props.layer ?? null)
    : moreMenu(message, props.canCopy === true));
const menuLabel = computed(() => message(openPopover.value === 'alignment' ? 'slides.elementProperties.alignment'
  : openPopover.value === 'arrange' ? 'slides.elementProperties.arrange' : 'slides.elementProperties.more'));
function selectMenuItem(value: ElementPropertyMenuValue): void {
  close(true);
  if (value === 'copy') { emit('copy'); return; }
  if (value === 'duplicate') { emit('duplicate'); return; }
  const [kind, detail] = value.split(':');
  if (kind === 'text-align' && (detail === 'left' || detail === 'center' || detail === 'right')) submitTextStyle({ align: detail });
  else if (kind === 'layer' && (detail === 'front' || detail === 'forward' || detail === 'backward' || detail === 'back')) emit('layer', detail);
  else if (kind === 'arrange' && isArrangement(detail)) emit('arrange', detail);
}
function isArrangement(value: string | undefined): value is ElementArrangement {
  return SELECTION_ALIGNMENTS.some(item => item.action === value) || SELECTION_DISTRIBUTIONS.some(item => item.action === value);
}
const canDelete = computed(() => !props.readonly && props.textSelection === undefined && props.target.capabilities.includes('delete'));
const currentTextColor = computed(() => textStyle.value?.color ?? null);
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
