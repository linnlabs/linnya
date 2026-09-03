import type {
  TableAiModeActiveColumnReference,
  TableAiModeColumnReference,
  TableAiModeContext,
  TableAiModeRect,
} from '../definitions/tableAiMode';
import { TABLE_AI_COLUMN_REFERENCE_COLORS } from '../definitions/tableAiColumnReferencePalette';

export interface BuildTableAiColumnReferenceDependencies {
  readonly parseRange: (reference: string) => TableAiModeRect | null;
  readonly createId: () => string;
}

export function parseTableAiColumnReferences(text: string): readonly string[] {
  return Array.from(
    text.matchAll(/\{\{([A-Za-z0-9]+(?::[A-Za-z0-9]+)?)\}\}/g),
    match => match[1],
  ).filter((reference): reference is string => typeof reference === 'string');
}

function listAvailableReferenceKeys(context: TableAiModeContext): readonly string[] {
  const keys = context.columnRefs.map(columnRef => columnRef.range || columnRef.reference);
  if (context.selectionRange) keys.push(context.selectionRange);
  return Array.from(new Set(keys));
}

export function resolveTableAiColumnReferenceColor(
  context: TableAiModeContext,
  reference: string,
): string | null {
  const referenceIndex = listAvailableReferenceKeys(context).indexOf(reference);
  if (referenceIndex < 0) return null;
  return TABLE_AI_COLUMN_REFERENCE_COLORS[
    referenceIndex % TABLE_AI_COLUMN_REFERENCE_COLORS.length
  ] ?? null;
}

function isValidRect(rect: TableAiModeRect | null | undefined): rect is TableAiModeRect {
  return !!rect
    && rect.top >= 0
    && rect.bottom > rect.top
    && rect.left >= 0
    && rect.right > rect.left;
}

function resolveRect(
  reference: string,
  fallback: TableAiModeRect | null | undefined,
  parseRange: BuildTableAiColumnReferenceDependencies['parseRange'],
): TableAiModeRect | null {
  const parsed = parseRange(reference);
  if (isValidRect(parsed)) return parsed;
  return isValidRect(fallback) ? fallback : null;
}

function buildAvailableReferences(
  context: TableAiModeContext,
  parseRange: BuildTableAiColumnReferenceDependencies['parseRange'],
): Readonly<Record<string, TableAiModeRect>> {
  const available: Record<string, TableAiModeRect> = {};

  for (const columnRef of context.columnRefs) {
    const reference = columnRef.range || columnRef.reference;
    const rect = resolveRect(reference, columnRef.rect, parseRange);
    if (rect) available[reference] = rect;
  }

  if (context.selectionRange) {
    const selectionRect = resolveRect(
      context.selectionRange,
      mergeColumnReferenceRects(context.columnRefs),
      parseRange,
    );
    if (selectionRect) available[context.selectionRange] = selectionRect;
  }

  return available;
}

function mergeColumnReferenceRects(
  columnRefs: readonly TableAiModeColumnReference[],
): TableAiModeRect | null {
  const rects = columnRefs.flatMap(columnRef => (
    isValidRect(columnRef.rect) ? [columnRef.rect] : []
  ));
  const [firstRect, ...remainingRects] = rects;
  if (!firstRect) return null;

  return remainingRects.reduce<TableAiModeRect>((merged, rect) => ({
    top: Math.min(merged.top, rect.top),
    bottom: Math.max(merged.bottom, rect.bottom),
    left: Math.min(merged.left, rect.left),
    right: Math.max(merged.right, rect.right),
  }), firstRect);
}

function createActiveReference(
  context: TableAiModeContext,
  reference: string,
  rect: TableAiModeRect,
  dependencies: BuildTableAiColumnReferenceDependencies,
): TableAiModeActiveColumnReference | null {
  const color = resolveTableAiColumnReferenceColor(context, reference);
  if (!color) return null;
  return {
    id: dependencies.createId(),
    color,
    rect: { ...rect },
    active: true,
  };
}

export function buildTableAiColumnReferencesFromKeys(
  context: TableAiModeContext,
  references: readonly string[],
  dependencies: BuildTableAiColumnReferenceDependencies,
): Readonly<Record<string, TableAiModeActiveColumnReference>> {
  const available = buildAvailableReferences(context, dependencies.parseRange);
  const activeRefs: Record<string, TableAiModeActiveColumnReference> = {};

  for (const reference of references) {
    const rect = available[reference];
    if (!rect || activeRefs[reference]) continue;
    const activeReference = createActiveReference(context, reference, rect, dependencies);
    if (activeReference) activeRefs[reference] = activeReference;
  }

  return activeRefs;
}

export function buildClickedTableAiColumnReference(
  context: TableAiModeContext,
  columnRef: TableAiModeColumnReference,
  dependencies: BuildTableAiColumnReferenceDependencies,
): TableAiModeActiveColumnReference | null {
  const rect = resolveRect(columnRef.reference, columnRef.rect, dependencies.parseRange);
  return rect ? createActiveReference(context, columnRef.reference, rect, dependencies) : null;
}
