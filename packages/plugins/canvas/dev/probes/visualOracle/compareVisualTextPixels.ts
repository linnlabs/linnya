import pixelmatch from 'pixelmatch';
import { VISUAL_TEXT_LIMITS, type VisualColor, type VisualImage, type VisualRect, type VisualTextLayout } from './definitions';
import { matchesMonochromePaint, qualifiesMonochromeModel } from './monochromeTextModel';

/** Electron NativeImage明确返回BGRA；pixelmatch要求RGBA，不能把红/蓝颠倒后声称颜色通过。 */
export function visualImageFromBgra(pixels: Uint8Array, width: number, height: number): VisualImage {
  if (pixels.length !== width * height * 4) throw new Error('visual_oracle_image_size');
  const rgba = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) rgba.set([pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]], i);
  return { width, height, rgba };
}
function distance(pixels: Uint8Array, i: number, color: VisualColor) {
  return Math.max(Math.abs(pixels[i] - color[0]), Math.abs(pixels[i + 1] - color[1]), Math.abs(pixels[i + 2] - color[2]));
}
function channelDelta(a: Uint8Array, b: Uint8Array, i: number) {
  return Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
}
function pixelBounds(rect: VisualRect, dpr: number, image: VisualImage) {
  // 只扩展一物理像素容纳斜体overhang；不平移/缩放图像来找最佳匹配。
  return { left: Math.max(0, Math.floor(rect.x * dpr) - 1), top: Math.max(0, Math.floor(rect.y * dpr) - 1),
    right: Math.min(image.width, Math.ceil((rect.x + rect.width) * dpr) + 1), bottom: Math.min(image.height, Math.ceil((rect.y + rect.height) * dpr) + 1) };
}
function outsideTextFacts(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout, pixi: boolean) {
  const glyphBounds = layout.graphemes.filter(grapheme => /\S/u.test(grapheme.text)).flatMap(grapheme => grapheme.rects.map(rect => pixelBounds(rect, layout.dpr, reference)));
  const coverage = new Uint8Array(reference.width * reference.height);
  for (const bounds of glyphBounds) for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) coverage[y * reference.width + x] = 1;
  // Pixi有独立纸边/阴影，沿既有正文比较区排除材质；文字范围内的空隙不能随AA一起豁免。
  const region = pixi && glyphBounds.length ? { left: Math.min(...glyphBounds.map(bounds => bounds.left)), top: Math.min(...glyphBounds.map(bounds => bounds.top)),
    right: Math.max(...glyphBounds.map(bounds => bounds.right)), bottom: Math.max(...glyphBounds.map(bounds => bounds.bottom)) }
    : { left: 0, top: 0, right: reference.width, bottom: reference.height };
  let checked = 0, differing = 0;
  for (let y = region.top; y < region.bottom; y++) for (let x = region.left; x < region.right; x++) {
    const index = y * reference.width + x, i = index * 4;
    if (coverage[index]) continue;
    checked++;
    if (channelDelta(reference.rgba, actual.rgba, i) > VISUAL_TEXT_LIMITS.outsideColorDelta) differing++;
  }
  return { pass: differing === 0, checked, differing, region };
}
function monochromeMask(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout) {
  const allowed = new Uint8Array(reference.width * reference.height), forbidden = new Uint8Array(allowed.length);
  for (const grapheme of layout.graphemes.filter(item => /\S/u.test(item.text))) for (const rect of grapheme.rects) {
    const bounds = pixelBounds(rect, layout.dpr, reference), eligible = qualifiesMonochromeModel(grapheme);
    for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
      const index = y * reference.width + x;
      if (!eligible) forbidden[index] = 1;
      else if (matchesMonochromePaint(reference.rgba, actual.rgba, index * 4, grapheme.style.color, grapheme.style.background)) allowed[index] = 1;
    }
  }
  // 真实Range可重叠；彩色/未知字簇优先禁止，不得借邻字的单色资格蒙混过关。
  for (let index = 0; index < allowed.length; index++) if (forbidden[index]) allowed[index] = 0;
  return allowed;
}
function regionFacts(input: { reference: VisualImage; actual: VisualImage; mask: Uint8Array; rect: VisualRect;
  dpr: number; foreground: VisualColor; background: VisualColor; monochrome: Uint8Array }) {
  const { reference, actual, mask, foreground, background } = input, bounds = pixelBounds(input.rect, input.dpr, reference);
  let referenceMass = 0, actualMass = 0, referenceX = 0, referenceY = 0, actualX = 0, actualY = 0;
  let union = 0, residual = 0, nonAaColor = 0, meaningfulNonAaColor = 0, modeledLcdColor = 0, solid = 0, solidPreserved = 0;
  for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
    const i = (y * reference.width + x) * 4, a = distance(reference.rgba, i, background), b = distance(actual.rgba, i, background);
    const referenceInk = a > VISUAL_TEXT_LIMITS.contrastFloor, actualInk = b > VISUAL_TEXT_LIMITS.contrastFloor;
    if (referenceInk) { const mass = a / 255; referenceMass += mass; referenceX += x * mass; referenceY += y * mass; }
    if (actualInk) { const mass = b / 255; actualMass += mass; actualX += x * mass; actualY += y * mass; }
    if (referenceInk || actualInk) {
      union++;
      if (mask[i + 3]) {
        // 有意义的非AA颜色差也必须拒绝；emoji没有CSS文字实色核，不能只检查二值形状。
        if (referenceInk !== actualInk) residual++;
        else {
          nonAaColor++;
          if (channelDelta(reference.rgba, actual.rgba, i) > VISUAL_TEXT_LIMITS.solidColorDelta) {
            meaningfulNonAaColor++;
            if (input.monochrome[i / 4]) modeledLcdColor++;
            else residual++;
          }
        }
      }
    }
    // 只从reference实际存在的实色内核取证；小标点没有内核时仍必须通过非空/质量/位置检查。
    if (referenceInk && distance(reference.rgba, i, foreground) <= VISUAL_TEXT_LIMITS.solidColorDelta) {
      solid++; if (distance(actual.rgba, i, foreground) <= VISUAL_TEXT_LIMITS.solidColorDelta) solidPreserved++;
    }
  }
  return { bounds, union, residual, nonAaColor, meaningfulNonAaColor, modeledLcdColor, residualRatio: union ? residual / union : 1, referenceMass, actualMass,
    massRatio: referenceMass ? actualMass / referenceMass : 0,
    centroidDelta: referenceMass && actualMass ? Math.max(Math.abs(referenceX / referenceMass - actualX / actualMass),
      Math.abs(referenceY / referenceMass - actualY / actualMass)) : null,
    solid, solidPreserved, solidCoverage: solid ? solidPreserved / solid : null };
}
function reasons(facts: ReturnType<typeof regionFacts>, maximumResidualRatio: number): string[] {
  const failures: string[] = [];
  if (facts.referenceMass === 0) failures.push('reference_has_no_visible_ink');
  if (facts.actualMass === 0) failures.push('missing_ink');
  if (facts.massRatio < VISUAL_TEXT_LIMITS.massRatioMin || facts.massRatio > VISUAL_TEXT_LIMITS.massRatioMax) failures.push('ink_mass');
  if (facts.centroidDelta === null || facts.centroidDelta > VISUAL_TEXT_LIMITS.centroidPhysicalPx) failures.push('ink_position');
  if (facts.residualRatio > maximumResidualRatio) failures.push('non_aa_shape');
  if (facts.solidCoverage !== null && facts.solidCoverage < VISUAL_TEXT_LIMITS.solidCoverage) failures.push('solid_color');
  return failures;
}

