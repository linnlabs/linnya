<script setup lang="ts">
import { BaseDropdown, DropdownPanel, ToolbarButton, ToolbarGroup } from '@linnya/renderer-ui';
import {
  BulletListIcon,
  ChevronIcon,
  HeadingIcon,
  ImageIcon,
  MoreIcon,
  NumberedListIcon,
  QuoteIcon,
  TableIcon,
} from '@linnya/renderer-ui/icons';

/**
 * 缩减后的 Markdown 悬浮工具栏原型：粗体、斜体交给选区工具栏和快捷键；
 * “…”的条目与斜杠菜单同一份清单（实施时直接复用斜杠菜单的定义，不另维护）。
 */
withDefaults(defineProps<{ readonly hidden?: boolean }>(), { hidden: false });

const HEADINGS = ['正文', '一级标题', '二级标题', '三级标题'] as const;
const LISTS = [
  { label: '无序列表', icon: BulletListIcon },
  { label: '有序列表', icon: NumberedListIcon },
] as const;
const MORE_ITEMS = ['代码块', '公式', '分隔线', '引用文献', 'AI 写作'] as const;
</script>

<template>
  <div class="md-pill" :class="{ 'is-hidden': hidden }" role="toolbar" aria-label="格式">
    <ToolbarGroup>
      <BaseDropdown class="md-pill__anchor">
        <template #trigger="{ toggle, isOpen }">
          <ToolbarButton label="标题" :active="isOpen" :aria-expanded="isOpen" @click="toggle">
            <HeadingIcon /><ChevronIcon class="md-pill__chevron" direction="down" />
          </ToolbarButton>
        </template>
        <template #content="{ isOpen, close }">
          <DropdownPanel :show="isOpen" class="md-pill__menu">
            <button v-for="item in HEADINGS" :key="item" type="button" class="md-pill__item" @click="close()">{{ item }}</button>
          </DropdownPanel>
        </template>
      </BaseDropdown>
    </ToolbarGroup>
    <ToolbarGroup>
      <BaseDropdown class="md-pill__anchor">
        <template #trigger="{ toggle, isOpen }">
          <ToolbarButton label="列表" :active="isOpen" :aria-expanded="isOpen" @click="toggle">
            <BulletListIcon /><ChevronIcon class="md-pill__chevron" direction="down" />
          </ToolbarButton>
        </template>
        <template #content="{ isOpen, close }">
          <DropdownPanel :show="isOpen" class="md-pill__menu">
            <button v-for="item in LISTS" :key="item.label" type="button" class="md-pill__item" @click="close()">
              <component :is="item.icon" class="md-pill__item-icon" />{{ item.label }}
            </button>
          </DropdownPanel>
        </template>
      </BaseDropdown>
      <ToolbarButton label="引用"><QuoteIcon /></ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup>
      <ToolbarButton label="图片"><ImageIcon /></ToolbarButton>
      <ToolbarButton label="表格"><TableIcon /></ToolbarButton>
    </ToolbarGroup>
    <ToolbarGroup>
      <BaseDropdown class="md-pill__anchor">
        <template #trigger="{ toggle, isOpen }">
          <ToolbarButton label="更多插入" :active="isOpen" :aria-expanded="isOpen" @click="toggle"><MoreIcon direction="horizontal" /></ToolbarButton>
        </template>
        <template #content="{ isOpen, close }">
          <DropdownPanel :show="isOpen" class="md-pill__menu md-pill__menu--end">
            <button v-for="item in MORE_ITEMS" :key="item" type="button" class="md-pill__item" @click="close()">{{ item }}</button>
            <div class="md-pill__hint">在正文输入 / 也能插入</div>
          </DropdownPanel>
        </template>
      </BaseDropdown>
    </ToolbarGroup>
  </div>
</template>

<style scoped>
/* 与 Slides、Canvas 命令栏相同的胶囊外观；实施时应收成 renderer-ui 的公共样式，不再各写一份。 */
.md-pill {
  position: absolute;
  top: 8px;
  left: 50%;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px;
  border-radius: 10px;
  background-color: var(--color-bg-default);
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--color-text-primary) 6%, transparent),
    0 1px 3px var(--shadow-color-xs),
    0 8px 24px -4px var(--shadow-color-md);
  transform: translateX(-50%);
  transition: opacity 160ms ease, transform 160ms ease;
}

.md-pill.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -6px);
}

.md-pill__anchor {
  position: relative;
}

.md-pill :deep(.toolbar-button) {
  width: auto;
  min-width: 28px;
}

.md-pill__chevron {
  width: 10px;
  height: 10px;
  margin-left: 1px;
  color: var(--color-text-tertiary);
}

.md-pill__menu {
  top: calc(100% + 6px);
  left: 0;
  min-width: 132px;
  padding: 4px;
}

.md-pill__menu--end {
  right: 0;
  left: auto;
}

.md-pill__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 30px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--color-text-primary);
  text-align: left;
  white-space: nowrap;
}

.md-pill__item:hover {
  background: var(--color-bg-hover);
}

.md-pill__item-icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-secondary);
}

.md-pill__hint {
  padding: 6px var(--space-2) 2px;
  border-top: 0.5px solid var(--color-border-light);
  margin-top: 4px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
}
</style>
