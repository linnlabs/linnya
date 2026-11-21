<script setup lang="ts">
import { computed } from 'vue';
import { IconButton } from '@linnya/renderer-ui';
import { AddCircleIcon, AddIcon, AppsIcon, FolderIcon, FolderOpenIcon, LibraryIcon, MoreIcon, PinIcon } from '@linnya/renderer-ui/icons';
import RunStatusIndicator from './RunStatusIndicator.vue';
import { RUN_STATUS_PRIORITY, RUN_STATUS_TRAILING, type RunStatus } from './runStatus';

/**
 * 侧栏列表态的示意（W-0352）：尺寸、颜色与行结构照搬 WorkspaceSidebar.css / SidebarChatList.css，
 * 行首 18px 状态位与项目文件夹图标同列。不是真实侧栏组件。
 *
 * variant：none 现状；quiet 推荐；colored 11-17 候选。
 */
export interface RunStatusChat {
  readonly id: string;
  readonly title: string;
  readonly time: string;
  readonly pinned?: boolean;
  status: RunStatus;
}

export interface RunStatusProject {
  readonly id: string;
  readonly name: string;
  readonly expanded: boolean;
  readonly chats: RunStatusChat[];
}

const props = withDefaults(
  defineProps<{
    readonly projects: RunStatusProject[];
    readonly variant: 'none' | 'quiet' | 'colored';
    readonly activeId?: string | null;
    readonly width?: number;
    /** 演示用：让某一行保持悬停态。 */
    readonly hoverId?: string | null;
    readonly showEntries?: boolean;
  }>(),
  { activeId: null, width: 260, hoverId: null, showEntries: true },
);

const emit = defineEmits<{ open: [chat: RunStatusChat] }>();

const ENTRIES = [
  { icon: AddIcon, label: '新对话' },
  { icon: AddCircleIcon, label: '新项目' },
  { icon: LibraryIcon, label: '知识库' },
  { icon: AppsIcon, label: '插件' },
] as const;

/** 正在看的对话：中断当场就算看过，不再出圆点。 */
function shownStatus(chat: RunStatusChat): RunStatus {
  if (props.variant === 'none') return 'idle';
  if (chat.status === 'interrupted' && chat.id === props.activeId) return 'idle';
  return chat.status;
}

function needsYou(status: RunStatus): boolean {
  return status === 'awaiting-answer' || status === 'awaiting-approval';
}

function trailing(chat: RunStatusChat): string {
  const status = shownStatus(chat);
  return props.variant === 'quiet' ? (RUN_STATUS_TRAILING[status] ?? chat.time) : chat.time;
}

/** 收起的项目：行尾只给里面最需要处理的一种状态。 */
function projectSummary(project: RunStatusProject): { status: RunStatus; label: string } | null {
  if (project.expanded || props.variant !== 'quiet') return null;
  const statuses = project.chats.map(shownStatus);
  const status = RUN_STATUS_PRIORITY.find(item => statuses.includes(item));
  if (!status) return null;
  const count = statuses.filter(item => item === status).length;
  const labels: Record<Exclude<RunStatus, 'idle'>, string> = {
    'awaiting-approval': `${count} 个对话等你审批`,
    'awaiting-answer': `${count} 个对话等你回答`,
    interrupted: `${count} 个对话运行已中断`,
    running: `${count} 个对话正在运行`,
  };
  return { status, label: labels[status as Exclude<RunStatus, 'idle'>] };
}

const style = computed(() => ({ width: `${props.width}px` }));
</script>

