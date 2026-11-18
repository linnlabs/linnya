<script setup lang="ts">
import { computed, ref, type Component } from 'vue';
import { CustomTextInput, SegmentedTabs, type SegmentedTabItem } from '@linnya/renderer-ui';
import * as icons from '@linnya/renderer-ui/icons';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/** 需要参数才能画出的图标给一个代表性取值，其余图标不传参数。 */
const ICON_PROPS: Readonly<Record<string, Record<string, unknown>>> = {
  AlignObjectsIcon: { alignment: 'left' },
  BorderPreviewIcon: { borderType: 'all' },
  BorderStyleIcon: { styleType: 1 },
  DistributeIcon: { direction: 'horizontal' },
  EyeIcon: { visible: true },
  FontSizeIcon: { direction: 'increase' },
  RunControlIcon: { action: 'send' },
  TextAlignIcon: { alignment: 'left' },
  TextBoxAlignIcon: { alignment: 'middle' },
  WindowActionIcon: { action: 'maximize' },
};

const BRAND_ICONS = new Set(['LinnyaIcon', 'LinnyaLoadingIcon']);

function isComponentEntry(entry: [string, unknown]): entry is [string, Component] {
  const [name, value] = entry;
  return name.endsWith('Icon') && typeof value === 'object' && value !== null;
}

const allIcons = Object.entries(icons)
  .filter(isComponentEntry)
  .filter(([name]) => !BRAND_ICONS.has(name))
  .map(([name, component]) => ({ name, component, props: ICON_PROPS[name] ?? {} }))
  .sort((left, right) => left.name.localeCompare(right.name));

const SIZE_TABS: SegmentedTabItem[] = [
  { id: '16', label: '16px' },
  { id: '18', label: '18px' },
  { id: '20', label: '20px' },
];

const filter = ref('');
const size = ref('18');
const visibleIcons = computed(() => {
  const keyword = filter.value.trim().toLowerCase();
  return keyword.length === 0 ? allIcons : allIcons.filter(icon => icon.name.toLowerCase().includes(keyword));
});
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="品牌标识">
      <GalleryRow label="LinnyaIcon">
        <icons.LinnyaIcon class="icons__brand-small" />
        <icons.LinnyaIcon variant="display" class="icons__brand-large" />
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock :title="`平台图标（${allIcons.length}）`" note="单色线性，颜色继承 currentColor。">
      <div class="icons__toolbar">
        <CustomTextInput v-model="filter" class="gallery-field" type="search" clearable placeholder="按名称筛选" aria-label="按名称筛选图标" />
        <SegmentedTabs v-model="size" :tabs="SIZE_TABS" aria-label="图标尺寸" />
      </div>
      <div class="icons__grid" :style="{ '--gallery-icon-size': `${size}px` }">
        <div v-for="icon in visibleIcons" :key="icon.name" class="icons__cell">
          <component :is="icon.component" v-bind="icon.props" class="icons__glyph" />
          <span class="gallery-caption">{{ icon.name.replace(/Icon$/, '') }}</span>
        </div>
      </div>
    </GalleryBlock>
  </div>
</template>

<style>
.icons__brand-small {
  width: 18px;
  height: 18px;
}

.icons__brand-large {
  width: 48px; /* scale-exempt: 版面尺寸 */
  height: 48px; /* scale-exempt: 版面尺寸 */
}

.icons__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.icons__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); /* scale-exempt: 版面尺寸 */
  gap: var(--space-2);
}

.icons__cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
}

.icons__cell:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.icons__glyph {
  width: var(--gallery-icon-size);
  height: var(--gallery-icon-size);
}
</style>
