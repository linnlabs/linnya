<template>
  <FloatingToolbar
    :show="true"
    :position="position"
    class="canvas-selection-bar"
    role="toolbar"
    :aria-label="`已选 ${count} 张卡片`"
    @pointerdown.stop
  >
    <ToolbarGroup>
      <ToolbarButton
        class="canvas-selection-ai"
        label="加入对话"
        data-linnya-tooltip="加入对话 (⌘K)"
        @click="emit('converse')"
      >
        <LinnyaIcon />
        <span>AI</span>
      </ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup v-if="count > 1">
      <span class="canvas-selection-count">已选 {{ count }} 张</span>
    </ToolbarGroup>
    <ToolbarGroup>
      <ToolbarButton label="编辑或打开" data-linnya-tooltip="编辑或打开 (↩)" @click="emit('edit')">
        <EditIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="image"
        label="编辑图片"
        data-linnya-tooltip="编辑图片：裁剪、图注、替换"
        :disabled="readonly || imageLocked"
        @click="emit('editImage')"
      >
        <ImageIcon />
      </ToolbarButton>
      <ToolbarButton
        label="创建副本"
        data-linnya-tooltip="创建副本 (⌘D)"
        :disabled="readonly"
        @click="emit('duplicate')"
      >
        <DuplicateIcon />
      </ToolbarButton>
      <ToolbarButton
        v-if="count === 2"
        label="连接两张卡"
        :disabled="readonly"
        @click="emit('connect')"
      >
        <LinkIcon />
      </ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup>
      <CanvasToolbarMenu
        label="卡片颜色"
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
        label="更多卡片操作"
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
  LinkIcon,
  LinnyaIcon,
  MoreIcon,
} from '@linnya/renderer-ui/icons';
import type { CanvasColor } from '@plugin/canvas/shared';
import { canvasColorSwatchOptions } from '../functions/canvasColorMenuOptions';
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
