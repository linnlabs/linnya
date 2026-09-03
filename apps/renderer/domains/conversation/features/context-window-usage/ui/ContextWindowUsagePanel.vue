<template>
  <section
    class="usage-breakdown-panel"
    role="dialog"
    :aria-labelledby="titleId"
  >
    <h2 :id="titleId" class="usage-breakdown-panel__title">{{ title }}</h2>

    <p v-if="emptyMessage" class="usage-breakdown-panel__empty">{{ emptyMessage }}</p>

    <template v-else>
      <div class="usage-breakdown-panel__summary">
        <span>{{ summaryText }}</span>
        <span>{{ totalText }}</span>
      </div>

      <div
        class="usage-breakdown-panel__track"
        role="progressbar"
        :aria-label="progressAriaLabel"
        :aria-valuetext="progressAriaLabel"
        :aria-valuenow="usedTokens"
        aria-valuemin="0"
        :aria-valuemax="progressMaximum"
      >
        <span
          class="usage-breakdown-panel__used"
          :style="{ width: `${trackPresentation.usedShare * 100}%` }"
        >
          <span
            v-for="segment in trackPresentation.segments"
            :key="segment.id"
            class="usage-breakdown-panel__segment"
            :class="`usage-breakdown-panel__tone--${segment.tone}`"
            :style="{ flexBasis: `${segment.relativeShare * 100}%` }"
          ></span>
        </span>
      </div>

      <dl class="usage-breakdown-panel__rows">
        <div
          v-for="row in rows"
          :key="row.id"
          class="usage-breakdown-panel__row"
        >
          <dt class="usage-breakdown-panel__row-label">
            <span
              class="usage-breakdown-panel__swatch"
              :class="`usage-breakdown-panel__tone--${row.tone}`"
              aria-hidden="true"
            ></span>
            <span>{{ row.label }}</span>
          </dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </template>

    <section
      v-if="detailRows.length > 0"
      class="usage-breakdown-panel__details"
      :aria-label="detailsTitle || undefined"
    >
      <h3 v-if="detailsTitle" class="usage-breakdown-panel__details-title">{{ detailsTitle }}</h3>
      <dl class="usage-breakdown-panel__details-rows">
        <div
          v-for="row in detailRows"
          :key="row.id"
          class="usage-breakdown-panel__detail-row"
        >
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import type {
  ContextWindowUsagePanelDetailRow,
  ContextWindowUsagePanelRow,
  ContextWindowUsagePanelSegment,
} from '../definitions/contextWindowUsagePanel';
import { projectContextWindowUsageTrack } from '../functions/projectContextWindowUsageTrack';

const props = withDefaults(defineProps<{
  readonly title: string;
  readonly summaryText?: string;
  readonly totalText?: string;
  readonly progressAriaLabel?: string;
  readonly usedTokens?: number;
  readonly capacityTokens?: number;
  readonly segments?: readonly ContextWindowUsagePanelSegment[];
  readonly rows?: readonly ContextWindowUsagePanelRow[];
  readonly emptyMessage?: string;
  readonly detailsTitle?: string;
  readonly detailRows?: readonly ContextWindowUsagePanelDetailRow[];
}>(), {
  summaryText: '',
  totalText: '',
  progressAriaLabel: '',
  usedTokens: 0,
  capacityTokens: 1,
  segments: () => [],
  rows: () => [],
  emptyMessage: '',
  detailsTitle: '',
  detailRows: () => [],
});

const titleId = `usage-breakdown-panel-${useId()}`;
// 超预算是正式状态；ARIA 数值范围不能让 valuemax 小于 valuenow，真实预算仍由 valuetext 完整说明。
const progressMaximum = computed(() => Math.max(props.usedTokens, props.capacityTokens));
const trackPresentation = computed(() => projectContextWindowUsageTrack(props.segments));
</script>
