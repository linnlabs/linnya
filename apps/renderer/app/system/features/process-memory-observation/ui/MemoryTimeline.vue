<template>
  <div class="process-memory-timeline">
    <div class="process-memory-timeline__plot">
      <span class="process-memory-timeline__axis is-top">{{ formatMB(view.yMaxMB) }}</span>
      <span class="process-memory-timeline__axis is-middle">{{ formatMB(view.yMidMB) }}</span>
      <span class="process-memory-timeline__axis is-bottom">0 MB</span>
      <svg
        viewBox="0 0 720 180"
        preserveAspectRatio="none"
        role="img"
        :aria-label="chartLabel"
      >
        <line class="process-memory-timeline__grid" x1="0" y1="0" x2="720" y2="0" />
        <line class="process-memory-timeline__grid" x1="0" y1="90" x2="720" y2="90" />
        <line class="process-memory-timeline__grid" x1="0" y1="180" x2="720" y2="180" />
        <polyline
          v-for="series in view.series"
          :key="series.id"
          :class="['process-memory-timeline__line', `is-${series.id}`]"
          :points="series.points"
        />
      </svg>
    </div>
    <div class="process-memory-timeline__legend" aria-hidden="true">
      <span v-for="item in legend" :key="item.id" :class="`is-${item.id}`">
        <i />{{ item.label }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { MemoryTimelineSeries, MemoryTimelineView } from '../definitions/processMemoryObservation';

defineProps<{
  view: MemoryTimelineView;
  chartLabel: string;
  legend: readonly { readonly id: MemoryTimelineSeries['id']; readonly label: string }[];
}>();

function formatMB(value: number): string {
  return `${Math.round(value)} MB`;
}
</script>
