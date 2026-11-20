import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyPptxPaintPatches, type PptxPaintWarning } from '../pptxPaintPostProcessor';
import { requiresNativePptxPaintPatch } from '../pptxPaintCompileAdapter';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
  registerPptxBackgroundPaint,
  registerPptxShapePaint,
  registerPptxTextEffects,
} from '../pptxPaintPatchPlan';
import type { TextEffects } from '@plugin/slides/shared';

/** 一个带 marker 的文本框，段落里放一个 run 和一个 endParaRPr，返回补丁后的 `a:p` 内部 XML。 */
async function applyTextEffects(
  effects: TextEffects,
  runProperties: string,
  warnings: PptxPaintWarning[] = [],
): Promise<string> {
  const plan = createPptxPaintPatchPlan();
  const marker = registerPptxTextEffects(createPptxPaintCompileContext(plan, 0), effects);
  const zip = new JSZip();
  zip.file('ppt/slides/slide1.xml', [
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
    '<p:cSld><p:spTree>',
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${marker}"/></p:nvSpPr><p:txBody><a:bodyPr/>`,
    `<a:p><a:r>${runProperties}<a:t>Text</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p>`,
    '</p:txBody></p:sp>',
    '</p:spTree></p:cSld></p:sld>',
  ].join(''));
  await applyPptxPaintPatches(zip, plan, (warning) => warnings.push(warning));
  const xml = await zip.file('ppt/slides/slide1.xml')!.async('text');
  return /<a:p>([\s\S]*)<\/a:p>/.exec(xml)![1];
}

