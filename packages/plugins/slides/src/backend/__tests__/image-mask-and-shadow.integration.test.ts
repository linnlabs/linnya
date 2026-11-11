import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import type { RenderNode } from '@plugin/slides/shared';
import { compilePresentationComposePayload } from '../features/presentationBuildExecution/functions/compilePresentationComposePayload';
import { preparePresentationMaterialization } from '../features/presentationBuildExecution/orchestration/preparePresentationMaterialization';
import { materializePresentationPptx } from '../features/presentationBuildExecution';
import { buildDeckSpecFromDirectInput, readCompiledDirectComposeInput } from '../codegen/compose/presentationComposeInput';
import { renderDeck } from './helpers/render-model-mapping-harness';
import { TINY_PNG_DATA_URI } from './helpers/render-pptx-alignment-harness';

/** deck.js 节点 → compose 回读 → DeckSpec → RenderModel 与原生 PPTX，走真实链路。 */
async function compileSlide(children: SandboxJsonObject[]) {
  const compiled = await compilePresentationComposePayload({
    title: 'Mask and shadow',
    slides: [{ _type: 'Slide', children }],
  });
  if (!compiled.ok) throw new Error(compiled.message);
  const parsed = readCompiledDirectComposeInput(compiled.input);
  if (!parsed.input) throw new Error(parsed.error);
  const deck = buildDeckSpecFromDirectInput(parsed.input);
  const nodes = renderDeck(deck).slides[0].elements;
  const pptx = await materializePresentationPptx(await preparePresentationMaterialization(deck, undefined, {}));
  const xml = await (await JSZip.loadAsync(pptx)).file('ppt/slides/slide1.xml')?.async('text');
  if (!xml) throw new Error('Expected slide XML');
  return { deck, nodes, xml };
}

async function compileError(children: SandboxJsonObject[]): Promise<string> {
  const compiled = await compilePresentationComposePayload({ title: 'Invalid', slides: [{ _type: 'Slide', children }] });
  if (compiled.ok) {
    const parsed = readCompiledDirectComposeInput(compiled.input);
    if (parsed.input) throw new Error('Expected compile failure');
    return parsed.error ?? '';
  }
  return compiled.message;
}

function image(extra: SandboxJsonObject): SandboxJsonObject {
  return { _type: 'Image', src: TINY_PNG_DATA_URI, width: 4, height: 2, fitMode: 'cover', ...extra };
}

function pictures(xml: string): string[] {
  return xml.match(/<p:pic>[\s\S]*?<\/p:pic>/g) ?? [];
}

function onlyNode(nodes: readonly RenderNode[], kind: RenderNode['kind']): RenderNode {
  const matches = nodes.filter((node) => node.kind === kind);
  expect(matches).toHaveLength(1);
  return matches[0];
}

const TRIANGLE_PATH = {
  type: 'path',
  viewBox: { width: 10, height: 10 },
  commands: [
    { type: 'moveTo', x: 5, y: 0 },
    { type: 'cubicTo', x1: 8, y1: 2, x2: 10, y2: 6, x: 10, y: 10 },
    { type: 'lineTo', x: 0, y: 10 },
    { type: 'close' },
  ],
};

describe('图片形状遮罩：预览与 PPTX 用同一份几何', () => {
  it('preset 遮罩写成图片的 prstGeom，导出后不留补丁标记', async () => {
    const { deck, nodes, xml } = await compileSlide([image({ maskShape: 'hexagon' })]);

    expect(deck.slides[0].spec.elements[0]).toEqual(expect.objectContaining({ type: 'image', maskShape: 'hexagon' }));
    expect(onlyNode(nodes, 'image')).toEqual(expect.objectContaining({ maskShape: { type: 'preset', name: 'hexagon' } }));
    const [picture] = pictures(xml);
    expect(picture).toContain('<a:prstGeom prst="hexagon"><a:avLst/></a:prstGeom>');
    expect(xml).not.toContain('linnya-paint:');
    expect(picture).toMatch(/<p:cNvPr id="\d+" name="Picture \d+"/);
  });

  it('path 遮罩写成 custGeom，坐标按 viewBox 映射到 0..100000，曲线与闭合都保留', async () => {
    const { nodes, xml } = await compileSlide([image({ maskShape: TRIANGLE_PATH })]);

    expect(onlyNode(nodes, 'image')).toEqual(expect.objectContaining({ maskShape: expect.objectContaining({ type: 'path' }) }));
    const [picture] = pictures(xml);
    expect(picture).not.toContain('<a:prstGeom');
    // 两个对角的零面积子路径让 PowerPoint 的贴图外框等于图片框（否则端点碰不到四边的轮廓会把图压扁）。
    expect(picture).toContain('<a:path w="100000" h="100000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="0" y="0"/></a:lnTo><a:close/>'
      + '<a:moveTo><a:pt x="100000" y="100000"/></a:moveTo><a:lnTo><a:pt x="100000" y="100000"/></a:lnTo><a:close/>');
    expect(picture).toContain('<a:moveTo><a:pt x="50000" y="0"/></a:moveTo>');
    expect(picture).toContain('<a:cubicBezTo><a:pt x="80000" y="20000"/><a:pt x="100000" y="60000"/><a:pt x="100000" y="100000"/></a:cubicBezTo>');
    expect(picture).toContain('<a:close/>');
  });

  it('circle 与旧 rounding 仍是 PptxGenJS 的 ellipse；rect 不算遮罩', async () => {
    const { xml } = await compileSlide([
      image({ maskShape: 'circle' }),
      image({ rounding: true }),
      image({ maskShape: 'rect' }),
    ]);
    const geometries = pictures(xml).map((picture) => picture.match(/prst="(\w+)"/)?.[1]);
    expect(geometries).toEqual(['ellipse', 'ellipse', 'rect']);
  });

  it('写错的遮罩名直接报错，不降级成矩形', async () => {
    expect(await compileError([image({ maskShape: 'blob' })])).toMatch(/maskShape/);
  });
});

