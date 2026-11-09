<template>
  <!-- 设置壳“文档与插件”分组里的独立页面；件套不对插件开放，页面与分区按件套同一版式排。 -->
  <div class="canvas-settings-page">
    <section class="canvas-settings-section">
      <h3 class="canvas-settings-heading">卡片</h3>
      <div class="canvas-settings">
        <div class="canvas-settings-row is-field">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">卡片形状</span>
            <span class="canvas-settings-description"
              >圆角：细描边、轻投影；直角：无描边、贴地阴影</span
            >
          </div>
          <div class="canvas-settings-control">
            <CustomSelect
              :model-value="store.preferences.material"
              :options="materials"
              trigger-aria-label="卡片形状"
              font-size="14px"
              show-selected-checkmark
              @update:model-value="setMaterial"
            />
          </div>
        </div>
        <div class="canvas-settings-row is-field">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">远景显示</span>
            <span class="canvas-settings-description">缩小到看不清正文时，卡片上显示什么</span>
          </div>
          <div class="canvas-settings-control">
            <CustomSelect
              :model-value="store.preferences.overview"
              :options="overviews"
              trigger-aria-label="远景显示"
              font-size="14px"
              show-selected-checkmark
              @update:model-value="setOverview"
            />
          </div>
        </div>
      </div>
    </section>
    <section class="canvas-settings-section">
      <h3 class="canvas-settings-heading">操作</h3>
      <div class="canvas-settings">
        <div class="canvas-settings-row is-end">
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
        <div class="canvas-settings-row is-end">
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
    </section>
  </div>
</template>
<script setup lang="ts">
import { CustomSelect, Switch } from '@linnya/renderer-ui';
import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';
import { CanvasPreferencesSchema } from '../definitions/canvasPreferences';
const store = useCanvasPreferencesStore();
const materials = [
  { value: 'card', text: '圆角' },
  { value: 'paper', text: '直角' },
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
