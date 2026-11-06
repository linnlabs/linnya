<template>
  <div class="canvas-command-dock">
    <FloatingToolbar
      :show="true"
      :position="{ top: 0, left: 0 }"
      class="canvas-command-bar"
      role="toolbar"
      aria-label="画布命令"
      @pointerdown.stop
    >
      <ToolbarGroup>
        <ToolbarButton
          label="撤销"
          data-linnya-tooltip="撤销 (⌘Z)"
          :disabled="readonly"
          @click="emit('undo')"
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          label="重做"
          data-linnya-tooltip="重做 (⇧⌘Z)"
          :disabled="readonly"
          @click="emit('redo')"
        >
          <RedoIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="新建文字卡" :disabled="readonly" @click="emit('createText')">
          <TextIcon />
        </ToolbarButton>
        <ToolbarButton label="添加文档" :disabled="readonly" @click="emit('addDocument')">
          <DocumentAddIcon />
        </ToolbarButton>
        <ToolbarButton label="添加图片" :disabled="readonly" @click="emit('addImage')">
          <ImageIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="搜索画布" data-linnya-tooltip="搜索画布 (⌘F)" @click="emit('search')">
          <SearchIcon />
        </ToolbarButton>
        <slot name="layout" />
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton label="显示全部" data-linnya-tooltip="显示全部 (⌘1)" @click="emit('fit')">
          <FullscreenIcon />
        </ToolbarButton>
        <ToolbarButton
          label="缩小"
          data-linnya-tooltip="缩小 (⌘−)"
          @click="emit('zoom', zoom / 1.25)"
        >
          <ZoomOutIcon />
        </ToolbarButton>
        <CustomSelect
          :model-value="zoom"
          :options="zoomOptions"
          :placeholder="`${Math.round(zoom * 100)}%`"
          trigger-aria-label="画布缩放比例"
          min-width="72px"
          variant="minimal"
          :bordered="false"
          class="canvas-zoom-select"
          @update:model-value="emit('zoom', $event)"
        />
        <ToolbarButton
          label="放大"
          data-linnya-tooltip="放大 (⌘+)"
          @click="emit('zoom', zoom * 1.25)"
        >
          <ZoomInIcon />
        </ToolbarButton>
      </ToolbarGroup>
    </FloatingToolbar>
  </div>
</template>
<script setup lang="ts">
import {
  CustomSelect,
  FloatingToolbar,
  ToolbarButton,
  ToolbarGroup,
  type CustomSelectOption,
} from '@linnya/renderer-ui';
import {
  DocumentAddIcon,
  FullscreenIcon,
  ImageIcon,
  RedoIcon,
  SearchIcon,
  TextIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@linnya/renderer-ui/icons';

/** 画布顶部命令条：只发出命令，执行与错误归页面编排。 */
defineProps<{ readonly: boolean; zoom: number }>();
const emit = defineEmits<{
  undo: [];
  redo: [];
  createText: [];
  addDocument: [];
  addImage: [];
  search: [];
  fit: [];
  zoom: [value: number];
}>();
defineSlots<{ layout(): unknown }>();
const zoomOptions: readonly CustomSelectOption<number>[] = [
  { value: 0.1, text: '10%' },
  { value: 0.25, text: '25%' },
  { value: 0.5, text: '50%' },
  { value: 0.75, text: '75%' },
  { value: 1, text: '100%', shortcut: '⌘0' },
  { value: 1.5, text: '150%' },
  { value: 2, text: '200%' },
  { value: 4, text: '400%' },
];
</script>
