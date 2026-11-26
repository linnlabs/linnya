import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractArticle } from './extractArticle';
import { assessWebReadQuality } from '../functions/assessWebReadQuality';
import { createWebReadResult } from '../functions/createWebReadResult';

describe('结构化 DOM 规范化（布局表展平与 ARIA 表格）', () => {
  it('把 ARIA grid/table/treegrid 转换为语义 table，并保留跨度与标题关联', () => {
    const html = `<!doctype html><html><head><title>Metrics</title></head><body><main>
      <h1>Quarterly Output</h1>
      <p id="grid-note">Units: GW. Blank cells denote unverified readings.</p>
      <div role="grid" aria-label="Quarterly Capacity" aria-describedby="grid-note">
        <div role="rowgroup">
          <div role="row">
            <div role="columnheader" aria-colspan="2">Period</div>
            <div role="columnheader">GW</div>
          </div>
        </div>
        <div role="rowgroup">
          <div role="row">
            <div role="rowheader" aria-rowspan="2">2026</div>
            <div role="gridcell">Q1</div>
            <div role="gridcell">83</div>
          </div>
          <div role="row">
            <div role="gridcell">Q2</div>
            <div role="gridcell">113</div>
          </div>
        </div>
      </div>
    </main></body></html>`;

    const extracted = extractArticle(html, { url: 'https://example.test/metrics' });
    expect(extracted.text).toContain('Quarterly Output');
    const doc = load(extracted.text);
    expect(doc('caption').text()).toBe('Quarterly Capacity');
    expect(doc('thead th').eq(0).attr('colspan')).toBe('2');
    expect(doc('thead th').eq(0).attr('scope')).toBe('col');
    expect(doc('tbody tr').eq(0).find('th').attr('rowspan')).toBe('2');
    expect(doc('tbody tr').eq(0).find('th').attr('scope')).toBe('row');
    expect(doc('tbody tr').eq(1).children().map((_, cell) => doc(cell).text()).get()).toEqual(['Q2', '113']);
  });

  it('ARIA 表格内的 hidden、display:none 与 aria-hidden 行和单元格绝不泄露', () => {
    const html = `<!doctype html><html><head><title>Safe Grid</title></head><body><article>
      <h1>Public Report</h1>
      <div role="table" aria-label="Public Data">
        <div role="row">
          <div role="columnheader">Region</div>
          <div role="columnheader">Value</div>
        </div>
        <div role="row">
          <div role="cell">North</div>
          <div role="cell">42</div>
        </div>
        <div role="row" hidden>
          <div role="cell">HIDDEN_ROW</div>
          <div role="cell">999</div>
        </div>
        <div role="row" style="display:none">
          <div role="cell">INLINE_HIDDEN_ROW</div>
          <div role="cell">888</div>
        </div>
        <div role="row">
          <div role="cell">South</div>
          <div role="cell" aria-hidden="true">ARIA_HIDDEN_CELL</div>
          <div role="cell">55</div>
        </div>
      </div>
    </article></body></html>`;

    const extracted = extractArticle(html, { url: 'https://example.test/safe-grid' });
    expect(extracted.text).toContain('North');
    expect(extracted.text).toContain('55');
    expect(extracted.text).not.toContain('HIDDEN_ROW');
    expect(extracted.text).not.toContain('INLINE_HIDDEN_ROW');
    expect(extracted.text).not.toContain('ARIA_HIDDEN_CELL');
  });

  it('拒绝误转单列 ARIA 列表、单行工具栏与空骨架，独立数值 ARIA grid 走 tabular_dom 且受 js_shell 约束', () => {
    const singleColumnAria = `<!doctype html><html><head><title>Menu List</title></head><body><main>
      <h1>Navigation Items</h1>
      <div role="grid">
        <div role="row"><div role="gridcell">Item One</div></div>
        <div role="row"><div role="gridcell">Item Two</div></div>
      </div>
      <div role="table">
        <div role="row"><div role="columnheader">Toolbar A</div><div role="columnheader">Toolbar B</div></div>
      </div>
    </main></body></html>`;
    const listExtracted = extractArticle(singleColumnAria, { url: 'https://example.test/menu' });
    expect(load(listExtracted.text)('table')).toHaveLength(0);

    const standaloneGridHtml = `<!doctype html><html><head><title>Standalone Grid</title></head><body>
      <p id="grid-desc">Measured quarterly output in GW.</p>
      <div role="grid" aria-describedby="grid-desc">
        <div role="row"><div role="columnheader">Year</div><div role="columnheader">Output</div></div>
        <div role="row"><div role="gridcell">2025</div><div role="gridcell">83</div></div>
        <div role="row"><div role="gridcell">2026</div><div role="gridcell">113</div></div>
      </div>
    </body></html>`;
    const gridExtracted = extractArticle(standaloneGridHtml, { url: 'https://example.test/grid' });
    expect(gridExtracted.extractor).toBe('tabular_dom');
    expect(gridExtracted.text).toContain('Measured quarterly output in GW.');
    expect(gridExtracted.text).toContain('<td>113</td>');

    const jsShellGrid = extractArticle(
      standaloneGridHtml.replace('</body>', '<script></script><script></script><script></script></body>'),
      { url: 'https://example.test/grid-shell' },
    );
    expect(jsShellGrid.extractor).toBe('tabular_dom');
    const result = createWebReadResult({
      url: 'https://example.test/grid-shell',
      status: 200,
      contentType: 'text/html',
      content: jsShellGrid.text,
      contentFormat: 'markdown',
      extractor: jsShellGrid.extractor,
      renderMode: 'http',
      rawLength: standaloneGridHtml.length,
      warnings: jsShellGrid.warnings,
      latencyMs: 1,
    });
    expect(assessWebReadQuality(result)).toMatchObject({ shouldEscalate: true, reason: 'js_required' });
  });

  it('安全展平旧式多层嵌套布局表，同时完整保留内层数据表与纯 td 数值表', () => {
    const legacyHtml = `<!doctype html><html><head><title>旧式CMS公告页</title></head><body>
      <table width="100%"><tr><td>
        <table width="960"><tr>
          <td><div class="sidebar"><p>栏目导航</p></div></td>
          <td><div class="article-body">
            <h1>关于开展 2026 年度专项核查的通知</h1>
            <p>${'各级单位应按本通知要求如实报送年度运行统计与核查报告，截止时间为本月底前。'.repeat(6)}</p>
            <table>
              <tr><th>指标名称</th><th>目标值</th></tr>
              <tr><td>完成率</td><td>98.5%</td></tr>
              <tr><td>合格率</td><td>100%</td></tr>
            </table>
          </div></td>
        </tr></table>
      </td></tr></table>
    </body></html>`;

    const extracted = extractArticle(legacyHtml, { url: 'https://gov.example.test/notice.html' });
    expect(extracted.text).toContain('关于开展 2026 年度专项核查的通知');
    expect(extracted.text).toContain('<td>98.5%</td>');
    expect(load(extracted.text)('table')).toHaveLength(1);

    // 无 th 的纯 td 数值型叶子表绝不能被展平
    const pureTdTable = `<!doctype html><html><head><title>纯TD数据表</title></head><body>
      <table>
        <tr><td>Indicator</td><td>2025</td><td>2026</td></tr>
        <tr><td>Capacity</td><td>83</td><td>113</td></tr>
        <tr><td>Share</td><td>41.5%</td><td>52.0%</td></tr>
        <tr><td>Reserve</td><td>12</td><td>18</td></tr>
      </table>
    </body></html>`;
    const tdExtracted = extractArticle(pureTdTable, { url: 'https://stats.example.test/td.html' });
    expect(tdExtracted.extractor).toBe('tabular_dom');
    expect(tdExtracted.text).toContain('<td>113</td>');
  });
});
