<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { BaseDropdown, DropdownPanel, SegmentedTabs, ToolbarButton, ToolbarGroup, type SegmentedTabItem } from '@linnya/renderer-ui';
import {
  BoldIcon,
  BulletListIcon,
  ChevronIcon,
  CloseIcon,
  DocumentIcon,
  DocumentTextIcon,
  HeadingIcon,
  ImageIcon,
  ItalicIcon,
  MoreIcon,
  NumberedListIcon,
  QuoteIcon,
  RefreshIcon,
  TableIcon,
  WrenchIcon,
} from '@linnya/renderer-ui/icons';
import MarkdownFloatingToolbar from '../prototypes/MarkdownFloatingToolbar.vue';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const PARAGRAPHS = [
  ['h2', '背景'],
  ['p', '今年国内办公软件市场继续增长，用户对协作和 AI 功能的关注明显上升。'],
  ['h2', '主要发现'],
  ['p', '大型企业最看重数据安全和权限管理；中小团队最看重上手速度和价格。'],
  ['p', '受访团队里有六成已经在用至少一个 AI 写作工具，但多数只用来改写和总结。'],
  ['h2', '建议'],
  ['p', '优先打磨文档协作的基础体验，再逐步加入 AI 辅助写作。'],
  ['p', '定价分两档：个人免费、团队按席位收费，避免一上来就谈企业版。'],
  ['h2', '附录'],
  ['p', '访谈共 24 家，覆盖制造、零售、咨询与互联网四个行业。'],
  ['p', '问卷回收 312 份，有效 287 份。'],
] as const;

/** 工具栏 B：打字或向下滚动时淡出，移动鼠标或向上滚动时回来。 */
const autoHidden = ref(false);
let lastScrollTop = 0;
function onAutoScroll(event: Event) {
  const top = (event.target as HTMLElement).scrollTop;
  if (top > lastScrollTop + 6) autoHidden.value = true;
  else if (top < lastScrollTop - 6) autoHidden.value = false;
  lastScrollTop = top;
}

type DocKind = 'markdown' | 'slides' | 'canvas';
interface DemoDoc {
  readonly id: string;
  readonly title: string;
  readonly kind: DocKind;
}
const DOCS: readonly DemoDoc[] = [
  { id: 'report', title: '市场调研报告', kind: 'markdown' },
  { id: 'deck', title: '竞品对比', kind: 'slides' },
  { id: 'minutes', title: '会议纪要', kind: 'markdown' },
  { id: 'board', title: '用户旅程', kind: 'canvas' },
  { id: 'plan', title: '第四季度计划与预算拆分', kind: 'markdown' },
  { id: 'faq', title: '常见问题', kind: 'markdown' },
  { id: 'interview', title: '访谈记录整理', kind: 'markdown' },
  { id: 'pricing', title: '定价方案草稿', kind: 'markdown' },
  { id: 'persona', title: '用户画像', kind: 'canvas' },
  { id: 'retro', title: '十月复盘', kind: 'slides' },
  { id: 'glossary', title: '术语表', kind: 'markdown' },
  { id: 'roadmap', title: '产品路线图', kind: 'canvas' },
];
const docById = (id: string) => DOCS.find(doc => doc.id === id)!;

interface OpenTab {
  readonly id: string;
  preview: boolean;
}

const OPEN_MODES: SegmentedTabItem[] = [
  { id: 'preview', label: '单击先开临时标签' },
  { id: 'always', label: '单击总是新开标签' },
];
const openMode = ref<'preview' | 'always'>('preview');

const TAB_STYLES: SegmentedTabItem[] = [
  { id: 'browser', label: 'A 浏览器式' },
  { id: 'pill', label: 'B 轻量式' },
];
const tabStyle = ref<'browser' | 'pill'>('pill');

const tabs = ref<OpenTab[]>([
  { id: 'report', preview: false },
  { id: 'deck', preview: false },
  { id: 'minutes', preview: true },
]);
const activeId = ref('report');
const activeDoc = computed(() => docById(activeId.value));

/** 最近使用顺序：Ctrl+Tab 切换、“全部标签”排序、关闭当前标签后回到哪个，都按它。 */
const recent = ref<string[]>(['report', 'deck', 'minutes']);
const closedStack = ref<string[]>([]);
watch(activeId, id => {
  recent.value = [id, ...recent.value.filter(item => item !== id)];
  void nextTick(scrollActiveIntoView);
});