describe('PPTX native Paint adapter', () => {
  it('does not schedule package patches for PptxGenJS-native solid paint', () => {
    expect(requiresNativePptxPaintPatch({ type: 'solid', color: '#123456' })).toBe(false);
    expect(requiresNativePptxPaintPatch({
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#123456', position: 0 },
        { color: '#654321', position: 1 },
      ],
    })).toBe(true);
  });

  it('writes radial background, multi-stop fill, linear stroke and alpha without JSON markers', async () => {
    const plan = createPptxPaintPatchPlan();
    const context = createPptxPaintCompileContext(plan, 0);
    registerPptxBackgroundPaint(context, {
      type: 'radial',
      center: { x: 0.25, y: 0.75 },
      radius: { x: 0.2, y: 0.3 },
      stops: [
        { color: '#FFFFFF', position: 0 },
        { color: '#102030', position: 1 },
      ],
    });
    const marker = registerPptxShapePaint(context, {
      fill: {
        type: 'linear',
        angle: 45,
        stops: [
          { color: '#FF0000', position: 0 },
          { color: '#00FF00', position: 0.5, opacity: 0.4 },
          { color: '#0000FF', position: 1 },
        ],
      },
      fillOpacity: 0.5,
      stroke: {
        width: 2,
        dash: 'dash',
        paint: {
          type: 'linear',
          angle: 90,
          stops: [
            { color: '#111111', position: 0 },
            { color: '#EEEEEE', position: 1 },
          ],
        },
      },
    });

    const zip = new JSZip();
    zip.file('ppt/slides/slide1.xml', [
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<p:cSld><p:spTree>',
      `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${marker}"/></p:nvSpPr><p:spPr>`,
      '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>',
      '<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>',
      '</p:spPr></p:sp>',
      '</p:spTree></p:cSld></p:sld>',
    ].join(''));

    await expect(applyPptxPaintPatches(zip, plan)).resolves.toBe(true);
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('text');

    expect(xml).toContain('<p:bg><p:bgPr><a:gradFill rotWithShape="1">');
    expect(xml).toContain('<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>');
    expect(xml).toContain('<a:tileRect l="5000" t="45000" r="55000" b="-5000"/>');
    expect(xml).toContain('<a:gs pos="50000"><a:srgbClr val="00FF00"><a:alpha val="20000"/></a:srgbClr></a:gs>');
    expect(xml).toContain('<a:lin ang="2700000" scaled="1"/>');
    expect(xml).toContain('<a:ln w="25400"><a:gradFill rotWithShape="1">');
    expect(xml).toContain('<a:lin ang="5400000" scaled="1"/>');
    expect(xml).toContain('<a:prstDash val="dash"/>');
    expect(xml).not.toContain('linnya-paint:');
    expect(xml).not.toContain(encodeURIComponent('{'));
  });

  it('文字外阴影按 pt 写 blurRad/dist，方向折回 0–359 度，缺省不透明度 0.3', async () => {
    const paragraph = await applyTextEffects(
      { shadow: { color: '#222222', blur: 0, offsetX: 2, offsetY: -2, opacity: 0.6 } },
      '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill></a:rPr>',
    );
    expect(paragraph).toContain(
      '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill><a:effectLst>'
      + '<a:outerShdw blurRad="0" dist="35921" dir="18900000" algn="tl" rotWithShape="0">'
      + '<a:srgbClr val="222222"><a:alpha val="60000"/></a:srgbClr></a:outerShdw></a:effectLst></a:rPr>',
    );

    const defaulted = await applyTextEffects(
      { shadow: { color: '#000000', blur: 6, offsetX: 0, offsetY: 2 } },
      '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill></a:rPr>',
    );
    expect(defaulted).toContain(
      '<a:outerShdw blurRad="76200" dist="25400" dir="5400000" algn="tl" rotWithShape="0">'
      + '<a:srgbClr val="000000"><a:alpha val="30000"/></a:srgbClr></a:outerShdw>',
    );
  });

  describe('只写 opacity 的文字效果', () => {
    it('纯色 srgb 的 run：保留颜色并写 alpha', async () => {
      const warnings: PptxPaintWarning[] = [];
      const paragraph = await applyTextEffects(
        { opacity: 0.4 },
        '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="C0392B"/></a:solidFill></a:rPr>',
        warnings,
      );
      expect(warnings).toEqual([]);
      expect(paragraph).toContain(
        '<a:rPr lang="en-US"><a:solidFill><a:srgbClr val="C0392B"><a:alpha val="40000"/></a:srgbClr></a:solidFill></a:rPr>',
      );
    });

    it('主题色的 run：保留主题色并补 alpha，不丢颜色也不丢透明度', async () => {
      const warnings: PptxPaintWarning[] = [];
      const paragraph = await applyTextEffects(
        { opacity: 0.4 },
        '<a:rPr lang="en-US"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>',
        warnings,
      );
      expect(warnings).toEqual([]);
      expect(paragraph).toContain(
        '<a:rPr lang="en-US"><a:solidFill><a:schemeClr val="accent1"><a:alpha val="40000"/></a:schemeClr></a:solidFill></a:rPr>',
      );
    });

    it('没有显式填充的 run：颜色可能继承自段落、占位符或形状样式，填充保持原样、不写 alpha，并给出诊断；段落结束符不报', async () => {
      const warnings: PptxPaintWarning[] = [];
      const paragraph = await applyTextEffects({ opacity: 0.4 }, '<a:rPr lang="en-US"></a:rPr>', warnings);

      expect(paragraph).toContain('<a:rPr lang="en-US"/>');
      expect(paragraph).not.toContain('Fill');
      expect(paragraph).not.toContain('alpha');
      expect(paragraph).toContain('<a:endParaRPr lang="en-US" dirty="0"/>');
      expect(warnings).toEqual([expect.objectContaining({
        code: 'text_opacity_not_written',
        slideNumber: 1,
        shapeId: '2',
        message: expect.stringContaining('继承'),
      })]);
    });

    it('run 的填充不是纯色（空心或渐变）：同样原样保留并给出诊断，不删填充', async () => {
      const warnings: PptxPaintWarning[] = [];
      const paragraph = await applyTextEffects(
        { opacity: 0.4 },
        '<a:rPr lang="en-US"><a:noFill/></a:rPr>',
        warnings,
      );

      expect(paragraph).toContain('<a:rPr lang="en-US"><a:noFill/></a:rPr>');
      expect(paragraph).not.toContain('alpha');
      expect(warnings).toHaveLength(1);
    });

    it('没有显式填充但还写了阴影：阴影照常写入，填充仍不动，诊断照给', async () => {
      const warnings: PptxPaintWarning[] = [];
      const paragraph = await applyTextEffects(
        { opacity: 0.4, shadow: { color: '#000000', blur: 0, offsetX: 0, offsetY: 2 } },
        '<a:rPr lang="en-US"></a:rPr>',
        warnings,
      );

      expect(paragraph).toContain('<a:rPr lang="en-US"><a:effectLst><a:outerShdw');
      expect(paragraph).not.toContain('solidFill');
      expect(warnings).toHaveLength(1);
    });
  });
});
