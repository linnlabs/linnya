<script setup lang="ts">
import { ref } from 'vue';
import {
  DraggablePanel,
  FloatingToolbar,
  ToolbarButton,
  ToolbarColorButton,
  ToolbarGroup,
} from '@linnya/renderer-ui';
import {
  BoldIcon,
  BulletListIcon,
  CommentAddIcon,
  HeadingIcon,
  ItalicIcon,
  LinkIcon,
  LinnyaIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikethroughIcon,
  TextAlignIcon,
  UnderlineIcon,
} from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const bold = ref(true);
const italic = ref(false);
const underline = ref(false);
const panelVisible = ref(true);
const TOOLBAR_POSITION = Object.freeze({ top: 16, left: 16 });
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="浮动工具条" note="分组之间的分隔线到相邻控件各 6px；Editor 选区工具条与 Slides 对象属性共用。">
      <GalleryRow label="文本格式" align="start">
        <div class="toolbars__stage">
          <FloatingToolbar :show="true" :position="TOOLBAR_POSITION" aria-label="文本格式">
            <ToolbarGroup>
              <ToolbarButton label="Linnya 改写"><LinnyaIcon /></ToolbarButton>
              <ToolbarButton label="批注"><CommentAddIcon /></ToolbarButton>
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton label="标题"><HeadingIcon /></ToolbarButton>
              <ToolbarButton label="加粗" :active="bold" @click="bold = !bold"><BoldIcon /></ToolbarButton>
              <ToolbarButton label="斜体" :active="italic" @click="italic = !italic"><ItalicIcon /></ToolbarButton>
              <ToolbarButton label="下划线" :active="underline" @click="underline = !underline"><UnderlineIcon /></ToolbarButton>
              <ToolbarButton label="删除线" disabled><StrikethroughIcon /></ToolbarButton>
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarColorButton label="文字颜色" kind="text" color="var(--block-text-red, var(--color-error))" :expanded="false" />
              <ToolbarColorButton label="背景颜色" kind="background" color="var(--color-accent-bg)" :expanded="true" />
            </ToolbarGroup>
            <ToolbarGroup>
              <ToolbarButton label="无序列表"><BulletListIcon /></ToolbarButton>
              <ToolbarButton label="有序列表"><NumberedListIcon /></ToolbarButton>
              <ToolbarButton label="引用"><QuoteIcon /></ToolbarButton>
              <ToolbarButton label="对齐"><TextAlignIcon alignment="left" /></ToolbarButton>
              <ToolbarButton label="链接"><LinkIcon /></ToolbarButton>
            </ToolbarGroup>
          </FloatingToolbar>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="可拖拽面板" note="编辑器、画布里的浮层；拖动标题栏移动，右下角调整大小。">
      <div class="toolbars__panel-stage">
        <DraggablePanel
          :visible="panelVisible"
          width="360px"
          height="200px"
          initial-position="top-left"
          @close="panelVisible = false"
        >
          <template #title>查找与替换</template>
          <p class="toolbars__panel-text">在当前文档里查找“路线图”，共 4 处。</p>
        </DraggablePanel>
        <button v-if="!panelVisible" type="button" class="toolbars__reopen" @click="panelVisible = true">重新打开面板</button>
      </div>
    </GalleryBlock>
  </div>
</template>

<style>
.toolbars__stage {
  position: relative;
  width: 100%;
  max-width: 720px; /* scale-exempt: 版面尺寸 */
  height: 72px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-subtle);
}

/* transform 让 fixed 定位的面板以舞台为参照。 */
.toolbars__panel-stage {
  position: relative;
  transform: translateZ(0);
  max-width: 720px; /* scale-exempt: 版面尺寸 */
  height: 280px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-subtle);
}

.toolbars__panel-text {
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-secondary);
}

.toolbars__reopen {
  margin: var(--space-4);
  color: var(--color-text-link);
}
</style>
