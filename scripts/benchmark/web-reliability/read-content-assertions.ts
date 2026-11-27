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
export function inspectWebBenchmarkContent(
  content: string,
  assertions: readonly WebContentAssertion[],
) {
  const document = load(markdown.render(content));
  document('head, nav, [role="navigation"], footer, aside, script, style, template, [hidden], [aria-hidden="true"]').remove();
  const visibleText = normalizedText(document('body').prop('innerText') ?? '');
  const normalizedBody = visibleText.toLowerCase();
  const failed = assertions.filter(assertion => {
    switch (assertion.kind) {
      case 'link':
        return !document('a[href]').toArray().some(node => document(node).attr('href') === assertion.url);
      case 'code_contains':
        return !document('pre code').toArray().some(node => document(node).text().includes(assertion.text));
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
      case 'dated_page_links': {
        const links = new Set<string>();
        for (const node of document('a[href]').toArray()) {
          const link = document(node);
          const href = link.attr('href') ?? '';
          if (!href.startsWith(assertion.urlPrefix) || !/\.html?$/i.test(href) || !link.text().trim()) continue;
          const row = link.closest('li, tr');
          if (!row.length || row.find('a[href]').length !== 1) continue;
          const label = row.clone();
          label.find('a').remove();
          if (/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(label.text())) links.add(href);
        }
        return links.size < 2;
      }
      case 'dated_document_link': {
        // 列表的业务事实是带日期的详情条目。只在同一行/条目里关联链接与日期。
        const date = /20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/;
        return !document('a[href]').toArray().some(node => {
          const link = document(node);
          const href = link.attr('href') ?? '';
          if (!/^(?:https?:\/\/|\/[^/])/.test(href) || !/\.pdf(?:$|[?#])/i.test(href) || !link.text().trim()) return false;
          const entry = link.closest('tr, li, p');
          return entry.length > 0 && date.test(entry.text());
        });
      }
      case 'text_present':
        return !normalizedBody.includes(normalizedText(assertion.text).toLowerCase());
      case 'text_absent':
        return normalizedBody.includes(normalizedText(assertion.text).toLowerCase());
    }
  }).map(assertion => assertion.id);
  const bodyVerified = !assertions.some(assertion => failed.includes(assertion.id)
    && (assertion.kind === 'text_present' || assertion.kind === 'text_absent' || assertion.kind === 'dated_document_link' || assertion.kind === 'dated_page_links'));
  return { visibleText, bodyVerified, contentChecks: { checked: assertions.length, failed } };
}
