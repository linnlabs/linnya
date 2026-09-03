import type { Box, PatchOperation, PatchSpec, ShapeStyle } from '@plugin/slides/shared';
import type {
  ApplyMasterOp,
  ElementLevelOp,
  InsertionEntry,
  PatchPlan,
  ResolvedApplyMaster,
} from './types.js';

export class PatchPlanBuilder {
  static build(patchSpec: PatchSpec, slideCount: number): PatchPlan {
    const deletedSlides = new Set<number>();
    const insertions = new Map<number, InsertionEntry[]>();
    const elementOps = new Map<number, ElementLevelOp[]>();
    const applyMasterOps = new Map<number, ApplyMasterOp>();
    const resolvedApplyMasters = new Map<number, ResolvedApplyMaster>();
    let reorderOp: PatchPlan['reorderOp'] = null;

    for (const op of patchSpec.operations) {
      switch (op.op) {
        case 'delete_slide': {
          if (op.slideNumber < 1 || op.slideNumber > slideCount) {
            throw new Error(`delete_slide: slide ${op.slideNumber} is out of range [1, ${slideCount}]`);
          }
          deletedSlides.add(op.slideNumber);
          break;
        }
        case 'insert_slide': {
          // slideNumber 1-indexed = 操作完成后该新页所处的页码。
          // 合法范围：[1, slideCount + 1]（slideCount + 1 = 追加到末尾）。
          if (op.slideNumber < 1 || op.slideNumber > slideCount + 1) {
            throw new Error(`insert_slide: slideNumber ${op.slideNumber} is out of range [1, ${slideCount + 1}]`);
          }
          // PatchPlan.insertions 的 key 沿用 splice 索引 = slideNumber - 1，
          // 与 DeckSpecPatchApplier 的内部实现保持一致。
          const spliceIndex = op.slideNumber - 1;
          const list = insertions.get(spliceIndex) ?? [];
          list.push({ spec: op.spec, sourceLabel: '' });
          insertions.set(spliceIndex, list);
          break;
        }
        case 'reorder_slides': {
          if (reorderOp) {
            throw new Error('Multiple reorder_slides operations are not allowed');
          }
          reorderOp = op;
          break;
        }
        case 'modify_text':
        case 'replace_image':
        case 'update_chart':
        case 'update_table':
        case 'modify_style':
        case 'modify_geometry':
        case 'reorder_layer':
        case 'apply_master':
          break;
      }
    }

    PatchPlanBuilder.validateReorder(reorderOp, deletedSlides, slideCount);

    for (const op of patchSpec.operations) {
      switch (op.op) {
        case 'modify_text':
        case 'replace_image':
        case 'update_chart':
        case 'update_table': {
          PatchPlanBuilder.validateElementSlideMutation(op.op, op.target.slideNumber, slideCount, deletedSlides);
          const ops = elementOps.get(op.target.slideNumber) ?? [];
          if (op.op === 'modify_text') {
            PatchPlanBuilder.validateModifyText(op.text);
            ops.push({ ...op, text: op.text });
          } else {
            ops.push(op);
          }
          elementOps.set(op.target.slideNumber, ops);
          break;
        }
        case 'modify_style': {
          PatchPlanBuilder.validateElementSlideMutation(op.op, op.target.slideNumber, slideCount, deletedSlides);
          PatchPlanBuilder.validateSupportedStyle(op.style);
          break;
        }
        case 'modify_geometry': {
          PatchPlanBuilder.validateElementSlideMutation(op.op, op.target.slideNumber, slideCount, deletedSlides);
          PatchPlanBuilder.validateGeometryPatch(op.position);
          break;
        }
        case 'reorder_layer': {
          PatchPlanBuilder.validateElementSlideMutation(op.op, op.target.slideNumber, slideCount, deletedSlides);
          break;
        }
        case 'apply_master': {
          PatchPlanBuilder.validateElementSlideMutation(op.op, op.slideNumber, slideCount, deletedSlides);
          if (applyMasterOps.has(op.slideNumber)) {
            throw new Error(`apply_master: multiple master operations for slide ${op.slideNumber} are not allowed`);
          }
          applyMasterOps.set(op.slideNumber, op);
          break;
        }
        default:
          break;
      }
    }

    return {
      deletedSlides,
      insertions,
      elementOps,
      applyMasterOps,
      resolvedApplyMasters,
      reorderOp,
    };
  }

