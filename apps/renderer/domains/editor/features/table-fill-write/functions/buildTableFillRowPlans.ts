import { getTableMap } from '../../../blocks/TableBlock/position/tableMapUtils.js';
import { refreshTableInfoSnapshot } from '../../../blocks/TableBlock/position/tableIdentity';
import {
  constructPromptForRow,
  getRowDataContext,
} from '../../../blocks/TableBlock/ai/tableRowProcessing.js';
import type {
  BuildTableFillRowPlansInput,
  BuiltTableFillRowPlans,
  TableFillInputReference,
  TableFillRowPlan,
} from '../definitions/tableFillWrite';

function validateOutputRect(
  rect: BuildTableFillRowPlansInput['outputRect'],
  tableSize: { width: number; height: number },
): void {
  if (
    !Number.isInteger(rect.top)
    || !Number.isInteger(rect.bottom)
    || !Number.isInteger(rect.left)
    || !Number.isInteger(rect.right)
    || rect.top < 0
    || rect.bottom <= rect.top
    || rect.left < 0
    || rect.right <= rect.left
    || rect.bottom > tableSize.height
    || rect.left >= tableSize.width
  ) {
    throw new Error('[TableFillPlan] outputRect is outside the current table');
  }
}

function copyInputRefs(refs: readonly TableFillInputReference[]): TableFillInputReference[] {
  return refs.map((ref) => ({
    refKey: ref.refKey,
    label: ref.label,
    rect: { ...ref.rect },
  }));
}

/**
 * 在发起 batch 前读取一次表格快照并构造全部行计划。
 *
 * 这里按 rootBlockId 刷新表身份，避免把会漂移的旧 pos 带进长生命周期写回 session。
 */
export function buildTableFillRowPlans(
  input: BuildTableFillRowPlansInput,
): BuiltTableFillRowPlans {
  if (!input.promptTemplate.trim()) {
    throw new Error('[TableFillPlan] promptTemplate must not be empty');
  }
  if (!input.table.rootBlockId.trim()) {
    throw new Error('[TableFillPlan] rootBlockId is required');
  }

  const table = refreshTableInfoSnapshot(input.editor.state.doc, {
    pos: input.table.initialPos,
    rootBlockId: input.table.rootBlockId,
  });
  if (!table || table.rootBlockId !== input.table.rootBlockId) {
    throw new Error(`[TableFillPlan] table not found: ${input.table.rootBlockId}`);
  }

  const tableMap = getTableMap(table.node);
  if (!tableMap) {
    throw new Error('[TableFillPlan] current table map is unavailable');
  }
  validateOutputRect(input.outputRect, tableMap);

  const activeInputRefs = copyInputRefs(input.activeInputRefs);
  const rows: TableFillRowPlan[] = [];
  for (let rowIndex = input.outputRect.top; rowIndex < input.outputRect.bottom; rowIndex += 1) {
    const prompt = constructPromptForRow(
      input.editor,
      table.node,
      table.pos,
      input.promptTemplate,
      activeInputRefs,
      rowIndex,
    );
    if (prompt === null) {
      throw new Error(`[TableFillPlan] failed to build prompt for row ${rowIndex}`);
    }

    rows.push({
      rowIndex,
      colIndex: input.outputRect.left,
      prompt,
      rowContext: getRowDataContext(
        input.editor,
        table.node,
        table.pos,
        activeInputRefs,
        rowIndex,
      ),
    });
  }

  return {
    table: {
      initialPos: table.pos,
      rootBlockId: input.table.rootBlockId,
    },
    rows,
  };
}
