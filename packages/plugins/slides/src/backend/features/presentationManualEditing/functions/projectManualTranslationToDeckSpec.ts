import { collectManualAuthoringTargets } from './collectManualAuthoringTargets.js';
import { isManualTranslationOnGrid, roundToManualTranslationGrid } from '@plugin/slides/shared/authoringEditing';
import type {
  DeckSpec,
  FreeformElement,
  SlidesAuthoringEditRef,
  SlidesAuthoringObjectRef,
  SlidesManualEditOperation,
  StructuredElement,
} from '@plugin/slides/shared';

import type { ManualEditDeckProjection } from '../definitions/manualEditDeckProjection.js';

export class SlidesManualEditDeckProjectionError extends Error {
  readonly code = 'operation_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'SlidesManualEditDeckProjectionError';
  }
}

/**
 * translate_by 是 Flex 编译完成后的平移。只有目标是唯一的顶层原子元素时，
 * 当前 DeckSpec 加同一 delta 才能严格等价；Frame 与嵌套 group 交回完整编译器。
 */
export function projectManualTranslationToDeckSpec(
  deckSpec: DeckSpec,
  operation: SlidesManualEditOperation,
): ManualEditDeckProjection {
  // 编译器坐标量化为 1e-4 inch；非整格 delta 不能在已舍入快照上累加，否则重复微移会漂移。
  if (operation.op !== 'translate_by' || !isManualTranslationOnGrid(operation.delta)) {
    return { kind: 'requires_full_compile' };
  }

  const matches = collectManualAuthoringTargets(deckSpec, operation.target);
  if (matches.length !== 1) {
    throw new SlidesManualEditDeckProjectionError(
      matches.length === 0
        ? `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 在当前编译快照中不存在。`
        : `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 在当前编译快照中不唯一。`,
    );
  }
  const match = matches[0];
  if (match.ref.targetKind !== operation.targetKind) {
    throw new SlidesManualEditDeckProjectionError(
      `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 类型为 ${operation.targetKind}，当前编译快照为 ${match.ref.targetKind}。`,
    );
  }
  if (!match.isTopLevel || operation.targetKind === 'frame') {
    return { kind: 'requires_full_compile' };
  }

  let projectedCount = 0;
  const slides = deckSpec.slides.map(slide => ({
    ...slide,
    spec: slide.spec.type === 'structured'
      ? {
          ...slide.spec,
          elements: slide.spec.elements.map(element => {
            if (!matchesTarget(element._authoringRef, operation.target)) return element;
            projectedCount += 1;
            return translateStructuredElement(element, operation.delta);
          }),
        }
      : {
          ...slide.spec,
          elements: slide.spec.elements.map(element => {
            if (!matchesTarget(element._authoringRef, operation.target)) return element;
            projectedCount += 1;
            return translateFreeformElement(element, operation.delta);
          }),
        },
  }));
  if (projectedCount !== 1) {
    throw new SlidesManualEditDeckProjectionError(
      `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 无法从当前顶层快照投影。`,
    );
  }
  return { kind: 'projected', deckSpec: { ...deckSpec, slides } };
}

function matchesTarget(
  ref: SlidesAuthoringObjectRef | undefined,
  target: SlidesAuthoringEditRef,
): boolean {
  return ref?.slideKey === target.slideKey && ref.editKey === target.editKey;
}

function translateStructuredElement(
  element: StructuredElement,
  delta: { readonly dx: number; readonly dy: number },
): StructuredElement {
  return {
    ...element,
    position: translateBox(element.position, delta),
    ...(element._layoutConstraintEvidence
      ? {
          _layoutConstraintEvidence: {
            ...element._layoutConstraintEvidence,
            finalBox: translateBox(element._layoutConstraintEvidence.finalBox, delta),
          },
        }
      : {}),
  };
}

function translateFreeformElement(
  element: FreeformElement,
  delta: { readonly dx: number; readonly dy: number },
): FreeformElement {
  return {
    ...element,
    position: translateBox(element.position, delta),
    ...(element._layoutConstraintEvidence
      ? {
          _layoutConstraintEvidence: {
            ...element._layoutConstraintEvidence,
            finalBox: translateBox(element._layoutConstraintEvidence.finalBox, delta),
          },
        }
      : {}),
  };
}

function translateBox<T extends { readonly x: number; readonly y: number }>(
  box: T,
  delta: { readonly dx: number; readonly dy: number },
): T {
  // 快照与 delta 都在格点上；按编译器同一规则取整，消除二进制浮点残差。
  return { ...box, x: roundToManualTranslationGrid(box.x + delta.dx), y: roundToManualTranslationGrid(box.y + delta.dy) };
}
