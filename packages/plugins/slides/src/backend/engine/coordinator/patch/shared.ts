/**
 * DeckSpecPatchApplier 共享小工具：纯函数、无状态。
 *
 * 这些函数被 structured / freeform 两条主链共享。放在这里避免
 * 双方互相 import（避免反向 / 循环依赖）。
 */

import {
  findSlideElement,
  type PresentationInfo,
  type SlideElementInfo,
} from '@plugin/slides/shared';
import type { Box, PatchTarget } from '@plugin/slides/shared';

/**
 * 在 source PresentationInfo（导入侧的 ground-truth 结构）中找到 patch.target
 * 指向的源元素。优先用 OOXML `creationId`（最稳定的元素身份），
 * 退化到 `elementName`（人类可读、但模板复制后可能重名）。
 */
export function findSourceElementInfo(
  sourceInfo: PresentationInfo,
  target: PatchTarget,
): SlideElementInfo | null {
  const slide = sourceInfo.slides.find((entry) => entry.number === target.slideNumber);
  if (!slide) {
    return null;
  }

  if ('creationId' in target && target.creationId) {
    const byCreationId = findSlideElement(
      slide.elements,
      ({ element }) => element.creationId === target.creationId,
    );
    if (byCreationId) {
      return byCreationId;
    }
  }

  return findSlideElement(
    slide.elements,
    ({ element }) => element.name === target.elementName,
  ) ?? null;
}

/**
 * 用元素 bbox 的 L1 距离打"位置匹配分"，越接近分越高。
 * 用于 structured / freeform 两条主链在多个候选元素中挑"几何最像"的那个。
 */
export function positionScore(
  left: Box,
  right: NonNullable<SlideElementInfo['position']>,
): number {
  const delta = Math.abs(left.x - right.x)
    + Math.abs(left.y - right.y)
    + Math.abs(left.w - right.w)
    + Math.abs(left.h - right.h);
  if (delta < 0.01) {
    return 50;
  }
  if (delta < 0.1) {
    return 30;
  }
  if (delta < 0.5) {
    return 10;
  }
  return -20;
}

/** patch.position 仅 partial，未提供的轴沿用 current.box。 */
export function mergeBox(current: Box, patch: Partial<Box>): Box {
  return {
    x: patch.x != null ? round3(patch.x) : current.x,
    y: patch.y != null ? round3(patch.y) : current.y,
    w: patch.w != null ? round3(patch.w) : current.w,
    h: patch.h != null ? round3(patch.h) : current.h,
  };
}

/**
 * 通用 reorder：给定数组 + 当前 index + placement，原地调整顺序。
 *
 * placement 语义（与 PowerPoint "Bring to front / Send to back" 一致）：
 * - `front`  → 推到数组末尾（绘制最上层）
 * - `back`   → 推到数组开头（绘制最底层）
 * - `forward`→ 与后一个元素互换
 * - `backward`→ 与前一个元素互换
 *
 * Note: PPT 数组排序里 index 越大越靠前（最后绘制 = 最上层）。
 * 数组只有 ≤ 1 个元素 / index 越界时静默 no-op。
 */
export function reorderItem<T>(
  items: T[],
  index: number,
  placement: 'front' | 'back' | 'forward' | 'backward',
): void {
  if (index < 0 || index >= items.length || items.length <= 1) {
    return;
  }

  const [item] = items.splice(index, 1);
  if (!item) {
    return;
  }

  if (placement === 'front') {
    items.push(item);
    return;
  }

  if (placement === 'back') {
    items.unshift(item);
    return;
  }

  if (placement === 'forward') {
    items.splice(Math.min(index + 1, items.length), 0, item);
    return;
  }

  items.splice(Math.max(index - 1, 0), 0, item);
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