const tabsEl = ref<HTMLElement | null>(null);
const overflowing = ref(false);
const moreLeft = ref(false);
const moreRight = ref(false);
function measureOverflow() {
  const el = tabsEl.value;
  overflowing.value = !!el && el.scrollWidth > el.clientWidth + 1;
  moreLeft.value = !!el && el.scrollLeft > 1;
  moreRight.value = !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}
function scrollActiveIntoView() {
  tabsEl.value?.querySelector<HTMLElement>('.doc-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  measureOverflow();
}
/** 竖向滚轮也横向滚动标签栏。 */
function onTabsWheel(event: WheelEvent) {
  const el = tabsEl.value;
  if (!el || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  el.scrollLeft += event.deltaY;
  event.preventDefault();
}
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  resizeObserver = new ResizeObserver(measureOverflow);
  if (tabsEl.value) resizeObserver.observe(tabsEl.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(() => tabs.value.length, () => void nextTick(measureOverflow));

const listQuery = ref('');
const listedTabs = computed(() => {
  const query = listQuery.value.trim();
  return recent.value
    .filter(id => tabs.value.some(tab => tab.id === id))
    .map(docById)
    .filter(doc => !query || doc.title.includes(query));
});

interface TabMenuState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}
const tabMenu = ref<TabMenuState | null>(null);
function openTabMenu(event: MouseEvent, id: string) {
  const frame = (event.currentTarget as HTMLElement).closest('.doc-frame')!.getBoundingClientRect();
  tabMenu.value = { id, x: event.clientX - frame.left, y: event.clientY - frame.top };
}
function closeTabs(ids: readonly string[]) {
  for (const id of ids) closeTab(id);
  tabMenu.value = null;
}
function closeOthers(id: string) {
  closeTabs(tabs.value.filter(tab => tab.id !== id).map(tab => tab.id));
  activeId.value = id;
}
function closeRight(id: string) {
  const index = tabs.value.findIndex(tab => tab.id === id);
  closeTabs(tabs.value.slice(index + 1).map(tab => tab.id));
}
function reopenClosed() {
  const id = closedStack.value.pop();
  if (id) openDoc(id, true);
  tabMenu.value = null;
}

function openDoc(id: string, pin: boolean) {
  const existing = tabs.value.find(tab => tab.id === id);
  if (existing) {
    if (pin) existing.preview = false;
  } else if (openMode.value === 'always' || pin) {
    tabs.value.push({ id, preview: false });
  } else {
    const previewIndex = tabs.value.findIndex(tab => tab.preview);
    if (previewIndex >= 0) tabs.value.splice(previewIndex, 1, { id, preview: true });
    else tabs.value.push({ id, preview: true });
  }
  activeId.value = id;
}

function pinActive() {
  const tab = tabs.value.find(item => item.id === activeId.value);
  if (tab) tab.preview = false;
}

function closeTab(id: string) {
  const index = tabs.value.findIndex(tab => tab.id === id);
  if (index < 0) return;
  tabs.value.splice(index, 1);
  closedStack.value.push(id);
  recent.value = recent.value.filter(item => item !== id);
  if (activeId.value === id && tabs.value.length) activeId.value = recent.value.find(item => tabs.value.some(tab => tab.id === item)) ?? tabs.value[0].id;
}

function resetTabs() {
  tabs.value = [{ id: 'report', preview: false }, { id: 'deck', preview: false }, { id: 'minutes', preview: true }];
  activeId.value = 'report';
  recent.value = ['report', 'deck', 'minutes'];
  closedStack.value = [];
}

function openMany() {
  for (const doc of DOCS) {
    if (tabs.value.some(tab => tab.id === doc.id)) continue;
    tabs.value.push({ id: doc.id, preview: false });
    recent.value = [...recent.value, doc.id];
  }
}
</script>

<template>
  <div class="gallery-section doc-top">
    <GalleryBlock
      title="Markdown 工具栏：顶部整行 → 悬浮"
      note="现状的格式工具栏单独占一整行（37px）。A、B 都改成和 Slides、Canvas 一样的顶部居中悬浮胶囊，顶部只剩标题栏一行，并缩减为 标题▾ | 列表▾ 引用 | 图片 表格 | …：粗体、斜体交给选中文字时的工具栏和快捷键，“…”与斜杠菜单同一份清单。B 在打字或向下滚动时淡出，移动鼠标或向上滚动时回来。三个框都可以滚动、可以打字试。"
    >
      <GalleryRow label="三种对比" align="start">
        <div class="doc-top__grid">
          <figure class="doc-top__figure">
            <figcaption>现状：工具栏占一整行</figcaption>
            <div class="doc-frame">
              <header class="doc-frame__header">
                <span class="doc-frame__crumb">改动清单验证 <span class="doc-frame__sep">/</span> <strong>市场调研报告.md</strong></span>
                <span class="doc-frame__actions"><MoreIcon /><RefreshIcon /></span>
              </header>
              <div class="doc-frame__menu-row">
                <ToolbarGroup>
                  <ToolbarButton label="标题"><HeadingIcon /></ToolbarButton>
                  <ToolbarButton label="粗体"><BoldIcon /></ToolbarButton>
                  <ToolbarButton label="斜体"><ItalicIcon /></ToolbarButton>
                </ToolbarGroup>
                <ToolbarGroup>
                  <ToolbarButton label="无序列表"><BulletListIcon /></ToolbarButton>
                  <ToolbarButton label="有序列表"><NumberedListIcon /></ToolbarButton>
                  <ToolbarButton label="引用"><QuoteIcon /></ToolbarButton>
                </ToolbarGroup>
                <ToolbarGroup>
                  <ToolbarButton label="图片"><ImageIcon /></ToolbarButton>
                  <ToolbarButton label="表格"><TableIcon /></ToolbarButton>
                </ToolbarGroup>
                <ToolbarGroup>
                  <ToolbarButton label="工具"><WrenchIcon /></ToolbarButton>
                  <ToolbarButton label="AI"><span class="doc-frame__ai">AI</span></ToolbarButton>
                </ToolbarGroup>
              </div>
              <article class="doc-frame__body" contenteditable="true" spellcheck="false">
                <h1>市场调研报告</h1>
                <component :is="tag" v-for="([tag, text], index) in PARAGRAPHS" :key="index">{{ text }}</component>
              </article>
            </div>
          </figure>

          <figure v-for="variant in (['always', 'auto'] as const)" :key="variant" class="doc-top__figure">
            <figcaption>{{ variant === 'always' ? 'A 常驻悬浮' : 'B 打字和下滚时隐藏' }}</figcaption>
            <div class="doc-frame" @mousemove="variant === 'auto' && (autoHidden = false)">
              <header class="doc-frame__header">
                <span class="doc-frame__crumb">改动清单验证 <span class="doc-frame__sep">/</span> <strong>市场调研报告.md</strong></span>
                <span class="doc-frame__actions"><MoreIcon /><RefreshIcon /></span>
              </header>
              <div class="doc-frame__stage">
                <MarkdownFloatingToolbar :hidden="variant === 'auto' && autoHidden" />
                <article
                  class="doc-frame__body doc-frame__body--floating"
                  contenteditable="true"
                  spellcheck="false"
                  @scroll="variant === 'auto' && onAutoScroll($event)"
                  @keydown="variant === 'auto' && (autoHidden = true)"
                >
                  <h1>市场调研报告</h1>
                  <component :is="tag" v-for="([tag, text], index) in PARAGRAPHS" :key="index">{{ text }}</component>
                </article>
              </div>
            </div>
          </figure>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock
      title="文档栏：面包屑 → 标签页"
      note="标签页取代现在的“项目 / 文档名”那一行，右侧的更多和刷新保留。不设数量上限：标签缩到最小宽度后横向滚动（滚轮也能横滚），切到的标签自动滚进可见区；放不下时右端出现“全部标签”，按最近使用列出、可筛选；右键标签有关闭菜单。点左边的文档打开：单击是临时标签（斜体，再单击别的文档会被替换），双击或在正文里打字就固定下来；也可以切成“单击总是新开”对比。悬停标签显示所属项目。"
    >
      <GalleryRow label="设置">
        <SegmentedTabs v-model="tabStyle" :tabs="TAB_STYLES" aria-label="标签样式" />
        <SegmentedTabs v-model="openMode" :tabs="OPEN_MODES" aria-label="打开方式" />
        <button type="button" class="doc-top__link" @click="openMany">打开很多个看溢出</button>
        <button type="button" class="doc-top__link" @click="resetTabs">重置</button>
      </GalleryRow>
      <GalleryRow label="快捷键">
        <span class="doc-top__keys">
          <kbd>Ctrl</kbd>+<kbd>Tab</kbd> / <kbd>Ctrl</kbd>+<kbd>⇧</kbd>+<kbd>Tab</kbd> 按最近使用切换　<kbd>⌘W</kbd> 关闭当前　<kbd>⇧⌘T</kbd> 重新打开刚关闭的（浏览器里会被拦截，这里只列出；右键标签可试关闭菜单）
        </span>
      </GalleryRow>
      <GalleryRow label="试一试" align="start">
        <div class="tabs-demo">
          <nav class="tabs-demo__tree" aria-label="项目文档">
            <div class="tabs-demo__tree-title">改动清单验证</div>
            <button
              v-for="doc in DOCS"
              :key="doc.id"
              type="button"
              class="tabs-demo__tree-item"
              :class="{ 'is-active': doc.id === activeId }"
              @click="openDoc(doc.id, false)"
              @dblclick="openDoc(doc.id, true)"
            >
              <DocumentTextIcon v-if="doc.kind === 'markdown'" />
              <DocumentIcon v-else />
              <span>{{ doc.title }}</span>
            </button>
          </nav>

          <div class="doc-frame doc-frame--wide">
            <header class="doc-frame__header doc-frame__header--tabs" :class="`is-${tabStyle}`">
              <div ref="tabsEl" class="doc-tabs" :class="{ 'is-more-left': moreLeft, 'is-more-right': moreRight }" role="tablist" aria-label="已打开的文档" @wheel="onTabsWheel" @scroll="measureOverflow">
                <div
                  v-for="tab in tabs"
                  :key="tab.id"
                  class="doc-tab"
                  :class="{ 'is-active': tab.id === activeId, 'is-preview': tab.preview }"
                  role="tab"
                  :aria-selected="tab.id === activeId"
                  :title="`改动清单验证 / ${docById(tab.id).title}`"
                  @click="activeId = tab.id"
                  @dblclick="tab.preview = false"
                  @contextmenu.prevent="openTabMenu($event, tab.id)"
                >
                  <DocumentTextIcon v-if="docById(tab.id).kind === 'markdown'" class="doc-tab__icon" />
                  <DocumentIcon v-else class="doc-tab__icon" />
                  <span class="doc-tab__title">{{ docById(tab.id).title }}</span>
                  <button type="button" class="doc-tab__close" aria-label="关闭" @click.stop="closeTab(tab.id)"><CloseIcon /></button>
                </div>
              </div>
              <BaseDropdown v-if="overflowing" class="doc-tabs__all-anchor">
                <template #trigger="{ toggle, isOpen }">
                  <button
                    type="button"
                    class="doc-tabs__all"
                    :class="{ 'is-open': isOpen }"
                    :aria-expanded="isOpen"
                    :title="`全部标签（${tabs.length}）`"
                    @click="listQuery = ''; toggle()"
                  >
                    {{ tabs.length }}<ChevronIcon direction="down" />
                  </button>
                </template>
                <template #content="{ isOpen, close }">
                  <DropdownPanel :show="isOpen" class="doc-tabs__list">
                    <input v-model="listQuery" class="doc-tabs__filter" placeholder="筛选已打开的文档" aria-label="筛选已打开的文档" />
                    <div class="doc-tabs__list-caption">按最近使用</div>
                    <div
                      v-for="doc in listedTabs"
                      :key="doc.id"
                      class="doc-tabs__list-item"
                      :class="{ 'is-active': doc.id === activeId }"
                      @click="activeId = doc.id; close()"
                    >
                      <DocumentTextIcon v-if="doc.kind === 'markdown'" class="doc-tab__icon" />
                      <DocumentIcon v-else class="doc-tab__icon" />
                      <span class="doc-tab__title">{{ doc.title }}</span>
                      <button type="button" class="doc-tab__close" aria-label="关闭" @click.stop="closeTab(doc.id)"><CloseIcon /></button>
                    </div>
                    <div v-if="!listedTabs.length" class="doc-tabs__list-empty">没有匹配的文档</div>
                  </DropdownPanel>
                </template>
              </BaseDropdown>
              <span class="doc-frame__actions"><MoreIcon /><RefreshIcon /></span>
            </header>
            <div v-if="tabMenu" class="tab-menu__scrim" @click="tabMenu = null" @contextmenu.prevent="tabMenu = null" />
            <div v-if="tabMenu" class="tab-menu" :style="{ left: `${tabMenu.x}px`, top: `${tabMenu.y}px` }" role="menu">
              <button type="button" class="tab-menu__item" @click="closeTabs([tabMenu.id])">关闭<kbd>⌘W</kbd></button>
              <button type="button" class="tab-menu__item" @click="closeOthers(tabMenu.id)">关闭其他</button>
              <button type="button" class="tab-menu__item" @click="closeRight(tabMenu.id)">关闭右侧</button>
              <button type="button" class="tab-menu__item" @click="closeTabs(tabs.map(tab => tab.id))">全部关闭</button>
              <div class="tab-menu__divider" />
              <button type="button" class="tab-menu__item" :disabled="!closedStack.length" @click="reopenClosed">重新打开刚关闭的<kbd>⇧⌘T</kbd></button>
            </div>
            <div class="doc-frame__stage">
              <MarkdownFloatingToolbar />
              <article
                v-if="tabs.length"
                class="doc-frame__body doc-frame__body--floating"
                contenteditable="true"
                spellcheck="false"
                @keydown="pinActive"
              >
                <h1>{{ activeDoc.title }}</h1>
                <component :is="tag" v-for="([tag, text], index) in PARAGRAPHS.slice(0, 5)" :key="index">{{ text }}</component>
              </article>
              <div v-else class="doc-frame__empty">没有打开的文档</div>
            </div>
          </div>
        </div>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style scoped>
.doc-top__grid {
  display: grid;
  /* 真实文档栏约 660px 宽：每格不超过 680px，窄屏时换行。 */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 680px));
  gap: var(--space-5);
  width: 100%;
}

