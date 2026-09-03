/**
 * @file numberUtils.ts
 * @description Workspace 工具内部使用的数字工具函数（纯函数）
 *
 * 目标：
 * - 统一 clamp 逻辑，避免多个 Tool 各自实现导致行为漂移
 * - 保持工具层“高内聚低耦合”：工具编排代码不应关注数值边界细节
 */

/**
 * 将 number 限制在 [min, max] 区间内。
 *
 * 注意：
 * - NaN 会回退为 min（与历史实现保持一致）
 * - 该函数是纯函数，便于单元测试与复用
 */
export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}


