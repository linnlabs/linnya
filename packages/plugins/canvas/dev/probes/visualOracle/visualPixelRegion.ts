import { VISUAL_TEXT_LIMITS, type VisualColor, type VisualImage, type VisualRect, type VisualInkMoment, type VisualMonochromePixels, type VisualStructureFacts } from './definitions';
import { matchesMonochromePaint } from './monochromeTextModel';
import { coverageFacts, meanChannelAlpha } from './visualInkCoverage';

export function visualColorDistance(pixels: Uint8Array, i: number, color: VisualColor) {
  return Math.max(Math.abs(pixels[i] - color[0]), Math.abs(pixels[i + 1] - color[1]), Math.abs(pixels[i + 2] - color[2]));
}
export function visualChannelDelta(a: Uint8Array, b: Uint8Array, i: number) {
  return Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
}
export function visualPixelBounds(rect: VisualRect, dpr: number, image: VisualImage) {
  // 只扩展一物理像素容纳斜体overhang；不平移/缩放图像来找最佳匹配。
  return { left: Math.max(0, Math.floor(rect.x * dpr) - 1), top: Math.max(0, Math.floor(rect.y * dpr) - 1),
    right: Math.min(image.width, Math.ceil((rect.x + rect.width) * dpr) + 1), bottom: Math.min(image.height, Math.ceil((rect.y + rect.height) * dpr) + 1) };
}
export function readVisualPixelRegion(input: { reference: VisualImage; actual: VisualImage; mask: Uint8Array; rect: VisualRect;
  dpr: number; foreground: VisualColor; background: VisualColor; monochrome: VisualMonochromePixels; projectAlpha: boolean }) {
  const { reference, actual, mask, foreground, background } = input, bounds = visualPixelBounds(input.rect, input.dpr, reference);
  let referenceMass = 0, actualMass = 0, referenceX = 0, referenceY = 0, actualX = 0, actualY = 0;
  const referenceCoverage: VisualInkMoment = { mass: 0, x: 0, y: 0 }, actualCoverage: VisualInkMoment = { mass: 0, x: 0, y: 0 };
  let union = 0, residual = 0, nonAaColor = 0, meaningfulNonAaColor = 0, modeledLcdColor = 0, solid = 0, solidPreserved = 0, solidRolePreserved = 0, actualSolid = 0;
  let structureUnion = 0, structureResidual = 0, modeledPixels = 0;
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const i = (y * reference.width + x) * 4, a = visualColorDistance(reference.rgba, i, background), b = visualColorDistance(actual.rgba, i, background);
    const referenceInk = a > VISUAL_TEXT_LIMITS.contrastFloor, actualInk = b > VISUAL_TEXT_LIMITS.contrastFloor;
    const modeled = input.monochrome.legacyMask[i / 4] !== 0 && (!input.projectAlpha || matchesMonochromePaint(reference.rgba, actual.rgba, i, foreground, background));
    const structureModeled = input.monochrome.structureOwner[i / 4] > 0;
    const referenceShape = (structureModeled ? input.monochrome.referenceContrast[i / 4] : a) > VISUAL_TEXT_LIMITS.contrastFloor;
    const actualShape = (structureModeled ? input.monochrome.actualContrast[i / 4] : b) > VISUAL_TEXT_LIMITS.contrastFloor;
    if (structureModeled) modeledPixels++;
    if (referenceShape || actualShape) {
      structureUnion++;
      if (mask[i + 3] && (referenceShape !== actualShape
        || visualChannelDelta(reference.rgba, actual.rgba, i) > VISUAL_TEXT_LIMITS.solidColorDelta && !structureModeled)) structureResidual++;
    }
    if (referenceInk) { const mass = a / 255; referenceMass += mass; referenceX += x * mass; referenceY += y * mass; }
    if (actualInk) { const mass = b / 255; actualMass += mass; actualX += x * mass; actualY += y * mass; }
    if (referenceInk) {
      const mass = input.projectAlpha ? meanChannelAlpha(reference.rgba, i, foreground, background) : a / 255;
      referenceCoverage.mass += mass; referenceCoverage.x += x * mass; referenceCoverage.y += y * mass;
    }
    if (actualInk) {
      const mass = input.projectAlpha ? meanChannelAlpha(actual.rgba, i, foreground, background) : b / 255;
      actualCoverage.mass += mass; actualCoverage.x += x * mass; actualCoverage.y += y * mass;
    }
    if (referenceInk || actualInk) {
      union++;
      if (mask[i + 3]) {
        // 有意义的非AA颜色差也必须拒绝；emoji没有CSS文字实色核，不能只检查二值形状。
        if (referenceInk !== actualInk) residual++;
        else {
          nonAaColor++;
          if (visualChannelDelta(reference.rgba, actual.rgba, i) > VISUAL_TEXT_LIMITS.solidColorDelta) {
            meaningfulNonAaColor++;
            if (modeled) modeledLcdColor++;
            else residual++;
          }
        }
      }
    }
    // 只从reference实际存在的实色内核取证；小标点没有内核时仍必须通过非空/质量/位置检查。
    if (referenceInk && visualColorDistance(reference.rgba, i, foreground) <= VISUAL_TEXT_LIMITS.solidColorDelta) {
      solid++;
      const exact = visualColorDistance(actual.rgba, i, foreground) <= VISUAL_TEXT_LIMITS.solidColorDelta;
      if (exact) solidPreserved++;
      if (actualInk && (exact || input.monochrome.legacyMask[i / 4] !== 0 && matchesMonochromePaint(reference.rgba, actual.rgba, i, foreground, background))) solidRolePreserved++;
    }
    if (actualInk && visualColorDistance(actual.rgba, i, foreground) <= VISUAL_TEXT_LIMITS.solidColorDelta) actualSolid++;
  }
  return { bounds, union, residual, nonAaColor, meaningfulNonAaColor, modeledLcdColor, residualRatio: union ? residual / union : 1, referenceMass, actualMass,
    massRatio: referenceMass ? actualMass / referenceMass : 0,
    centroidDelta: referenceMass && actualMass ? Math.max(Math.abs(referenceX / referenceMass - actualX / actualMass),
      Math.abs(referenceY / referenceMass - actualY / actualMass)) : null,
    solid, solidPreserved, solidCoverage: solid ? solidPreserved / solid : null,
    solidRolePreserved, solidRoleCoverage: solid ? solidRolePreserved / solid : null,
    actualSolid, foregroundPeakPresent: solid === 0 || actualSolid > 0,
    coverage: coverageFacts(referenceCoverage, actualCoverage, input.projectAlpha ? 'rgb-alpha-mean' : 'contrast-max'),
    structure: { model: 'per-pixel-qualified-rgb-mean', union: structureUnion, residual: structureResidual,
      residualRatio: structureUnion ? structureResidual / structureUnion : 1, modeledPixels } satisfies VisualStructureFacts };
}
export function visualPixelRegionFailures(facts: ReturnType<typeof readVisualPixelRegion>, maximumResidualRatio: number): string[] {
  const failures: string[] = [];
  if (facts.referenceMass === 0) failures.push('reference_has_no_visible_ink');
  if (facts.actualMass === 0) failures.push('missing_ink');
  if (facts.coverage.massRatio < VISUAL_TEXT_LIMITS.massRatioMin || facts.coverage.massRatio > VISUAL_TEXT_LIMITS.massRatioMax) failures.push('ink_mass');
  if (facts.coverage.positionDelta === null || facts.coverage.positionDelta > VISUAL_TEXT_LIMITS.centroidPhysicalPx) failures.push('ink_position');
  if (facts.structure.residualRatio > maximumResidualRatio) failures.push('non_aa_residual');
  if (facts.solidRoleCoverage !== null && facts.solidRoleCoverage < VISUAL_TEXT_LIMITS.solidCoverage) failures.push('solid_color');
  if (!facts.foregroundPeakPresent) failures.push('foreground_peak');
  return failures;
}

