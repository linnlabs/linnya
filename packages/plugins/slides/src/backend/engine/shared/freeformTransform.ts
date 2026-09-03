/**
 * Freeform Transform 共享算法
 *
 * 单一职责：在 freeform group 嵌套树里维护"局部 ↔ 全局"坐标换算。
 *
 * **唯一实现来源**：
 * - generatedTextRenderInput：把嵌套文本换算到页面坐标（渲染测量路径）；
 * - DeckSpecPatchApplier.freeformApplier：把 patch.position（全局）反算成局部，
 *   写回元素 position（导入稿 patch 路径）。
 *
 * 历史教训：不同路径曾各自维护一份几乎相同的 `apply / build / measure` 三件套，
 * 长期存在隐性漂移。收敛到本文件后，CONTRACTS §5 明确：任何 freeform group 坐标换算必须复用本文件，
 * 禁止在外部重新实现。
 *
 * 设计要点：
 * - 所有出口 box 都过 `round3`，避免浮点精度引发的等值判定漂移；
 * - `measureFreeformChildrenBounds` 一律对 w/h 夹逼 ≥ 0，防止子节点跨界后产生负宽高；
 * - 没有子节点 / bounds 为空时退化为"只移动不缩放"，避免除零。
 */

import type { Box, FreeformElement } from '@plugin/slides/shared';

export interface FreeformTransform {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

export const IDENTITY_FREEFORM_TRANSFORM: FreeformTransform = {
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 把局部坐标 box 用 transform 投到全局。
 *
 * forward：local -> global
 *   global.x = offsetX + local.x * scaleX
 *   global.y = offsetY + local.y * scaleY
 */
export function applyFreeformTransform(box: Box, transform: FreeformTransform): Box {
  return {
    x: round3(transform.offsetX + box.x * transform.scaleX),
    y: round3(transform.offsetY + box.y * transform.scaleY),
    w: round3(box.w * transform.scaleX),
    h: round3(box.h * transform.scaleY),
  };
}

/**
 * 把全局坐标 patch 反算成局部坐标，用于把 patch.position 写回 element.position。
 *
 * inverse：global -> local
 *   local.x = (global.x - offsetX) / scaleX
 *   local.y = (global.y - offsetY) / scaleY
 *
 * patch 是 partial，未提供的轴沿用 current（不参与反算）。
 */
export function toLocalFreeformBox(
  current: Box,
  patch: Partial<Box>,
  transform: FreeformTransform,
): Box {
  return {
    x: patch.x != null ? round3((patch.x - transform.offsetX) / transform.scaleX) : current.x,
    y: patch.y != null ? round3((patch.y - transform.offsetY) / transform.scaleY) : current.y,
    w: patch.w != null ? round3(patch.w / transform.scaleX) : current.w,
    h: patch.h != null ? round3(patch.h / transform.scaleY) : current.h,
  };
}

/**
 * 计算 group children 的 bounds（局部坐标系）。
 *
 * - 任何一个轴没有有效输入时返回 null（让上层退化为"只移动不缩放"）；
 * - w/h 一律夹逼 ≥ 0，避免子节点排列翻转或跨界时产生负宽高；
 * - 不递归——本函数只看直接子层 bounds，更深层由各自 group 的 transform 累积处理。
 */
export function measureFreeformChildrenBounds(
  children: FreeformElement[] | undefined,
): Box | null {
  if (!children?.length) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const child of children) {
    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + child.position.w);
    maxY = Math.max(maxY, child.position.y + child.position.h);
  }

  if (
    !Number.isFinite(minX)
    || !Number.isFinite(minY)
    || !Number.isFinite(maxX)
    || !Number.isFinite(maxY)
  ) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}

/**
 * 用 group 的 position（局部）+ children 实际 bounds，构造该 group 内部的子坐标系 transform。
 *
 * 当 group 没有 children 或 bounds 退化时，退化为"沿用父 transform 的 scale，仅平移到 group 原点"。
 */
export function buildFreeformGroupTransform(
  group: Extract<FreeformElement, { type: 'group' }>,
  parent: FreeformTransform,
): FreeformTransform {
  const groupBox = applyFreeformTransform(group.position, parent);
  const bounds = measureFreeformChildrenBounds(group.children);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return {
      offsetX: groupBox.x,
      offsetY: groupBox.y,
      scaleX: parent.scaleX,
      scaleY: parent.scaleY,
    };
  }

  return {
    offsetX: groupBox.x - bounds.x * (groupBox.w / bounds.w),
    offsetY: groupBox.y - bounds.y * (groupBox.h / bounds.h),
    scaleX: groupBox.w / bounds.w,
    scaleY: groupBox.h / bounds.h,
  };
}
