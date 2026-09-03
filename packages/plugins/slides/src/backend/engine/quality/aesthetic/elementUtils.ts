/**
 * AestheticLint 共享工具：与"元素几何 / 文本"相关，但不属于任何单条规则的小函数。
 *
 * 这里的函数都是 pure，无状态、无副作用、无 I/O，方便：
 * - 各 lint 规则共享；
 * - 在主类不知情的前提下被未来新增规则直接复用；
 * - 单元测试可以直接 import 测，不必走 AestheticLint 全流程。
 */

import type { SlideElementInfo } from '@plugin/slides/shared';

/**
 * 在 shapes 中找到 bbox 完全包含 text bbox 的最小 shape——视为最贴近的容器。
 * 完全包含定义：四边都不小于 text 边界（带 0.01" 容差）。
 *
 * 仅用于 text contrast 规则推断"文字踩在哪个 shape 上"；找不到时返回 null
 * 而不是 page background，避免 lint 误用全局背景色（lint 不持有页面背景）。
 */
export function findContainingShape(
  text: SlideElementInfo,
  shapes: SlideElementInfo[],
): SlideElementInfo | null {
  if (!text.position) return null;
  const tp = text.position;
  const TOL = 0.01;
  let best: SlideElementInfo | null = null;
  let bestArea = Infinity;
  for (const s of shapes) {
    if (!s.position) continue;
    const sp = s.position;
    if (sp.x > tp.x + TOL) continue;
    if (sp.y > tp.y + TOL) continue;
    if (sp.x + sp.w + TOL < tp.x + tp.w) continue;
    if (sp.y + sp.h + TOL < tp.y + tp.h) continue;
    const area = sp.w * sp.h;
    if (area < bestArea) {
      bestArea = area;
      best = s;
    }
  }
  return best;
}

/**
 * 为 Lint 消息生成简短标识：优先用 element 名称，其次用首 12 字文本，最后用 type。
 * 用于错误消息里"某元素"的可读引用，调试 / 复现都用这个 label 锁定元素。
 */
export function abbreviateLabel(element: SlideElementInfo): string {
  if (element.name && element.name.trim().length > 0) return element.name.trim();
  if (element.text && element.text.trim().length > 0) {
    const snippet = element.text.trim().replace(/\s+/g, ' ');
    return snippet.length <= 12 ? snippet : `${snippet.slice(0, 12)}…`;
  }
  return element.type;
}

/**
 * 将数值列表按"相邻差 ≤ granularity 归为一档"聚合，返回每档的中位数（升序）。
 * 仅用于字号档位近似聚类——值域极小（通常 5-60 pt），O(n log n) 足够。
 */
export function clusterByGranularity(values: number[], granularity: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const tiers: number[] = [];
  let bucketStart = sorted[0];
  let bucket: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    if (v - bucketStart <= granularity) {
      bucket.push(v);
    } else {
      tiers.push(bucket[Math.floor(bucket.length / 2)]);
      bucket = [v];
      bucketStart = v;
    }
  }
  tiers.push(bucket[Math.floor(bucket.length / 2)]);
  return tiers;
}

/** 三位小数四舍五入（用于 metric 输出，避免 0.83333... 噪声） */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
