<template>
  <div class="canvas-command-dock">
    <div
      class="canvas-command-bar"
      role="toolbar"
      :aria-label="t('canvas.command.label')"
      @pointerdown.stop
    >
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.undo')"
          :data-linnya-tooltip="`${t('canvas.command.undo')} (⌘Z)`"
          :disabled="readonly"
          @click="emit('undo')"
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.redo')"
          :data-linnya-tooltip="`${t('canvas.command.redo')} (⇧⌘Z)`"
          :disabled="readonly"
          @click="emit('redo')"
        >
          <RedoIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.createText')"
          :disabled="readonly"
          @click="emit('createText')"
        >
          <TextIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.addDocument')"
          :disabled="readonly"
          @click="emit('addDocument')"
        >
          <DocumentAddIcon />
        </ToolbarButton>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.addImage')"
          :disabled="readonly"
          @click="emit('addImage')"
        >
          <ImageIcon />
        </ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolbarButton
          class="canvas-toolbar-button"
          :label="t('canvas.command.search')"
          :data-linnya-tooltip="`${t('canvas.command.search')} (⌘F)`"
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
          >{{ t(`canvas.save.${saveStatus}`) }}</span
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

import { canvasText as t } from '../../localization';
import { useCanvasSaveStatus } from '../orchestration/useCanvasSaveStatus';

/**
 * 画布顶部命令条，与 Slides 编辑命令条同一组织：撤销重做、插入、画布命令，末尾是保存状态。
 * 缩放与 Slides 一样不在顶部，见 CanvasZoomControls。只发出命令，执行与错误归页面编排。
 */
const props = defineProps<{ readonly: boolean; saving: boolean; unsaved: boolean }>();
const saveStatus = useCanvasSaveStatus(toRef(props, 'saving'), toRef(props, 'unsaved'));
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
