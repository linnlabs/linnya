<template>
  <div class="subrun-collection">
    <SubrunCard
      v-for="(item, index) in items"
      :key="item.subrunId"
      :message-id="`subrun-card-${item.subrunId}`"
      :class="{ 'subrun-collection__item--entering': isEntering(item.subrunId) }"
      :style="entryAnimationStyle(item.subrunId, index)"
      :presentation="item.presentation"
      :subrun-trace="subrunTrace"
      :subrun-trace-version="subrunTraceVersion"
      :subrun-id="item.subrunId"
      :lazy-subrun-trace-source="cardLazySource(item.subrunId)"
      :has-next="index < items.length - 1"
      :expansion-state="activeSubrunId === item.subrunId ? 'expanded' : 'collapsed'"
      @animationend.self="finishEntry(item.subrunId)"
      @animationcancel.self="finishEntry(item.subrunId)"
      @expanded-change="handleExpandedChange(item.subrunId, $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import '../styles/subrunCollection.css';
import type { HistoricalSubrunTraceLazySource } from '../../subrun-trace';
import SubrunCard from '../../subrun-card/ui/SubrunCard.vue';
import type { SubrunCollectionItem } from '../definitions/subrunCollection';

const props = defineProps<{
  items: readonly SubrunCollectionItem[];
  animateEntry?: boolean;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();

const seenSubrunIds = new Set(props.items.map((item) => item.subrunId));
const enteringSubrunIds = ref(new Set(props.animateEntry ? seenSubrunIds : []));

watch(
  () => props.items.map((item) => item.subrunId),
  (subrunIds) => {
    if (!props.animateEntry) return;
    const nextEntering = new Set(enteringSubrunIds.value);
    for (const subrunId of subrunIds) {
      if (seenSubrunIds.has(subrunId)) continue;
      seenSubrunIds.add(subrunId);
      nextEntering.add(subrunId);
    }
    enteringSubrunIds.value = nextEntering;
  },
);

function isEntering(subrunId: string): boolean {
  return enteringSubrunIds.value.has(subrunId);
}

function entryAnimationStyle(subrunId: string, index: number): Record<string, string> | undefined {
  if (!isEntering(subrunId)) return undefined;
  return {
    '--subrun-collection-entry-delay': `${Math.min(index, 5) * 42}ms`,
  };
}

function finishEntry(subrunId: string): void {
  if (!enteringSubrunIds.value.has(subrunId)) return;
  const nextEntering = new Set(enteringSubrunIds.value);
  nextEntering.delete(subrunId);
  enteringSubrunIds.value = nextEntering;
}

const activeSubrunId = ref<string | null>(null);
function cardLazySource(subrunId: string): HistoricalSubrunTraceLazySource | undefined {
  const source = props.lazySubrunTraceSource;
  return source ? { ...source, subrunId } : undefined;
}

function handleExpandedChange(subrunId: string, expanded: boolean): void {
  if (expanded) {
    activeSubrunId.value = subrunId;
    return;
  }
  if (activeSubrunId.value === subrunId) {
    activeSubrunId.value = null;
  }
}
</script>
