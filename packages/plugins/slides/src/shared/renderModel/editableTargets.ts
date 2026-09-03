import type {
  EditableOperation,
  EditableTarget,
  PresentationRenderModel,
} from './renderModel';
import { visitRenderNodes } from './renderModelTraversal';

export const PATCHABLE_EDIT_OPERATIONS: readonly EditableOperation[] = [
  'modify_text',
  'edit_image',
  'update_chart',
  'update_table',
  'modify_style',
  'modify_geometry',
  'reorder_layer',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPatchableEditableOperation(
  operation: EditableOperation,
): operation is Extract<EditableOperation,
  | 'modify_text'
  | 'edit_image'
  | 'update_chart'
  | 'update_table'
  | 'modify_style'
  | 'modify_geometry'
  | 'reorder_layer'
> {
  return PATCHABLE_EDIT_OPERATIONS.includes(operation);
}

export function sanitizeToolEditableTarget(target: EditableTarget): EditableTarget | null {
  /** elementId 对 generated deck 足够稳定，creationId / elementName 对 canonical (imported) deck 必需 */
  const patchLocatorAvailable = isNonEmptyString(target.elementId)
    || isNonEmptyString(target.creationId)
    || isNonEmptyString(target.elementName);
  const patchOperations = target.operations.filter((operation) =>
    isPatchableEditableOperation(operation),
  );
  const supportsRelayout = (isNonEmptyString(target.semanticNodeId) || isNonEmptyString(target.semanticRole))
    && target.operations.includes('relayout_slide');
  const relayoutOperations: EditableOperation[] = supportsRelayout ? ['relayout_slide'] : [];
  const operations: EditableOperation[] = [
    ...(patchLocatorAvailable ? patchOperations : []),
    ...relayoutOperations,
  ];
  if (operations.length === 0) {
    return null;
  }
  return {
    ...target,
    operations,
    relayoutCapabilities: supportsRelayout ? target.relayoutCapabilities : undefined,
  };
}

export function collectEditableTargetsBySlide(
  renderModel: PresentationRenderModel,
): Map<number, EditableTarget[]> {
  const targetsBySlide = new Map<number, EditableTarget[]>();

  for (const slide of renderModel.slides) {
    const targets: EditableTarget[] = [];
    visitRenderNodes(slide.elements, ({ node }) => {
      const editableTarget = node.editableTarget;
      if (!editableTarget) {
        return;
      }
      const normalized = sanitizeToolEditableTarget({
        ...editableTarget,
        slideNumber: slide.index + 1,
      });
      if (normalized) {
        targets.push(normalized);
      }
    });

    targetsBySlide.set(slide.index + 1, targets);
  }

  return targetsBySlide;
}
