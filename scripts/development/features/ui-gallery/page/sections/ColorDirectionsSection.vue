<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  BaseButton,
  CustomCheckbox,
  SegmentedTabs,
  Switch,
  type SegmentedTabItem,
} from '@linnya/renderer-ui';
import { AddIcon, ChatIcon, FolderIcon, LibraryIcon } from '@linnya/renderer-ui/icons';
import { COLOR_DIRECTION_VALUES } from '../prototypes/colorDirectionValues.ts';
import RunStatusIndicator from '../prototypes/RunStatusIndicator.vue';
import StatusBadge from '../prototypes/StatusBadge.vue';
import GalleryBlock from '../ui/GalleryBlock.vue';
import GalleryRow from '../ui/GalleryRow.vue';

/**
 * 颜色方向对比（计划阶段）：中性色、强调色、状态色三个维度分开切换，
 * 左边现状、右边所选组合，用真组件并排看。只覆盖浅色与深色；月白蓝有自己的蓝色强调色，不在本轮。
 */
type Theme = 'light' | 'dark';
type TokenMap = Readonly<Record<string, string>>;

const NEUTRAL_TABS: SegmentedTabItem[] = [
  { id: 'current', label: '纯灰（现状）' },
  { id: 'sage', label: '鼠尾草灰' },
  { id: 'warm', label: '暖灰' },
];
const ACCENT_TABS: SegmentedTabItem[] = [
  { id: 'current', label: '现状绿' },
  { id: 'forest', label: '深林绿' },
  { id: 'jade', label: '玉绿' },
  { id: 'ink', label: '墨色操作' },
];
const STATUS_TABS: SegmentedTabItem[] = [
  { id: 'current', label: '现状' },
  { id: 'tuned', label: '协调' },
];

const NOTES: Readonly<Record<string, string>> = {
  'neutral:sage': '灰阶明度不变，加一点点偏向绿色的彩度（OKLCH C≈0.005–0.012），和品牌绿同一家族。Radix 给绿色强调色配的就是这类灰。',
  'neutral:warm': '同样只加极低彩度，色相偏米黄。Notion、Linear 新版都往这个方向走过；过暖会发脏，所以只加到能感觉、看不出颜色。',
  'accent:forest': '不降彩度，改为降明度：更沉、更稳，不发灰。白字对比度 7.0:1。',
  'accent:jade': '色相往青色偏 17°，彩度略降：更清、更冷静，少一点草地感。白字对比度 5.0:1。',
  'accent:ink': '主按钮、勾选、焦点改用墨色，绿色只留给品牌标识和“成功”。界面里几乎不出现大面积绿色。',
  'status:tuned': '四个状态色放到同一组明度与彩度上（现状是 Tailwind 默认值，红蓝很艳、黄色在白底上看不清），成功色和品牌绿分开。',
};

const neutral = ref('current');
const accent = ref('current');
const status = ref('current');
const agree = ref(true);
const notify = ref(true);
const tab = ref('docs');
const PANE_TABS: SegmentedTabItem[] = [
  { id: 'docs', label: '文档' },
  { id: 'chats', label: '对话' },
  { id: 'kb', label: '知识库' },
];

const theme = ref<Theme>('light');
let observer: MutationObserver | null = null;
function readTheme() {
  const value = document.documentElement.getAttribute('data-linnya-ui-theme');
  theme.value = value === 'dark' ? 'dark' : 'light';
}
const isMoonBlue = ref(false);
onMounted(() => {
  const sync = () => {
    readTheme();
    isMoonBlue.value = document.documentElement.getAttribute('data-linnya-ui-theme') === 'moon-blue';
  };
  sync();
  observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-linnya-ui-theme'] });
});
onBeforeUnmount(() => observer?.disconnect());

function pick(group: Readonly<Record<string, Readonly<Record<Theme, TokenMap>>>>, id: string): TokenMap {
  return id in group ? group[id][theme.value] : {};
}