<template>
  <nav class="rs-sidebar" :style="style">
    <template v-if="showEntries">
      <div v-for="entry in ENTRIES" :key="entry.label" class="rs-row rs-row--entry">
        <span class="rs-row__icon"><component :is="entry.icon" /></span>
        <span class="rs-row__label">{{ entry.label }}</span>
      </div>
      <div class="rs-heading">项目</div>
    </template>
    <template v-for="project in projects" :key="project.id">
      <div class="rs-row rs-row--project" :class="{ 'is-hover': hoverId === project.id }">
        <span class="rs-row__icon"><FolderIcon /></span>
        <span class="rs-row__label">{{ project.name }}</span>
        <span v-if="projectSummary(project)" class="rs-row__summary">
          <RunStatusIndicator :status="projectSummary(project)!.status" :label="projectSummary(project)!.label" />
        </span>
        <span class="rs-row__actions">
          <IconButton label="打开项目" class="rs-row__action"><FolderOpenIcon /></IconButton>
          <IconButton label="更多选项" class="rs-row__action"><MoreIcon direction="horizontal" /></IconButton>
        </span>
      </div>
      <template v-if="project.expanded">
        <div
          v-for="chat in project.chats"
          :key="chat.id"
          class="rs-row rs-row--chat"
          :class="{
            'is-active': chat.id === activeId,
            'is-hover': chat.id === hoverId,
            'is-pinned': chat.pinned,
            'needs-you': variant !== 'none' && needsYou(shownStatus(chat)),
          }"
          role="button"
          tabindex="0"
          @click="emit('open', chat)"
          @keydown.enter="emit('open', chat)"
        >
          <span class="rs-row__icon rs-row__status">
            <RunStatusIndicator
              v-if="shownStatus(chat) !== 'idle'"
              :status="shownStatus(chat)"
              :variant="variant === 'colored' ? 'colored' : 'quiet'"
            />
            <PinIcon v-else-if="chat.pinned" class="rs-row__pin" />
          </span>
          <span class="rs-row__label">{{ chat.title }}</span>
          <span class="rs-row__time" :class="{ 'is-flag': trailing(chat) !== chat.time }">{{ trailing(chat) }}</span>
          <span class="rs-row__actions">
            <IconButton label="更多选项" class="rs-row__action"><MoreIcon direction="horizontal" /></IconButton>
          </span>
        </div>
      </template>
    </template>
  </nav>
</template>

<style>
/* 数值照搬 WorkspaceSidebar.css 与 SidebarChatList.css，便于和真实侧栏对比。 */
.rs-sidebar {
  --rs-label-color: color-mix(in srgb, var(--color-text-secondary) 94%, var(--color-text-tertiary));
  --rs-heading-color: color-mix(in srgb, var(--color-text-secondary) 84%, var(--color-text-tertiary));
  --rs-muted-color: color-mix(in srgb, var(--color-text-secondary) 70%, var(--color-text-tertiary));

  display: flex;
  flex: none;
  flex-direction: column;
  box-sizing: border-box;
  padding: var(--space-2) 0;
  overflow: hidden;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-sidebar);
  box-shadow: 0 0 0 1px var(--color-border-light);
}

.rs-row {
  position: relative;
  display: flex;
  flex: none;
  gap: var(--space-2);
  align-items: center;
  box-sizing: border-box;
  width: calc(100% - 20px); /* scale-exempt: 侧栏行左右各 10px 外边距 */
  height: 32px; /* scale-exempt: 侧栏行高 */
  margin: 1px 10px; /* scale-exempt: 侧栏行外边距 */
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.rs-row:hover,
.rs-row.is-hover {
  background-color: var(--color-bg-hover);
}

.rs-row.is-active {
  background-color: var(--color-bg-navigation-highlight);
  color: var(--color-text-primary);
}

.rs-row:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
}

.rs-row__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--color-text-secondary);
}

.rs-row__icon > svg {
  width: 18px;
  height: 18px;
}

.rs-row__pin {
  width: 16px;
  height: 16px;
  color: var(--color-accent);
}

.rs-row__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--rs-label-color);
  font-size: var(--font-size-prose);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.rs-row.is-active .rs-row__label,
.rs-row.needs-you .rs-row__label {
  color: var(--color-text-primary);
}

.rs-row__time {
  flex: none;
  color: var(--rs-muted-color);
  font-size: var(--font-size-caption);
  white-space: nowrap;
}

.rs-row.is-active .rs-row__time {
  color: var(--color-text-primary);
}

.rs-row__time.is-flag {
  color: var(--color-accent-text);
  font-weight: var(--font-weight-medium);
}

.rs-row__summary {
  display: inline-flex;
  flex: none;
}

.rs-row__actions {
  position: absolute;
  top: 50%;
  right: 5px; /* scale-exempt: 与真实侧栏行内操作位置一致 */
  display: flex;
  gap: var(--space-0-5);
  align-items: center;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
}

.rs-row:hover .rs-row__actions,
.rs-row.is-hover .rs-row__actions {
  opacity: 1;
  pointer-events: auto;
}

.rs-row:hover .rs-row__time,
.rs-row.is-hover .rs-row__time {
  opacity: 0;
}

/* 项目行悬停时记号留着，左移让出两个操作按钮的位置，悬停记号仍能看到数量。 */
.rs-row--project:hover .rs-row__summary,
.rs-row--project.is-hover .rs-row__summary {
  margin-right: 50px; /* scale-exempt: 两个行内操作按钮的宽度 */
}

.rs-heading {
  margin: var(--space-3) 18px var(--space-1); /* scale-exempt: 与行内文字左缘对齐 */
  color: var(--rs-heading-color);
  font-size: var(--font-size-caption);
}
</style>
