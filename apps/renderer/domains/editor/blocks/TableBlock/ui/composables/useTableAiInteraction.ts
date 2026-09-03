import { computed, ref } from 'vue';
import type {
  ColumnRef,
  OutputRect,
  TableAiInteraction,
  TableInfo,
  TableRect,
  TargetColumn,
  UseTableAiInteractionOptions,
} from './types/tableAiTypes';
import { useTableAiActions } from './useTableAiActions';
import { useTableRenderVirtualizationKeepAlive } from './useTableRenderVirtualizationKeepAlive';
import {
  activateTableAiMode,
  useTableAiModeStore,
} from '../../../../features/table-ai-mode';

/** TableBlock 的 Table AI 入口；只暴露工具栏当前真实使用的动作。 */
export function useTableAiInteraction(options: UseTableAiInteractionOptions): TableAiInteraction {
  const { mergedEditorProps, hideToolbar } = options;
  const tableAiModeStore = useTableAiModeStore();
  const aiActions = useTableAiActions(mergedEditorProps, hideToolbar);

  const tableInfo = ref<TableInfo | null>(null);
  const originalRect = ref<TableRect | null>(null);
  const currentOutputRect = ref<OutputRect | null>(null);
  const columnRefs = ref<ColumnRef[]>([]);
  const selectionRange = ref('');
  const targetColumn = ref<TargetColumn>({ index: -1, exists: false });
  const outputColumnAdded = ref(false);
  const isColumnAddedAndRetrying = ref(false);

  useTableRenderVirtualizationKeepAlive({
    editor: computed(() => mergedEditorProps.value?.editor ?? null),
    activePos: computed(() => tableAiModeStore.activeTable?.lastKnownPos ?? null),
    activeBlockId: computed(() => tableAiModeStore.activeTable?.rootBlockId ?? null),
    reason: 'table-ai',
  });

  const handleAIAction = async (action: string): Promise<void> => {
    if (action === 'aiFill') {
      // Toolbar 组件在模式显隐间不会重建；每次用户发起新操作必须丢弃上一轮草稿。
      tableInfo.value = null;
      originalRect.value = null;
      currentOutputRect.value = null;
      columnRefs.value = [];
      selectionRange.value = '';
      targetColumn.value = { index: -1, exists: false };
      outputColumnAdded.value = false;
      isColumnAddedAndRetrying.value = false;

      await aiActions.handleAiFillAction(
        tableInfo,
        originalRect,
        currentOutputRect,
        columnRefs,
        selectionRange,
        targetColumn,
        outputColumnAdded,
        isColumnAddedAndRetrying,
        (input) => {
          activateTableAiMode(input);
        },
      );
      return;
    }

    if (action === 'aiAnalyze') {
      await aiActions.handleAiAnalyzeAction();
      return;
    }

    console.warn(`[TableAI] 未知的AI动作: ${action}`);
  };

  return { handleAIAction };
}