/** 组合后的覆盖变量；派生量（悬停、焦点环、成功色）在根上已解析，这里必须显式给出。 */
const candidateStyle = computed(() => {
  const tokens: Record<string, string> = {
    ...pick(COLOR_DIRECTION_VALUES.neutral, neutral.value),
    ...pick(COLOR_DIRECTION_VALUES.brand, accent.value),
    ...pick(COLOR_DIRECTION_VALUES.status, status.value),
  };
  if (tokens['text-primary']) {
    const alpha = theme.value === 'dark' ? [10, 16] : [7, 12];
    tokens['bg-hover'] = `color-mix(in srgb, ${tokens['text-primary']} ${alpha[0]}%, transparent)`;
    tokens['bg-hover-strong'] = `color-mix(in srgb, ${tokens['text-primary']} ${alpha[1]}%, transparent)`;
  }
  if (theme.value === 'light' && !tokens['bg-default']) {
    tokens['bg-default'] = '#ffffff';
  }
  return Object.fromEntries(Object.entries(tokens).map(([name, value]) => [`--color-${name}`, value]));
});

const activeNotes = computed(() =>
  [`neutral:${neutral.value}`, `accent:${accent.value}`, `status:${status.value}`]
    .map(key => NOTES[key])
    .filter((note): note is string => Boolean(note))
);

const PANES = [
  { id: 'current', label: '现状' },
  { id: 'candidate', label: '所选组合' },
] as const;
</script>

<template>
  <div class="gallery-section">
    <GalleryBlock
      title="颜色方向（计划中）"
      note="三个维度可以分开选，右侧即时组合。这些是研究用的候选值，不是产品 token。只覆盖浅色与深色。"
    >
      <GalleryRow label="中性色"><SegmentedTabs v-model="neutral" :tabs="NEUTRAL_TABS" /></GalleryRow>
      <GalleryRow label="强调色"><SegmentedTabs v-model="accent" :tabs="ACCENT_TABS" /></GalleryRow>
      <GalleryRow label="状态色"><SegmentedTabs v-model="status" :tabs="STATUS_TABS" /></GalleryRow>
      <GalleryRow v-if="activeNotes.length > 0" label="说明" align="start">
        <ul class="color-dir__notes">
          <li v-for="note in activeNotes" :key="note">{{ note }}</li>
        </ul>
      </GalleryRow>
      <p v-if="isMoonBlue" class="color-dir__moon">当前是月白蓝主题：本轮只比较浅色与深色，请切到这两个主题再看。</p>

      <div class="color-dir__panes">
        <div v-for="pane in PANES" :key="pane.id" class="color-dir__pane-wrap">
          <p class="color-dir__pane-label">{{ pane.label }}</p>
          <div class="color-dir__pane" :style="pane.id === 'candidate' ? candidateStyle : undefined">
            <aside class="color-dir__sidebar">
              <div class="color-dir__nav is-selected"><FolderIcon class="color-dir__icon" />项目文档</div>
              <div class="color-dir__nav"><LibraryIcon class="color-dir__icon" />知识库</div>
              <p class="color-dir__group">最近对话</p>
              <div class="color-dir__nav"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">季度复盘演示稿</span><RunStatusIndicator status="running" /></div>
              <div class="color-dir__nav is-attention"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">竞品对比表</span><RunStatusIndicator status="awaiting-approval" /></div>
              <div class="color-dir__nav"><ChatIcon class="color-dir__icon" /><span class="color-dir__title">总结项目现状</span><span class="color-dir__time">昨天</span></div>
            </aside>
            <main class="color-dir__main">
              <SegmentedTabs v-model="tab" :tabs="PANE_TABS" />
              <h3 class="color-dir__heading">季度复盘</h3>
              <p class="color-dir__body">
                第三季度新增 12 位付费用户，留存比上季提高 4 个百分点。详细数据见
                <a class="color-dir__link" href="#" @click.prevent>投资人汇报数据表</a>，访谈要点放在知识库。
              </p>
              <p class="color-dir__meta">修改于 11:20 · 3 处引用</p>
              <div class="color-dir__row">
                <BaseButton variant="primary" size="md"><template #icon><AddIcon /></template>新建文档</BaseButton>
                <BaseButton variant="outline" size="md">导出</BaseButton>
                <BaseButton variant="tint" tone="accent" size="md">引用</BaseButton>
              </div>
              <div class="color-dir__row">
                <CustomCheckbox v-model="agree">回答时引用知识库</CustomCheckbox>
                <Switch v-model="notify" ariaLabel="完成时通知" />
                <span class="color-dir__focus">焦点环</span>
              </div>
              <div class="color-dir__row">
                <StatusBadge tone="accent">默认</StatusBadge>
                <StatusBadge tone="success" dot>已解析</StatusBadge>
                <StatusBadge tone="warning" dot>2 个来源失效</StatusBadge>
                <StatusBadge tone="error" dot>解析失败</StatusBadge>
                <StatusBadge tone="info" dot>新</StatusBadge>
              </div>
              <div class="color-dir__card">
                <p class="color-dir__card-title">访谈纪要 / 用户 A</p>
                <p class="color-dir__meta">知识库 · 18 段</p>
              </div>
            </main>
          </div>
        </div>
      </div>
    </GalleryBlock>
  </div>
