<template>
  <!--
    中文说明：
    - mindmap_subrun_parallel 是“批量并行启动多个子 agent”的工具；
    - 同一条 tool_calls message 的 metadata.subrunTrace 里会挂多个 subrun bucket；
    - 这里把每个 subrun 渲染成一个独立 UiCardGroup（复用 SubrunCard），默认收起，避免并行时 UI 爆炸。
  -->
  <div class="mindmap-subrun-parallel">
    <!-- 只有一个子任务：过程仍默认折叠，由用户主动展开 -->
    <SubrunCard
      v-if="subruns.length === 1"
      :messageId="childMessageId(subruns[0]!.subrunId)"
      :presentation="subruns[0]!.presentation"
      :subrunTrace="subrunTrace"
      :subrunTraceVersion="subrunTraceVersion"
      :subrunId="subruns[0]!.subrunId"
      :lazySubrunTraceSource="lazySubrunTraceSource"
    />

    <!-- 多个子任务：每个子 agent 一个 group，统一默认收起 -->
    <SubrunCard
      v-else
      v-for="(t, idx) in subruns"
      :key="`${idx}_${t.subrunId}`"
      :messageId="childMessageId(t.subrunId)"
      :presentation="t.presentation"
      :subrunTrace="subrunTrace"
      :subrunTraceVersion="subrunTraceVersion"
      :subrunId="t.subrunId"
      :lazySubrunTraceSource="lazySubrunTraceSource"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { SubrunCard } from '@plugin/renderer/subrunToolUi';
import type { HistoricalSubrunTraceLazySource } from '@plugin/renderer/subrunToolUi';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import type { MindmapParallelSubrunPresentationData } from '../definitions/mindmapToolPresentation';

const props = defineProps<{
  presentation: ToolCardPresentation<MindmapParallelSubrunPresentationData>;
  messageId: string;
  subrunTrace?: unknown;
  subrunTraceVersion?: number;
  lazySubrunTraceSource?: HistoricalSubrunTraceLazySource;
}>();

const subruns = computed(() => props.presentation.data.items);

function childMessageId(subrunId: string): string {
  return `${props.messageId}:${subrunId}`;
}
</script>
