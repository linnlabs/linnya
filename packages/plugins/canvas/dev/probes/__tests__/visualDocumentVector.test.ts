import { createCanvas, loadImage } from '@napi-rs/canvas';
import { createVNode } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { expect, it } from 'vitest';
import { compareVisualTextLayout, compareVisualTextPixels, qualifiesDocumentVector, readVisualFontFacts,
  type VisualDocumentVector, type VisualImage, type VisualTextLayout } from '../visualOracle';

const paint: VisualDocumentVector['paint'] = { fill: 'none', stroke: 'rgb(62, 61, 59)', color: [62, 61, 59], background: [255, 255, 255],
  strokeWidth: '1px', strokeLinecap: 'round', strokeLinejoin: 'round', opacity: '1', fillOpacity: '1', strokeOpacity: '1',
  strokeDasharray: 'none', strokeDashoffset: '0px', vectorEffect: 'none',
  transform: 'none', visibility: 'visible', filter: 'none', clipPath: 'none', maskImage: 'none' };

/** 真正公开图标交给CPU SVG rasterizer；仅验证拒绝语义，不冒充Electron DOM/Windows资格。 */
async function fixture(damage?: 'missing' | 'color' | 'shift') {
  const markup = await renderToString(createVNode(DocumentIcon, { style: { color: damage === 'color' ? '#0000cc' : '#3e3d3b' } }));
  // 浏览器由14px槽建立viewport；CPU SVG加载器需要显式intrinsic size，不能让300×150默认框把图标缩没。
  const icon = await loadImage(Buffer.from(markup.replace('<svg', '<svg width="24" height="24"')));
  const canvas = createCanvas(90, 50), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (damage !== 'missing') context.drawImage(icon, damage === 'shift' ? 11 : 10, 14, 14, 14);
  context.fillStyle = '#3e3d3b'; context.font = '14px system-ui'; context.textBaseline = 'top'; context.fillText('文', 40, 14);
  const rect = { x: 40, y: 14, width: context.measureText('文').width, height: 18 };
  const vector: VisualDocumentVector = { id: 'document-icon:0', geometryKind: 'document-reference-icon', rect: { x: 10, y: 14, width: 14, height: 14 },
    viewBox: { x: 0, y: 0, width: 24, height: 24 }, preserveAspectRatio: null, transform: null, childNames: ['path', 'path'], paint,
    paths: Array.from(markup.matchAll(/<path[^>]*\sd="([^"]+)"/g), match => ({ d: match[1], transform: null, paint })) };
  const layout: VisualTextLayout = { version: 4, dpr: 1, fontsStatus: 'loaded', width: 90, vectors: [vector],
    graphemes: [{ id: 'text', text: '文', geometryKind: 'range', rects: [rect], style: {
      ...readVisualFontFacts({ font: '14px system-ui', fontFamily: 'system-ui', fontSize: '14px', fontStyle: 'normal', fontWeight: '400', fontStretch: '100%', fontVariantNumeric: 'normal' }),
      fontAvailable: true, lineHeight: '18px', letterSpacing: 'normal', direction: 'ltr', fontFeatureSettings: 'normal', fontVariationSettings: 'normal',
      transform: 'none', visibility: 'visible', color: [62, 61, 59], background: [255, 255, 255] } }],
    lines: [{ id: 'line:0', rect, graphemeIds: ['text'] }] };
  const image: VisualImage = { width: canvas.width, height: canvas.height, rgba: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  return { image, layout, vector };
}

it('公开DocumentIcon真实CPU位图独立统计图形质量，文字Range不替图标取得资格', async () => {
  const source = await fixture(), result = compareVisualTextPixels(source.image, source.image, source.layout);
  expect(qualifiesDocumentVector(source.vector)).toBe(true); expect(result.pass).toBe(true);
  expect(result.vectors).toHaveLength(1); expect(result.vectors[0].referenceMass).toBeGreaterThan(0);
  expect(result.vectors[0].structure.residual).toBe(0); expect(result.vectors[0].failures).toEqual([]);
});

it.each(['missing', 'color', 'shift'] as const)('真实SVG损坏%s必须由图形像素本身拒绝，保持原reference metadata仍拒绝', async damage => {
  const source = await fixture(), actual = await fixture(damage);
  expect(compareVisualTextPixels(source.image, source.image, source.layout).vectors[0].referenceMass).toBeGreaterThan(0);
  for (const pixi of [false, true]) {
    const result = compareVisualTextPixels(source.image, actual.image, source.layout, { pixi });
    expect(result.pass).toBe(false); expect(result.vectors[0].failures.length).toBeGreaterThan(0);
    expect(result.graphemes[0].failures).toEqual([]);
    if (damage === 'missing') expect(result.vectors[0].failures).toContain('missing_ink');
    if (damage === 'color') expect(result.vectors[0].failures).toContain('non_aa_residual');
    if (damage === 'shift') expect(result.vectors[0].failures).toContain('ink_position');
  }
});

it('SVG真实path身份或位置变化不具同源资格，未知图形不能扩大outside豁免', async () => {
  const source = await fixture(), changed = structuredClone(source.layout);
  changed.vectors[0].paths[0].d = 'M0 0h24v24z';
  expect(compareVisualTextLayout(source.layout, changed).pass).toBe(false);
  const unknown = structuredClone(source.layout); unknown.vectors[0].paint.fill = 'rgb(0, 0, 0)';
  const damaged = await fixture('missing');
  const result = compareVisualTextPixels(source.image, damaged.image, unknown);
  expect(result.vectors[0].qualified).toBe(false); expect(result.outsideText.differing).toBeGreaterThan(0);
  expect(result.pass).toBe(false);
  changed.vectors[0].paths[0].d = source.vector.paths[0].d; changed.vectors[0].rect.x += 1;
  expect(compareVisualTextLayout(source.layout, changed).failures).toContain('layout_vector_bounds:document-icon:0');
});

it('图标槽外黑条仍严格拒绝，已知SVG不得豁免临近空白', async () => {
  const source = await fixture(), actual = structuredClone(source.image);
  for (let y = 14; y < 28; y++) actual.rgba.set([0, 0, 0, 255], (y * actual.width + 30) * 4);
  const result = compareVisualTextPixels(source.image, actual, source.layout);
  expect(result.outsideText.differing).toBe(14); expect(result.vectors[0].failures).toEqual([]); expect(result.pass).toBe(false);
});
