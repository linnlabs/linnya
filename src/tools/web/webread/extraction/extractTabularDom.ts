import { normalizeExtractedText } from './extractSemanticDom';
import { renderReadableMarkdown } from './renderReadableMarkdown';

export interface TabularDomExtraction {
  readonly text: string;
  readonly textLength: number;
  readonly tableCount: number;
  readonly tableDataRows: readonly ReadonlySet<string>[];
}

function rowSignature(row: Element): string | undefined {
  if ([...row.children].every(cell => cell.tagName === 'TH')) return undefined;
  const cells = [...row.children].map(cell => normalizeExtractedText(cell.textContent)).filter(Boolean);
  return cells.length >= 2 ? JSON.stringify(cells) : undefined;
}

function isDataTable(table: Element): boolean {
  // 老式页面用嵌套 table 排版；只接受叶子数据表，不能把整页布局当正文。
  if (table.querySelector('table') || table.matches('[role="presentation"], [role="none"]')) return false;
  const rows = [...table.querySelectorAll('tr')];
  const multiCellRows = rows.filter(row => [...row.children]
    .filter(cell => normalizeExtractedText(cell.textContent)).length >= 2);
  if (multiCellRows.length < 2) return false;
  // 部分观测值表只有 td：要求多行同时具有行标签和独立数值单元格。
  // 单个数字、链接列表或无内容的表格骨架不构成已取得的数据表。
  const numericRows = multiCellRows.filter(row => {
    const cells = [...row.children];
    const label = normalizeExtractedText(cells[0]?.textContent);
    return label.length > 0 && cells.slice(1).some(cell =>
      /^[−+-]?(?:\d[\d,]*)(?:\.\d+)?%?$/.test(normalizeExtractedText(cell.textContent)));
  });
  return numericRows.length >= (table.querySelector('th') ? 2 : 3);
}

/** 为没有 main/article 的旧式数据页提供窄视图，不回退到整个 body。 */
export function extractTabularDom(document: Document): TabularDomExtraction {
  const fragments: string[] = [];
  let textLength = 0;
  let tableCount = 0;
  const tableDataRows: ReadonlySet<string>[] = [];
  for (const table of document.querySelectorAll('table')) {
    if (!isDataTable(table)) continue;
    const summary = normalizeExtractedText(table.getAttribute('summary'));
    const descriptions = (table.getAttribute('aria-describedby') ?? '').split(/\s+/)
      .filter(Boolean).map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    const context = [summary, ...descriptions.map(element => renderReadableMarkdown(element))]
      .filter(Boolean);
    const captured = { markdown: renderReadableMarkdown(table),
      textLength: normalizeExtractedText(table.textContent).length };
    const dataRows = new Set<string>();
    for (const row of table.querySelectorAll('tr')) {
      const signature = rowSignature(row);
      if (signature) dataRows.add(signature);
    }
    tableDataRows.push(dataRows);
    fragments.push(...context, captured.markdown);
    textLength += captured.textLength
      + context.reduce((total, value) => total + value.length, 0);
    tableCount += 1;
  }
  return { text: fragments.join('\n\n'), textLength, tableCount, tableDataRows };
}

/** Readability 可能只留下同表的一部分；按实际行内容排除残表，避免交付两版数据。 */
export function extractTabularContext(element: Element | undefined, captured: TabularDomExtraction): {
  text: string; textLength: number;
} {
  if (!element) return { text: '', textLength: 0 };
  const context = element.ownerDocument.createElement('div');
  context.appendChild(element.cloneNode(true));
  for (const table of context.querySelectorAll('table')) {
    if (table.querySelector('table')) continue;
    const rows = [...table.querySelectorAll('tr')].map(rowSignature)
      .filter((signature): signature is string => signature !== undefined);
    // 共用表头/单行重合不代表同一张表；残表的全部实际数据必须来自同一捕获。
    if (rows.length > 0 && captured.tableDataRows.some(source =>
      rows.every(signature => source.has(signature)))) table.remove();
  }
  return { text: renderReadableMarkdown(context), textLength: normalizeExtractedText(context.textContent).length };
}
