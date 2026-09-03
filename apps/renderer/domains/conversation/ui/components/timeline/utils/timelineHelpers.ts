/**
 * 时间轴工具函数
 * 功能 (What): 提供时间轴相关的纯函数工具
 */

/**
 * 应用最小间距约束
 * 确保标记点之间保持最小距离，同时保持在边界内
 */
export function applyMinGap(
  positions: number[],
  minTop: number,
  maxTop: number,
  gap: number
): number[] {
  const n = positions.length;
  if (n === 0) return positions;
  
  const out = positions.slice();
  
  // 第一遍：从上到下，确保单调递增
  out[0] = Math.max(minTop, Math.min(positions[0], maxTop));
  for (let i = 1; i < n; i++) {
    const minAllowed = out[i - 1] + gap;
    out[i] = Math.max(positions[i], minAllowed);
  }
  
  // 如果最后一个超出边界，从下到上回调
  if (out[n - 1] > maxTop) {
    out[n - 1] = maxTop;
    for (let i = n - 2; i >= 0; i--) {
      const maxAllowed = out[i + 1] - gap;
      out[i] = Math.min(out[i], maxAllowed);
    }
    
    // 再次确保第一个在边界内
    if (out[0] < minTop) {
      out[0] = minTop;
      for (let i = 1; i < n; i++) {
        const minAllowed = out[i - 1] + gap;
        out[i] = Math.max(out[i], minAllowed);
      }
    }
  }
  
  // 最终边界检查
  for (let i = 0; i < n; i++) {
    if (out[i] < minTop) out[i] = minTop;
    if (out[i] > maxTop) out[i] = maxTop;
  }
  
  return out;
}

/**
 * 计算元素在容器中的归一化位置 (0-1)
 */
export function calculateNormalizedPosition(
  elementTop: number,
  firstElementTop: number,
  contentSpan: number
): number {
  const offsetFromStart = elementTop - firstElementTop;
  let n = contentSpan > 0 ? offsetFromStart / contentSpan : 0;
  return Math.max(0, Math.min(1, n));
}

