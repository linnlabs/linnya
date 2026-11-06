<template>
  <div class="canvas-appearance-section">
    <label
      >材质
      <CustomSelect
        :model-value="store.preferences.material"
        :options="materials"
        @update:model-value="setMaterial"
    /></label>
    <label
      ><input
        type="checkbox"
        :checked="store.preferences.wheelZoom"
        @change="setToggle('wheelZoom', $event)"
      />滚轮缩放（关闭时平移，捏合仍缩放）</label
    >
    <label
      ><input
        type="checkbox"
        :checked="store.preferences.snapping"
        @change="setToggle('snapping', $event)"
      />拖动吸附（按住 Alt 临时关闭）</label
    >
    <label
      >远景
      <CustomSelect
        :model-value="store.preferences.overview"
        :options="overviews"
        @update:model-value="setOverview"
    /></label>
  </div>
</template>
<script setup lang="ts">
import { CustomSelect } from '@linnya/renderer-ui';
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
const setToggle = (key: 'wheelZoom' | 'snapping', event: Event) => {
  if (event.target instanceof HTMLInputElement)
    store.replace(
      CanvasPreferencesSchema.parse({
        ...store.preferences,
        [key]: event.target.checked,
        ...(key === 'wheelZoom' ? { wheelSuggestionSeen: true } : {}),
      })
    );
};
</script>
