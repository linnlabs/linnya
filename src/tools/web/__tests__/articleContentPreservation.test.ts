import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractArticle } from '../webread/extraction/extractArticle';

const paragraph = 'This bulletin documents the calculation, the original source and the revised capacity. '.repeat(10);
const html = `<!doctype html><html><head><title>Capacity revision</title>
  <base href="https://example.com/releases/"></head><body>
  <nav>Navigation noise</nav><article><h1>Capacity revision</h1><p>${paragraph}</p>
  <p>See the <a href="data.csv">original data</a> and <a href="#notes">notes</a>.</p>
  <p>The estimate changed from <del>113 GW</del> to <ins>83 GW</ins>.</p>
  <p style="display: none !important">HIDDEN_OLD_VALUE 113 GW</p>
  <section style="visibility: hidden"><main>HIDDEN_NESTED_REGION</main></section>
  <pre><code>if ready:\n    output = 83\n    print(output)\nprint(113)</code></pre>
  <ol start="3"><li>Read the source</li><li>Recalculate</li></ol>
  <ol reversed start="5"><li>Latest update</li><li value="2">Earlier update</li></ol>
  <figure><img src="chart.png" alt="Demand scenarios"><figcaption>Values in GW</figcaption></figure>
  <table onclick="untrusted()"><caption>Capacity by region</caption>
    <thead><tr><th scope="col">Year</th><th scope="col">Region</th><th scope="col">GW</th></tr></thead>
    <tbody><tr><th rowspan="2" scope="rowgroup">2026</th><td>A</td><td>83</td></tr>
    <tr><td>B</td><td>113</td></tr><tr><td>2027</td><td></td><td>120</td></tr>
    <tr><th colspan="2">Total</th><td>316</td></tr></tbody>
  </table><p>${paragraph}</p></article></body></html>`;