.doc-top__figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.doc-top__figure figcaption {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.doc-top__link {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-link);
  cursor: pointer;
}

.doc-frame {
  isolation: isolate;
  display: flex;
  flex-direction: column;
  height: 460px;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background: var(--color-bg-default);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.doc-frame--wide {
  flex: 1 1 520px;
  max-width: 680px;
  height: 420px;
}

.doc-frame__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  height: 36px;
  padding: 0 var(--space-3);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.doc-frame__crumb {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.doc-frame__crumb strong {
  font-weight: inherit;
  color: var(--color-text-primary);
}

.doc-frame__sep {
  margin: 0 4px;
  color: var(--color-text-tertiary);
}

.doc-frame__actions {
  display: inline-flex;
  flex: none;
  gap: var(--space-3);
  color: var(--color-text-secondary);
}

.doc-frame__actions :deep(svg) {
  width: 16px;
  height: 16px;
}

.doc-frame__menu-row {
  display: flex;
  flex: none;
  justify-content: center;
  align-items: center;
  height: 36px;
  border-bottom: 0.5px solid var(--color-border-default);
}

.doc-frame__ai {
  font-size: 11px;
  font-weight: 600;
}

.doc-frame__stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.doc-frame__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-4) var(--space-8) var(--space-8);
  color: var(--color-text-primary);
  font-size: 15px;
  line-height: 1.75;
  outline: none;
}

