import { generateMessageId } from '@shared/utils/idUtils';
import { parseCoordinateRange } from '../../../blocks/TableBlock/position/tableCoordinateUtils';
import type {
  TableAiColumnReferenceHighlightRequest,
  TableAiModeActiveColumnReference,
  TableAiModeColumnReference,
} from '../definitions/tableAiMode';
import {
  buildClickedTableAiColumnReference,
  buildTableAiColumnReferencesFromKeys,
  parseTableAiColumnReferences,
  type BuildTableAiColumnReferenceDependencies,
} from '../functions/tableAiColumnReferences';
import { useTableAiModeStore } from '../store/tableAiModeStore';
import { tableAiHighlightRuntime } from './tableAiHighlightRuntime';

const buildDependencies: BuildTableAiColumnReferenceDependencies = {
  parseRange: parseCoordinateRange,
  createId: () => `table-ai-ref-${generateMessageId()}`,
};

function haveSameReferenceKeys(
  left: Readonly<Record<string, TableAiModeActiveColumnReference>>,
  right: Readonly<Record<string, TableAiModeActiveColumnReference>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]);
}

function applyHighlights(request: TableAiColumnReferenceHighlightRequest): void {
  tableAiHighlightRuntime.applyColumnReferenceHighlights(request);
}

function replaceActiveColumnRefs(
  activeColumnRefs: Readonly<Record<string, TableAiModeActiveColumnReference>>,
  scheduleHighlights = false,
): boolean {
  const store = useTableAiModeStore();
  const sessionId = store.session?.sessionId;
  if (!sessionId || !store.updateActiveColumnRefs(activeColumnRefs)) return false;

  const request: TableAiColumnReferenceHighlightRequest = {
    sessionId,
    activeColumnRefs,
  };
  if (scheduleHighlights) {
    // InputRule 运行在 TipTap 事务处理中，高亮事务必须推迟到当前事务完成后。
    globalThis.setTimeout(() => applyHighlights(request), 0);
  } else {
    applyHighlights(request);
  }
  return true;
}

export function updateTableAiColumnReferencesFromText(text: string): void {
  const store = useTableAiModeStore();
  const context = store.activeContext;
  if (!context) return;

  const nextRefs = buildTableAiColumnReferencesFromKeys(
    context,
    parseTableAiColumnReferences(text),
    buildDependencies,
  );
  if (haveSameReferenceKeys(context.activeColumnRefs, nextRefs)) return;
  replaceActiveColumnRefs(nextRefs);
}

export function activateTableAiColumnReference(
  columnRef: TableAiModeColumnReference,
): string | null {
  const store = useTableAiModeStore();
  const context = store.activeContext;
  if (!context) return null;

  const activeRef = buildClickedTableAiColumnReference(context, columnRef, buildDependencies);
  if (!activeRef) return null;

  replaceActiveColumnRefs({
    ...context.activeColumnRefs,
    [columnRef.reference]: activeRef,
  });
  return activeRef.color;
}

export function validateAndActivateTableAiColumnReference(refKey: string): string | null {
  const store = useTableAiModeStore();
  const context = store.activeContext;
  if (!context) return null;

  const nextRef = buildTableAiColumnReferencesFromKeys(
    context,
    [refKey],
    buildDependencies,
  )[refKey];
  if (!nextRef) return null;

  replaceActiveColumnRefs({
    ...context.activeColumnRefs,
    [refKey]: nextRef,
  }, true);
  return nextRef.color;
}

export function readActiveTableAiColumnReferences(): Readonly<
  Record<string, TableAiModeActiveColumnReference>
> {
  return useTableAiModeStore().activeContext?.activeColumnRefs ?? {};
}
