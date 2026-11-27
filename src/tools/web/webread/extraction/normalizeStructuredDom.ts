import { normalizeExtractedText } from './normalizeExtractedText';

const ARIA_TABLE_SELECTOR = '[role="table"], [role="grid"], [role="treegrid"]';
const ARIA_CELL_SELECTOR = '[role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]';
const BLOCK_LAYOUT_CHILD_SELECTOR =
  'div, p, h1, h2, h3, h4, h5, h6, ul, ol, section, article, blockquote, pre';
const TABLE_SEMANTIC_OWN_SELECTOR = 'th, caption, thead, tfoot, [scope], [headers]';
const MAX_ARIA_SPAN = 50;

/** 仅按 direct DOM 层级收集属于当前 `<table>` 的行，避免受内部嵌套表格干扰且不依赖 `:scope`。 */
function getDirectTableRows(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.children) {
    if (child.tagName === 'TR') {
      rows.push(child);
      continue;
    }
    if (child.tagName === 'THEAD' || child.tagName === 'TBODY' || child.tagName === 'TFOOT') {
      for (const grandChild of child.children) {
        if (grandChild.tagName === 'TR') rows.push(grandChild);
      }
    }
  }
  return rows;
}

function getDirectRowCells(row: Element): Element[] {
  const cells: Element[] = [];
  for (const child of row.children) {
    if (child.tagName === 'TD' || child.tagName === 'TH') cells.push(child);
  }
  return cells;
}

function hasOwnTableSemantics(table: Element): boolean {
  if (table.hasAttribute('summary') || table.hasAttribute('aria-describedby')) return true;
  for (const marker of table.querySelectorAll(TABLE_SEMANTIC_OWN_SELECTOR)) {
    if (marker.closest('table') === table) return true;
  }
  return false;
}

function isStrictLayoutTable(table: Element): boolean {
  if (table.matches('[role="presentation"], [role="none"]')) return true;
  if (hasOwnTableSemantics(table)) return false;
  if (table.querySelector('table') !== null) return true;

  const rows = getDirectTableRows(table);
  let maxNonEmptyCells = 0;
  for (const row of rows) {
    let nonEmptyInRow = 0;
    for (const cell of getDirectRowCells(row)) {
      if (normalizeExtractedText(cell.textContent).length > 0) nonEmptyInRow += 1;
    }
    if (nonEmptyInRow > maxNonEmptyCells) maxNonEmptyCells = nonEmptyInRow;
  }

  if (rows.length > 1 && maxNonEmptyCells > 1) return false;
  return table.querySelector(BLOCK_LAYOUT_CHILD_SELECTOR) !== null;
}

function moveChildNodes(source: Element, target: Element): void {
  while (source.firstChild) {
    target.appendChild(source.firstChild);
  }
}

/**
 * 在隐藏节点清理后、正文抽取前按从深到浅顺序安全展平明确布局型 `<table>`：
 * 保留外层包装内真实的内层数据表与链接，绝不拆毁多行多列真实数据表。
 */
export function unwrapLayoutTables(document: Document): number {
  const targets = [...document.querySelectorAll('table')].filter(isStrictLayoutTable).reverse();
  let unwrapped = 0;
  for (const table of targets) {
    const parent = table.parentNode;
    if (!parent) continue;
    const wrapper = document.createElement('div');
    const rows = getDirectTableRows(table);
    for (const row of rows) {
      for (const cell of getDirectRowCells(row)) {
        if (!cell.hasChildNodes()) continue;
        const cellDiv = document.createElement('div');
        moveChildNodes(cell, cellDiv);
        if (cellDiv.hasChildNodes()) wrapper.appendChild(cellDiv);
      }
    }
    parent.replaceChild(wrapper, table);
    unwrapped += 1;
  }
  return unwrapped;
}

function positiveAriaInteger(value: string | null): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseAriaSpan(value: string | null): number | undefined {
  const span = positiveAriaInteger(value);
  return span !== undefined && span >= 2 && span <= MAX_ARIA_SPAN ? span : undefined;
}

function isColumnHeaderRow(cells: readonly Element[]): boolean {
  return cells.length > 0 && cells.every((cell) => cell.getAttribute('role') === 'columnheader');
}

interface AriaRow {
  readonly source: Element;
  readonly cells: Element[];
}

