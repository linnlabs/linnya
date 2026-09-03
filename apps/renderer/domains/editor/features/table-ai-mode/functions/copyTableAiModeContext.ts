import type {
  TableAiModeActiveColumnReference,
  TableAiModeContext,
  TableAiModeRect,
} from '../definitions/tableAiMode';

function copyRect(rect: TableAiModeRect): TableAiModeRect {
  return { ...rect };
}

function copyActiveColumnRefs(
  refs: Readonly<Record<string, TableAiModeActiveColumnReference>>,
): Readonly<Record<string, TableAiModeActiveColumnReference>> {
  return Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, {
    ...ref,
    rect: copyRect(ref.rect),
  }]));
}

export function copyTableAiModeContext(context: TableAiModeContext): TableAiModeContext {
  return {
    ...context,
    columnRefs: context.columnRefs.map((ref) => ({
      ...ref,
      ...(ref.rect ? { rect: copyRect(ref.rect) } : {}),
    })),
    activeColumnRefs: copyActiveColumnRefs(context.activeColumnRefs),
    outputRect: context.outputRect ? copyRect(context.outputRect) : null,
  };
}