describe('网页选中正文的语义保留', () => {
  it.each(['readability', 'semantic_dom'] as const)('%s 保留可展开的正文，继续排除内部隐藏旧值', extractor => {
    const result = extractArticle(`<html><head><title>Expandable report</title></head><body><article>
      <h1>Expandable report</h1><p>${paragraph}</p>
      <div><button class="readmore-button">Continue reading</button></div>
      <div class="read-more-wrapper" style="display: none !important; color: black">
        <p>CONTINUATION: Only half of the proposed capacity has a confirmed schedule.</p>
        <p>${paragraph}</p><p hidden>HIDDEN_OLD_VALUE 113 GW</p>
        <p style="display:none">HIDDEN_INTERNAL_REVISION 120 GW</p>
      </div>
      <button aria-expanded="false" aria-controls="assumptions">Assumptions</button>
      <section id="assumptions" hidden aria-hidden="true" style="visibility: hidden">
        <p>ASSUMPTION: Reserved capacity is not a firm order.</p><p>${paragraph}</p>
      </section>
      <details><summary>Method</summary><p>METHOD: Count firm orders separately.</p></details>
      <p style="display:none">HIDDEN_UNRELATED 999 GW</p>
    </article></body></html>`, extractor === 'semantic_dom' ? { parseReadability: () => null } : {});
    expect(result.extractor).toBe(extractor);
    expect(result.text).toContain('CONTINUATION: Only half');
    expect(result.text).toContain('ASSUMPTION: Reserved capacity');
    expect(result.text).toContain('METHOD: Count firm orders');
    expect(result.text).not.toContain('HIDDEN_');
  });

  it.each(['readability', 'semantic_dom'] as const)('%s 不凭名称或无关控件展开隐藏内容', extractor => {
    const result = extractArticle(`<html><head><title>Current report</title></head><body>
      <nav><button aria-expanded="false" aria-controls="stale">Navigation control</button></nav>
      <article><h1>Current report</h1><p>${paragraph}</p>
        <div class="read-more-wrapper" style="display:none">HIDDEN_NAME_ONLY</div>
        <button class="readmore-button">Read more</button>
        <div style="display:none">HIDDEN_NO_TARGET</div>
        <section id="stale" hidden>HIDDEN_NAV_TARGET</section>
        <button aria-expanded="false" aria-controls="locked">Open</button>
        <div id="locked" inert hidden>HIDDEN_INERT</div>
        <div style="display:none"><button aria-expanded="false" aria-controls="old">Inactive control</button></div>
        <div id="old" hidden>HIDDEN_INACTIVE_TARGET</div>
        <button disabled aria-expanded="false" aria-controls="disabled-target">Unavailable</button>
        <div id="disabled-target" hidden>HIDDEN_DISABLED_TARGET</div>
        <p>${paragraph}</p>
      </article></body></html>`, extractor === 'semantic_dom' ? { parseReadability: () => null } : {});
    expect(result.text).not.toContain('HIDDEN_');
  });

  it('相对地址使用最终 URL，拒绝危险协议与凭据地址时仍保留正文标签', () => {
    const result = extractArticle(`<html><head><base href="javascript:invalid"></head><body><main>
      <p>${paragraph}</p><p><a href="../source">Related source</a>
      <a href="javascript:alert(1)">Unsafe link label</a>
      <a href="https://user:secret@example.com">Credential label</a></p>
      <img src="data:image/png;base64,invalid" alt="Unusable image"><p>${paragraph}</p>
    </main></body></html>`, { url: 'https://example.com/reports/final.html' });
    expect(result.text).toContain('[Related source](https://example.com/source)');
    expect(result.text).toContain('Unsafe link label');
    expect(result.text).toContain('Credential label');
    expect(result.text).not.toMatch(/javascript:|user:secret|data:image/);
  });

  it('表格标记与长链接不能把空正文或稀疏正文伪装成足量正文', () => {
    const result = extractArticle(`<html><body><main><p><a href="https://example.com/${'a'.repeat(1500)}">Short</a></p></main></body></html>`);
    expect(result.text.length).toBeGreaterThan(1000);
    expect(result.warnings).toContain('content_too_short');
  });

  it.each(['readability', 'semantic_dom'] as const)('%s 保留来源、修订、计算与表格关系', extractor => {
    const result = extractArticle(html, extractor === 'semantic_dom' ? { parseReadability: () => null } : {});
    expect(result.extractor).toBe(extractor);
    expect(result.text).toContain('[original data](https://example.com/releases/data.csv)');
    expect(result.text).toContain('[notes](https://example.com/releases/#notes)');
    expect(result.text).toContain('~~113 GW~~');
    expect(result.text).toContain('83 GW');
    expect(result.text).toContain('if ready:\n    output = 83\n    print(output)\nprint(113)');
    expect(result.text).toMatch(/3\. +Read the source/);
    expect(result.text).toMatch(/4\. +Recalculate/);
    expect(result.text).toContain('![Demand scenarios](https://example.com/releases/chart.png)');
    expect(result.text).not.toContain('HIDDEN_');
    expect(result.text).not.toContain('Navigation noise');
    expect(result.text).not.toContain('onclick');
    const table = load(result.text);
    expect(table('caption').text()).toBe('Capacity by region');
    expect(table('tbody tr').eq(0).find('th').attr('rowspan')).toBe('2');
    expect(table('tbody tr').eq(0).find('th').attr('scope')).toBe('rowgroup');
    expect(table('tbody tr').eq(1).children().map((_, cell) => table(cell).text()).get()).toEqual(['B', '113']);
    expect(table('tbody tr').eq(2).children().map((_, cell) => table(cell).text()).get()).toEqual(['2027', '', '120']);
    expect(table('tbody tr').eq(3).find('th').attr('colspan')).toBe('2');
    expect(table('ol[reversed]').attr('start')).toBe('5');
    expect(table('ol[reversed] li').eq(1).attr('value')).toBe('2');
  });
});
