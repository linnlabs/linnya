/**
 * @file apps/renderer/features/TableBlock/ui/composables/useTableAiActions.ts
 *
 * @brief 表格AI操作处理
 *
 * @description
 * 处理表格AI的核心操作：
 * - AI填充和分析操作
 * - 列添加逻辑
 * - 选区提取和处理
 * - 装饰系统集成
 */

import { type Ref } from 'vue';
import { CellSelection } from '@tiptap/pm/tables';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Selection } from '@tiptap/pm/state';
import type {
  TableInfo,
  TableRect,
  OutputRect,
  MergedEditorPropsRef,
  ColumnRef,
  TargetColumn
} from './types/tableAiTypes';
import { extractColumnReferences } from '../../ai/tableAiPositionUtils';
import { setKeepTableSelectionVisible } from '../../extensions/TableSelectionDecoratorExtension';
import { addColumnAfter } from '../../commands/tableToolbarCommands';
import { getTableMap } from '../../position/tableMapUtils';
import { useNotificationStore } from '@/app/notification';
import {
  createOutputColumnConfig,
  correctRectsAfterOutputColumnInsertion,
  isExtractedColumnReferenceContext,
  mapExtractedColumnRefsToColumnRefs,
  resolveTableAiSelectionContext,
  type OutputColumnConfig,
} from './tableAiSelectionContext';
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage';
import type { ActivateTableAiModeInput } from '../../../../features/table-ai-mode';

type ActivateTableAiMode = (input: ActivateTableAiModeInput) => void | Promise<void>;

/**
 * 表格AI操作处理
 * @param mergedEditorProps - 编辑器属性引用
 * @param hideToolbar - 隐藏工具栏的方法
 * @returns AI操作处理相关的方法
 */
