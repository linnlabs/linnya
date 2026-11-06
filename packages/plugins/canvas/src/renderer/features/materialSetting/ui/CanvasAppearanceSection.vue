<template>
  <div class="canvas-settings">
    <div class="canvas-settings-row">
      <div class="canvas-settings-text">
        <span class="canvas-settings-label">卡片材质</span>
        <span class="canvas-settings-description">纸：直角、贴地阴影；卡：圆角、细描边</span>
      </div>
      <CustomSelect
        :model-value="store.preferences.material"
        :options="materials"
        trigger-aria-label="卡片材质"
        min-width="120px"
        @update:model-value="setMaterial"
      />
    </div>
    <div class="canvas-settings-row">
      <div class="canvas-settings-text">
        <span class="canvas-settings-label">远景显示</span>
        <span class="canvas-settings-description">缩小到看不清正文时，卡片上显示什么</span>
      </div>
      <CustomSelect
        :model-value="store.preferences.overview"
        :options="overviews"
        trigger-aria-label="远景显示"
        min-width="120px"
        @update:model-value="setOverview"
      />
    </div>
    <div class="canvas-settings-row">
      <div class="canvas-settings-text">
        <span class="canvas-settings-label">滚轮缩放</span>
        <span class="canvas-settings-description">关闭时滚轮平移画布；触控板捏合始终缩放</span>
      </div>
      <Switch
        :model-value="store.preferences.wheelZoom"
        v-bind="{ ariaLabel: '滚轮缩放' }"
        @update:model-value="setToggle('wheelZoom', $event)"
      />
    </div>
    <div class="canvas-settings-row">
      <div class="canvas-settings-text">
        <span class="canvas-settings-label">拖动吸附</span>
        <span class="canvas-settings-description">拖动时对齐其他卡片；按住 Alt 临时关闭</span>
      </div>
      <Switch
        :model-value="store.preferences.snapping"
        v-bind="{ ariaLabel: '拖动吸附' }"
        @update:model-value="setToggle('snapping', $event)"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { CustomSelect, Switch } from '@linnya/renderer-ui';
import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';
import { CanvasPreferencesSchema } from '../definitions/canvasPreferences';
const store = useCanvasPreferencesStore();
const materials = [
  { value: 'paper', text: '纸' },
  { value: 'card', text: '卡' },
];
const overviews = [
  { value: 'titles', text: '大标题' },
  { value: 'thumbnails', text: '内容缩略图' },
];
const setMaterial = (value: string | number | boolean) =>
  store.replace(CanvasPreferencesSchema.parse({ ...store.preferences, material: value }));
const setOverview = (value: string | number | boolean) =>
  store.replace(CanvasPreferencesSchema.parse({ ...store.preferences, overview: value }));
const setToggle = (key: 'wheelZoom' | 'snapping', value: boolean) =>
  store.replace(
    CanvasPreferencesSchema.parse({
      ...store.preferences,
      [key]: value,
      ...(key === 'wheelZoom' ? { wheelSuggestionSeen: true } : {}),
    })
  );
</script>
