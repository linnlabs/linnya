import { computed, type ComputedRef, type Ref } from 'vue';
import { isInteractiveRunUnfinished, useInteractiveRunStore } from '../../interactive-run';
import { useAnnotationRunExecutionStore } from '../../annotation-run';
import type { ToolCallMessage } from '../../../types';
import type { ConversationMessageVisualRow, ConversationVisualRow } from '../../../ui/messageCanvas';
import { projectTurnWorkFolds } from '../functions/projectTurnWorkFolds';
import { useTurnWorkFoldStore } from '../store/turnWorkFoldStore';

/**
 * 主时间线的折叠接线：在增量 visual-row 之上套一层折叠投影，交给虚拟列表与画布。
 * 只有主时间线使用；Subrun 详情直接渲染消息行，不折叠。
 */
export function useTurnWorkFoldRows(input: {
  readonly conversationId: () => string;
  readonly rows: Readonly<Ref<readonly ConversationMessageVisualRow[]>>;
  readonly foldRowEstimatedHeight: () => number;
  readonly isDeliverableTool: (message: ToolCallMessage) => boolean;
}): {
  readonly rows: ComputedRef<ConversationVisualRow[]>;
  readonly toggle: (rootUserMessageId: string) => void;
} {
  const store = useTurnWorkFoldStore();
  const interactive = useInteractiveRunStore();
  const annotation = useAnnotationRunExecutionStore();

  // 进行中（含等回答、暂停）的运行都不折叠：暂停后还会继续，过程仍是用户正在看的内容。
  const busyRunIds = computed<ReadonlySet<string>>(() => {
    const conversationId = input.conversationId();
    const ids = new Set<string>();
    const snapshot = interactive.snapshotFor(conversationId);
    if (snapshot?.runId && isInteractiveRunUnfinished(snapshot)) ids.add(snapshot.runId);
    if (annotation.runId && annotation.isStreamingFor(conversationId)) ids.add(annotation.runId);
    return ids;
  });

  let previousRows = new Map<string, ConversationVisualRow>();
  const rows = computed(() => {
    const conversationId = input.conversationId();
    const next = projectTurnWorkFolds({
      rows: input.rows.value,
      busyRunIds: busyRunIds.value,
      isExpanded: rootUserMessageId => store.isExpanded(conversationId, rootUserMessageId),
      isDeliverableTool: input.isDeliverableTool,
      foldRowEstimatedHeight: input.foldRowEstimatedHeight(),
      previousRows,
    });
    previousRows = new Map(next.map(row => [row.key, row] as const));
    return next;
  });

  return {
    rows,
    toggle: rootUserMessageId => {
      const conversationId = input.conversationId();
      store.setExpanded(conversationId, rootUserMessageId, !store.isExpanded(conversationId, rootUserMessageId));
    },
  };
}
