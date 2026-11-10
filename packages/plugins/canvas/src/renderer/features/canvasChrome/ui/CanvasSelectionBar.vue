<template>
  <FloatingToolbar
    :show="true"
    :position="position"
    class="canvas-selection-bar"
    role="toolbar"
    :aria-label="t('canvas.selection.label', { count })"
    @pointerdown.stop
  >
    <ToolbarGroup>
      <ToolbarButton
        class="canvas-toolbar-button canvas-selection-ai"
        :label="t('canvas.selection.converse')"
        :data-linnya-tooltip="`${t('canvas.selection.converse')} (⌘K)`"
        @click="emit('converse')"
      >
        <LinnyaIcon />
        <span>AI</span>
      </ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup v-if="count > 1">
      <span class="canvas-selection-count">{{ t('canvas.selection.count', { count }) }}</span>
    </ToolbarGroup>
    <ToolbarGroup>
      <ToolbarButton
        class="canvas-toolbar-button"
        :label="t('canvas.selection.edit')"
        :data-linnya-tooltip="`${t('canvas.selection.edit')} (↩)`"
        @click="emit('edit')"
      >
        <EditIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="image"
        class="canvas-toolbar-button"
        :label="t('canvas.selection.editImage')"
        :data-linnya-tooltip="t('canvas.selection.editImageTip')"
        :disabled="readonly || imageLocked"
        @click="emit('editImage')"
      >
        <ImageIcon />
      </ToolbarButton>
      <ToolbarButton
        class="canvas-toolbar-button"
        :label="t('canvas.selection.duplicate')"
        :data-linnya-tooltip="`${t('canvas.selection.duplicate')} (⌘D)`"
        :disabled="readonly"
        @click="emit('duplicate')"
      >
        <DuplicateIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="count === 2"
        class="canvas-toolbar-button"
        :label="t('canvas.selection.connect')"
        :disabled="readonly"
        @click="emit('connect')"
      >
        <ConnectorIcon />
      </ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup>
      <CanvasToolbarMenu
        v-if="colorable"
        :label="t('canvas.selection.color')"
        :options="colorOptions"
        :model-value="color"
        :show-selected-checkmark="true"
        :disabled="readonly"
        min-width="140px"
        @select="emit('color', $event)"
      >
        <CanvasColorSwatch :color="color" />
      </CanvasToolbarMenu>
      <CanvasToolbarMenu
        :label="t('canvas.selection.more')"
        :options="moreActions"
        :disabled="readonly"
        min-width="170px"
        align="end"
        :arrow="false"
        @select="emit('action', $event)"
      >
        <MoreIcon />
      </CanvasToolbarMenu>
    </ToolbarGroup>
  </FloatingToolbar>
</template>
<script setup lang="ts">
import { computed, type CSSProperties } from 'vue';
import {
  FloatingToolbar,
  ToolbarButton,
  ToolbarGroup,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import {
  DuplicateIcon,
  EditIcon,
  ImageIcon,
  LinnyaIcon,
  MoreIcon,
} from '@linnya/renderer-ui/icons';
import ConnectorIcon from '../../../icon/ConnectorIcon.vue';
import type { CanvasColor } from '@plugin/canvas/shared';
import { canvasColorSwatchOptions } from '../functions/canvasColorMenuOptions';
import { canvasText as t } from '../../localization';
import CanvasColorSwatch from './CanvasColorSwatch.vue';
import CanvasToolbarMenu from './CanvasToolbarMenu.vue';

/** 选区浮条：位置由画布投影给出，命令执行归页面编排。 */
const props = defineProps<{
  placement: CSSProperties;
  count: number;
  color: CanvasColor;
  colors: readonly { readonly color: CanvasColor; readonly text: string }[];
  moreActions: readonly CustomSelectOption<string>[];
  readonly: boolean;
  image: boolean;
  imageLocked: boolean;
  /** 选区里有可染色的卡；纯图片选区不给颜色：图片铺满纸面，纸色看不见。 */
  colorable: boolean;
}>();
const emit = defineEmits<{
  converse: [];
  edit: [];
  editImage: [];
  duplicate: [];
  connect: [];
  color: [value: CanvasColor];
  action: [value: string];
}>();
const colorOptions = computed(() => canvasColorSwatchOptions(props.colors));
const pixels = (value: CSSProperties['left']) =>
  typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : 0;
const position = computed(() => ({
  top: pixels(props.placement.top),
  left: pixels(props.placement.left),
}));
</script>
