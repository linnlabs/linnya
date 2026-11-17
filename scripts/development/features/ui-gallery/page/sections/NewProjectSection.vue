<script setup lang="ts">
/**
 * 新项目侧栏空态的方向对比（W-0360）。只在画廊里，不是产品组件。
 * 侧栏行的尺寸照抄产品 WorkspaceSidebar.css：行高 34、左右外边距 10、内边距 10、图标 18、字号 prose。
 */
import { computed, ref, type Component } from 'vue';
import { ActionButtons, BaseButton, SegmentedTabs } from '@linnya/renderer-ui';
import {
  AddIcon,
  ChevronIcon,
  DocumentTextIcon,
  ExternalLinkIcon,
  LinnyaIcon,
  MicrophoneIcon,
  OptionsIcon,
  SearchIcon,
  TableIcon,
  TimelineIcon,
} from '@linnya/renderer-ui/icons';
import SlidesIcon from '../../../../../../packages/plugins/slides/src/renderer/icon/SlidesIcon.vue';
import CanvasIcon from '../../../../../../packages/plugins/canvas/src/renderer/icon/CanvasIcon.vue';
import GalleryBlock from '../ui/GalleryBlock.vue';

interface CreateType {
  readonly id: string;
  readonly label: string;
  readonly icon: Component;
}

/** 前三种是现有类型（按 createPriority）；其余是假设将来插件提供的类型，只用来看容量。 */
const ALL_TYPES: readonly CreateType[] = [
  { id: 'doc', label: '文档', icon: DocumentTextIcon },
  { id: 'slides', label: '演示文稿', icon: SlidesIcon },
  { id: 'canvas', label: '画布', icon: CanvasIcon },
  { id: 'table', label: '表格', icon: TableIcon },
  { id: 'decision', label: '决策', icon: OptionsIcon },
  { id: 'timeline', label: '时间线', icon: TimelineIcon },
  { id: 'interview', label: '访谈纪要', icon: MicrophoneIcon },
  { id: 'clip', label: '网页剪藏', icon: ExternalLinkIcon },
];

const typeCount = ref('3');
const countTabs = [
  { id: '3', label: '现在 3 种' },
  { id: '8', label: '将来 8 种' },
];
const types = computed(() => ALL_TYPES.slice(0, Number(typeCount.value)));

/** A、C 直接露出的类型数，多出来的收进“更多类型”。 */
const A_VISIBLE = 3;
const C_VISIBLE = 5;
const aVisible = computed(() => types.value.slice(0, A_VISIBLE));
const aHasMore = computed(() => types.value.length > A_VISIBLE);
const cVisible = computed(() => (types.value.length > C_VISIBLE + 1 ? types.value.slice(0, C_VISIBLE) : types.value));
const cHasMore = computed(() => types.value.length > C_VISIBLE + 1);

const aMenuOpen = ref(false);
const bMenuOpen = ref(true);
const bQuery = ref('');
const bFiltered = computed(() => types.value.filter(type => type.label.includes(bQuery.value.trim())));

