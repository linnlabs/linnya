<template>
  <!--
    设计说明（品牌化图标进度）：
    - 组件本体只显示一个 Linnya 图标
    - 进度通过“自下而上裁切显示彩色层”的方式体现（灰底 + 彩色叠层）
    - 信息卡片使用 TextPopover（点击触发），避免与 hover 下拉菜单/其他交互冲突
  -->
  <div class="kg-progress" :class="{ compact }" :style="cssVars">
    <!-- 列表页（compact）：仅展示图标，不弹卡片，避免 hover/点击干扰卡片点击 -->
    <div
      v-if="compact"
      class="kg-icon"
      :class="{ compact }"
      :aria-label="knowledgeBaseMessage('knowledgeBase.graph.ariaLabel')"
      role="img"
    >
      <div class="kg-icon-layer kg-icon-layer--base">
        <LinnyaIcon />
      </div>
      <div class="kg-icon-layer kg-icon-layer--fill" :class="{ empty: !hasValue }">
        <LinnyaIcon />
      </div>
    </div>

    <!-- 详情页（非 compact）：点击图标弹出小卡片 -->
    <TextPopover
      v-else
      :trigger-title="tooltipTitle"
      trigger-mode="hover"
      trigger-class="kg-trigger"
      placement="auto"
      max-width="280px"
    >
      <template #trigger>
        <span
          class="kg-icon"
          :aria-label="knowledgeBaseMessage('knowledgeBase.graph.ariaLabel')"
          role="img"
        >
          <span class="kg-icon-layer kg-icon-layer--base">
            <LinnyaIcon />
          </span>
          <span class="kg-icon-layer kg-icon-layer--fill" :class="{ empty: !hasValue }">
            <LinnyaIcon />
          </span>
        </span>
      </template>

      <template #content>
        <div class="kg-popover">
          <div class="kg-popover-title">{{ statusText }}</div>
          <div class="kg-popover-sub">
            {{ knowledgeBaseMessage('knowledgeBase.graph.popover.progress', { percent: displayPercentText }) }}
          </div>
        </div>
      </template>
    </TextPopover>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { LinnyaIcon } from '@linnya/renderer-ui/icons';
import { TextPopover } from '@linnya/renderer-ui';
import { useKnowledgeBaseLocalization } from './useKnowledgeBaseLocalization';

const props = defineProps<{
  percent: number | null;
  totalUnits?: number | null;
  doneUnits?: number | null;
  compact?: boolean;
  showDetail?: boolean;
  /**
   * 图标尺寸（仅在非 compact 模式下生效）
   * - sm: 更小（适合非常紧凑的列表/表格）
   * - md: 默认
   * - lg: 详情页更醒目
   */
  size?: 'sm' | 'md' | 'lg';
}>();

const { knowledgeBaseMessage } = useKnowledgeBaseLocalization();

const hasValue = computed(() => typeof props.percent === 'number' && Number.isFinite(props.percent));

const clampedPercent = computed(() => {
  if (!hasValue.value) return 0;
  const pct = props.percent;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, Math.round(pct)));
});

const displayPercentText = computed(() => {
  return hasValue.value ? `${clampedPercent.value}%` : '—';
});

const compact = computed(() => props.compact === true);
const size = computed(() => props.size ?? 'md');

const statusText = computed(() => {
  // 没有任何进度值：通常表示“尚未开始抽取 / 后端暂无进度”
  if (!hasValue.value) return knowledgeBaseMessage('knowledgeBase.graph.status.notStarted');
  if (clampedPercent.value >= 100) return knowledgeBaseMessage('knowledgeBase.graph.status.completed');
  return knowledgeBaseMessage('knowledgeBase.graph.status.inProgress');
});

const cssVars = computed((): Record<string, string> => {
  const progress = hasValue.value ? `${clampedPercent.value}%` : '0%';
  // 说明：LinnyaIcon 使用 1em 尺寸，这里用 font-size 同步控制宽高。
  const iconPx = (() => {
    if (compact.value) return 16;
    if (size.value === 'lg') return 22;
    if (size.value === 'sm') return 16;
    return 18;
  })();

  return {
    '--kg-progress': progress,
    '--kg-icon-size': `${iconPx}px`,
  };
});

const tooltipTitle = computed(() => {
  return hasValue.value
    ? knowledgeBaseMessage('knowledgeBase.graph.tooltip.withPercent', {
      statusText: statusText.value,
      percent: clampedPercent.value,
    })
    : knowledgeBaseMessage('knowledgeBase.graph.tooltip.empty', {
      statusText: statusText.value,
    });
});
</script>
