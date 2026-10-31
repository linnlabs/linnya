import type {
  DeckSpec, FreeformElement, StructuredElement, SourceSpan,
  GeneratedLayoutConstraintEvidence,
} from '@plugin/slides/shared';
import type { InsertBlankSlideIntoDeckSourceResult } from './insertBlankSlideIntoDeckSource.js';
import type { ManualEditDeckProjection } from '../definitions/manualEditDeckProjection.js';
import { hasUnanchoredObjectCalls } from '../../../sandbox/authoringIdentity/index.js';

/**
 * 新的空白 createSlide 没有布局依赖。内联 compose.slides 只增加一个成员，已有页无需重跑
 * sandbox/Yoga；但源码行号和布局诊断页码必须与完整编译保持一致，不能只 splice 页面数组。
 */
export function projectBlankSlideInsertion(
  deck: DeckSpec,
  insertion: InsertBlankSlideIntoDeckSourceResult,
  index: number,
  backgroundColor: string,
): ManualEditDeckProjection {
  if (!insertion.canProject) return { kind: 'requires_full_compile' };
  // 页面结构改变生成程序摘要；未固定调用点或循环序号身份不能沿用旧投影。
  if (deck.slides.some(slide => slide.spec.elements.some(element =>
    element._authoringRef?.editKey.startsWith('sysr_')
    || element._authoringRef?.editKey.startsWith('sysu_') && hasUnanchoredObjectCalls(insertion.source)))) {
    return { kind: 'requires_full_compile' };
  }

  const shiftSpan = (span: SourceSpan): SourceSpan => ({
    startLine: shiftLine(span.startLine),
    endLine: shiftLine(span.endLine),
  });
  function shiftLine(line: number): number {
    return line + insertion.lineShifts.reduce((sum, shift) => sum + (line >= shift.fromLine ? shift.count : 0), 0);
  }

  const slides = deck.slides.map((slide, oldIndex) => {
    const number = oldIndex + (oldIndex >= index ? 2 : 1);
    const shiftId = (id: string): string => id.replace(`layout:s${oldIndex + 1}:`, `layout:s${number}:`);
    function shiftParent(parent: GeneratedLayoutConstraintEvidence['parent']): GeneratedLayoutConstraintEvidence['parent'] {
      return {
        ...parent,
        nodeId: shiftId(parent.nodeId),
        ...(parent.sourceSpan ? { label: parent.label.replace(
          `L${parent.sourceSpan.startLine}-${parent.sourceSpan.endLine}`,
          `L${shiftLine(parent.sourceSpan.startLine)}-${shiftLine(parent.sourceSpan.endLine)}`,
        ) } : {}),
        ...(parent.parentNodeId ? { parentNodeId: shiftId(parent.parentNodeId) } : {}),
        ...(parent.sourceSpan ? { sourceSpan: shiftSpan(parent.sourceSpan) } : {}),
      };
    }
    function shiftMetadata<T extends StructuredElement | FreeformElement>(element: T): T {
      const evidence = element._layoutConstraintEvidence;
      return {
        ...element,
        ...(element._sourceSpan ? { _sourceSpan: shiftSpan(element._sourceSpan) } : {}),
        ...(evidence ? { _layoutConstraintEvidence: {
          ...evidence,
          layoutNodeId: shiftId(evidence.layoutNodeId),
          parent: shiftParent(evidence.parent),
          ...(evidence.parentConstraint ? { parentConstraint: {
            ...evidence.parentConstraint, parent: shiftParent(evidence.parentConstraint.parent),
          } } : {}),
        } } : {}),
      };
    }
    function shiftFreeform(element: FreeformElement): FreeformElement {
      const updated = shiftMetadata(element);
      return updated.type === 'group' && updated.children
        ? { ...updated, children: updated.children.map(shiftFreeform) }
        : updated;
    }
    const layoutReplay = slide.spec.layoutReplay && {
      nodes: slide.spec.layoutReplay.nodes.map(node => ({ ...node, id: shiftId(node.id) })),
    };
    return {
      ...slide,
      slideNumber: number,
      spec: slide.spec.type === 'structured'
        ? { ...slide.spec, ...(layoutReplay ? { layoutReplay } : {}), elements: slide.spec.elements.map(element => shiftMetadata(element)) }
        : { ...slide.spec, ...(layoutReplay ? { layoutReplay } : {}), elements: slide.spec.elements.map(shiftFreeform) },
    };
  });
  slides.splice(index, 0, {
    slideNumber: index + 1,
    spec: { type: 'freeform', background: { paint: { type: 'solid', color: backgroundColor } }, elements: [] },
  });
  return { kind: 'projected', deckSpec: { ...deck, slides } };
}