const VARIANTS = [
  {
    id: 'current',
    title: '现状',
    note: '虚线卡片 + 标题 + 徽标 + 说明，每种类型一个按钮，颜色深浅不一；类型一多，按钮会一直往下堆。',
  },
  {
    id: 'a',
    title: 'A 列表行（推荐）',
    note: '一行灰字说明，下面直接列出类型，长得和文件行一样，悬停才出底色。只露常用的 3 种，其余收进“更多类型”，点开在原地展开。AI 初始化单独一行，用 Linnya 标识。不加卡片、徽标和彩色按钮。',
  },
  {
    id: 'b',
    title: 'B 一个入口',
    note: '只放一个“新建…”按钮，点开是带搜索的类型列表（图里保持展开）；类型再多也只是列表变长。最省地方，但要多点一下才看到能建什么。',
  },
  {
    id: 'c',
    title: 'C 图块',
    note: '三列小图块，图标在上、名字在下，浅底无边框；超过 6 种时第 6 格变成“更多”。一眼能看到类型，但比列表占地方，也和侧栏其他行的形态不同。',
  },
] as const;
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock
      title="新项目：侧栏空态"
      note="项目里还没有文件时，侧栏“项目文件”下方显示的内容。切换类型数量，看插件变多以后各方向怎么容纳。前三种是现有类型，其余五种是假设的插件类型。"
    >
      <div class="np-controls">
        <SegmentedTabs v-model="typeCount" :tabs="countTabs" />
      </div>

      <div class="np-grid">
        <figure v-for="variant in VARIANTS" :key="variant.id" class="np-figure">
          <div class="np-sidebar">
            <div class="np-row np-row--static">
              <ChevronIcon direction="left" class="np-row-icon" />
              <span class="np-row-label np-row-label--strong">默认项目</span>
            </div>
            <div class="np-row np-row--static">
              <AddIcon class="np-row-icon" />
              <span class="np-row-label">新建</span>
            </div>
            <div class="np-row np-row--static">
              <SearchIcon class="np-row-icon" />
              <span class="np-row-label np-row-label--muted">搜索文件</span>
            </div>
            <div class="np-heading">项目文件</div>

            <!-- 现状：照产品 FileTreeView 的结构与样式还原 -->
            <div v-if="variant.id === 'current'" class="np-current">
              <div class="np-current-card">
                <div class="np-current-title-row">
                  <span class="np-current-title">开始创作</span>
                  <span class="np-current-badge">新项目</span>
                </div>
                <p class="np-current-subtitle">这个项目还没有任何内容，先创建第一个文件。</p>
                <div class="np-current-actions">
                  <ActionButtons :show-primary-action="true" :show-secondary-action="true">
                    <template #primary-content>
                      <component :is="types[0].icon" class="np-button-icon" />
                      <span>新建{{ types[0].label }}</span>
                    </template>
                    <template #secondary-content>
                      <component :is="types[2].icon" class="np-button-icon" />
                      <span>新建{{ types[2].label }}</span>
                    </template>
                  </ActionButtons>
                  <ActionButtons
                    v-for="type in [types[1], ...types.slice(3)]"
                    :key="type.id"
                    class="np-current-full"
                    :show-primary-action="true"
                    :show-secondary-action="false"
                  >
                    <template #primary-content>
                      <component :is="type.icon" class="np-button-icon" />
                      <span>新建{{ type.label }}</span>
                    </template>
                  </ActionButtons>
                  <BaseButton variant="tint" size="sm">
                    <template #icon><LinnyaIcon /></template>
                    AI 项目初始化
                  </BaseButton>
                </div>
              </div>
            </div>

            <!-- A 列表行 -->
            <div v-else-if="variant.id === 'a'" class="np-a">
              <p class="np-hint">还没有文件，从这里开始</p>
              <button v-for="type in aVisible" :key="type.id" type="button" class="np-row">
                <component :is="type.icon" class="np-row-icon" />
                <span class="np-row-label">{{ type.label }}</span>
              </button>
              <template v-if="aHasMore && aMenuOpen">
                <button v-for="type in types.slice(A_VISIBLE)" :key="type.id" type="button" class="np-row">
                  <component :is="type.icon" class="np-row-icon" />
                  <span class="np-row-label">{{ type.label }}</span>
                </button>
              </template>
              <button
                v-if="aHasMore"
                type="button"
                class="np-row"
                @click="aMenuOpen = !aMenuOpen"
              >
                <span class="np-row-icon np-row-icon--placeholder" />
                <span class="np-row-label np-row-label--muted">{{ aMenuOpen ? '收起' : `更多类型（${types.length - A_VISIBLE}）` }}</span>
                <ChevronIcon :direction="aMenuOpen ? 'up' : 'down'" class="np-row-chevron" />
              </button>
              <div class="np-gap" />
              <button type="button" class="np-row np-row--ai">
                <LinnyaIcon class="np-row-icon np-row-icon--accent" />
                <span class="np-row-label">让 AI 初始化项目</span>
              </button>
            </div>

            <!-- B 一个入口 -->
            <div v-else-if="variant.id === 'b'" class="np-b">
              <p class="np-hint">还没有文件</p>
              <div class="np-b-actions">
                <BaseButton variant="secondary" size="sm" block @click="bMenuOpen = !bMenuOpen">
                  <template #icon><AddIcon /></template>
                  新建…
                </BaseButton>
                <div v-if="bMenuOpen" class="np-menu np-menu--b">
                  <label class="np-menu-search">
                    <SearchIcon class="np-menu-icon" />
                    <input v-model="bQuery" placeholder="搜索类型" />
                  </label>
                  <button v-for="type in bFiltered" :key="type.id" type="button" class="np-menu-item">
                    <component :is="type.icon" class="np-menu-icon" />
                    <span>{{ type.label }}</span>
                  </button>
                </div>
                <BaseButton variant="plain" tone="accent" size="sm" class="np-b-ai">
                  <template #icon><LinnyaIcon /></template>
                  让 AI 初始化项目
                </BaseButton>
              </div>
            </div>

            <!-- C 图块 -->
            <div v-else class="np-c">
              <p class="np-hint">还没有文件，从这里开始</p>
              <div class="np-tiles">
                <button v-for="type in cVisible" :key="type.id" type="button" class="np-tile">
                  <component :is="type.icon" class="np-tile-icon" />
                  <span>{{ type.label }}</span>
                </button>
                <button v-if="cHasMore" type="button" class="np-tile np-tile--more">
                  <span class="np-tile-more-count">+{{ types.length - C_VISIBLE }}</span>
                  <span>更多</span>
                </button>
              </div>
              <button type="button" class="np-row np-row--ai">
                <LinnyaIcon class="np-row-icon np-row-icon--accent" />
                <span class="np-row-label">让 AI 初始化项目</span>
              </button>
            </div>
          </div>
          <figcaption class="np-caption">
            <strong>{{ variant.title }}</strong>
            <span>{{ variant.note }}</span>
          </figcaption>
        </figure>
      </div>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.np-controls {
  margin-bottom: 16px;
}

