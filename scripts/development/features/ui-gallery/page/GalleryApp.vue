<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import {
  BaseButton,
  CustomSelect,
  SegmentedTabs,
  useHoverTooltipService,
  type CustomSelectOption,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import {
  BUILT_IN_RENDERER_UI_THEMES,
  isRendererUiTheme,
  type RendererUiTheme,
} from '@linnya/renderer-ui/theme';
import { defaultGallerySchemeId, gallerySchemes } from 'virtual:linnya-ui-gallery-schemes';
import { CURRENT_GALLERY_SCHEME_ID } from '../definitions/galleryScheme.ts';
import { GALLERY_SECTIONS, type GallerySectionId } from './definitions/gallerySections.ts';
import {
  parseGalleryLocation,
  serializeGalleryLocation,
  type GalleryLocation,
} from './functions/galleryLocation.ts';
import {
  applyGalleryTheme,
  installGallerySchemeStyle,
  reportEmbedHeight,
} from './orchestration/galleryDocument.ts';
import ButtonsSection from './sections/ButtonsSection.vue';
import CandidatesSection from './sections/CandidatesSection.vue';
import DialogsSection from './sections/DialogsSection.vue';
import DocumentTopSection from './sections/DocumentTopSection.vue';
import FeedbackSection from './sections/FeedbackSection.vue';
import FormExampleSection from './sections/FormExampleSection.vue';
import FoundationsSection from './sections/FoundationsSection.vue';
import IconsSection from './sections/IconsSection.vue';
import InputsSection from './sections/InputsSection.vue';
import ListExampleSection from './sections/ListExampleSection.vue';
import MenusSection from './sections/MenusSection.vue';
import SelectionSection from './sections/SelectionSection.vue';
import ToolbarsSection from './sections/ToolbarsSection.vue';
import GalleryCompare from './ui/GalleryCompare.vue';

useHoverTooltipService();

const THEME_LABELS: Readonly<Record<RendererUiTheme, string>> = {
  light: '浅色',
  dark: '深色',
  'moon-blue': '月白蓝',
};

/** 对话框分区单独渲染，因为只有它接收“直接打开某个浮层”的参数。 */
const SECTION_COMPONENTS: Readonly<Record<Exclude<GallerySectionId, 'dialogs'>, Component>> = {
  foundations: FoundationsSection,
  buttons: ButtonsSection,
  inputs: InputsSection,
  selection: SelectionSection,
  menus: MenusSection,
  feedback: FeedbackSection,
  toolbars: ToolbarsSection,
  icons: IconsSection,
  'form-example': FormExampleSection,
  'list-example': ListExampleSection,
  candidates: CandidatesSection,
  'document-top': DocumentTopSection,
};

const schemeIds = gallerySchemes.map(scheme => scheme.id);
const schemeChoices = [
  { id: CURRENT_GALLERY_SCHEME_ID, label: '现状' },
  ...gallerySchemes.map(scheme => ({ id: scheme.id, label: scheme.label })),
];
const schemeOptions: CustomSelectOption<string>[] = schemeChoices.map(choice => ({
  text: choice.label,
  value: choice.id,
}));
const themeTabs: SegmentedTabItem[] = BUILT_IN_RENDERER_UI_THEMES.map(theme => ({
  id: theme,
  label: THEME_LABELS[theme],
}));

const location = ref<GalleryLocation>(parseGalleryLocation(window.location.search, schemeIds, defaultGallerySchemeId));
const embedRoot = ref<HTMLElement | null>(null);

const activeSection = computed(
  () => GALLERY_SECTIONS.find(section => section.id === location.value.section) ?? GALLERY_SECTIONS[0]
);
const activeComponent = computed(() =>
  location.value.section === 'dialogs' ? null : SECTION_COMPONENTS[location.value.section]
);

function update(patch: Partial<GalleryLocation>, mode: 'push' | 'replace' = 'replace') {
  location.value = { ...location.value, ...patch };
  const url = `${window.location.pathname}${serializeGalleryLocation(location.value, defaultGallerySchemeId)}`;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(null, '', url);
}

function selectTheme(value: string) {
  if (isRendererUiTheme(value)) update({ theme: value });
}

function selectSection(section: GallerySectionId) {
  if (section !== location.value.section) update({ section, open: null }, 'push');
}

const setSchemeCss = installGallerySchemeStyle();
watch(
  () => [location.value.theme, location.value.scheme] as const,
  ([theme, scheme]) => {
    applyGalleryTheme(theme);
    setSchemeCss(gallerySchemes.find(candidate => candidate.id === scheme)?.css ?? '');
  },
  { immediate: true }
);

function restoreFromHistory() {
  location.value = parseGalleryLocation(window.location.search, schemeIds, defaultGallerySchemeId);
}

let stopReportingHeight: (() => void) | null = null;
onMounted(() => {
  window.addEventListener('popstate', restoreFromHistory);
  if (embedRoot.value) stopReportingHeight = reportEmbedHeight(embedRoot.value);
});
onBeforeUnmount(() => {
  window.removeEventListener('popstate', restoreFromHistory);
  stopReportingHeight?.();
});
</script>

<template>
  <div v-if="location.embed" ref="embedRoot" class="gallery-embed">
    <DialogsSection v-if="location.section === 'dialogs'" :open-overlay="location.open" />
    <component :is="activeComponent" v-else />
  </div>
  <div v-else class="gallery">
    <nav class="gallery__nav" aria-label="画廊分区">
      <div class="gallery__brand">
        <LinnyaIcon class="gallery__brand-icon" />
        <span>Renderer UI 画廊</span>
      </div>
      <button
        v-for="section in GALLERY_SECTIONS"
        :key="section.id"
        type="button"
        class="gallery__nav-item"
        :class="{ 'is-active': section.id === location.section }"
        :aria-current="section.id === location.section ? 'page' : undefined"
        @click="selectSection(section.id)"
      >
        {{ section.label }}
      </button>
    </nav>
    <main class="gallery__main">
      <header class="gallery__header">
        <div>
          <h1 class="gallery__title">{{ activeSection.label }}</h1>
          <p class="gallery__description">{{ activeSection.description }}</p>
        </div>
        <div class="gallery__controls">
          <SegmentedTabs
            :model-value="location.theme"
            :tabs="themeTabs"
            aria-label="主题"
            @update:model-value="selectTheme"
          />
          <CustomSelect
            v-if="!location.compare && schemeOptions.length > 1"
            class="gallery__scheme"
            :model-value="location.scheme"
            :options="schemeOptions"
            trigger-aria-label="候选方案"
            @update:model-value="value => update({ scheme: value })"
          />
          <span v-else-if="!location.compare" class="gallery__hint">未加载候选方案</span>
          <BaseButton
            :variant="location.compare ? 'primary' : 'secondary'"
            size="sm"
            @click="update({ compare: !location.compare })"
          >
            {{ location.compare ? '退出对比' : '并排对比' }}
          </BaseButton>
        </div>
      </header>
      <GalleryCompare
        v-if="location.compare"
        :section="location.section"
        :schemes="schemeChoices"
        :selected-schemes="location.compareSchemes"
        :selected-themes="location.compareThemes"
        :theme-labels="THEME_LABELS"
        @update:selected-schemes="value => update({ compareSchemes: value })"
        @update:selected-themes="value => update({ compareThemes: value })"
      />
      <DialogsSection v-else-if="location.section === 'dialogs'" :open-overlay="location.open" />
      <component :is="activeComponent" v-else />
    </main>
  </div>
</template>