.doc-frame__body--floating {
  height: 100%;
  padding-top: 56px;
}

.doc-frame__body h1 {
  margin: 0 0 var(--space-3);
  font-size: 26px;
  line-height: 1.3;
}

.doc-frame__body h2 {
  margin: var(--space-5) 0 var(--space-2);
  font-size: 19px;
}

.doc-frame__body p {
  margin: 0 0 var(--space-3);
}

.doc-frame__empty {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
}

.tabs-demo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  width: 100%;
}

.tabs-demo__tree {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 200px;
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  background: var(--color-bg-sidebar);
}

.tabs-demo__tree-title {
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.tabs-demo__tree-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 30px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--color-text-primary);
  text-align: left;
  cursor: default;
  user-select: none;
}

.tabs-demo__tree-item span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tabs-demo__tree-item :deep(svg) {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.tabs-demo__tree-item:hover {
  background: var(--color-bg-hover);
}

.tabs-demo__tree-item.is-active {
  background: var(--color-bg-active);
}

.doc-frame__header--tabs {
  padding: 0 var(--space-3) 0 var(--space-2);
}

.doc-tabs {
  display: flex;
  flex: 1;
  align-items: stretch;
  min-width: 0;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}

/* 哪一端还有标签就在哪一端淡出，滚到头就不淡出。 */
.doc-tabs.is-more-right {
  mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);
}

