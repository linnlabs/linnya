import { collectManualAuthoringTargets } from './collectManualAuthoringTargets.js';
import { isEditableTextContent, isManualTranslationOnGrid, roundToManualTranslationGrid } from '@plugin/slides/shared/authoringEditing';
import { computeGeneratedLayoutRatios, projectIndependentTextWidth } from '@plugin/slides/shared/generatedLayoutConstraints';
import { normalizeShapeFillInput } from '@plugin/slides/shared/visual';
import type {
  DeckSpec, FreeformElement, SlidesAuthoringEditRef, SlidesAuthoringObjectRef,
  SlidesManualEditOperation, StructuredElement,
} from '@plugin/slides/shared';
import type { ManualEditDeckProjection } from '../definitions/manualEditDeckProjection.js';
import type { LayoutReplay } from '@plugin/slides/shared/generatedLayoutReplay';

export class SlidesManualEditDeckProjectionError extends Error {
  readonly code = 'operation_invalid';
  constructor(message: string) {
    super(message);
    this.name = 'SlidesManualEditDeckProjectionError';
  }
}

type ProjectableOperation = Extract<SlidesManualEditOperation,
  { op: 'translate_by' | 'set_visual_size' | 'set_fill_color' | 'set_text_width' }>;

/** 只投影不影响其他作者节点的人工值；源码仍经同一 CAS 提交，文字排版由正式 RenderModel 完成。 */
export function projectManualEditToDeckSpec(
  deckSpec: DeckSpec,
  operation: SlidesManualEditOperation,
): ManualEditDeckProjection {
  if (!canProject(operation)) return { kind: 'requires_full_compile' };
  const matches = collectManualAuthoringTargets(deckSpec, operation.target);
  // 无装饰 Frame 不生成独立元素，完整编译器仍可按作者树定位，不能误报目标不存在。
  if (matches.length === 0 && operation.targetKind === 'frame') return { kind: 'requires_full_compile' };
  if (matches.length !== 1) {
    throw new SlidesManualEditDeckProjectionError(matches.length === 0
      ? `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 在当前编译快照中不存在。`
      : `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 在当前编译快照中不唯一。`);
  }
  const match = matches[0];
  if (match.ref.targetKind !== operation.targetKind) {
    throw new SlidesManualEditDeckProjectionError(
      `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 类型为 ${operation.targetKind}，当前编译快照为 ${match.ref.targetKind}。`);
  }
  if ((operation.op === 'set_fill_color' && match.element.type !== 'shape')
    || (operation.op === 'set_visual_size' && match.element.type !== 'shape' && match.element.type !== 'image')
    || !match.isTopLevel || match.element.type === 'group') return { kind: 'requires_full_compile' };
  if (operation.op !== 'translate_by' && !match.element._layoutConstraintEvidence) return { kind: 'requires_full_compile' };
  const textWidthBox = operation.op === 'set_text_width' && match.element.type === 'text' && match.element._layoutConstraintEvidence
    ? projectIndependentTextWidth(match.element._layoutConstraintEvidence, operation.width,
        isEditableTextContent(match.element.content) ? match.element.content : undefined) : null;
  if (operation.op === 'set_text_width' && !textWidthBox) return { kind: 'requires_full_compile' };
  const frameLayoutId = operation.targetKind === 'frame' ? match.element._layoutConstraintEvidence?.layoutNodeId : undefined;
  if (operation.targetKind === 'frame' && !frameLayoutId) return { kind: 'requires_full_compile' };

  const projectedOperation = operation;
  function projectReplay<T extends { layoutReplay?: LayoutReplay }>(spec: T): T {
    if (projectedOperation.op !== 'set_text_width' || !spec.layoutReplay) return spec;
    return { ...spec, layoutReplay: { nodes: spec.layoutReplay.nodes.map(node => node.id === match.element._layoutConstraintEvidence?.layoutNodeId
      ? { ...node, style: { ...node.style, width: Math.fround(projectedOperation.width * 72) } } : node) } };
  }
  function project<T extends FreeformElement | StructuredElement>(element: T): T {
    const own = matchesTarget(element._authoringRef, projectedOperation.target);
    const descendant = projectedOperation.op === 'translate_by' && frameLayoutId !== undefined
      && element._authoringAncestorRefs?.some(ref => matchesTarget(ref, projectedOperation.target));
    if (!own && !descendant) return element;
    if (projectedOperation.op === 'set_text_width') {
      const evidence = element._layoutConstraintEvidence;
      if (!textWidthBox || !evidence) return element;
      return { ...element, textWrap: 'word', position: { ...element.position, w: textWidthBox.w, h: textWidthBox.h },
        _layoutConstraintEvidence: { ...evidence, finalBox: textWidthBox,
          declared: { ...evidence.declared, widthInches: projectedOperation.width },
          computedRatios: { ...evidence.computedRatios, widthToDeclared: 1 },
        } };
    }
    if (projectedOperation.op === 'set_fill_color') {
      if (element.type !== 'shape') return element;
      const paint = normalizeShapeFillInput(projectedOperation.color, 'manual.fill');
      if ('error' in paint) throw new SlidesManualEditDeckProjectionError(paint.error);
      return { ...element, style: { ...element.style, paint: paint.value } };
    }
    const delta = projectedOperation.op === 'translate_by' ? projectedOperation.delta : projectedOperation.translationDelta ?? { dx: 0, dy: 0 };
    const size = projectedOperation.op === 'set_visual_size' ? { w: projectedOperation.visualSize.width, h: projectedOperation.visualSize.height } : undefined;
    const evidence = element._layoutConstraintEvidence;
    return { ...element, position: projectBox(element.position, delta, size),
      ...(evidence ? { _layoutConstraintEvidence: { ...evidence,
        finalBox: projectBox(evidence.finalBox, delta, size),
        ...(size ? { computedRatios: computeGeneratedLayoutRatios(evidence.declared, size) } : {}),
        // Frame 后代的父/祖父容器也是被平移的编译事实；保留声明值与宽高比例。
        parent: frameLayoutId && insideFrame(evidence.parent.nodeId, frameLayoutId)
          ? { ...evidence.parent, finalBox: projectBox(evidence.parent.finalBox, delta) } : evidence.parent,
        ...(evidence.parentConstraint ? { parentConstraint: { ...evidence.parentConstraint,
          parent: frameLayoutId && insideFrame(evidence.parentConstraint.parent.nodeId, frameLayoutId)
            ? { ...evidence.parentConstraint.parent, finalBox: projectBox(evidence.parentConstraint.parent.finalBox, delta) }
            : evidence.parentConstraint.parent,
        } } : {}),
      } } : {}),
    };
  }
  const slides = deckSpec.slides.map(slide => {
    if (slide.spec.type === 'structured') {
      const elements = slide.spec.elements.map(project);
      return elements.every((element, index) => element === slide.spec.elements[index]) ? slide : { ...slide, spec: { ...projectReplay(slide.spec), elements } };
    }
    const elements = slide.spec.elements.map(project);
    return elements.every((element, index) => element === slide.spec.elements[index]) ? slide : { ...slide, spec: { ...projectReplay(slide.spec), elements } };
  });
  return { kind: 'projected', deckSpec: { ...deckSpec, slides } };
}

