import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import { normalizeMathFormulaSource } from '@plugin/slides/shared';
import { PptxPackageSanitizer } from '../../pptx/PptxPackageSanitizer';
import { createFormulaPptxCompileContext, createFormulaPptxPatchPlan } from './formulaPptxPlan';

describe('applyFormulaPptxPatches', () => {
  it('replaces exactly one placeholder shape with editable block OMML', async () => {
    const source = normalizeMathFormulaSource({
      latex: String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
      fontSize: 32,
      color: '#173B57',
      altText: '一元二次方程求根公式',
    });
    if ('error' in source) throw new Error(source.error);
    const plan = createFormulaPptxPatchPlan();
    const entry = createFormulaPptxCompileContext(plan, 0).register(
      source.value,
      { x: 1, y: 1, w: 8, h: 1.5 },
    );
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    slide.addText(entry.placeholderToken, {
      x: 1, y: 1, w: 8, h: 1.5,
      objectName: entry.objectName,
    });
    const raw = await pptx.write({ outputType: 'nodebuffer' });
    const buffer = await new PptxPackageSanitizer().sanitize(Buffer.from(raw as ArrayBuffer), { formulaPlan: plan });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(xml).toContain('<mc:AlternateContent');
    expect(xml).toContain('<a14:m>');
    expect(xml).toContain('<m:oMathPara');
    expect(xml).toContain('<m:f>');
    expect(xml).toContain('<m:rad>');
    expect(xml).not.toContain(entry.placeholderToken);
    expect(xml).not.toContain(source.value.latex);
  });

  it('replaces multiple rich-text placeholders inside the original paragraph', async () => {
    const first = normalizeMathFormulaSource({
      latex: String.raw`E=mc^2`,
      fontSize: 24,
      altText: '质能方程',
    }, 'inline');
    const second = normalizeMathFormulaSource({
      latex: String.raw`a^2+b^2=c^2`,
      fontSize: 24,
      altText: '勾股定理',
    }, 'inline');
    if ('error' in first) throw new Error(first.error);
    if ('error' in second) throw new Error(second.error);
    const plan = createFormulaPptxPatchPlan();
    const textBox = createFormulaPptxCompileContext(plan, 0).createInlineTextBox(
      { x: 1, y: 1, w: 8, h: 1.5 },
    );
    const firstEntry = textBox.register(first.value);
    const secondEntry = textBox.register(second.value);
    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    const slide = pptx.addSlide();
    slide.addText([
      { text: '先看 ' },
      { text: firstEntry.placeholderToken },
      { text: '，再比较 ' },
      { text: secondEntry.placeholderToken },
      { text: '。' },
    ], {
      x: 1, y: 1, w: 8, h: 1.5,
      objectName: textBox.objectName,
    });
    const raw = await pptx.write({ outputType: 'nodebuffer' });
    const buffer = await new PptxPackageSanitizer().sanitize(Buffer.from(raw as ArrayBuffer), { formulaPlan: plan });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/slides/slide1.xml')?.async('text');
    expect(xml).toMatch(/<a14:m(?:\s|>)/u);
    expect(xml?.match(/<a14:m(?:\s|>)/gu)).toHaveLength(2);
    expect(xml).toContain('先看 ');
    expect(xml).toContain('，再比较 ');
    expect(xml).toContain('。');
    expect(xml).not.toContain('LINNYA_INLINE_FORMULA');
    expect(xml).not.toContain('<m:oMathPara');
    expect(xml?.match(/<a:pPr(?:\s|>)/gu)).toHaveLength(1);
  });
});
