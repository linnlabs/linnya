<template>
  <div
    ref="toolbarMountRef"
    class="block-chrome-host-revision-toolbar"
    contenteditable="false"
  >
    <RevisionToolbar
      v-if="revisionSummary.hasPendingRevision"
      placement="block-top-right"
      :visible="true"
      :block-id="props.blockId"
      :position="{ top: 0, left: 0 }"
      :insert-count="revisionSummary.insertCount"
      :delete-count="revisionSummary.deleteCount"
      @accept-all="handleAcceptAll"
      @reject-all="handleRejectAll"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Host 版块级修订工具栏。
 *
 * 中文说明：
 * - 这里只迁移 hover / selection 时出现的轻量接受、拒绝入口；
 * - 是否显示由 Revision overlay 的运行态发布，Host 不复制 hover / selection 规则；
 * - 点击动作通过 Revision orchestration 回到 feature 内部，Host 不直接写接受 / 拒绝规则。
 */

import { computed, ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import RevisionToolbar from '../../features/Revision/ui/RevisionToolbar.vue';
import { useRevisionIndicatorSummary } from '../../features/Revision/readModel';
import { applyBlockRevisionToolbarAction } from '../../features/Revision/orchestration/applyBlockRevisionToolbarAction';
import { useRenderVirtualizationKeepAliveLease } from '../../features/RenderVirtualization/state/useRenderVirtualizationKeepAliveLease';

const props = defineProps<{
  editor: Editor;
  blockId: string;
}>();

const toolbarMountRef = ref<HTMLElement | null>(null);
const currentBlockId = computed(() => props.blockId);
const revisionSummary = useRevisionIndicatorSummary(props.editor, currentBlockId);

useRenderVirtualizationKeepAliveLease({
  target: () => toolbarMountRef.value,
  fallbackTarget: () => props.editor.view.dom,
  blockId: currentBlockId,
  reason: 'revision-toolbar',
  active: computed(() => toolbarMountRef.value !== null && revisionSummary.value.hasPendingRevision),
});

function handleAcceptAll(): void {
  void applyBlockRevisionToolbarAction({
    editor: props.editor,
    blockId: props.blockId,
    action: 'accept',
  });
}

function handleRejectAll(): void {
  void applyBlockRevisionToolbarAction({
    editor: props.editor,
    blockId: props.blockId,
    action: 'reject',
  });
}
</script>