  static canReturnPreparedSource(plan: PatchPlan): boolean {
    return plan.deletedSlides.size === 0
      && plan.insertions.size === 0
      && plan.elementOps.size === 0
      && plan.applyMasterOps.size === 0
      && plan.resolvedApplyMasters.size === 0
      && !plan.reorderOp;
  }

  static resolveSlideOrder(plan: PatchPlan, slideCount: number): number[] {
    if (plan.reorderOp) {
      return plan.reorderOp.order;
    }
    const order: number[] = [];
    for (let index = 1; index <= slideCount; index += 1) {
      if (!plan.deletedSlides.has(index)) {
        order.push(index);
      }
    }
    return order;
  }

  private static validateElementSlideMutation(
    opName: PatchOperation['op'],
    slideNumber: number,
    slideCount: number,
    deletedSlides: Set<number>,
  ): void {
    if (slideNumber < 1 || slideNumber > slideCount) {
      throw new Error(`${opName}: slide ${slideNumber} is out of range [1, ${slideCount}]`);
    }
    if (deletedSlides.has(slideNumber)) {
      throw new Error(`${opName}: cannot modify slide ${slideNumber} which is marked for deletion`);
    }
  }

  private static validateReorder(
    reorderOp: PatchPlan['reorderOp'],
    deletedSlides: Set<number>,
    slideCount: number,
  ): void {
    if (!reorderOp) {
      return;
    }

    const survivingSlides: number[] = [];
    for (let index = 1; index <= slideCount; index += 1) {
      if (!deletedSlides.has(index)) {
        survivingSlides.push(index);
      }
    }

    if (reorderOp.order.length !== survivingSlides.length) {
      throw new Error(`reorder_slides: order must contain exactly ${survivingSlides.length} surviving slides`);
    }

    const allowed = new Set(survivingSlides);
    const seen = new Set<number>();

    for (const slideNumber of reorderOp.order) {
      if (slideNumber < 1 || slideNumber > slideCount) {
        throw new Error(`reorder_slides: slide ${slideNumber} is out of range [1, ${slideCount}]`);
      }
      if (deletedSlides.has(slideNumber)) {
        throw new Error(`reorder_slides: slide ${slideNumber} is marked for deletion`);
      }
      if (!allowed.has(slideNumber)) {
        throw new Error(`reorder_slides: slide ${slideNumber} is not available for reordering`);
      }
      if (seen.has(slideNumber)) {
        throw new Error(`reorder_slides: duplicate slide ${slideNumber} is not allowed`);
      }
      seen.add(slideNumber);
    }

    if (seen.size !== survivingSlides.length) {
      throw new Error('reorder_slides: order must be a complete permutation of surviving slides');
    }
  }

  private static validateSupportedStyle(style: Partial<ShapeStyle>): void {
    const unsupportedFields: string[] = [];
    if (style.borderRadius != null) {
      unsupportedFields.push('borderRadius');
    }
    if (unsupportedFields.length > 0) {
      throw new Error(`modify_style: unsupported style fields: ${unsupportedFields.join(', ')}`);
    }
    if (!style.fill && style.rotate == null && !style.border && style.opacity == null && !style.shadow) {
      throw new Error('modify_style: at least one supported field is required (fill, rotate, border, opacity, shadow)');
    }
  }

  private static validateModifyText(text: string | undefined): asserts text is string {
    if (text == null) {
      throw new Error('modify_text: text is required');
    }
  }

  private static validateGeometryPatch(position: Partial<Box>): void {
    const hasAnyField = position.x != null || position.y != null || position.w != null || position.h != null;
    if (!hasAnyField) {
      throw new Error('modify_geometry: at least one of x, y, w, h is required');
    }
    if (position.w != null && position.w <= 0) {
      throw new Error('modify_geometry: width must be greater than 0');
    }
    if (position.h != null && position.h <= 0) {
      throw new Error('modify_geometry: height must be greater than 0');
    }
  }
}
