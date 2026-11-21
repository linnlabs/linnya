<script setup lang="ts">
import { ref } from 'vue';
import { BaseButton } from '@linnya/renderer-ui';
import { AddIcon, LibraryIcon, LoadingIcon } from '@linnya/renderer-ui/icons';
import StatusBadge, { type BadgeTone } from '../prototypes/StatusBadge.vue';
import CollapsibleSection from '../prototypes/CollapsibleSection.vue';
import EmptyState from '../prototypes/EmptyState.vue';
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

</script>

<template>
  <div class="gallery-section">

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
.candidates__row-icon {
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
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