/** 外方内方的“回”字框：两个闭合子路径，中间按奇偶规则挖空。 */
const FRAME_PATH = {
  type: 'path',
  viewBox: { width: 10, height: 10 },
  commands: [
    { type: 'moveTo', x: 0, y: 0 },
    { type: 'lineTo', x: 10, y: 0 },
    { type: 'lineTo', x: 10, y: 10 },
    { type: 'lineTo', x: 0, y: 10 },
    { type: 'close' },
    { type: 'moveTo', x: 3, y: 3 },
    { type: 'lineTo', x: 7, y: 3 },
    { type: 'lineTo', x: 7, y: 7 },
    { type: 'lineTo', x: 3, y: 7 },
    { type: 'close' },
  ],
};

describe('多个闭合子路径：镂空与分离笔画', () => {
  it('Shape 与图片遮罩都把全部子路径写进同一个 a:path（PowerPoint 按奇偶规则挖空）', async () => {
    const { nodes, xml } = await compileSlide([
      { _type: 'Shape', width: 2, height: 2, fill: '#B4552F', geometry: FRAME_PATH },
      image({ maskShape: FRAME_PATH }),
    ]);

    const shape = onlyNode(nodes, 'shape');
    expect(shape.kind === 'shape' && shape.geometry?.type === 'path' && shape.geometry.commands.filter((command) => command.type === 'moveTo')).toHaveLength(2);

    const paths = xml.match(/<a:path [^>]*>[\s\S]*?<\/a:path>/g) ?? [];
    expect(paths).toHaveLength(2);
    // Shape：两段各自 moveTo/close；图片：前面另有两个零面积的角点子路径。
    expect(paths[0].match(/<a:moveTo>/g)).toHaveLength(2);
    expect(paths[0].match(/<a:close ?\/>/g)).toHaveLength(2);
    expect(paths[1].match(/<a:moveTo>/g)).toHaveLength(4);
    expect(paths[1]).toContain('<a:moveTo><a:pt x="30000" y="30000"/></a:moveTo>');
  });

  it('多个子路径里有没闭合的一段时报错', async () => {
    const open = {
      ...FRAME_PATH,
      commands: [
        { type: 'moveTo', x: 0, y: 0 }, { type: 'lineTo', x: 10, y: 0 },
        { type: 'moveTo', x: 3, y: 3 }, { type: 'lineTo', x: 7, y: 3 }, { type: 'lineTo', x: 7, y: 7 }, { type: 'close' },
      ],
    };
    expect(await compileError([{ _type: 'Shape', width: 2, height: 2, fill: '#B4552F', geometry: open }])).toMatch(/每一段都要闭合/);
  });
});

describe('Shape / View 的投影：与图片同一种写法', () => {
  it('Shape.shadow 的 angle/distance 换成直角偏移；PPTX 的 0° 和 0 模糊按原值写出', async () => {
    const { deck, nodes, xml } = await compileSlide([{
      _type: 'Shape', width: 2, height: 1, fill: '#B4552F',
      shadow: { color: '#112233', blur: 0, angle: 0, distance: 4 },
    }]);

    const shape = deck.slides[0].spec.elements[0];
    expect(shape).toEqual(expect.objectContaining({ type: 'shape' }));
    const shadow = shape.type === 'shape' ? shape.style?.shadow : undefined;
    expect(shadow?.offsetX).toBeCloseTo(4);
    expect(shadow?.offsetY).toBeCloseTo(0);
    expect(onlyNode(nodes, 'shape')).toEqual(expect.objectContaining({ shadow: expect.objectContaining({ blur: 0 }) }));
    expect(xml).toContain('blurRad="0" dist="50800" dir="0"');
    expect(xml).toMatch(/<a:srgbClr val="112233">\s*<a:alpha val="30000"\/>/);
  });

  it('朝右上的投影折回 0–360°，不会被 PptxGenJS 改成正上方', async () => {
    const { xml } = await compileSlide([{
      _type: 'Shape', width: 2, height: 1, fill: '#B4552F',
      shadow: { blur: 4, angle: -45, distance: 3, opacity: 0.5 },
    }]);
    expect(xml).toContain(`dir="${315 * 60000}"`);
    expect(xml).toContain('<a:alpha val="50000"/>');
  });

  it('View.shadow 生成带投影的圆角底；没有底色或描边时报错', async () => {
    const { deck } = await compileSlide([{
      _type: 'View', children: [], width: 3, height: 2, backgroundColor: '#FFFFFF', borderRadius: 0.1,
      shadow: { blur: 12, angle: 90, distance: 4 },
    }]);
    expect(deck.slides[0].spec.elements[0]).toEqual(expect.objectContaining({
      type: 'shape',
      geometry: 'roundRect',
      style: expect.objectContaining({ shadow: expect.objectContaining({ blur: 12 }) }),
    }));

    expect(await compileError([{ _type: 'View', children: [], width: 3, height: 2, shadow: { blur: 4 } }])).toMatch(/backgroundColor/);
    expect(await compileError([{ _type: 'Shape', width: 1, height: 1, shadow: 'soft' }])).toMatch(/Shape\.shadow/);
  });

  it('图片投影距离为 0 时按 0 写出（去背图的贴边投影），默认不透明度与预览相同', async () => {
    const { xml } = await compileSlide([image({ shadow: { blur: 10 } })]);
    const [picture] = pictures(xml);
    expect(picture).toContain('blurRad="127000" dist="0" dir="2700000"');
    expect(picture).toContain('<a:alpha val="30000"/>');
  });
});
