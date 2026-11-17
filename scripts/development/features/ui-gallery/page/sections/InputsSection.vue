<script setup lang="ts">
import { ref } from 'vue';
import {
  CustomNumberInput,
  CustomSlider,
  CustomTextarea,
  CustomTextInput,
  InlineTextInput,
  SecretInput,
} from '@linnya/renderer-ui';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const name = ref('季度复盘');
const empty = ref('');
const search = ref('路线图');
const location = ref('');
const note = ref('这份路线图需要按季度拆开，第一页放目标，第二页放里程碑。');
const growing = ref('随内容增高，到最大高度后在内部滚动。');
const apiKey = ref('sk-gallery-example');
const fontSize = ref<number | string>(14);
const lineHeight = ref<number | string>(1.5);
const zoom = ref(64);
const opacity = ref(30);
const renameDraft = ref('产品路线图.canvas');
const labelDraft = ref('依赖');
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="单行输入" note="焦点只改变边框颜色，不加外扩阴影。">
      <GalleryRow label="默认">
        <CustomTextInput v-model="name" class="gallery-field" placeholder="名称" />
        <CustomTextInput v-model="empty" class="gallery-field" placeholder="输入项目名称" />
      </GalleryRow>
      <GalleryRow label="紧凑">
        <CustomTextInput v-model="name" class="gallery-field" size="compact" placeholder="名称" />
      </GalleryRow>
      <GalleryRow label="可清除搜索">
        <CustomTextInput v-model="search" class="gallery-field" type="search" clearable placeholder="搜索文件名和正文" />
      </GalleryRow>
      <GalleryRow label="无边框">
        <CustomTextInput v-model="location" class="gallery-field" size="compact" :bordered="false" placeholder="+ 所在地" />
      </GalleryRow>
      <GalleryRow label="禁用">
        <CustomTextInput model-value="只读内容" class="gallery-field" disabled />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="密文与多行">
      <GalleryRow label="SecretInput">
        <SecretInput v-model="apiKey" class="gallery-field" placeholder="请输入 API Key" />
        <SecretInput class="gallery-field" placeholder="请输入 API Key" disabled />
      </GalleryRow>
      <GalleryRow label="CustomTextarea" align="start">
        <CustomTextarea v-model="note" class="gallery-field" placeholder="说明" />
        <CustomTextarea v-model="growing" class="gallery-field" auto-grow :auto-grow-min-height="32" :auto-grow-max-height="120" placeholder="自动增高" />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="数值">
      <GalleryRow label="CustomNumberInput">
        <CustomNumberInput v-model="fontSize" label="字号" :min="8" :max="72" :step="1" show-spin-buttons />
        <CustomNumberInput v-model="lineHeight" label="行距" :min="1" :max="3" :step="0.1" />
      </GalleryRow>
      <GalleryRow label="CustomSlider">
        <div class="gallery-field gallery-stack">
          <CustomSlider v-model="zoom" aria-label="缩放" />
          <CustomSlider v-model="opacity" variant="compact" aria-label="透明度" />
          <CustomSlider :model-value="50" disabled aria-label="不可调整" />
        </div>
        <span class="gallery-caption">{{ zoom }}% · {{ opacity }}%</span>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="原位编辑" note="点一下才出现、改完就消失的短文本编辑。">
      <GalleryRow label="inline">
        <div class="inputs__row">
          <DocumentIcon class="inputs__row-icon" />
          <InlineTextInput v-model="renameDraft" :autofocus="false" aria-label="重命名" />
        </div>
      </GalleryRow>
      <GalleryRow label="floating">
        <div class="inputs__canvas">
          <InlineTextInput v-model="labelDraft" variant="floating" :autofocus="false" aria-label="连线标签" />
        </div>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style>
.inputs__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 280px; /* scale-exempt: 版面尺寸 */
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  background-color: var(--color-bg-hover);
}

.inputs__row-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.inputs__canvas {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 280px; /* scale-exempt: 版面尺寸 */
  height: 96px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-subtle);
}
</style>
