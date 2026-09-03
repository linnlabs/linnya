import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyPptxPaintPatches } from '../pptxPaintPostProcessor';
import { requiresNativePptxPaintPatch } from '../pptxPaintCompileAdapter';
import {
  createPptxPaintCompileContext,
  createPptxPaintPatchPlan,
  registerPptxBackgroundPaint,
  registerPptxShapePaint,
} from '../pptxPaintPatchPlan';

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
});
