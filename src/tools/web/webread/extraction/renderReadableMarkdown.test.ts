import { describe, expect, it } from 'vitest';
import { parseCanonicalHtmlDocument } from './parseCanonicalHtmlDocument';
import { renderReadableMarkdown } from './renderReadableMarkdown';

function renderBodyMarkdown(bodyHtml: string): string {
  const document = parseCanonicalHtmlDocument(`<!doctype html><html><body><div>${bodyHtml}</div></body></html>`);
  const root = document.body.firstElementChild;
  if (!root) throw new Error('Expected root container');
  return renderReadableMarkdown(root);
}

describe('renderReadableMarkdown 代码语言与公式还原', () => {
  it('保留 pre > code 的安全语言标注，忽略非法语言，且不向其他节点泄漏 class/事件', () => {
    const markdown = renderBodyMarkdown(`
      <pre><code class="highlight language-TypeScript">export const ok = true;</code></pre>
      <pre class="lang-python">
        <code>print(42)</code>
      </pre>
      <pre data-lang="json"><code>{"k": 1}</code></pre>
      <pre><code>plain_code()</code></pre>
      <pre><code class="language-bad/lang">ignored()</code></pre>
      <table class="secret-table-cls" onclick="alert(1)"><tr><th>Col</th><th>Val</th></tr><tr><td>A</td><td>1</td></tr></table>
    `);

    expect(markdown).toContain('```typescript\nexport const ok = true;\n```');
    expect(markdown).toContain('```python\nprint(42)\n```');
    expect(markdown).toContain('```json\n{"k": 1}\n```');
    expect(markdown).toContain('```\nplain_code()\n```');
    expect(markdown).toContain('```\nignored()\n```');
    expect(markdown).not.toContain('secret-table-cls');
    expect(markdown).not.toContain('onclick');
    expect(markdown).not.toContain('bad/lang');
  });

  it('还原 KaTeX 行内/块级公式与 Wikipedia displaystyle annotation，不转义反斜杠也不丢正文', () => {
    const markdown = renderBodyMarkdown(`
      <p>质能方程为
        <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">E=mc2</span></span>。
      </p>
      <span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>P</mi></mrow><annotation encoding="application/x-tex">\\frac{a_1}{b_2}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">a1/b2</span></span></span>
      <p>贝叶斯公式为 <span class="mwe-math-element"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>P</mi></mrow><annotation encoding="application/x-tex">{\\displaystyle P(A\\mid B) = \\frac{P(B\\mid A)P(A)}{P(B)}}</annotation></semantics></math></span>，周围正文保留。</p>
      <p>裸标签公式：<math xmlns="http://www.w3.org/1998/Math/MathML"><mrow><mi>x</mi><mo>+</mo><mi>y</mi></mrow></math></p>
    `);

    expect(markdown).toContain('质能方程为 $E = mc^2$。');
    expect(markdown).not.toContain('E=mc2');
    expect(markdown).toContain('$$\n\\frac{a_1}{b_2}\n$$');
    expect(markdown).not.toContain('\\\\frac');
    expect(markdown).not.toContain('a\\_1');
    expect(markdown).toContain('$P(A\\mid B) = \\frac{P(B\\mid A)P(A)}{P(B)}$，周围正文保留。');
    expect(markdown).not.toContain('\\displaystyle');
    expect(markdown).toContain('裸标签公式：x+y');
  });
});