.doc-tabs.is-more-left {
  mask-image: linear-gradient(to right, transparent, #000 24px);
}

.doc-tabs.is-more-left.is-more-right {
  mask-image: linear-gradient(to right, transparent, #000 24px, #000 calc(100% - 24px), transparent);
}

.doc-tab {
  display: flex;
  flex: 0 1 180px;
  align-items: center;
  gap: 6px;
  min-width: 96px;
  padding: 0 4px 0 10px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: default;
  user-select: none;
}

.doc-tab__icon {
  flex: none;
  width: 14px;
  height: 14px;
}

.doc-tab__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.doc-tab.is-preview .doc-tab__title {
  font-style: italic;
}

.doc-tab__close {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-text-tertiary);
  opacity: 0;
}

.doc-tab__close :deep(svg) {
  width: 12px;
  height: 12px;
}

.doc-tab:hover .doc-tab__close,
.doc-tab.is-active .doc-tab__close {
  opacity: 1;
}

.doc-tab__close:hover {
  background: var(--color-bg-hover-strong);
  color: var(--color-text-primary);
}

/* 放不下时右端的“全部标签”：数字 + 下拉。 */
.doc-tabs__all-anchor {
  position: relative;
  flex: none;
}

.doc-tabs__all {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.doc-tabs__all :deep(svg) {
  width: 10px;
  height: 10px;
}

.doc-tabs__all:hover,
.doc-tabs__all.is-open {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.doc-tabs__list {
  top: calc(100% + 6px);
  right: 0;
  width: 260px;
  max-height: 320px;
  padding: 6px;
  overflow: auto;
}

.doc-tabs__filter {
  box-sizing: border-box;
  width: 100%;
  height: 28px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-bg-field);
  font: inherit;
  font-size: 13px;
  color: var(--color-text-primary);
  outline: none;
}

.doc-tabs__list-caption {
  padding: var(--space-2) var(--space-2) 2px;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.doc-tabs__list-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 4px 0 var(--space-2);
  border-radius: var(--radius-md);
  font-size: 13px;
  color: var(--color-text-primary);
  cursor: default;
}

.doc-tabs__list-item:hover {
  background: var(--color-bg-hover);
}

.doc-tabs__list-item.is-active {
  background: var(--color-bg-active);
}

.doc-tabs__list-item:hover .doc-tab__close,
.doc-tabs__list-item.is-active .doc-tab__close {
  opacity: 1;
}

.doc-tabs__list-empty {
  padding: var(--space-3) var(--space-2);
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.doc-frame--wide {
  position: relative;
}

.tab-menu__scrim {
  position: absolute;
  inset: 0;
  z-index: 4;
}

.tab-menu {
  position: absolute;
  z-index: 5;
  display: flex;
  flex-direction: column;
  min-width: 180px;
  padding: 4px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-elevated);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--color-text-primary) 8%, transparent),
    0 8px 24px -4px var(--shadow-color-md);
}

