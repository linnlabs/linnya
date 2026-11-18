<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CustomCheckbox } from '@linnya/renderer-ui';
import { BUILT_IN_RENDERER_UI_THEMES, type RendererUiTheme } from '@linnya/renderer-ui/theme';
import type { GallerySectionId } from '../definitions/gallerySections.ts';
import { createEmbeddedGallerySearch } from '../functions/galleryLocation.ts';
import { isGalleryEmbedHeightMessage } from '../orchestration/galleryDocument.ts';

interface SchemeChoice {
  readonly id: string;
  readonly label: string;
}

const props = defineProps<{
  readonly section: GallerySectionId;
  readonly schemes: readonly SchemeChoice[];
  readonly selectedSchemes: readonly string[];
  readonly selectedThemes: readonly RendererUiTheme[];
  readonly themeLabels: Readonly<Record<RendererUiTheme, string>>;
}>();

const emit = defineEmits<{
  'update:selectedSchemes': [value: string[]];
  'update:selectedThemes': [value: RendererUiTheme[]];
}>();

const frameHeights = ref<Record<string, number>>({});
const frames = new Map<string, HTMLIFrameElement>();

const rows = computed(() => props.schemes.filter(scheme => props.selectedSchemes.includes(scheme.id)));
const columns = computed(() =>
  BUILT_IN_RENDERER_UI_THEMES.filter(theme => props.selectedThemes.includes(theme))
);
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${Math.max(columns.value.length, 1)}, minmax(520px, 1fr))`,
}));

function cellKey(scheme: string, theme: RendererUiTheme): string {
  return `${scheme}:${theme}`;
}

function cellSource(scheme: string, theme: RendererUiTheme): string {
  return `${window.location.pathname}${createEmbeddedGallerySearch(props.section, theme, scheme)}`;
}

function registerFrame(key: string, element: unknown) {
  if (element instanceof HTMLIFrameElement) frames.set(key, element);
  else frames.delete(key);
}

function toggle<T extends string>(list: readonly T[], value: T, checked: boolean): T[] {
  if (checked) return list.includes(value) ? [...list] : [...list, value];
  const next = list.filter(item => item !== value);
  return next.length > 0 ? next : [...list];
}

function receiveHeight(event: MessageEvent) {
  if (event.origin !== window.location.origin || !isGalleryEmbedHeightMessage(event.data)) return;
  for (const [key, frame] of frames) {
    if (frame.contentWindow === event.source) {
      frameHeights.value = { ...frameHeights.value, [key]: event.data.height };
    }
  }
}

onMounted(() => window.addEventListener('message', receiveHeight));
onBeforeUnmount(() => window.removeEventListener('message', receiveHeight));
</script>

<template>
  <div class="gallery-compare">
    <div class="gallery-compare__pickers">
      <div class="gallery-compare__picker">
        <span class="gallery-row__label">方案</span>
        <CustomCheckbox
          v-for="scheme in schemes"
          :key="scheme.id"
          :model-value="selectedSchemes.includes(scheme.id)"
          @update:model-value="checked => emit('update:selectedSchemes', toggle(selectedSchemes, scheme.id, checked === true))"
        >
          {{ scheme.label }}
        </CustomCheckbox>
      </div>
      <div class="gallery-compare__picker">
        <span class="gallery-row__label">主题</span>
        <CustomCheckbox
          v-for="theme in BUILT_IN_RENDERER_UI_THEMES"
          :key="theme"
          :model-value="selectedThemes.includes(theme)"
          @update:model-value="checked => emit('update:selectedThemes', toggle(selectedThemes, theme, checked === true))"
        >
          {{ themeLabels[theme] }}
        </CustomCheckbox>
      </div>
    </div>
    <div class="gallery-compare__grid" :style="gridStyle">
      <template v-for="scheme in rows" :key="scheme.id">
        <div v-for="theme in columns" :key="cellKey(scheme.id, theme)" class="gallery-compare__cell">
          <span class="gallery-caption">{{ scheme.label }} · {{ themeLabels[theme] }}</span>
          <iframe
            :ref="element => registerFrame(cellKey(scheme.id, theme), element)"
            class="gallery-compare__frame"
            :title="`${scheme.label} · ${themeLabels[theme]}`"
            :src="cellSource(scheme.id, theme)"
            :style="{ height: frameHeights[cellKey(scheme.id, theme)] ? `${frameHeights[cellKey(scheme.id, theme)]}px` : undefined }"
          />
        </div>
      </template>
    </div>
  </div>
</template>
