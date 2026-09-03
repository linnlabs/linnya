const POINTS_PER_INCH = 72;
const PIXELS_PER_INCH = 96;
const EMU_PER_INCH = 914400;

/** EMU (English Metric Units) → inches，保留 3 位小数 */
export function emuToInches(emu: number): number {
  return Math.round((emu / EMU_PER_INCH) * 1000) / 1000;
}

/** inches → EMU (English Metric Units) */
export function inchesToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

export function pointsToInches(points: number): number {
  return points / POINTS_PER_INCH;
}

export function inchesToPoints(inches: number): number {
  return inches * POINTS_PER_INCH;
}

export function pointsToPixels(points: number): number {
  return (points / POINTS_PER_INCH) * PIXELS_PER_INCH;
}

export function pixelsToInches(pixels: number): number {
  return pixels / PIXELS_PER_INCH;
}

export function inchesToPixels(inches: number): number {
  return inches * PIXELS_PER_INCH;
}
