import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import {
  addPptxCustomGeometryShape,
  addPptxShapeText,
  resolvePptxShapeGeometry,
} from './pptxShapeGeometryAdapter';
import { presetShapeNameToPptxName } from './shapeNameRegistry';

describe('PPTX shape geometry artifact', () => {
  it('preset 映射保留语义，不经过字符串 alias 或 rect fallback', () => {
    expect(presetShapeNameToPptxName('rightTriangle')).toBe('rtTriangle');
    expect(presetShapeNameToPptxName('nonIsoscelesTrapezoid')).toBe('nonIsoscelesTrapezoid');
    expect(presetShapeNameToPptxName('rightArrow')).toBe('rightArrow');
  });

  it('自定义轮廓和带文字轮廓都输出同一个 p:sp 内的 a:custGeom', async () => {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    const box = { x: 1, y: 1, w: 3, h: 2 };
    const geometry = resolvePptxShapeGeometry({
      type: 'regularPolygon',
      sides: 5,
    }, box);
    expect(geometry.shapeName).toBe('custGeom');
    expect(geometry.points).toHaveLength(6);

    addPptxCustomGeometryShape(slide, {
      ...box,
      points: geometry.points,
      fill: { color: '2563EB' },
    });
    addPptxShapeText(slide, '五边形', geometry, {
      x: 5,
      y: 1,
      w: box.w,
      h: box.h,
      fill: { color: 'F97316' },
      align: 'center',
      valign: 'middle',
    });

    const result = await pptx.write({ outputType: 'nodebuffer' });
    const zip = await JSZip.loadAsync(result);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(xml).toBeDefined();
    expect(xml?.match(/<a:custGeom>/g)).toHaveLength(2);
    expect(xml?.match(/<a:close \/>/g)).toHaveLength(2);
    expect(xml).toMatch(/<p:sp>[\s\S]*?<a:custGeom>[\s\S]*?<p:txBody>/);
  });

  it('开放 typed path 输出不带 close 的自定义几何', async () => {
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    const box = { x: 1, y: 1, w: 3, h: 2 };
    const geometry = resolvePptxShapeGeometry({
      type: 'path',
      viewBox: { width: 100, height: 100 },
      commands: [
        { type: 'moveTo', x: 0, y: 100 },
        { type: 'quadraticTo', x1: 50, y1: 0, x: 100, y: 100 },
      ],
    }, box);
    if (!geometry.points) throw new Error('expected custom geometry points');

    addPptxCustomGeometryShape(slide, {
      ...box,
      points: geometry.points,
      fill: { color: 'FFFFFF', transparency: 100 },
      line: { color: '2563EB', width: 2 },
    });

    const result = await pptx.write({ outputType: 'nodebuffer' });
    const zip = await JSZip.loadAsync(result);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(xml).toContain('<a:custGeom>');
    expect(xml).not.toContain('<a:close />');
  });
});
