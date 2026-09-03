import { describe, expect, it } from 'vitest';
import { normalizeMathFormulaSource } from '@plugin/slides/shared';
import { MathFormulaCompileError } from '../definitions/MathFormulaCompileError';
import { compileMathFormula } from './compileMathFormula';
import { emitFormulaMathMl } from './emitFormulaMathMl';

function source(latex: string) {
  const normalized = normalizeMathFormulaSource({ latex, fontSize: 32, color: '#173B57' });
  if ('error' in normalized) throw new Error(normalized.error);
  return normalized.value;
}

function compile(latex: string) {
  return compileMathFormula(source(latex));
}

describe('compileMathFormula', () => {
  it.each([
    ['fraction and radical', String.raw`\frac{-b \pm \sqrt{b^2-4ac}}{2a}`, ['<m:f>', '<m:rad>']],
    ['scripts', String.raw`x_i^2 + y^2`, ['<m:sSubSup>']],
    ['n-ary', String.raw`\sum_{i=1}^{n} i`, ['<m:nary>']],
    ['matrix', String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, ['<m:m>', '<m:d>']],
    ['aligned', String.raw`\begin{aligned}a&=b+c\\d&=e\end{aligned}`, ['<m:eqArr>']],
  ])('projects %s from one canonical IR', (_name, latex, expectedTags) => {
    const result = compile(latex);
    expect(result.ir.nodeCount).toBeGreaterThan(1);
    expect(result.renderProjection.canonicalSvg).toContain('<svg');
    expect(result.renderProjection.canonicalSvg).not.toContain(latex);
    expect(result.renderProjection.metrics.advanceWidth).toBeGreaterThan(0);
    for (const tag of expectedTags) expect(result.blockOmml).toContain(tag);
    expect(result.blockOmml).toContain('Cambria Math');
    expect(result.inlineOmml).toContain('<m:oMath');
  });

  it.each([
    String.raw`E=mc^2`,
    String.raw`a^2+b^2=c^2`,
    String.raw`\alpha+\beta=\gamma`,
    String.raw`x\in A \subseteq B`,
    String.raw`\left(\frac{x+1}{x-1}\right)`,
    String.raw`\sqrt[3]{x^2+y^2}`,
    String.raw`\binom{n}{k}`,
    String.raw`\prod_{i=1}^{n}x_i`,
    String.raw`\int_{0}^{\infty}e^{-x}x^2`,
    String.raw`\oint_C x\,dy-y\,dx`,
    String.raw`\lim_{x\to 0}\frac{\sin x}{x}=1`,
    String.raw`\hat{x}+\bar{y}+\vec{v}`,
    String.raw`\operatorname{rank}(A)=n`,
    String.raw`\begin{pmatrix}1&0\\0&1\end{pmatrix}`,
    String.raw`\begin{Bmatrix}a&b\\c&d\end{Bmatrix}`,
    String.raw`\begin{vmatrix}a&b\\c&d\end{vmatrix}`,
    String.raw`\begin{cases}x^2&x\ge 0\\-x&x<0\end{cases}`,
    String.raw`\begin{aligned}f(x)&=x^2+1\\f'(x)&=2x\end{aligned}`,
    String.raw`\nabla f=\left(\frac{\partial f}{\partial x},\frac{\partial f}{\partial y}\right)`,
    String.raw`\forall x\in A\;\exists y\in B`,
  ])('keeps the supported corpus on native SVG and OMML projections: %s', (latex) => {
    const result = compile(latex);
    expect(result.renderProjection.canonicalSvg).toMatch(/^<svg /u);
    expect(result.blockOmml).toContain('<m:oMath');
    expect(result.inlineOmml).toContain('<m:oMath');
    expect(result.renderProjection.contentViewBox.width).toBeGreaterThan(0);
    expect(result.renderProjection.contentViewBox.height).toBeGreaterThan(0);
    expect(result.renderProjection.canonicalSvg).toContain('<path');
    expect(result.renderProjection.canonicalSvg).not.toMatch(/<text\b/iu);
    expect(result.renderProjection.canonicalSvg).not.toContain('font-family');
  });

  it('preserves math token semantics and uses deterministic STIX2 path layout', () => {
    const formulaSource = source(String.raw`E=mc^2`);
    const first = compileMathFormula(formulaSource);
    const second = compileMathFormula(formulaSource);
    const mathMl = emitFormulaMathMl(first.ir, formulaSource);

    expect(first.ir.version).toBe(2);
    expect(mathMl).toContain('<mi>E</mi><mo>=</mo><mi>m</mi>');
    expect(mathMl).toContain('<msup><mi>c</mi><mrow><mn>2</mn></mrow></msup>');
    expect(first.renderProjection.canonicalSvg).toContain('STX-I-');
    expect(first.renderProjection.canonicalSvg).toContain('STX-N-');
    expect(first.renderProjection.canonicalSvg).toBe(second.renderProjection.canonicalSvg);
    expect(first.renderProjection.contentHash).toBe(second.renderProjection.contentHash);
    expect(first.renderProjection.metrics.advanceWidth).toBeGreaterThan(1.4);
    expect(first.renderProjection.contentViewBox.y).toBeLessThan(0);
    expect(first.renderProjection.viewBox.x).toBeLessThan(first.renderProjection.contentViewBox.x);
  });

  it('keeps roman and function tokens upright in the shared MathML projection', () => {
    const formulaSource = source(String.raw`\mathrm{Re}+\sin x+\operatorname{rank}(A)`);
    const result = compileMathFormula(formulaSource);
    const mathMl = emitFormulaMathMl(result.ir, formulaSource);
    expect(mathMl).toContain('<mi mathvariant="normal">Re</mi>');
    expect(mathMl).toContain('<mi mathvariant="normal">sin</mi>');
    expect(mathMl).toContain('<mi mathvariant="normal">rank</mi>');
  });

  it('keeps formula accessibility text XML-safe for browser SVG decoding', () => {
    const normalized = normalizeMathFormulaSource({
      latex: String.raw`f(x)=\begin{cases}x^2&x>0\\-x^2&x<0\end{cases}`,
      altText: `x<0 & x>0 say "negative" or 'positive'`,
      fontSize: 20,
      color: '#10243E',
    });
    if ('error' in normalized) throw new Error(normalized.error);

    const svg = compileMathFormula(normalized.value).renderProjection.canonicalSvg;
    expect(svg).toContain(
      'aria-label="x&lt;0 &amp; x&gt;0 say &quot;negative&quot; or &apos;positive&apos;"',
    );
    expect(svg).not.toContain('aria-label="x<0');
  });

  it('fails closed when preview glyphs cannot be embedded as paths', () => {
    expect(() => compile(String.raw`\text{总能量}`)).toThrowError(expect.objectContaining({
      code: 'slides.formula.unsupported_syntax',
    }));
  });

  it('fails closed for unknown commands', () => {
    expect(() => compile(String.raw`\unknown{x}`)).toThrowError(MathFormulaCompileError);
    try {
      compile(String.raw`\unknown{x}`);
    } catch (error) {
      expect(error).toMatchObject({ code: 'slides.formula.unsupported_syntax' });
    }
  });

  it('strips one complete outer delimiter before compiling', () => {
    const normalized = normalizeMathFormulaSource({ latex: String.raw`$$\frac{1}{2}$$` });
    expect(normalized).toMatchObject({ value: { latex: String.raw`\frac{1}{2}` } });
  });

  it('enforces the node budget across all matrix cells as one compilation', () => {
    const row = Array.from({ length: 256 }, () => 'xxxxxxxx').join('&');
    expect(() => compile(String.raw`\begin{matrix}${row}\end{matrix}`))
      .toThrowError(expect.objectContaining({ code: 'slides.formula.resource_limit_exceeded' }));
  });
});