export function useTableAiActions(
  mergedEditorProps: MergedEditorPropsRef,
  hideToolbar: () => void
) {
  const notificationStore = useNotificationStore();

  /**
   * 从选区提取列引用信息并设置状态
   * @param state - 编辑器状态
   * @param selection - 表格选区
   * @param columnRefs - 列引用数组引用
   * @param selectionRange - 选区范围引用
   * @param targetColumn - 目标列引用
   */
  const extractAndSetColumnRefs = (
    state: EditorState,
    selection: CellSelection,
    columnRefs: Ref<ColumnRef[]>,
    selectionRange: Ref<string>,
    targetColumn: Ref<TargetColumn>
  ): void => {
    const editor = mergedEditorProps.value?.editor;
    if (!editor) return;

    const columnInfo: unknown = extractColumnReferences(state, selection);
    if (isExtractedColumnReferenceContext(columnInfo)) {
      columnRefs.value = mapExtractedColumnRefsToColumnRefs(columnInfo.columnRefs);
      selectionRange.value = columnInfo.selectionRange;
      targetColumn.value = columnInfo.targetColumn;
    } else {
      console.warn('[TableAI] 提取列引用失败，返回结构不符合预期');
    }
  };

  /**
   * 验证并准备上下文（选区校验、上下文提取）
   * @returns 准备好的上下文数据或null（失败）
   */
  const _validateAndPrepareContext = (
    state: EditorState,
    selection: Selection,
    tableInfo: Ref<TableInfo | null>,
    originalRect: Ref<TableRect | null>,
    columnRefs: Ref<ColumnRef[]>,
    selectionRange: Ref<string>,
    targetColumn: Ref<TargetColumn>
  ): { rect: TableRect; tableNode: ProseMirrorNode; useCurrentSelection: boolean } | null => {
    const resolved = resolveTableAiSelectionContext({
      state,
      selection,
      savedTableInfo: tableInfo.value,
      savedRect: originalRect.value,
    });

    if (!resolved.ok) {
      console.warn('[TableAI] 表格 AI 上下文无效', { reason: resolved.reason });
      if (resolved.reason === 'saved-context-missing' || resolved.reason === 'saved-rect-invalid') {
        notificationStore.show(resolveCurrentEditorMessage('editor.tableBlock.alert.selectCellRange'), 'warning', 3500);
      }
      return null;
    }

    const { context } = resolved;
    originalRect.value = { ...context.rect };
    tableInfo.value = context.tableInfo;

    if (context.selection) {
      extractAndSetColumnRefs(state, context.selection, columnRefs, selectionRange, targetColumn);
    } else {
      console.log('[TableAI] 使用保存的列引用状态');
    }

    return {
      rect: context.rect,
      tableNode: context.tableNode,
      useCurrentSelection: context.source === 'current-selection',
    };
  };

  /**
   * 处理列添加、坐标修正、装饰重设
   */
  const _handleColumnAddition = (
    currentEditorInstance: Editor,
    rect: TableRect,
    outputRectConfig: OutputColumnConfig,
    tableInfo: Ref<TableInfo | null>,
    originalRect: Ref<TableRect | null>,
    currentOutputRect: Ref<OutputRect | null>,
    columnRefs: Ref<ColumnRef[]>,
    selectionRange: Ref<string>,
    targetColumn: Ref<TargetColumn>,
    outputColumnAdded: Ref<boolean>,
    isColumnAddedAndRetrying: Ref<boolean>,
    activateMode: ActivateTableAiMode
  ): void => {
    console.log('[AI] 检测到需要添加列，保持装饰状态并添加列');

    // 设置重试标志
    isColumnAddedAndRetrying.value = true;
    outputColumnAdded.value = true;

    // 保存插入列前的矩形坐标
    const preInsertRect = { ...rect };
    const preInsertOutputRect = { ...outputRectConfig };

    console.log('[AI] 插入列前的坐标:', { preInsertRect, preInsertOutputRect });

    const {
      insertedAtColumn,
      correctedRect,
      correctedOutputRect,
    } = correctRectsAfterOutputColumnInsertion({
      rect: preInsertRect,
      outputRect: preInsertOutputRect,
    });

    if (tableInfo.value) {
      tableInfo.value.insertedColumnIndex = insertedAtColumn;
    }
    console.log(`[AI] 列插入索引 ${insertedAtColumn} 已记录，用于精确撤销`);

    addColumnAfter(currentEditorInstance, () => {});

    // 列插入后立即修正坐标并重新设置装饰
    setTimeout(() => {
      console.log('[AI] 列添加完成，修正坐标并重新设置装饰');

      console.log('[AI] 修正后的坐标:', { correctedRect, correctedOutputRect });

      if (!tableInfo.value) {
        console.warn('[TableAI] 列添加后表格上下文已丢失，停止重试');
        return;
      }

      // 直接从最新编辑器状态获取最新的tableNode
      const latestTableNode = currentEditorInstance.state.doc.nodeAt(tableInfo.value.pos);
      console.log('[AI] 使用最新的tableNode，宽度:', latestTableNode ? getTableMap(latestTableNode)?.width : 'N/A');

      // 使用正确的API重新设置装饰高亮
      // ✅ 清理：历史遗留的 “PluginKey('tableSelectionDecorator')” meta 写入不会被当前装饰插件消费，
      // 属于无效事务（dead code）。装饰保持由 setKeepTableSelectionVisible / table-ai-mode runtime 负责。

      console.log('[AI] 列引用坐标更新将由 table-ai-mode runtime 处理');

      // 更新状态中的矩形信息
      console.log('[AI] 更新状态中的矩形信息');
      originalRect.value = correctedRect;
      currentOutputRect.value = correctedOutputRect;

      // 立即重新调用AI填充操作
      console.log('[AI] 用修正后的坐标重新执行AI操作');
      void handleAiFillAction(
        tableInfo,
        originalRect,
        currentOutputRect,
        columnRefs,
        selectionRange,
        targetColumn,
        outputColumnAdded,
        isColumnAddedAndRetrying,
        activateMode
      );
    }, 10);
  };

  /**
   * 处理AI填充操作 - 侧边栏模式
   * @param tableInfo - 表格信息引用
   * @param originalRect - 原始矩形引用
   * @param currentOutputRect - 当前输出矩形引用
   * @param columnRefs - 列引用数组引用
   * @param selectionRange - 选区范围引用
   * @param targetColumn - 目标列引用
   * @param outputColumnAdded - 输出列已添加标记引用
   * @param isColumnAddedAndRetrying - 是否正在重试标记引用
   * @param activateMode - 激活 Table AI 模式会话
   */
  const handleAiFillAction = async (
    tableInfo: Ref<TableInfo | null>,
    originalRect: Ref<TableRect | null>,
    currentOutputRect: Ref<OutputRect | null>,
    columnRefs: Ref<ColumnRef[]>,
    selectionRange: Ref<string>,
    targetColumn: Ref<TargetColumn>,
    outputColumnAdded: Ref<boolean>,
    isColumnAddedAndRetrying: Ref<boolean>,
    activateMode: ActivateTableAiMode
  ): Promise<void> => {
    const currentEditorInstance = mergedEditorProps.value?.editor;

    if (!isColumnAddedAndRetrying.value) {
      console.log('[AI] 开始新的AI操作');
    }

    if (!currentEditorInstance?.state) {
      console.error('[TableAI] Editor instance or state is missing');
      return;
    }

    const { state, view } = currentEditorInstance;
    const { selection } = state;

    try {
      // 验证并准备上下文
      const contextData = _validateAndPrepareContext(
        state,
        selection,
        tableInfo,
        originalRect,
        columnRefs,
        selectionRange,
        targetColumn
      );

      if (!contextData) {
        return; // 校验失败，已在辅助函数中处理错误
      }

      const { rect, tableNode } = contextData;

      const outputRectConfig = createOutputColumnConfig(rect, tableNode);

      currentOutputRect.value = {
        top: outputRectConfig.top,
        bottom: outputRectConfig.bottom,
        left: outputRectConfig.left,
        right: outputRectConfig.right,
        isOutputColumn: true
      };

      // 侧边栏模式下不需要位置计算
      console.log('[TableAI] 使用侧边栏模式，跳过位置计算');

      // 使用TableBlock提供的正确API设置装饰高亮
      if (view?.dispatch && !isColumnAddedAndRetrying.value) {
        console.log('[AI] 设置表格选区装饰高亮（首次调用）', { outputRectConfig, rect });
        const decoratedTr = setKeepTableSelectionVisible(state.tr, true, outputRectConfig, false);
        view.dispatch(decoratedTr);
      } else if (isColumnAddedAndRetrying.value) {
        console.log('[AI] 跳过装饰设置（递归调用，装饰已在插入列后设置）');
      }

      // 如果需要添加列，使用辅助函数处理
      if (outputRectConfig.needsNewColumn && !isColumnAddedAndRetrying.value) {
        _handleColumnAddition(
          currentEditorInstance,
          rect,
          outputRectConfig,
          tableInfo,
          originalRect,
          currentOutputRect,
          columnRefs,
          selectionRange,
          targetColumn,
          outputColumnAdded,
          isColumnAddedAndRetrying,
          activateMode
        );
        return; // 退出当前流程，等待重新执行
      } else {
        // 不需要添加列，或者是重试调用，重置标志并继续正常流程
        isColumnAddedAndRetrying.value = false;
        console.log('[AI] 右边有列或重试调用，继续正常流程');
      }

      // 启用侧边栏表格模式
      if (tableInfo.value && columnRefs.value) {
        const currentTableInfo = tableInfo.value;
        const activation: ActivateTableAiModeInput = {
          table: {
            editorId: 'main',
            rootBlockId: currentTableInfo.rootBlockId ?? null,
            lastKnownPos: currentTableInfo.pos,
          },
          context: {
            columnRefs: columnRefs.value,
            selectionRange: selectionRange.value,
            outputColumnRange: `${String.fromCharCode(65 + rect.right)}${rect.top + 1}:${String.fromCharCode(65 + rect.right)}${rect.bottom}`,
            activeColumnRefs: {},
            outputRect: currentOutputRect.value,
            outputColumnAdded: outputColumnAdded.value,
            ...(typeof currentTableInfo.insertedColumnIndex === 'number'
              ? { insertedColumnIndex: currentTableInfo.insertedColumnIndex }
              : {}),
          },
        };
        console.log('[AI] 激活 Table AI 模式会话', activation);
        await activateMode(activation);
      }

    } catch (error: unknown) {
      console.error('AI填充错误:', error);
      notificationStore.show(resolveCurrentEditorMessage('editor.tableBlock.alert.aiFillFailed'), 'error', 3500);

      if (currentEditorInstance?.view) {
        try {
          const tr = currentEditorInstance.state.tr;
          currentEditorInstance.view.dispatch(setKeepTableSelectionVisible(tr, false));
        } catch (cleanupError) {
          console.warn('清除选区高亮失败:', cleanupError);
        }
      }
    }

    // 🔧 修复：移除此处的 hideToolbar() 调用，避免与 TableFloatingToolbar 中的延迟隐藏冲突导致闪烁
    // TableFloatingToolbar.vue 已经在适当的时机（延迟100ms）请求隐藏工具栏
    // hideToolbar();
  };

  /**
   * 处理AI分析操作
   */
  const handleAiAnalyzeAction = async (): Promise<void> => {
    notificationStore.show(resolveCurrentEditorMessage('editor.tableBlock.alert.aiAnalyzeUnavailable'), 'info', 3500);
    hideToolbar();
  };

  return {
    handleAiFillAction,
    handleAiAnalyzeAction,
    extractAndSetColumnRefs
  };
}
