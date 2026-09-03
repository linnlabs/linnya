<template>
  <div>
    <SubrunProgressCard
      v-for="item in presentation.data.items"
      :key="item.subrunId"
      :message-id="messageId"
      :parent-tool-call-id="parentToolCallId"
      :presentation="item.presentation"
      :subrun-trace="subrunTrace"
      :subrun-trace-version="subrunTraceVersion"
      :subrun-id="item.subrunId"
      :lazy-subrun-trace-source="itemLazySource(item.subrunId)"
      show-description-in-trace
    />
  </div>
</template>

<script setup lang="ts">
import type { ConversationMessageId } from '@app/schemas';
import type { ToolCardPresentation } from '../../../ui/tools/types';
import type { HistoricalSubrunTraceLazySource } from '../../subrun-trace';
import { SubrunProgressCard } from '../../subrun-card';
import type { SubrunBatchPresentationData } from '../definitions/subrunCollection';

const props = defineProps<{
  messageId: ConversationMessageId;
  parentToolCallId: string;
  presentation: ToolCardPresentation<SubrunBatchPresentationData>;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();

function itemLazySource(subrunId: string): HistoricalSubrunTraceLazySource | undefined {
  return props.lazySubrunTraceSource
    ? { ...props.lazySubrunTraceSource, subrunId }
    : undefined;
}
</script>
