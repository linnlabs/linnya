import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { compareVisualTextPixels, compareVisualTextLayout, qualifiesMonochromeModel, matchesMonochromePaint, readVisualFontFacts,
  coverageFacts, fixedReferenceLineCoverage, meanChannelAlpha, readBitmapGhostPreservation, type VisualImage, type VisualTextLayout } from '../visualOracle';

// CPU Skia生成真实字形，只验证oracle规则；不能代替Electron的真实Range/Win AA资格与GPU负例。
const tokens = ['中', ...Array.from({ length: 40 }, () => '文'), '、', '🖼️', '红'];
function fixture(change?: 'han' | 'punctuation' | 'emoji' | 'clip' | 'shift' | 'size' | 'color' | 'opacity', fontFamily = 'sans-serif') {
  const canvas = createCanvas(1600, 100), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `24px ${fontFamily}`; context.textBaseline = 'top';
  const graphemes: VisualTextLayout['graphemes'] = [];
  tokens.forEach((text, index) => {
    const rect = { x: 12 + index * 34, y: 24, width: context.measureText(text).width, height: 30 };
    graphemes.push({ id: String(index), text, geometryKind: 'range', rects: [rect], style: {
      ...readVisualFontFacts({ font: `24px ${fontFamily}`, fontFamily, fontSize: '24px', fontStyle: 'normal', fontWeight: '400', fontStretch: '100%', fontVariantNumeric: 'normal' }),
      lineHeight: '30px', letterSpacing: 'normal',
      direction: 'ltr', fontFeatureSettings: 'normal', fontVariationSettings: 'normal', transform: 'none', visibility: 'visible',
      color: text === '红' ? [204, 0, 0] : [0, 0, 0], background: [255, 255, 255], fontAvailable: true } });
    if ((change === 'han' && index === 0) || (change === 'punctuation' && text === '、') || (change === 'emoji' && text === '🖼️')) return;
    context.font = `${change === 'size' ? 30 : 24}px ${fontFamily}`;
    context.fillStyle = text === '红' ? change === 'color' ? '#00c' : '#c00' : '#000';
    context.globalAlpha = change === 'opacity' ? 0.8 : 1;
    context.fillText(text, rect.x + (change === 'shift' ? 1 : 0), rect.y);
  });
  if (change === 'clip') { context.fillStyle = '#fff'; context.fillRect(0, 39, canvas.width, canvas.height - 39); }
  const image: VisualImage = { width: canvas.width, height: canvas.height, rgba: new Uint8Array(context.getImageData(0, 0, canvas.width, canvas.height).data) };
  return { image, layout: { version: 4, dpr: 1, fontsStatus: 'loaded', width: canvas.width, graphemes, vectors: [],
    lines: [{ id: 'line:0', rect: { x: 12, y: 24, width: 1480, height: 30 }, graphemeIds: graphemes.map(grapheme => grapheme.id) }] } satisfies VisualTextLayout };
}

it('相同实际CPU字形通过每簇和行检查，报告保留墨迹分母与零AA残差', () => {
  const source = fixture(), result = compareVisualTextPixels(source.image, source.image, source.layout);
  expect(result.pass).toBe(true); expect(result.graphemes).toHaveLength(tokens.length);
  expect(result.graphemes.every(grapheme => grapheme.union > 0 && grapheme.residual === 0)).toBe(true);
});

it.each(['han', 'punctuation', 'emoji', 'clip', 'shift', 'size', 'color', 'opacity'] as const)('真实字形损坏%s即使白底巨大也拒绝，metadata一致不能替像素通过', change => {
  const source = fixture(), damaged = fixture(change);
  const result = compareVisualTextPixels(source.image, damaged.image, source.layout);
  expect(result.pass).toBe(false);
  expect(result.graphemes.some(grapheme => grapheme.failures.length > 0)).toBe(true);
});

it('整体opacity .8虽然保留合理颜色混合，真实前景峰仍必须拒绝，不能冒充完成的文字', () => {
  // 必须实际走准入的单色模型；未知sans-serif的严格拒绝不能代替这条回归。
  const source = fixture(undefined, 'system-ui'), damaged = fixture('opacity', 'system-ui');
  const result = compareVisualTextPixels(source.image, damaged.image, source.layout);
  const han = result.graphemes.find(grapheme => grapheme.text === '中');
  expect(han?.monochromeEligible).toBe(true);
  expect(han?.coverage.model).toBe('rgb-alpha-mean');
  expect(han?.foregroundPeakPresent).toBe(false);
  expect(han?.failures).toContain('foreground_peak');
  expect(result.pass).toBe(false);
});