.tab-menu__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--color-text-primary);
  text-align: left;
}

.tab-menu__item:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.tab-menu__item:disabled {
  color: var(--color-text-tertiary);
}

.tab-menu__item kbd,
.doc-top__keys kbd {
  font: inherit;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.doc-top__keys {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.doc-top__keys kbd {
  padding: 1px 4px;
  border-radius: var(--radius-xs);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
}

.tab-menu__divider {
  height: 0.5px;
  margin: 4px 6px;
  background: var(--color-border-light);
}

/* A 浏览器式：标题栏是浅底，当前标签与正文同色、连成一体。 */
.is-browser.doc-frame__header--tabs {
  padding-top: 5px;
  background: var(--color-bg-sidebar);
  box-shadow: inset 0 -0.5px 0 var(--color-border-default);
}

.is-browser .doc-tab {
  margin-right: 1px;
  border-radius: 8px 8px 0 0;
}

.is-browser .doc-tab:hover {
  background: var(--color-bg-hover);
}

.is-browser .doc-tab.is-active {
  position: relative;
  background: var(--color-bg-default);
  color: var(--color-text-primary);
  box-shadow: 0 0 0 0.5px var(--color-border-default);
  clip-path: inset(-1px -1px 0 -1px);
}

/* B 轻量式：标题栏与正文同底，当前标签只用淡色块区分。 */
.is-pill .doc-tabs {
  align-items: center;
  gap: 2px;
}

.is-pill .doc-tab {
  height: 26px;
  border-radius: var(--radius-md);
}

.is-pill .doc-tab:hover {
  background: var(--color-bg-hover);
}

.is-pill .doc-tab.is-active {
  background: var(--color-bg-active);
  color: var(--color-text-primary);
}
</style>
