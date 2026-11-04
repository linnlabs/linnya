import pixelmatch from 'pixelmatch';
import { VISUAL_TEXT_LIMITS, type VisualImage, type VisualTextLayout, type VisualMonochromePixels } from './definitions';
import { qualifiesMonochromeModel, monochromeStructureContrast } from './monochromeTextModel';
import { fixedReferenceLineCoverage } from './visualInkCoverage';
import { visualChannelDelta, visualPixelBounds, readVisualPixelRegion, visualPixelRegionFailures } from './visualPixelRegion';
import { qualifiesDocumentVector } from './documentVectorModel';
import { compareVisualVectorPixels } from './compareVisualVectorPixels';

/** Electron NativeImage明确返回BGRA；pixelmatch要求RGBA，不能把红/蓝颠倒后声称颜色通过。 */
export function visualImageFromBgra(pixels: Uint8Array, width: number, height: number): VisualImage {
  if (pixels.length !== width * height * 4) throw new Error('visual_oracle_image_size');
  const rgba = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 4) rgba.set([pixels[i + 2], pixels[i + 1], pixels[i], pixels[i + 3]], i);
  return { width, height, rgba };
}
function outsideTextFacts(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout, pixi: boolean) {
  const glyphBounds = [...layout.graphemes.filter(grapheme => /\S/u.test(grapheme.text)).flatMap(grapheme => grapheme.rects.map(rect => visualPixelBounds(rect, layout.dpr, reference))),
    ...layout.vectors.filter(qualifiesDocumentVector).map(vector => visualPixelBounds(vector.rect, layout.dpr, reference))];
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
    if (visualChannelDelta(reference.rgba, actual.rgba, i) > VISUAL_TEXT_LIMITS.outsideColorDelta) differing++;
  }
  return { pass: differing === 0, checked, differing, region };
}
function monochromePixels(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout): VisualMonochromePixels {
  const allowed = new Uint8Array(reference.width * reference.height), forbidden = new Uint8Array(allowed.length);
  const structureOwner = new Int32Array(allowed.length), referenceContrast = new Float64Array(allowed.length), actualContrast = new Float64Array(allowed.length);
  const paints = new Map<string, number>();
  const regions = [...layout.graphemes.filter(item => /\S/u.test(item.text)).flatMap(grapheme => grapheme.rects.map(rect => ({ rect,
    color: grapheme.style.color, background: grapheme.style.background, eligible: qualifiesMonochromeModel(grapheme) }))),
    ...layout.vectors.map(vector => ({ rect: vector.rect, color: vector.paint.color, background: vector.paint.background, eligible: qualifiesDocumentVector(vector) }))];
  for (const region of regions) {
    const bounds = visualPixelBounds(region.rect, layout.dpr, reference), eligible = region.eligible;
    const paint = `${region.color.join(',')}:${region.background.join(',')}`;
    let owner = paints.get(paint);
    if (owner === undefined) { owner = paints.size + 1; paints.set(paint, owner); }
    for (let y = bounds.top; y < bounds.bottom; y++) for (let x = bounds.left; x < bounds.right; x++) {
      const index = y * reference.width + x;
      if (!eligible) { forbidden[index] = 1; structureOwner[index] = -1; continue; }
      const pair = monochromeStructureContrast(reference.rgba, actual.rgba, index * 4, region.color, region.background);
      if (pair) allowed[index] = 1;
      // 同一像素的重叠Range只准入一致paint；不能挑一个有利的fg/bg解释混色或未知内容。
      if (!pair || structureOwner[index] !== 0 && structureOwner[index] !== owner) structureOwner[index] = -1;
      else { structureOwner[index] = owner; referenceContrast[index] = pair.reference; actualContrast[index] = pair.actual; }
    }
  }
  // 真实Range可重叠；彩色/未知字簇优先禁止，不得借邻字的单色资格蒙混过关。
  for (let index = 0; index < allowed.length; index++) if (forbidden[index]) allowed[index] = 0;
  return { legacyMask: allowed, structureOwner, referenceContrast, actualContrast };
}
/** AA只是局部梯度候选。逐簇墨迹、位置、实色独立约束，分母永远不是整幅白底。 */
export function compareVisualTextPixels(reference: VisualImage, actual: VisualImage, layout: VisualTextLayout, options: { pixi?: boolean } = {}) {
  if (reference.width !== actual.width || reference.height !== actual.height
    || reference.rgba.length !== reference.width * reference.height * 4 || actual.rgba.length !== reference.rgba.length) throw new Error('visual_oracle_image_size');
  const mask = new Uint8Array(reference.rgba.length);
  const nonAaPixels = pixelmatch(reference.rgba, actual.rgba, mask, reference.width, reference.height,
    { threshold: 0, includeAA: false, diffMask: true });
  const monochrome = monochromePixels(reference, actual, layout);
  const graphemes = layout.graphemes.filter(grapheme => /\S/u.test(grapheme.text)).flatMap(grapheme => grapheme.rects.flatMap((rect, index) => {
    const bounds = visualPixelBounds(rect, layout.dpr, reference);
    if (bounds.left >= bounds.right || bounds.top >= bounds.bottom) return [];
    const facts = readVisualPixelRegion({ reference, actual, mask, monochrome, rect, dpr: layout.dpr, foreground: grapheme.style.color, background: grapheme.style.background,
      projectAlpha: qualifiesMonochromeModel(grapheme) });
    return [{ id: `${grapheme.id}:${index}`, sourceId: grapheme.id, rect, text: grapheme.text, geometryKind: grapheme.geometryKind, monochromeEligible: qualifiesMonochromeModel(grapheme), ...facts,
      failures: visualPixelRegionFailures(facts, VISUAL_TEXT_LIMITS.graphemeResidualRatio) }];
  }));
  const lines = layout.lines.flatMap(line => {
    const first = layout.graphemes.find(grapheme => line.graphemeIds.includes(grapheme.id));
    if (!first || !line.graphemeIds.some(id => graphemes.some(grapheme => grapheme.id.startsWith(`${id}:`)))) return [];
    const raw = readVisualPixelRegion({ reference, actual, mask, monochrome, rect: line.rect, dpr: layout.dpr, foreground: first.style.color, background: first.style.background, projectAlpha: false });
    const paired = graphemes.filter(region => line.graphemeIds.includes(region.sourceId) && Math.abs(region.rect.y - line.rect.y) < 0.01 && Math.abs(region.rect.height - line.rect.height) < 0.01);
    const facts = { ...raw, coverage: fixedReferenceLineCoverage(paired) };
    return [{ id: line.id, ...facts, failures: visualPixelRegionFailures(facts, VISUAL_TEXT_LIMITS.lineResidualRatio) }];
  });
  const outsideText = outsideTextFacts(reference, actual, layout, options.pixi === true);
  const vectors = compareVisualVectorPixels({ reference, actual, mask, monochrome, layout });
  return { pass: outsideText.pass && graphemes.length > 0 && lines.length > 0 && [...graphemes, ...lines, ...vectors].every(region => region.failures.length === 0),
    oracleRevision: 3, nonAaPixels, limits: VISUAL_TEXT_LIMITS, outsideText, graphemes, lines, vectors };
}