function canProject(operation: SlidesManualEditOperation): operation is ProjectableOperation {
  switch (operation.op) {
    case 'translate_by': return isManualTranslationOnGrid(operation.delta);
    // 绝对尺寸能直接量化；增量锚点补偿必须在格点上，不能在已舍入位置上累计非整格位移。
    case 'set_visual_size': return !operation.translationDelta || isManualTranslationOnGrid(operation.translationDelta);
    case 'set_fill_color': return true;
    case 'set_text_width': return isManualTranslationOnGrid({ dx: operation.width, dy: 0 });
    default: return false;
  }
}
function matchesTarget(ref: SlidesAuthoringObjectRef | undefined, target: SlidesAuthoringEditRef): boolean {
  return ref?.slideKey === target.slideKey && ref.editKey === target.editKey;
}
function insideFrame(nodeId: string, frameId: string): boolean { return nodeId === frameId || nodeId.startsWith(`${frameId}.`); }
function projectBox<T extends { readonly x: number; readonly y: number; readonly w: number; readonly h: number }>(
  box: T, delta: { readonly dx: number; readonly dy: number }, size?: { readonly w: number; readonly h: number },
): T {
  return { ...box, x: roundToManualTranslationGrid(box.x + delta.dx), y: roundToManualTranslationGrid(box.y + delta.dy),
    ...(size ? { w: roundToManualTranslationGrid(size.w), h: roundToManualTranslationGrid(size.h) } : {}) };
}
