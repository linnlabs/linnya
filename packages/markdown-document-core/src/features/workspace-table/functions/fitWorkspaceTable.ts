import { WORKSPACE_TABLE_COMPACT_CELL_CLASS } from '../definitions/workspaceTable';
import { estimateTableTextWidthEm } from './tableCellCompactness';

/**
 * 表格放不下时的分级退让，由呈现时测量决定，不写入文档：
 * - normal：标准内边距与长文本最小宽度；
 * - tight：收紧左右内边距与长文本最小宽度，短格仍不断行；
 * - scroll：收紧后仍放不下，在正文栏内横向滚动（交互表面）；
 * - wrap：收紧后仍放不下（纸面等不能滚动的输出）：字号降一档、去掉存储列宽，从最宽的列开始逐列放开短格直到放得下。
 */
export type WorkspaceTableFit = 'normal' | 'tight' | 'scroll' | 'wrap';

export interface WorkspaceTableFitOptions {
  /** 收紧后仍放不下时的去向；交互表面滚动，打印改为全部可换行。 */
  readonly overflow?: 'scroll' | 'wrap';
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * 按可用宽度给表格定级，结果写在 table 的 `data-table-fit` 上。
 * 用布局宽度（offsetWidth/clientWidth）而不是包围盒，画布卡片缩放时判定不变；可用宽度为 0（未布局）时保持原状。
 */
export function fitWorkspaceTable(
  table: HTMLElement,
  available: HTMLElement,
  options: WorkspaceTableFitOptions = {},
): WorkspaceTableFit {
  const width = available.clientWidth;
  const current = table.getAttribute('data-table-fit');
  if (width <= 0) return current === 'tight' || current === 'scroll' || current === 'wrap' ? current : 'normal';
  if (current === 'wrap') return 'wrap';
  const overflows = () => table.offsetWidth > width + 1;
  setAttribute(table, 'data-table-fit', null);
  if (!overflows()) return 'normal';
  setAttribute(table, 'data-table-fit', 'tight');
  if (!overflows()) return 'tight';
  if (options.overflow !== 'wrap') {
    setAttribute(table, 'data-table-fit', 'scroll');
    return 'scroll';
  }
  // 静态快照才会走到这里：去掉存储列宽与固定表宽，表格按版面宽度重新分列。
  setAttribute(table, 'data-table-fit', 'wrap');
  for (const column of Array.from(table.querySelectorAll<HTMLTableColElement>('col'))) {
    column.style.removeProperty('width');
    column.style.removeProperty('min-width');
  }
  table.style.removeProperty('min-width');
  table.style.width = '100%';
  // 从估算最宽的列开始逐列放开短格，放得下就停：两三个字的表头尽量保持单行，先折行的是长标签与备注列。
  for (const cells of compactColumnsByWidth(table)) {
    if (!overflowsAtNaturalWidth(table, width)) break;
    for (const cell of cells) cell.classList.remove(WORKSPACE_TABLE_COMPACT_CELL_CLASS);
  }
  if (overflowsAtNaturalWidth(table, width)) table.style.setProperty('--workspace-table-text-min', '0');
  return 'wrap';
}

/** 按逻辑列（累加 colspan）分组短格，按组内最宽文字从宽到窄排列。 */
function compactColumnsByWidth(table: HTMLElement): HTMLElement[][] {
  const columns = new Map<number, { cells: HTMLElement[]; width: number }>();
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    let column = 0;
    for (const cell of Array.from(row.querySelectorAll<HTMLElement>(':scope > td, :scope > th'))) {
      const span = Math.max(1, Number(cell.getAttribute('colspan')) || 1);
      if (cell.classList.contains(WORKSPACE_TABLE_COMPACT_CELL_CLASS)) {
        const entry = columns.get(column) ?? { cells: [], width: 0 };
        entry.cells.push(cell);
        entry.width = Math.max(entry.width, estimateTableTextWidthEm(cell.textContent ?? ''));
        columns.set(column, entry);
      }
      column += span;
    }
  }
  return [...columns.values()].sort((a, b) => b.width - a.width).map(entry => entry.cells);
}

/**
 * 表宽固定为 100% 时 offsetWidth 恒等于可用宽度，临时改回 auto 测量：自动宽度只在最小内容宽度超出时才超过可用宽度，
 * 这正是“折行也放不下”的判定。
 */
function overflowsAtNaturalWidth(table: HTMLElement, width: number): boolean {
  const previous = table.style.width;
  table.style.width = 'auto';
  const overflows = table.offsetWidth > width + 1;
  table.style.width = previous;
  return overflows;
}

/** 横向滚动时记录滚动位置，供右侧渐隐只在还有内容可看时出现。 */
export function syncWorkspaceTableScroll(table: HTMLElement, scroller: HTMLElement): void {
  if (table.getAttribute('data-table-fit') !== 'scroll') {
    setAttribute(table, 'data-table-scroll', null);
    return;
  }
  const remaining = scroller.scrollWidth - scroller.clientWidth - Math.abs(scroller.scrollLeft);
  const position = remaining <= 1 ? 'end' : scroller.scrollLeft <= 1 ? 'start' : 'middle';
  setAttribute(table, 'data-table-scroll', position);
}

/** 静态表面（只读预览）定级一次，并随用户横向滚动更新渐隐；监听随元素一起回收。 */
export function fitStaticWorkspaceTable(table: HTMLElement, scroller: HTMLElement): WorkspaceTableFit {
  const fit = fitWorkspaceTable(table, scroller);
  syncWorkspaceTableScroll(table, scroller);
  if (fit === 'scroll' && !scroller.hasAttribute('data-workspace-table-scroll-listener')) {
    scroller.setAttribute('data-workspace-table-scroll-listener', '');
    scroller.addEventListener('scroll', () => syncWorkspaceTableScroll(table, scroller), { passive: true });
  }
  return fit;
}

/**
 * 交互表面（编辑器）持续定级：表格内容或可用宽度变化后在下一帧重新判定。
 * 定级本身会改变表格尺寸，放到 animation frame 里执行，避免 ResizeObserver 同帧循环；结果确定，第二轮即稳定。
 * scroller 在挂载后才存在，每次定级时重新解析。
 */
export function observeWorkspaceTableFit(
  table: HTMLElement,
  available: HTMLElement,
  resolveScroller: () => HTMLElement | null,
): () => void {
  const view = table.ownerDocument.defaultView;
  if (!view || typeof view.ResizeObserver !== 'function') return () => {};
  let frame = 0;
  let scroller: HTMLElement | null = null;
  const onScroll = () => {
    if (scroller) syncWorkspaceTableScroll(table, scroller);
  };
  const run = () => {
    frame = 0;
    const next = resolveScroller();
    if (next !== scroller) {
      scroller?.removeEventListener('scroll', onScroll);
      scroller = next;
      scroller?.addEventListener('scroll', onScroll, { passive: true });
    }
    fitWorkspaceTable(table, available);
    if (scroller) syncWorkspaceTableScroll(table, scroller);
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(run);
  };
  const observer = new view.ResizeObserver(schedule);
  observer.observe(table);
  observer.observe(available);
  return () => {
    observer.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    frame = 0;
    scroller?.removeEventListener('scroll', onScroll);
    scroller = null;
  };
}
