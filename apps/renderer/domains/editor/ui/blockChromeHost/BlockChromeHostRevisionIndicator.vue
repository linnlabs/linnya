<template>
  <div
    v-if="revisionSummary.hasPendingRevision"
    class="block-revision-indicator-row"
  >
    <RevisionIndicator
      :status="revisionSummary.status"
      :insert-count="revisionSummary.insertCount"
      :delete-count="revisionSummary.deleteCount"
      :created-at="revisionSummary.createdAt"
      :force-visible="revisionSummary.forceVisible"
      :pending-only="revisionSummary.pendingOnly"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Host 版块级修订指示条。
 *
 * 中文说明：
 * - 这里只迁移“块上方有待处理修订”的轻量视觉入口；
 * - 不触发 revisionMark 投影，不读取文档 marks，不承载接受/拒绝操作；
 * - 接受 / 拒绝工具栏已经作为独立 surface 由 BlockChromeHostRevisionToolbar 承载。
 */

import { computed } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import RevisionIndicator from '../../features/Revision/ui/RevisionIndicator.vue';
import { useRevisionIndicatorSummary } from '../../features/Revision/readModel';

const props = defineProps<{
  editor: Editor;
  blockId: string;
}>();

const currentBlockId = computed(() => props.blockId);
const revisionSummary = useRevisionIndicatorSummary(props.editor, currentBlockId);
</script>
