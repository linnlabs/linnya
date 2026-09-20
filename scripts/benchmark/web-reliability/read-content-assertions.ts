import { load } from 'cheerio';
import MarkdownIt from 'markdown-it';
import type { WebContentAssertion } from './read-cases';

export interface WebContentCheckResult {
  checked: number;
  failed: string[];
}

const markdown = new MarkdownIt({ html: true });
const normalizedText = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** 对来源冻结的局部事实做确定性核对，不能用 Markdown 格式的存在替代内容正确。 */
export function checkWebContentAssertions(
  content: string,
  assertions: readonly WebContentAssertion[],
): WebContentCheckResult {
  if (assertions.length === 0) return { checked: 0, failed: [] };
  const document = load(markdown.render(content));
  const failed = assertions.filter(assertion => {
    switch (assertion.kind) {
      case 'link':
        return !document('a[href]').toArray().some(node => document(node).attr('href') === assertion.url);
      case 'code':
        return !document('pre').toArray().some(node =>
          document(node).text().replace(/\r\n?/g, '\n').trimEnd() === assertion.text.trimEnd());
      case 'strikethrough':
        return !document('s, del, strike').toArray().some(node =>
          normalizedText(document(node).text()) === normalizedText(assertion.text));
      case 'table':
        return !document('table').toArray().some(table => {
          const rows = document(table).find('tr').toArray()
            .filter(row => document(row).closest('table')[0] === table);
          return rows.length === assertion.rows.length && rows.every((row, rowIndex) => {
            const expected = assertion.rows[rowIndex];
            const cells = document(row).children('th, td').toArray();
            return cells.length === expected.length && cells.every((cell, columnIndex) => {
              const value = expected[columnIndex];
              // 不展开跨度，避免错误摊平后数字仍全在、检查却假通过。
              return normalizedText(document(cell).text()) === normalizedText(value.text)
                && Number(document(cell).attr('rowspan') ?? 1) === (value.rowSpan ?? 1)
                && Number(document(cell).attr('colspan') ?? 1) === (value.colSpan ?? 1);
            });
          });
        });
    }
  }).map(assertion => assertion.id);
  return { checked: assertions.length, failed };
}
