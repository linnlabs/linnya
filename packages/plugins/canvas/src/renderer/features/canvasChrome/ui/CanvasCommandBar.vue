<template>
  <div class="canvas-command-dock">
    <div class="canvas-command-bar" role="toolbar" aria-label="画布命令" @pointerdown.stop>
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="撤销"
          data-linnya-tooltip="撤销 (⌘Z)"
          :disabled="readonly"
          @click="emit('undo')"
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="重做"
          data-linnya-tooltip="重做 (⇧⌘Z)"
          :disabled="readonly"
          @click="emit('redo')"
        >
          <RedoIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="新建文字卡"
          :disabled="readonly"
          @click="emit('createText')"
        >
          <TextIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="添加文档"
          :disabled="readonly"
          @click="emit('addDocument')"
        >
          <DocumentAddIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="添加图片"
          :disabled="readonly"
          @click="emit('addImage')"
        >
          <ImageIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          label="搜索画布"
          data-linnya-tooltip="搜索画布 (⌘F)"
          @click="emit('search')"
        >
          <SearchIcon />
        </ToolbarButton>
        <slot name="layout" />
      </ToolbarGroup>
      <span
        v-if="!readonly"
        class="canvas-save-status"
        :class="`is-${saveStatus}`"
        role="status"
        aria-live="polite"
      >
        <CheckmarkIcon v-if="saveStatus === 'saved'" class="canvas-save-status-icon" /><span
          class="canvas-save-status-text"
          >{{ saveStatusText[saveStatus] }}</span
        >
      </span>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import { toRef } from 'vue';
import {
  CheckmarkIcon,
  DocumentAddIcon,
  ImageIcon,
  RedoIcon,
  SearchIcon,
  TextIcon,
  UndoIcon,
} from '@linnya/renderer-ui/icons';

import { useCanvasSaveStatus, type CanvasSaveStatus } from '../orchestration/useCanvasSaveStatus';

/**
 * 画布顶部命令条，与 Slides 编辑命令条同一组织：撤销重做、插入、画布命令，末尾是保存状态。
 * 缩放与 Slides 一样不在顶部，见 CanvasZoomControls。只发出命令，执行与错误归页面编排。
 */
const props = defineProps<{ readonly: boolean; saving: boolean; unsaved: boolean }>();
const saveStatus = useCanvasSaveStatus(toRef(props, 'saving'), toRef(props, 'unsaved'));
const saveStatusText: Record<CanvasSaveStatus, string> = {
  saved: '已保存',
  saving: '正在保存…',
  failed: '尚有未保存的修改',
};
const emit = defineEmits<{
  undo: [];
  redo: [];
  createText: [];
  addDocument: [];
  addImage: [];
  search: [];
}>();
defineSlots<{ layout(): unknown }>();
</script>
