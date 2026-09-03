/**
 * DeckSpecPatchApplier
 *
 * 把 PatchSpec 应用到 DeckSpec 上的薄编排层。
 *
 * **拆分约束**（详见 [`./patch/README.md`](./patch/README.md)）：
 * - element-level 操作 → `patch/{structuredApplier,freeformApplier}.ts`
 *   按 spec.type 二分派；两条主链共享 `patch/shared.ts` 的纯工具。
 * - slide-level 操作（insert / delete / reorder）→ `patch/slidePlan.ts`
 *   只输出"序"，不直接 mutate deck。
 * - 内部类型集中在 `patch/types.ts`。
 *
 * 外部 API 不变：唯一入口 `apply(deckSpec, patchSpec, sourceInfo)`。
 */

import type {
  DeckSpec,
  PatchSpec,
  PresentationInfo,
  SlideEntry,
} from '@plugin/slides/shared';
import { applyFreeformElementOp } from './patch/freeformApplier.js';
import { findSourceElementInfo } from './patch/shared.js';
import {
  collectDeletedSlides,
  collectInsertions,
  pushInsertedSlides,
  resolveOriginalSlideOrder,
} from './patch/slidePlan.js';
import { applyStructuredElementOp } from './patch/structuredApplier.js';
import type { ElementPatchOperation } from './patch/types.js';

export class DeckSpecPatchApplier {
  apply(
    deckSpec: DeckSpec,
    patchSpec: PatchSpec,
    sourceInfo: PresentationInfo | null,
  ): DeckSpec {
    const draft = JSON.parse(JSON.stringify(deckSpec)) as DeckSpec;
    const originalSlideMap = new Map<number, SlideEntry>(
      draft.slides.map((slide) => [slide.slideNumber, slide]),
    );

    if (sourceInfo) {
      for (const operation of patchSpec.operations) {
        if (!isElementPatchOperation(operation)) continue;
        this.applyElementOpToSlide(
          originalSlideMap.get(operation.target.slideNumber),
          operation,
          sourceInfo,
        );
      }
    }

    const deletedSlides = collectDeletedSlides(patchSpec);
    // insertions 的 key 是 splice 索引（slideNumber - 1），= "插在该 splice 索引位置的新页清单"。
    // splice 0 → 插到所有现有页前；splice N → 插到第 N 页之后。
    const insertions = collectInsertions(patchSpec);

    const originalOrder = resolveOriginalSlideOrder(
      draft.slides.length,
      patchSpec,
      deletedSlides,
    );
    const nextSlides: SlideEntry[] = [];

    pushInsertedSlides(nextSlides, insertions.get(0));
    for (const slideNumber of originalOrder) {
      if (deletedSlides.has(slideNumber)) {
        continue;
      }

      const slide = originalSlideMap.get(slideNumber);
      if (slide) {
        nextSlides.push(slide);
      }
      pushInsertedSlides(nextSlides, insertions.get(slideNumber));
    }

    return {
      ...draft,
      slides: nextSlides.map((slide, index) => ({
        ...slide,
        slideNumber: index + 1,
      })),
    };
  }

  private applyElementOpToSlide(
    slideEntry: SlideEntry | undefined,
    operation: ElementPatchOperation,
    sourceInfo: PresentationInfo,
  ): void {
    if (!slideEntry) {
      return;
    }

    const sourceElement = findSourceElementInfo(sourceInfo, operation.target);
    if (!sourceElement) {
      return;
    }

    if (slideEntry.spec.type === 'structured') {
      applyStructuredElementOp(slideEntry.spec, operation, sourceElement);
      return;
    }

    applyFreeformElementOp(slideEntry.spec, operation, sourceElement);
  }
}

function isElementPatchOperation(
  operation: PatchSpec['operations'][number],
): operation is ElementPatchOperation {
  switch (operation.op) {
    case 'modify_text':
    case 'replace_image':
    case 'update_chart':
    case 'update_table':
    case 'modify_style':
    case 'modify_geometry':
    case 'reorder_layer':
      return true;
    default:
      return false;
  }
}
