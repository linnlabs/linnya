import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { compareVisualTextPixels, compareVisualTextLayout, type VisualImage, type VisualTextLayout } from '../visualOracle';

// CPU Skia生成真实字形，只验证oracle规则；不能代替Electron的真实Range/Win AA资格与GPU负例。
const tokens = ['中', ...Array.from({ length: 40 }, () => '文'), '、', '🖼️', '红'];
function fixture(change?: 'han' | 'punctuation' | 'emoji' | 'clip' | 'shift' | 'size' | 'color') {
  const canvas = createCanvas(1600, 100), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '24px sans-serif'; context.textBaseline = 'top';
  const graphemes: VisualTextLayout['graphemes'] = [];
  tokens.forEach((text, index) => {
    const rect = { x: 12 + index * 34, y: 24, width: context.measureText(text).width, height: 30 };
    graphemes.push({ id: String(index), text, rects: [rect], style: { font: '24px sans-serif', lineHeight: '30px', letterSpacing: 'normal',
      direction: 'ltr', fontFeatureSettings: 'normal', fontVariationSettings: 'normal', transform: 'none', visibility: 'visible',
      color: text === '红' ? [204, 0, 0] : [0, 0, 0], background: [255, 255, 255], fontLoaded: true } });
    if ((change === 'han' && index === 0) || (change === 'punctuation' && text === '、') || (change === 'emoji' && text === '🖼️')) return;
    context.font = change === 'size' ? '30px sans-serif' : '24px sans-serif';
    context.fillStyle = text === '红' ? change === 'color' ? '#00c' : '#c00' : '#000';
    context.fillText(text, rect.x + (change === 'shift' ? 1 : 0), rect.y);
  });
  if (change === 'clip') { context.fillStyle = '#fff'; context.fillRect(0, 39, canvas.width, canvas.height - 39); }
  const image: VisualImage = { width: canvas.width, height: canvas.height, rgba: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  return { image, layout: { version: 1, dpr: 1, fontsStatus: 'loaded', width: canvas.width, graphemes,
    lines: [{ id: 'line:0', rect: { x: 12, y: 24, width: 1480, height: 30 }, graphemeIds: graphemes.map(grapheme => grapheme.id) }] } satisfies VisualTextLayout };
}

it('相同实际CPU字形通过每簇和行检查，报告保留墨迹分母与零AA残差', () => {
  const source = fixture(), result = compareVisualTextPixels(source.image, source.image, source.layout);
  expect(result.pass).toBe(true); expect(result.graphemes).toHaveLength(tokens.length);
  expect(result.graphemes.every(grapheme => grapheme.union > 0 && grapheme.residual === 0)).toBe(true);
});

it.each(['han', 'punctuation', 'emoji', 'clip', 'shift', 'size', 'color'] as const)('真实字形损坏%s即使白底巨大也拒绝，metadata一致不能替像素通过', change => {
  const source = fixture(), damaged = fixture(change);
  const result = compareVisualTextPixels(source.image, damaged.image, source.layout);
  expect(result.pass).toBe(false);
  expect(result.graphemes.some(grapheme => grapheme.failures.length > 0)).toBe(true);
});

it('单标点丢失可保留全图raw墨迹95，但必须由该字簇非空/质量规则独立拒绝', () => {
  const source = fixture(), damaged = fixture('punctuation');
  let intersection = 0, union = 0;
  for (let i = 0; i < source.image.rgba.length; i += 4) {
    const a = source.image.rgba[i] < 180 && source.image.rgba[i + 1] < 180 && source.image.rgba[i + 2] < 180;
    const b = damaged.image.rgba[i] < 180 && damaged.image.rgba[i + 1] < 180 && damaged.image.rgba[i + 2] < 180;
    if (a && b) intersection++; if (a || b) union++;
  }
  expect(intersection / union).toBeGreaterThan(0.95);
  const punctuation = compareVisualTextPixels(source.image, damaged.image, source.layout).graphemes.find(grapheme => grapheme.text === '、');
  expect(punctuation?.failures).toContain('missing_ink');
});

it('未加载字体或一物理像素排版差异没有环境资格，不能靠像素重对齐接受', () => {
  const { layout } = fixture(), changed = structuredClone(layout);
  changed.graphemes[0].rects[0].x += 1;
  expect(compareVisualTextLayout(layout, changed).pass).toBe(false);
  changed.graphemes[0].rects[0].x -= 1; changed.graphemes[0].style.fontLoaded = false;
  expect(compareVisualTextLayout(layout, changed).pass).toBe(false);
});

it('文字ROI之外的黑条仍须拒绝；白底与相同文字不能掩掉非AA损坏', () => {
  const source = fixture(), damaged = structuredClone(source.image);
  // 放在首/末文字之间的空隙内，既不碰任何字簇，又处于Pixi正文比较区。
  for (let y = 25; y < 53; y++) for (let x = 39; x < 43; x++) damaged.rgba.set([0, 0, 0, 255], (y * damaged.width + x) * 4);
  const raster = compareVisualTextPixels(source.image, damaged, source.layout);
  const pixi = compareVisualTextPixels(source.image, damaged, source.layout, { pixi: true });
  expect(raster.outsideText.differing).toBeGreaterThan(0); expect(raster.pass).toBe(false);
  expect(pixi.outsideText.differing).toBeGreaterThan(0); expect(pixi.pass).toBe(false);
});
