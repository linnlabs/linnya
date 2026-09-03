/**
 * 幻灯片级 patch 计算（删除 / 插入 / reorder）
 *
 * 单一职责：把 PatchSpec 中的 slide-level 操作折算成"最终的 slide 顺序数组"。
 * 不直接 mutate deck，只产出"序"，由主类按序拼接 originalSlideMap + insertions。
 *
 * 顺序语义（与 PatchSpec 公开协议一致）：
 * - `delete_slide.slideNumber`：从 0..N 全局删除该 1-based 位置；
 * - `insert_slide.slideNumber`：splice 索引（1-based 转 0-based 即 -1），
 *   - splice 0 → 插到所有现有页**之前**；
 *   - splice N → 插到第 N 页**之后**。
 *   多个 insert 同 splice 索引时，按 patchSpec.operations 中出现的顺序累计。
 * - `reorder_slides.order`：完整 1-based 序列，覆盖默认顺序；与 delete 互斥
 *   （主流程消费时由调用方保证）。
 */

import type {
  PatchOperation,
  PatchSpec,
  SlideEntry,
  StructuredSlideSpec,
} from '@plugin/slides/shared';

export function collectDeletedSlides(patchSpec: PatchSpec): Set<number> {
  return new Set(
    patchSpec.operations
      .filter(
        (operation): operation is Extract<PatchOperation, { op: 'delete_slide' }> =>
          operation.op === 'delete_slide',
      )
      .map((operation) => operation.slideNumber),
  );
}

/**
 * 收集所有 insert_slide，按 splice index 分桶。
 * 这里**深拷贝** spec，确保后续主流程对插入页的 mutate 不会回写到 patchSpec。
 */
export function collectInsertions(patchSpec: PatchSpec): Map<number, SlideEntry[]> {
  const insertions = new Map<number, SlideEntry[]>();

  for (const operation of patchSpec.operations) {
    if (operation.op !== 'insert_slide') {
      continue;
    }

    const spliceIndex = operation.slideNumber - 1;
    const list = insertions.get(spliceIndex) ?? [];
    list.push({
      slideNumber: 0,
      spec: JSON.parse(JSON.stringify(operation.spec)) as StructuredSlideSpec,
    });
    insertions.set(spliceIndex, list);
  }

  return insertions;
}

/**
 * 决定"原 slide 的访问顺序"：
 * - 优先使用 reorder_slides.order（完整覆盖）；
 * - 否则 1..slideCount 自然顺序，跳过 deletedSlides。
 */
export function resolveOriginalSlideOrder(
  slideCount: number,
  patchSpec: PatchSpec,
  deletedSlides: Set<number>,
): number[] {
  const reorderOp = patchSpec.operations.find(
    (operation): operation is Extract<PatchOperation, { op: 'reorder_slides' }> =>
      operation.op === 'reorder_slides',
  );
  if (reorderOp) {
    return reorderOp.order;
  }

  const order: number[] = [];
  for (let index = 1; index <= slideCount; index += 1) {
    if (!deletedSlides.has(index)) {
      order.push(index);
    }
  }
  return order;
}

export function pushInsertedSlides(target: SlideEntry[], slides?: SlideEntry[]): void {
  if (!slides) {
    return;
  }

  for (const slide of slides) {
    target.push(slide);
  }
}
