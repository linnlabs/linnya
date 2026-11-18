<script setup lang="ts">
import { ref } from 'vue';
import { BaseButton } from '@linnya/renderer-ui';
import { AddIcon, LibraryIcon, LoadingIcon } from '@linnya/renderer-ui/icons';
import StatusBadge, { type BadgeTone } from '../prototypes/StatusBadge.vue';
import CollapsibleSection from '../prototypes/CollapsibleSection.vue';
import EmptyState from '../prototypes/EmptyState.vue';
import RunStatusIndicator, { type RunStatus } from '../prototypes/RunStatusIndicator.vue';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

const TONES: readonly { tone: BadgeTone; text: string }[] = [
  { tone: 'neutral', text: '第 2 页' },
  { tone: 'accent', text: '默认' },
  { tone: 'success', text: '已解析' },
  { tone: 'warning', text: '2 个来源失效' },
  { tone: 'error', text: '解析失败' },
  { tone: 'info', text: '新' },
];

const filesOpen = ref(true);
const stepsOpen = ref(false);

interface SidebarRow {
  readonly id: string;
  readonly title: string;
  readonly time: string;
  status: RunStatus;
}

const rows = ref<SidebarRow[]>([
  { id: 'a', title: '把季度复盘整理成三页演示稿', time: '刚刚', status: 'running' },
  { id: 'b', title: '检索竞品资料并写对比表', time: '2 分钟前', status: 'awaiting-answer' },
  { id: 'c', title: '批量重命名访谈纪要', time: '5 分钟前', status: 'awaiting-approval' },
  { id: 'd', title: '翻译投资人汇报', time: '11:20', status: 'interrupted' },
  { id: 'e', title: '总结项目现状', time: '昨天', status: 'idle' },
]);
const selectedId = ref('e');

/** 打开对话：中断状态查看后消失；运行中与等待处理的状态由运行本身结束，不因查看而清除。 */
function openRow(row: SidebarRow) {
  selectedId.value = row.id;
  if (row.status === 'interrupted') row.status = 'idle';
}