/** HTML 表格一行的隐式列会跳过上一行的 rowspan。只有已挂载单元格能确定空缺的位置。 */
function locateAriaColumns(rows: readonly AriaRow[], columnCount: number | undefined) {
  const gaps = new Map<Element, number[]>();
  const occupiedUntil = new Map<number, number>();
  let partial = false;
  let previousRow = 0;
  for (const { source, cells } of rows) {
    const row = positiveAriaInteger(source.getAttribute('aria-rowindex')) ?? previousRow + 1;
    // 跳过逻辑行时，原生 rowspan 会落到错误的物理行；此时改为按坐标列出已知单元格。
    if (row <= previousRow || (row > previousRow + 1 && occupiedUntil.size > 0)) return undefined;
    previousRow = row;
    for (const [col, endRow] of occupiedUntil) if (endRow < row) occupiedUntil.delete(col);
    let next = 1;
    for (const [index, cell] of cells.entries()) {
      while (occupiedUntil.has(next)) next++;
      const raw = cell.getAttribute('aria-colindex') ?? (index === 0 ? source.getAttribute('aria-colindex') : null);
      const start = raw === null ? next : positiveAriaInteger(raw);
      const width = positiveAriaInteger(cell.getAttribute('aria-colspan')) ?? 1;
      const height = positiveAriaInteger(cell.getAttribute('aria-rowspan')) ?? 1;
      if (width > MAX_ARIA_SPAN || height > MAX_ARIA_SPAN) return undefined;
      // HTML colspan 上限是 1000。过宽或矛盾的窗口保留原始坐标，避免按属性数值分配 DOM。
      if (start === undefined || start < next || start - next > 1000
        || (columnCount !== undefined && start + width - 1 > columnCount)) return undefined;
      const missing: number[] = [];
      while (next < start) {
        const first = next;
        while (next < start && !occupiedUntil.has(next)) next++;
        if (first < next) missing.push(next - first);
        while (next < start && occupiedUntil.has(next)) next++;
      }
      if (missing.length) {
        partial = true;
        gaps.set(cell, missing);
      }
      for (let col = start; col < start + width; col++) {
        if (occupiedUntil.has(col)) return undefined;
        if (height > 1) occupiedUntil.set(col, row + height - 1);
      }
      next = start + width;
    }
    while (occupiedUntil.has(next)) next++;
    if (columnCount !== undefined && next <= columnCount) partial = true;
  }
  return { gaps, partial };
}

function describePartialAriaTable(document: Document, rows: readonly AriaRow[], label: string): Element {
  const section = document.createElement('section');
  const heading = document.createElement('p');
  heading.textContent = [label, '部分表格（列位置无法完整还原）'].filter(Boolean).join(' · ');
  section.appendChild(heading);
  for (const { source, cells } of rows) {
    const line = document.createElement('p');
    for (const [index, cell] of cells.entries()) {
      const col = positiveAriaInteger(cell.getAttribute('aria-colindex')
        ?? (index === 0 ? source.getAttribute('aria-colindex') : null));
      line.appendChild(document.createTextNode(`${index ? ' | ' : ''}${col ? `第 ${col} 列` : '列位置未确定'}：`));
      moveChildNodes(cell, line);
    }
    section.appendChild(line);
  }
  return section;
}