.np-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 260px);
  gap: 24px 12px;
  align-items: start;
}

.np-figure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
}

.np-sidebar {
  position: relative;
  width: 260px;
  min-height: 560px;
  box-sizing: border-box;
  padding: 8px 0 16px;
  background: var(--color-bg-sidebar);
  border-radius: var(--radius-lg);
  box-shadow: inset 0 0 0 0.5px var(--color-border-light);
  font-size: var(--font-size-prose);
}

.np-caption {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 260px;
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-normal);
  color: var(--color-text-secondary);
}

.np-caption strong {
  font-size: var(--font-size-body);
  color: var(--color-text-primary);
}

/* 侧栏行：尺寸与产品一致 */
.np-row {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  width: calc(100% - 20px);
  height: 34px;
  margin: 1px 10px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.np-row:hover {
  background: var(--color-bg-hover);
}

.np-row--static {
  cursor: default;
}

.np-row--static:hover {
  background: transparent;
}

.np-row-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.np-row-icon--placeholder {
  display: inline-block;
}

.np-row-icon--accent {
  color: var(--color-accent);
}

.np-row-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.np-row-label--strong {
  color: var(--color-text-primary);
}

.np-row-label--muted {
  color: var(--color-text-tertiary);
}

.np-row-chevron {
  width: 14px;
  height: 14px;
  color: var(--color-text-tertiary);
}

.np-heading {
  margin: 14px 20px 4px;
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.np-hint {
  margin: 4px 20px 6px;
  font-size: var(--font-size-footnote);
  color: var(--color-text-tertiary);
}

.np-gap {
  height: 10px;
}

/* 现状还原 */
.np-current {
  padding: 4px 12px 0;
}

.np-current-card {
  padding: 12px;
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
}

.np-current-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.np-current-title {
  font-size: var(--font-size-body);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
}

.np-current-badge {
  padding: 0 6px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
  background: var(--color-accent-bg-subtle);
  color: var(--color-accent-text);
}

.np-current-subtitle {
  margin: 10px 0 0;
  font-size: var(--font-size-footnote);
  color: var(--color-text-tertiary);
}

.np-current-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 0;
  margin-top: 12px;
}

.np-current-full {
  width: 100%;
}

.np-button-icon {
  width: 18px;
  height: 18px;
}

/* 菜单：只为预览拼的静态外观，取浮层表面与投影 */
.np-menu {
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-floating-panel);
}

.np-menu--b {
  margin-top: 4px;
}

.np-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
  font-size: var(--font-size-body);
  text-align: left;
  cursor: pointer;
}

.np-menu-item:hover {
  background: var(--color-bg-hover);
}

.np-menu-icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.np-menu-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  margin-bottom: 4px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  background: var(--color-bg-field);
}

.np-menu-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  font-size: var(--font-size-body);
}

/* B */
.np-b-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 2px 20px 0;
}

.np-b-ai {
  align-self: flex-start;
  margin-left: -8px;
}

/* C */
.np-tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 2px 20px 12px;
}

.np-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 64px;
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
  color: var(--color-text-secondary);
  font-size: var(--font-size-caption);
  cursor: pointer;
}

.np-tile:hover {
  background: var(--color-bg-field-hover);
}

.np-tile-icon {
  width: 20px;
  height: 20px;
}

.np-tile-more-count {
  font-size: var(--font-size-body);
  color: var(--color-text-tertiary);
}
</style>
