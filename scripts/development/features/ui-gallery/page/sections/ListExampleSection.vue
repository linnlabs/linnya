<script setup lang="ts">
import { ref } from 'vue';
import { IconButton, TagChip } from '@linnya/renderer-ui';
import {
  ChatIcon,
  DocumentIcon,
  FolderIcon,
  LibraryIcon,
  MoreIcon,
  TableIcon,
} from '@linnya/renderer-ui/icons';

interface ListRow {
  readonly id: string;
  readonly name: string;
  readonly meta: string;
  readonly icon: 'chat' | 'document' | 'folder' | 'table';
}

const ROWS: readonly ListRow[] = [
  { id: 'a', name: '整理产品路线图成三页演示稿', meta: '11:43', icon: 'chat' },
  { id: 'b', name: '季度复盘.md', meta: '昨天', icon: 'document' },
  { id: 'c', name: '访谈纪要', meta: '9月30日', icon: 'folder' },
  { id: 'd', name: '投资人汇报数据表', meta: '9月28日', icon: 'table' },
  { id: 'e', name: '一段名称很长、需要省略号截断并在悬停时让出操作区的对话标题', meta: '9月21日', icon: 'chat' },
];

const ICONS = { chat: ChatIcon, document: DocumentIcon, folder: FolderIcon, table: TableIcon } as const;

const CARDS = [
  { title: '行业报告', body: '12 份文档 · 3 个画布', status: 'success', statusText: '已同步' },
  { title: '竞品调研', body: '8 份文档 · 引用 34 处', status: 'warning', statusText: '2 个来源已失效' },
  { title: '用户访谈', body: '21 段录音转写', status: 'info', statusText: '正在转写' },
] as const;

const selected = ref('b');
</script>

<template>
  <div class="gallery-section list-example">
    <div class="list-example__layout">
      <div class="list-example__sidebar">
        <div class="list-example__heading">最近</div>
        <div
          v-for="row in ROWS"
          :key="row.id"
          class="list-example__row"
          :class="{ 'is-selected': row.id === selected }"
          role="button"
          tabindex="0"
          @click="selected = row.id"
          @keydown.enter="selected = row.id"
        >
          <component :is="ICONS[row.icon]" class="list-example__icon" />
          <span class="list-example__name">{{ row.name }}</span>
          <span class="list-example__meta">{{ row.meta }}</span>
          <span class="list-example__actions">
            <IconButton size="xs" label="更多操作"><MoreIcon direction="horizontal" /></IconButton>
          </span>
        </div>
      </div>

      <div class="list-example__content">
        <div class="list-example__heading">知识库</div>
        <div class="list-example__cards">
          <article v-for="card in CARDS" :key="card.title" class="list-example__card" tabindex="0">
            <div class="list-example__card-title">
              <LibraryIcon class="list-example__icon" />
              <span>{{ card.title }}</span>
            </div>
            <p class="list-example__card-body">{{ card.body }}</p>
            <span
              class="list-example__badge"
              :style="{ backgroundColor: `var(--color-${card.status}-bg)`, color: `var(--color-${card.status}-text)` }"
            >
              {{ card.statusText }}
            </span>
          </article>
        </div>
        <div class="list-example__tags">
          <TagChip label="路线图" />
          <TagChip label="季度复盘" closable />
          <TagChip label="投资人" closable />
        </div>
      </div>
    </div>
  </div>
</template>

<style>
.list-example__layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr); /* scale-exempt: 版面尺寸 */
  max-width: 960px; /* scale-exempt: 版面尺寸 */
  min-height: 420px; /* scale-exempt: 版面尺寸 */
  overflow: hidden;
  border: var(--border-width-hairline) solid var(--color-border-light);
  border-radius: var(--radius-lg);
}

.list-example__sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  padding: var(--space-3) var(--space-2);
  background-color: var(--color-bg-sidebar);
  border-right: var(--border-width-hairline) solid var(--color-border-sidebar);
}

.list-example__heading {
  padding: var(--space-2) var(--space-2) var(--space-1);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
  font-weight: var(--font-weight-medium);
}

.list-example__row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-height-md);
  padding: 0 var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.list-example__row:hover,
.list-example__row:focus-within {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.list-example__row.is-selected {
  background-color: var(--color-bg-active-subtle);
  color: var(--color-text-primary);
}

.list-example__icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.list-example__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.list-example__meta {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
  font-variant-numeric: tabular-nums;
}

/* 行内操作只在悬停、聚焦时出现并替换时间；按钮比行底色再高一层。 */
.list-example__actions {
  display: none;
  --linnya-ui-icon-button-hover-bg: var(--linnya-ui-icon-button-hover-bg-raised);
}

.list-example__row:hover .list-example__actions,
.list-example__row:focus-within .list-example__actions {
  display: flex;
}

.list-example__row:hover .list-example__meta,
.list-example__row:focus-within .list-example__meta {
  display: none;
}

.list-example__content {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  background-color: var(--color-bg-default);
}

.list-example__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); /* scale-exempt: 版面尺寸 */
  gap: var(--space-3);
}

.list-example__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--border-width-hairline) solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-surface);
  cursor: pointer;
  transition: border-color var(--duration-micro) var(--ease-standard);
}

.list-example__card:hover {
  border-color: var(--color-border-hover);
}

.list-example__card-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-size-subtitle);
  line-height: var(--line-height-subtitle);
  font-weight: var(--font-weight-semibold);
}

.list-example__card-body {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.list-example__badge {
  display: inline-flex;
  align-items: center;
  height: 20px; /* scale-exempt: 徽标高度 */
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-caption);
  line-height: var(--line-height-caption);
}

.list-example__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