function resetRows() {
  const initial: readonly RunStatus[] = ['running', 'awaiting-answer', 'awaiting-approval', 'interrupted', 'idle'];
  rows.value.forEach((row, index) => { row.status = initial[index]; });
  selectedId.value = 'e';
}
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock title="侧栏：Agent 运行状态" note="对话行前面没有图标，状态就放在行首这块预留的位置，标题对齐不变，行尾始终显示时间。等你回答、等你审批是必须处理的，带淡光环；中断只提示看一眼，点开该对话后消失。悬停圆点可看说明。">
      <GalleryRow label="图例">
        <span v-for="status in (['running', 'awaiting-answer', 'awaiting-approval', 'interrupted'] as const)" :key="status" class="candidates__legend">
          <RunStatusIndicator :status="status" />
          <span>{{ { running: '进行中', 'awaiting-answer': '需要回答', 'awaiting-approval': '需要审批', interrupted: '中断（查看后消失）' }[status] }}</span>
        </span>
        <span class="candidates__legend candidates__legend--muted">无运行：行首留空</span>
      </GalleryRow>
      <GalleryRow label="侧栏列表" align="start">
        <div class="candidates__sidebar">
          <div
            v-for="row in rows"
            :key="row.id"
            class="candidates__row"
            :class="{ 'is-selected': row.id === selectedId, 'is-attention': row.status === 'awaiting-answer' || row.status === 'awaiting-approval' }"
            role="button"
            tabindex="0"
            @click="openRow(row)"
            @keydown.enter="openRow(row)"
          >
            <span class="candidates__row-status">
              <RunStatusIndicator v-if="row.status !== 'idle'" :status="row.status" />
            </span>
            <span class="candidates__row-title">{{ row.title }}</span>
            <span class="candidates__row-time">{{ row.time }}</span>
          </div>
        </div>
        <BaseButton variant="plain" size="sm" @click="resetRows">重置状态</BaseButton>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="StatusBadge 徽标" note="取代各处自写的默认、新、解析状态、修订、日期、页码徽标。tone 表达语义；dot 加状态圆点，只有圆点时即状态点。">
      <GalleryRow label="sm">
        <StatusBadge v-for="item in TONES" :key="item.tone" :tone="item.tone">{{ item.text }}</StatusBadge>
      </GalleryRow>
      <GalleryRow label="md · 带圆点">
        <StatusBadge v-for="item in TONES" :key="item.tone" :tone="item.tone" size="md" dot>{{ item.text }}</StatusBadge>
      </GalleryRow>
      <GalleryRow label="只有圆点">
        <StatusBadge v-for="item in TONES" :key="item.tone" :tone="item.tone" dot />
      </GalleryRow>
      <GalleryRow label="放在标题旁">
        <span class="candidates__title-row"><LibraryIcon class="candidates__row-icon" />默认知识库<StatusBadge tone="accent">默认</StatusBadge></span>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="EmptyState 空状态" note="inline 用在列表、侧栏里；page 用在页面或面板中央。">
      <GalleryRow label="inline">
        <div class="candidates__inline-box"><EmptyState variant="inline" title="没有匹配的文件" /></div>
      </GalleryRow>
      <GalleryRow label="page" align="start">
        <div class="candidates__page-box">
          <EmptyState title="还没有知识库" description="把报告、访谈和资料放进知识库，Linnya 回答问题时会引用它们。">
            <template #icon><LibraryIcon /></template>
            <template #action>
              <BaseButton variant="outline" tone="accent" size="md"><template #icon><AddIcon /></template>新建知识库</BaseButton>
            </template>
          </EmptyState>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="CollapsibleSection 折叠区" note="箭头用 ChevronIcon 的方向状态，不再各自旋转；内容高度动效不需要测量。">
      <GalleryRow label="两组" align="start">
        <div class="candidates__collapsibles">
          <CollapsibleSection v-model:open="filesOpen" title="引用的文件" meta="3">
            <p class="candidates__collapsible-line">季度复盘.md</p>
            <p class="candidates__collapsible-line">访谈纪要 / 用户 A.md</p>
            <p class="candidates__collapsible-line">投资人汇报数据表</p>
          </CollapsibleSection>
          <CollapsibleSection v-model:open="stepsOpen" title="执行步骤" meta="12 步">
            <p class="candidates__collapsible-line">读取 3 个文件，写入 1 个演示稿。</p>
          </CollapsibleSection>
        </div>
      </GalleryRow>
    </GalleryBlock>

    <GalleryBlock title="加载" note="不新增组件：7 处自写的旋转 keyframes 改用图标库已有的 LoadingIcon（自带旋转与减少动态效果处理）。Agent 运行中用 Linnya 摇曳动态（LinnyaLoadingIcon thinking）。">
      <GalleryRow label="尺寸">
        <LoadingIcon class="candidates__loading candidates__loading--14" />
        <LoadingIcon class="candidates__loading candidates__loading--16" />
        <LoadingIcon class="candidates__loading candidates__loading--20" />
      </GalleryRow>
      <GalleryRow label="图标 + 说明">
        <span class="candidates__loading-label"><LoadingIcon class="candidates__loading candidates__loading--14" />正在解析 PDF…</span>
      </GalleryRow>
    </GalleryBlock>
  </div>
</template>

<style>
.candidates__legend {
  display: inline-flex;
  gap: var(--space-1-5);
  align-items: center;
  margin-right: var(--space-3);
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}

.candidates__legend--muted {
  color: var(--color-text-tertiary);
}

.candidates__sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  width: 280px; /* scale-exempt: 版面尺寸 */
  padding: var(--space-2);
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-sidebar);
}

.candidates__row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.candidates__row:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.candidates__row.is-selected {
  background-color: var(--color-bg-active-subtle);
  color: var(--color-text-primary);
}

/* 等用户处理的对话标题提升一级文字色，扫一眼就能看到。 */
.candidates__row.is-attention {
  color: var(--color-text-primary);
}

.candidates__row-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

/* 行首状态槽：与产品侧栏行的图标槽同宽（18px），没有状态时留空，标题位置不随状态跳动。 */
.candidates__row-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.candidates__row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidates__row-time {
  flex: none;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
  font-variant-numeric: tabular-nums;
}

.candidates__title-row {
  display: inline-flex;
  gap: var(--space-1-5);
  align-items: center;
  font-weight: var(--font-weight-medium);
}

.candidates__inline-box {
  width: 280px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-md);
  background-color: var(--color-bg-sidebar);
}

.candidates__page-box {
  width: 480px; /* scale-exempt: 版面尺寸 */
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-surface);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
}

.candidates__collapsibles {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  width: 320px; /* scale-exempt: 版面尺寸 */
}

.candidates__collapsible-line {
  margin: 0;
  padding: var(--space-1) 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}

.candidates__loading {
  color: var(--color-text-tertiary);
}

.candidates__loading--14 {
  width: 14px;
  height: 14px;
}

.candidates__loading--16 {
  width: 16px;
  height: 16px;
}

.candidates__loading--20 {
  width: 20px;
  height: 20px;
}

.candidates__loading-label {
  display: inline-flex;
  gap: var(--space-1-5);
  align-items: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
}
</style>
