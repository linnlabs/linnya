<script setup lang="ts">
import { ref } from 'vue';
import '../../../../../../apps/renderer/domains/knowledgebase/styles/components/KnowledgeBaseList.css';
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
  { title: '默认知识库', body: '未归类的资料都放在这里', count: '24 个文档', isDefault: true },
  { title: '行业报告', body: '券商研报与行业白皮书', count: '12 个文档', isDefault: false },
  { title: '用户访谈', body: '访谈录音转写与纪要', count: '21 个文档', isDefault: false },
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
        <!-- 卡片直接沿用知识库列表页的真实样式（边框 + 柔和阴影），不在画廊里另写一份。 -->
        <section class="kb-list-view list-example__kb">
          <div class="kb-grid">
            <article v-for="card in CARDS" :key="card.title" class="kb-card" role="button" tabindex="0">
              <div class="card-main">
                <div class="card-title-row">
                  <span class="card-icon-inline"><LibraryIcon class="kb-icon" /></span>
                  <h3 class="card-title">{{ card.title }}</h3>
                  <span v-if="card.isDefault" class="default-badge">默认</span>
                </div>
                <p class="card-subtitle">{{ card.body }}</p>
                <div class="card-meta">
                  <span class="meta-item">{{ card.count }}</span>
                </div>
              </div>
            </article>
          </div>
        </section>
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







/* 知识库页自带整页高度和背景，嵌在示例里只保留卡片网格。 */
.list-example__kb {
  min-height: 0;
}

.list-example__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
