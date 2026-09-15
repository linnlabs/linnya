/** 调用方保证有限范围且 max > min；越界值的轨道与浏览器钳制后的滑钮保持一致。 */
export function sliderProgress(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
}
