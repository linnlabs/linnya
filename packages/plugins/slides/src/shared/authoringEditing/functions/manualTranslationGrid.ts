import type { SlidesManualTranslation } from '../definitions/manualEdits';

/** 编译器把最终坐标量化到 1e-4 inch；人工平移落在同一格点上，快照累加才与重新编译等价。 */
const GRID_STEPS_PER_INCH = 10_000;

export function roundToManualTranslationGrid(value: number): number {
  return Math.round(value * GRID_STEPS_PER_INCH) / GRID_STEPS_PER_INCH;
}

export function quantizeManualTranslation(delta: SlidesManualTranslation): SlidesManualTranslation {
  return { dx: roundToManualTranslationGrid(delta.dx), dy: roundToManualTranslationGrid(delta.dy) };
}

/** 容忍十进制格点在二进制浮点中的表示误差，例如 0.1042 * 10000。 */
export function isManualTranslationOnGrid(delta: SlidesManualTranslation): boolean {
  return [delta.dx, delta.dy].every(value => Math.abs(value * GRID_STEPS_PER_INCH - Math.round(value * GRID_STEPS_PER_INCH)) < 1e-6);
}