/** AA只是局部梯度候选。逐簇墨迹、位置、实色独立约束，分母永远不是整幅白底。 */
export function compareVisualTextPixels(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout, options: { pixi?: boolean } = {}) {
  if (reference.width !== actual.width || reference.height !== actual.height
    || reference.rgba.length !== reference.width * reference.height * 4 || actual.rgba.length !== reference.rgba.length) throw new Error('visual_oracle_image_size');
  const mask = new Uint8Array(reference.rgba.length);
  const nonAaPixels = pixelmatch(reference.rgba, actual.rgba, mask, reference.width, reference.height,
    { threshold: 0, includeAA: false, diffMask: true });
  const monochrome = monochromeMask(reference, actual, layout);
  const graphemes = layout.graphemes.filter(grapheme => /\S/u.test(grapheme.text)).flatMap(grapheme => grapheme.rects.flatMap((rect, index) => {
    const bounds = pixelBounds(rect, layout.dpr, reference);
    if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) return [];
    const facts = regionFacts({ reference, actual, mask, monochrome, rect, dpr: layout.dpr, foreground: grapheme.style.color, background: grapheme.style.background });
    return [{ id: `${grapheme.id}:${index}`, text: grapheme.text, geometryKind: grapheme.geometryKind, monochromeEligible: qualifiesMonochromeModel(grapheme), ...facts,
      failures: reasons(facts, VISUAL_TEXT_LIMITS.graphemeResidualRatio) }];
  }));
  const lines = layout.lines.flatMap(line => {
    const first = layout.graphemes.find(grapheme => line.graphemeIds.includes(grapheme.id));
    if (!first || !line.graphemeIds.some(id => graphemes.some(grapheme => grapheme.id.startsWith(`${id}:`)))) return [];
    const facts = regionFacts({ reference, actual, mask, monochrome, rect: line.rect, dpr: layout.dpr, foreground: first.style.color, background: first.style.background });
    return [{ id: line.id, ...facts, failures: reasons(facts, VISUAL_TEXT_LIMITS.lineResidualRatio) }];
  });
  const outsideText = outsideTextFacts(reference, actual, layout, options.pixi === true);
  return { pass: outsideText.pass && graphemes.length > 0 && lines.length > 0 && [...graphemes, ...lines].every(region => region.failures.length === 0),
    nonAaPixels, limits: VISUAL_TEXT_LIMITS, outsideText, graphemes, lines };
}
