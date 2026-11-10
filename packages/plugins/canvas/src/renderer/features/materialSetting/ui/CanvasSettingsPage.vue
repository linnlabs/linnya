<template>
  <!-- 设置壳“文档与插件”分组里的独立页面；件套不对插件开放，页面与分区按件套同一版式排。 -->
  <div class="canvas-settings-page">
    <section class="canvas-settings-section">
      <h3 class="canvas-settings-heading">{{ t('canvas.settings.cards') }}</h3>
      <div class="canvas-settings">
        <div class="canvas-settings-row is-field">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">{{ t('canvas.settings.shape') }}</span>
            <span class="canvas-settings-description">{{ t('canvas.settings.shapeHint') }}</span>
          </div>
          <div class="canvas-settings-control">
            <CustomSelect
              :model-value="store.preferences.material"
              :options="materials"
              :trigger-aria-label="t('canvas.settings.shape')"
              font-size="14px"
              show-selected-checkmark
              @update:model-value="setMaterial"
            />
          </div>
        </div>
        <div class="canvas-settings-row is-field">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">{{ t('canvas.settings.overview') }}</span>
            <span class="canvas-settings-description">{{ t('canvas.settings.overviewHint') }}</span>
          </div>
          <div class="canvas-settings-control">
            <CustomSelect
              :model-value="store.preferences.overview"
              :options="overviews"
              :trigger-aria-label="t('canvas.settings.overview')"
              font-size="14px"
              show-selected-checkmark
              @update:model-value="setOverview"
            />
          </div>
        </div>
      </div>
    </section>
    <section class="canvas-settings-section">
      <h3 class="canvas-settings-heading">{{ t('canvas.settings.controls') }}</h3>
      <div class="canvas-settings">
        <div class="canvas-settings-row is-end">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">{{ t('canvas.settings.wheelZoom') }}</span>
            <span class="canvas-settings-description">{{
              t('canvas.settings.wheelZoomHint')
            }}</span>
          </div>
          <Switch
            :model-value="store.preferences.wheelZoom"
            v-bind="{ ariaLabel: t('canvas.settings.wheelZoom') }"
            @update:model-value="setToggle('wheelZoom', $event)"
          />
        </div>
        <div class="canvas-settings-row is-end">
          <div class="canvas-settings-text">
            <span class="canvas-settings-label">{{ t('canvas.settings.snapping') }}</span>
            <span class="canvas-settings-description">{{ t('canvas.settings.snappingHint') }}</span>
          </div>
          <Switch
            :model-value="store.preferences.snapping"
            v-bind="{ ariaLabel: t('canvas.settings.snapping') }"
            @update:model-value="setToggle('snapping', $event)"
          />
        </div>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { CustomSelect, Switch } from '@linnya/renderer-ui';
import { canvasText as t } from '../../localization';
import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';
import { CanvasPreferencesSchema } from '../definitions/canvasPreferences';
const store = useCanvasPreferencesStore();
const materials = computed(() => [
  { value: 'card', text: t('canvas.settings.rounded') },
  { value: 'paper', text: t('canvas.settings.square') },
]);
const overviews = computed(() => [
  { value: 'titles', text: t('canvas.settings.titles') },
  { value: 'thumbnails', text: t('canvas.settings.thumbnails') },
]);
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