function buildSemanticTableFromAria(
  document: Document,
  container: Element,
  rows: readonly AriaRow[],
): Element {
  const label = normalizeExtractedText(container.getAttribute('aria-label'));
  const layout = locateAriaColumns(rows, positiveAriaInteger(container.getAttribute('aria-colcount')));
  if (!layout) return describePartialAriaTable(document, rows, label);
  const table = document.createElement('table');
  const id = container.getAttribute('id')?.trim();
  if (id) table.setAttribute('id', id);
  const describedBy = container.getAttribute('aria-describedby')?.trim();
  if (describedBy) table.setAttribute('aria-describedby', describedBy);

  if (label || layout.partial) {
    const caption = document.createElement('caption');
    caption.textContent = [label, layout.partial ? '部分表格（有列未呈现）' : ''].filter(Boolean).join(' · ');
    table.appendChild(caption);
  }

  let headerRowCount = 0;
  while (
    headerRowCount < rows.length
    && isColumnHeaderRow(rows[headerRowCount]?.cells ?? [])
  ) {
    headerRowCount += 1;
  }

  // HTML 的 rowspan 不能跨 thead/tbody；跨边界的显式表头仍保留 th/scope，放入同一行组。
  const spansAcrossHeader = rows.slice(0, headerRowCount).some(({ cells }, index) =>
    cells.some(cell => index + (parseAriaSpan(cell.getAttribute('aria-rowspan')) ?? 1) > headerRowCount));
  if (spansAcrossHeader) headerRowCount = 0;

  const appendRowTo = (section: Element, cells: readonly Element[]): void => {
    const tr = document.createElement('tr');
    for (const cell of cells) {
      for (const gap of layout.gaps.get(cell) ?? []) {
        const placeholder = document.createElement('td');
        if (gap > 1) placeholder.setAttribute('colspan', String(gap));
        placeholder.textContent = '（未呈现）';
        tr.appendChild(placeholder);
      }
      const role = cell.getAttribute('role');
      const isColHeader = role === 'columnheader';
      const isRowHeader = role === 'rowheader';
      const targetCell = document.createElement(isColHeader || isRowHeader ? 'th' : 'td');
      if (isColHeader) targetCell.setAttribute('scope', 'col');
      else if (isRowHeader) targetCell.setAttribute('scope', 'row');
      const colSpan = parseAriaSpan(cell.getAttribute('aria-colspan'));
      if (colSpan !== undefined) targetCell.setAttribute('colspan', String(colSpan));
      const rowSpan = parseAriaSpan(cell.getAttribute('aria-rowspan'));
      if (rowSpan !== undefined) targetCell.setAttribute('rowspan', String(rowSpan));
      moveChildNodes(cell, targetCell);
      tr.appendChild(targetCell);
    }
    section.appendChild(tr);
  };

  if (headerRowCount > 0) {
    const thead = document.createElement('thead');
    for (let index = 0; index < headerRowCount; index += 1) {
      appendRowTo(thead, rows[index]?.cells ?? []);
    }
    table.appendChild(thead);
  }

  if (headerRowCount < rows.length) {
    const tbody = document.createElement('tbody');
    for (let index = headerRowCount; index < rows.length; index += 1) {
      appendRowTo(tbody, rows[index]?.cells ?? []);
    }
    table.appendChild(tbody);
  }

  return table;
}

/**
 * 将满足二维表格语义的 ARIA `table` / `grid` / `treegrid` 无损规范化为语义 `<table>`，
 * 使 Readability、`semantic_dom` 与 `tabular_dom` 三条路径统一复用同一套表格保留逻辑。
 */
export function normalizeAriaTables(document: Document): number {
  const candidates = [...document.querySelectorAll(ARIA_TABLE_SELECTOR)];
  let normalized = 0;

  for (const container of candidates) {
    const parent = container.parentNode;
    if (!parent) continue;
    if (container.closest('table')) continue;
    if (container.parentElement?.closest(ARIA_TABLE_SELECTOR)) continue;
    if (container.querySelector(`table, ${ARIA_TABLE_SELECTOR}`) !== null) continue;

    const ownRows = [...container.querySelectorAll('[role="row"]')].filter(
      (row) => row.closest(ARIA_TABLE_SELECTOR) === container,
    );
    const rows: AriaRow[] = [];
    let multiCellRowCount = 0;

    for (const row of ownRows) {
      const cells = [...row.querySelectorAll(ARIA_CELL_SELECTOR)].filter(
        (cell) => cell.closest('[role="row"]') === row,
      );
      if (cells.length === 0) continue;
      rows.push({ source: row, cells });
      const nonEmptyCount = cells.filter(
        (cell) => normalizeExtractedText(cell.textContent).length > 0,
      ).length;
      if (nonEmptyCount >= 2) multiCellRowCount += 1;
    }

    // 虚拟窗口可以只挂载一个有列号的数据单元格；有二维表头时仍能恢复其列身份。
    const indexedData = multiCellRowCount > 0 && rows.some(row => isColumnHeaderRow(row.cells))
      && rows.some(({ source, cells }) => !isColumnHeaderRow(cells)
        && (source.hasAttribute('aria-colindex') || cells.some(cell => cell.hasAttribute('aria-colindex'))));
    if (rows.length < 2 || (multiCellRowCount < 2 && !indexedData)) continue;

    const semanticTable = buildSemanticTableFromAria(document, container, rows);
    parent.replaceChild(semanticTable, container);
    normalized += 1;
  }

  return normalized;
}