it('RGB平均覆盖与固定reference行权重分开统计位置，真实1px位移仍保留1px', () => {
  expect(meanChannelAlpha(new Uint8Array([0, 127, 255, 255]), 0, [0, 0, 0], [255, 255, 255])).toBeCloseTo(0.5, 2);
  const a = coverageFacts({ mass: 10, x: 0, y: 0 }, { mass: 8, x: 0, y: 0 }, 'rgb-alpha-mean');
  const b = coverageFacts({ mass: 10, x: 1000, y: 0 }, { mass: 10, x: 1000, y: 0 }, 'rgb-alpha-mean');
  const line = fixedReferenceLineCoverage([{ coverage: a }, { coverage: b }]);
  expect(line.positionDelta).toBe(0); expect(line.massRatio).toBe(0.9);
  const moved = fixedReferenceLineCoverage([{ coverage: { ...a, actualCentroid: { x: 1, y: 0 } } }, { coverage: { ...b, actualCentroid: { x: 101, y: 0 } } }]);
  expect(moved.positionDelta).toBe(1);
});

it('ghost守卫本身拒绝正确body位图在目标横条被擦字，不借DOM AA或另一oracle的失败', () => {
  const source = fixture().image, target = structuredClone(source);
  for (let y = 35; y <= 37; y++) for (let x = 0; x < target.width; x++) target.rgba.set([255, 255, 255, 255], (y * target.width + x) * 4);
  const same = readBitmapGhostPreservation(source, source, { theme: 'light', dpr: 1, ghostY: 36 });
  const damaged = readBitmapGhostPreservation(source, target, { theme: 'light', dpr: 1, ghostY: 36 });
  expect(same.pass).toBe(true); expect(same.preservation).toBe(1);
  expect(damaged.sourceInk).toBeGreaterThan(10); expect(damaged.preservation).toBe(0); expect(damaged.pass).toBe(false);
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
  changed.graphemes[0].rects[0].x -= 1; changed.graphemes[0].style.fontAvailable = false;
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

it.each(['swap', 'grayscale'] as const)('灰背景上的彩色字形%s质量/质心不变，也必须由非AA颜色残差拒绝', damage => {
  const glyph = createCanvas(80, 64), shape = glyph.getContext('2d');
  shape.font = '32px sans-serif'; shape.textBaseline = 'top'; shape.fillText('🖼️', 10, 8);
  // 用真实CPU字形alpha承载双色，确保任何平台的fallback字体都能复演“无CSS灰色核”的颜色盲区。
  const colors = shape.createLinearGradient(0, 0, 80, 0); colors.addColorStop(0, '#f0640a'); colors.addColorStop(1, '#0a64f0');
  shape.globalCompositeOperation = 'source-in'; shape.fillStyle = colors; shape.fillRect(0, 0, 80, 64);
  const canvas = createCanvas(80, 64), context = canvas.getContext('2d');
  context.fillStyle = '#808080'; context.fillRect(0, 0, 80, 64); context.drawImage(glyph, 0, 0);
  const reference: VisualImage = { width: 80, height: 64, rgba: new Uint8Array(context.getImageData(0, 0, 80, 64).data) };
  const actual = structuredClone(reference);
  for (let i = 0; i < actual.rgba.length; i += 4) {
    if (damage === 'swap') { const red = actual.rgba[i]; actual.rgba[i] = actual.rgba[i + 2]; actual.rgba[i + 2] = red; }
    else {
      const gray = 128 - Math.max(Math.abs(actual.rgba[i] - 128), Math.abs(actual.rgba[i + 1] - 128), Math.abs(actual.rgba[i + 2] - 128));
      actual.rgba.set([gray, gray, gray], i);
    }
  }
  const rect = { x: 0, y: 0, width: 80, height: 64 };
  const layout: VisualTextLayout = { version: 4, dpr: 1, fontsStatus: 'loaded', width: 80, vectors: [],
    graphemes: [{ id: 'emoji', text: '🖼️', geometryKind: 'range', rects: [rect], style: {
      ...readVisualFontFacts({ font: '32px system-ui', fontFamily: 'system-ui', fontSize: '32px', fontStyle: 'normal', fontWeight: '400', fontStretch: '100%', fontVariantNumeric: 'normal' }),
      lineHeight: '40px', letterSpacing: 'normal', direction: 'ltr',
      fontFeatureSettings: 'normal', fontVariationSettings: 'normal', transform: 'none', visibility: 'visible', color: [0, 0, 0], background: [128, 128, 128], fontAvailable: true } }],
    lines: [{ id: 'line:0', rect, graphemeIds: ['emoji'] }] };
  const result = compareVisualTextPixels(reference, actual, layout), emoji = result.graphemes[0];
  expect(emoji.massRatio).toBe(1); expect(emoji.centroidDelta).toBe(0); expect(emoji.solid).toBe(0);
  expect(emoji.meaningfulNonAaColor).toBeGreaterThan(0); expect(result.pass).toBe(false);
  expect(emoji.modeledLcdColor).toBe(0); expect(emoji.monochromeEligible).toBe(false);
});

it('单色资格按完整字簇排除emoji/组合旗帜/keycap/ZWJ，未知字体不获灰阶模型豁免', () => {
  const { layout } = fixture(), glyph = layout.graphemes[0]; glyph.style.fontFamily = 'system-ui';
  expect(qualifiesMonochromeModel(glyph)).toBe(true);
  for (const text of ['🖼️', '🇹🇼', '1️⃣', '👨‍👩‍👧‍👦', '©️']) expect(qualifiesMonochromeModel({ ...glyph, text })).toBe(false);
  expect(qualifiesMonochromeModel({ ...glyph, style: { ...glyph.style, fontFamily: 'unknown-font' } })).toBe(false);
  const reference = new Uint8Array([50, 80, 110, 255]);
  expect(matchesMonochromePaint(reference, new Uint8Array([80, 80, 80, 255]), 0, [0, 0, 0], [255, 255, 255])).toBe(true);
  expect(matchesMonochromePaint(reference, new Uint8Array([80, 0, 180, 255]), 0, [0, 0, 0], [255, 255, 255])).toBe(false);
});

it('marker的真实tabular-nums使shorthand为空时，availability query仍来自本元素长属性', () => {
  const marker = readVisualFontFacts({ font: '', fontFamily: 'system-ui', fontSize: '14px', fontStyle: 'normal', fontWeight: '400', fontStretch: '100%', fontVariantNumeric: 'tabular-nums' });
  expect(marker.fontShorthand).toBe(''); expect(marker.fontVariantNumeric).toBe('tabular-nums');
  expect(marker.fontQuery).toBe('normal 400 14px system-ui');
  const italic = readVisualFontFacts({ font: '', fontFamily: 'DifferentFont', fontSize: '18px', fontStyle: 'italic', fontWeight: '700', fontStretch: '100%', fontVariantNumeric: 'tabular-nums' });
  expect(italic.fontQuery).toBe('italic 700 18px DifferentFont');
});

/** 固定色段只检验统计单位；不是字体rasterizer，也不充当真实DOM/GPU正例。 */
function structureFixture(mixed = false, grayForeground: 0 | 200 = 0) {
  const width = mixed ? 40 : 20, height = 14, rgba = new Uint8Array(width * height * 4).fill(255);
  const reference: VisualImage = { width, height, rgba }, actual = structuredClone(reference);
  const paint = (image: VisualImage, left: number, right: number, color: readonly number[], top = 3, bottom = 11) => {
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) image.rgba.set([...color, 255], (y * width + x) * 4);
  };
  paint(reference, 6, 13, [grayForeground, grayForeground, grayForeground]); paint(actual, 6, 13, [grayForeground, grayForeground, grayForeground]);
  // 保持两侧fringe对称，只改变LCD/gray通道分布，不把真实质心位移混进结构单位测试。
  for (const left of [3, 13]) { paint(reference, left, left + 3, [210, 250, 255], 5, 9); paint(actual, left, left + 3, [238, 238, 238], 5, 9); }
  const base = fixture(undefined, 'system-ui').layout.graphemes[0];
  const graphemes: VisualTextLayout['graphemes'] = [{ ...base, geometryKind: 'range', id: 'black', text: '甲', rects: [{ x: 0, y: 0, width: 16, height }],
    style: { ...base.style, color: [grayForeground, grayForeground, grayForeground] } }];
  if (mixed) {
    paint(reference, 24, 31, [204, 0, 0]); paint(actual, 24, 31, [204, 0, 0]);
    paint(reference, 31, 34, [230, 250, 255]); paint(actual, 31, 34, [246, 212, 212]);
    graphemes.push({ ...base, geometryKind: 'range', id: 'red', text: '乙', rects: [{ x: 22, y: 0, width: 16, height }], style: { ...base.style, color: [204, 0, 0] } });
  }
  const layout: VisualTextLayout = { version: 4, dpr: 1, fontsStatus: 'loaded', width, graphemes, vectors: [],
    lines: [{ id: 'line', rect: { x: 0, y: 0, width, height }, graphemeIds: graphemes.map(glyph => glyph.id) }] };
  return { reference, actual, layout };
}

it.each([0, 200] as const)('合格LCD fringe与gray按同一平均覆盖判形状，前景%d也保留原24对比单位', foreground => {
  const source = structureFixture(false, foreground), result = compareVisualTextPixels(source.reference, source.actual, source.layout), line = result.lines[0];
  expect(result.oracleRevision).toBe(3); expect(result.pass).toBe(true);
  expect(line.residual).toBeGreaterThan(0); expect(line.residualRatio).toBeGreaterThan(0.05);
  expect(line.structure.model).toBe('per-pixel-qualified-rgb-mean'); expect(line.structure.residual).toBe(0);
  expect(line.structure.union).toBe(56); expect(line.structure.union).toBeLessThan(line.union);
});

it('同行不同作者颜色分别用自己的fg/bg模型，不把首个黑字的alpha套给红字', () => {
  const source = structureFixture(true), result = compareVisualTextPixels(source.reference, source.actual, source.layout);
  expect(result.pass).toBe(true); expect(result.graphemes).toHaveLength(2);
  expect(result.lines[0].structure.residual).toBe(0);
});

it('真实字形被横向擦笔画，即使背景alpha0符合fg/bg模型，结构判定自身也必须拒绝', () => {
  const source = fixture(undefined, 'system-ui'), actual = structuredClone(source.image), glyph = source.layout.graphemes[0], rect = glyph.rects[0];
  const middle = Math.floor(rect.y + rect.height / 2), erasedInk: number[] = [];
  for (let y = middle - 2; y <= middle + 2; y++) for (let x = Math.floor(rect.x); x < Math.ceil(rect.x + rect.width); x++) {
    const offset = (y * actual.width + x) * 4;
    if (source.image.rgba[offset] < 231) erasedInk.push(offset);
    actual.rgba.set([255, 255, 255, 255], offset);
  }
  const layout: VisualTextLayout = { ...source.layout, graphemes: [glyph], lines: [{ id: 'one-han', rect, graphemeIds: [glyph.id] }] };
  const result = compareVisualTextPixels(source.image, actual, layout), line = result.lines[0];
  expect(result.graphemes[0].monochromeEligible).toBe(true); expect(erasedInk.length).toBeGreaterThan(0);
  expect(erasedInk.every(offset => matchesMonochromePaint(source.image.rgba, actual.rgba, offset, glyph.style.color, glyph.style.background))).toBe(true);
  expect(line.structure.modeledPixels).toBeGreaterThan(0); expect(line.structure.residualRatio).toBeGreaterThan(0.05);
  expect(line.failures).toContain('non_aa_residual'); expect(result.pass).toBe(false);
});

it('无资格重叠字簇不能借已知邻字的RGB平均模型豁免差异', () => {
  for (const text of ['🖼️', '未知']) {
    const source = structureFixture(), base = source.layout.graphemes[0];
    source.layout.graphemes.push({ ...base, geometryKind: 'range', id: 'strict', text, rects: [{ x: 3, y: 5, width: 3, height: 4 }],
      style: { ...base.style, fontFamily: text === '未知' ? 'unknown-font' : 'system-ui' } });
    source.layout.lines[0].graphemeIds.push('strict');
    const result = compareVisualTextPixels(source.reference, source.actual, source.layout);
    expect(result.pass).toBe(false); expect(result.lines[0].structure.residual).toBeGreaterThan(0);
    expect(result.graphemes.find(glyph => glyph.sourceId === 'strict')?.monochromeEligible).toBe(false);
  }
});

it('已知单色字体的小标点整擦仍由非空/质量和结构规则拒绝', () => {
  const source = fixture(undefined, 'system-ui'), actual = fixture('punctuation', 'system-ui');
  const result = compareVisualTextPixels(source.image, actual.image, source.layout), punctuation = result.graphemes.find(glyph => glyph.text === '、');
  expect(punctuation?.monochromeEligible).toBe(true); expect(punctuation?.failures).toContain('missing_ink');
  expect(punctuation?.structure.residual).toBeGreaterThan(0); expect(result.pass).toBe(false);
});
