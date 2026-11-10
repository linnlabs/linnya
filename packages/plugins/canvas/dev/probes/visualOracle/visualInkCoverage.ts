import type { VisualColor, VisualCoverage, VisualInkMoment } from './definitions';

/** 统计全部有效RGB通道的归一化覆盖；不是选green、模糊图像或还原某个字体rasterizer。 */
export function meanChannelAlpha(pixels: Uint8Array, i: number, foreground: VisualColor, background: VisualColor): number {
  let sum = 0, channels = 0;
  for (let channel = 0; channel < 3; channel++) {
    const delta = foreground[channel] - background[channel];
    if (delta === 0) continue;
    sum += Math.min(1, Math.max(0, (pixels[i + channel] - background[channel]) / delta)); channels++;
  }
  return channels ? sum / channels : 0;
}
export function coverageFacts(reference: VisualInkMoment, actual: VisualInkMoment, model: VisualCoverage['model']): VisualCoverage {
  const a = reference.mass ? { x: reference.x / reference.mass, y: reference.y / reference.mass } : null;
  const b = actual.mass ? { x: actual.x / actual.mass, y: actual.y / actual.mass } : null;
  return { model, referenceMass: reference.mass, actualMass: actual.mass, massRatio: reference.mass ? actual.mass / reference.mass : 0,
    referenceCentroid: a, actualCentroid: b, positionDelta: a && b ? Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) : null };
}

/** 行位置用同一reference权重；actual灰阶覆盖率变化不能把两个相隔很远的单词重新加权。 */
export function fixedReferenceLineCoverage(regions: readonly { readonly coverage: VisualCoverage }[]): VisualCoverage {
  const reference: VisualInkMoment = { mass: 0, x: 0, y: 0 }, actual: VisualInkMoment = { mass: 0, x: 0, y: 0 };
  let actualMass = 0, allVisible = true;
  for (const { coverage } of regions) {
    const weight = coverage.referenceMass;
    reference.mass += weight; actual.mass += weight; actualMass += coverage.actualMass;
    if (coverage.referenceCentroid) { reference.x += weight * coverage.referenceCentroid.x; reference.y += weight * coverage.referenceCentroid.y; }
    if (coverage.actualCentroid) { actual.x += weight * coverage.actualCentroid.x; actual.y += weight * coverage.actualCentroid.y; }
    else allVisible = false;
  }
  const result = coverageFacts(reference, actual, 'fixed-reference-glyph-weights');
  return { ...result, actualMass, massRatio: reference.mass ? actualMass / reference.mass : 0,
    actualCentroid: allVisible ? result.actualCentroid : null, positionDelta: allVisible ? result.positionDelta : null };
}