</template>

<style>
.color-dir__notes {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 640px; /* scale-exempt: 说明文字行宽 */
  margin: 0;
  padding-left: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-footnote);
  line-height: var(--line-height-footnote);
}

.color-dir__moon {
  margin: 0;
  color: var(--color-warning-text);
  font-size: var(--font-size-footnote);
}

.color-dir__panes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.color-dir__pane-label {
  margin: 0 0 var(--space-1-5);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-footnote);
}

.color-dir__pane {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr); /* scale-exempt: 版面尺寸 */
  overflow: hidden;
  border-radius: var(--radius-lg);
  background-color: var(--color-bg-default);
  box-shadow: inset 0 0 0 var(--border-width-hairline) var(--color-border-light);
  color: var(--color-text-primary);
}

.color-dir__sidebar {
  display: flex;
  flex-direction: column;
  gap: var(--space-0-5);
  padding: var(--space-2);
  background-color: var(--color-bg-sidebar);
  box-shadow: inset calc(-1 * var(--border-width-hairline)) 0 0 var(--color-border-light);
}

.color-dir__nav {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  height: var(--control-height-md);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-body);
}

.color-dir__nav:hover {
  background-color: var(--color-bg-hover);
}

.color-dir__nav.is-selected {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.color-dir__nav.is-attention {
  color: var(--color-text-primary);
}

.color-dir__icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
}

.color-dir__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-dir__time {
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__group {
  margin: var(--space-3) 0 var(--space-1);
  padding: 0 var(--space-2);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__main {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  padding: var(--space-4);
  background-color: var(--color-bg-surface);
}

.color-dir__heading {
  margin: 0;
  font-size: var(--font-size-title);
  font-weight: var(--font-weight-semibold);
}

.color-dir__body {
  margin: 0;
  color: var(--color-text-secondary);
  line-height: var(--line-height-body);
}

.color-dir__link {
  color: var(--color-text-link);
}

.color-dir__meta {
  margin: 0;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}

.color-dir__focus {
  padding: var(--space-0-5) var(--space-2);
  border-radius: var(--radius-sm);
  outline: var(--focus-ring-width) solid var(--color-focus-ring);
  outline-offset: 2px;
  color: var(--color-text-tertiary);
  font-size: var(--font-size-caption);
}

.color-dir__card {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background-color: var(--color-bg-subtle);
}

.color-dir__card-title {
  margin: 0 0 var(--space-0-5);
  font-weight: var(--font-weight-medium);
}
</style>
