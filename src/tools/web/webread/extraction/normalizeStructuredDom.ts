import { normalizeExtractedText } from './extractSemanticDom';

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

function parseAriaSpan(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 2 || parsed > MAX_ARIA_SPAN) return undefined;
  return parsed;
}

function isColumnHeaderRow(cells: readonly Element[]): boolean {
  return cells.length > 0 && cells.every((cell) => cell.getAttribute('role') === 'columnheader');
}

function buildSemanticTableFromAria(
  document: Document,
  container: Element,
  rowCellsList: readonly (readonly Element[])[],
): Element {
  const table = document.createElement('table');
  const id = container.getAttribute('id')?.trim();
  if (id) table.setAttribute('id', id);
  const describedBy = container.getAttribute('aria-describedby')?.trim();
  if (describedBy) table.setAttribute('aria-describedby', describedBy);

  const label = normalizeExtractedText(container.getAttribute('aria-label'));
  if (label) {
    const caption = document.createElement('caption');
    caption.textContent = label;
    table.appendChild(caption);
  }

  let headerRowCount = 0;
  while (
    headerRowCount < rowCellsList.length
    && isColumnHeaderRow(rowCellsList[headerRowCount] ?? [])
  ) {
    headerRowCount += 1;
  }

  const appendRowTo = (section: Element, cells: readonly Element[]): void => {
    const tr = document.createElement('tr');
    for (const cell of cells) {
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
      appendRowTo(thead, rowCellsList[index] ?? []);
    }
    table.appendChild(thead);
  }

  if (headerRowCount < rowCellsList.length) {
    const tbody = document.createElement('tbody');
    for (let index = headerRowCount; index < rowCellsList.length; index += 1) {
      appendRowTo(tbody, rowCellsList[index] ?? []);
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
    const rowCellsList: Element[][] = [];
    let multiCellRowCount = 0;

    for (const row of ownRows) {
      const cells = [...row.querySelectorAll(ARIA_CELL_SELECTOR)].filter(
        (cell) => cell.closest('[role="row"]') === row,
      );
      if (cells.length === 0) continue;
      rowCellsList.push(cells);
      const nonEmptyCount = cells.filter(
        (cell) => normalizeExtractedText(cell.textContent).length > 0,
      ).length;
      if (nonEmptyCount >= 2) multiCellRowCount += 1;
    }

    if (rowCellsList.length < 2 || multiCellRowCount < 2) continue;

    const semanticTable = buildSemanticTableFromAria(document, container, rowCellsList);
    parent.replaceChild(semanticTable, container);
    normalized += 1;
  }

  return normalized;
}
