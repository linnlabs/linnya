import { VISUAL_TEXT_LIMITS, type VisualTextLayout } from './definitions';

/** 只比较事实，不移动图像来补偿错位，也不把元数据一致当作位图有字的证据。 */
export function compareVisualTextLayout(reference: VisualTextLayout, actual: VisualTextLayout) {
  const failures: string[] = [];
  if (reference.dpr !== actual.dpr || reference.graphemes.length !== actual.graphemes.length
    || Math.abs(reference.width - actual.width) * reference.dpr > VISUAL_TEXT_LIMITS.layoutPhysicalPx) failures.push('layout_environment');
  reference.graphemes.forEach((expected, index) => {
    const found = actual.graphemes[index];
    if (!found || found.id !== expected.id || found.text !== expected.text || found.geometryKind !== expected.geometryKind || JSON.stringify(found.style) !== JSON.stringify(expected.style)
      || !expected.style.fontAvailable || !found.style.fontAvailable || found.rects.length !== expected.rects.length) {
      failures.push(`layout_grapheme:${expected.id}`); return;
    }
    if (expected.geometryKind === 'marker-gutter' && found.geometryKind === 'marker-gutter' && JSON.stringify(expected.marker) !== JSON.stringify(found.marker)) failures.push(`layout_marker:${expected.id}`);
    expected.rects.forEach((rect, rectIndex) => {
      const other = found.rects[rectIndex];
      if (Math.max(Math.abs(rect.x - other.x), Math.abs(rect.y - other.y), Math.abs(rect.width - other.width), Math.abs(rect.height - other.height))
        * reference.dpr > VISUAL_TEXT_LIMITS.layoutPhysicalPx) failures.push(`layout_bounds:${expected.id}`);
    });
  });
  return { pass: failures.length === 0, failures };
}
