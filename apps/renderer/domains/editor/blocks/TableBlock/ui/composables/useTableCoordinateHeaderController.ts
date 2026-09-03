import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue';
import { hasRenderVirtualizationTransactionMeta } from '../../../../features/RenderVirtualization';
import {
  findEditorPageScrollContainer,
  findTableHorizontalScrollContainer,
  getTableDomElement,
  measureTableColumnWidths,
  measureTablePositionMetrics,
  measureTableRowHeights,
  type PageScrollContainer,
  type PointMetrics,
  type RectMetrics,
  type TableCoordinateHeaderEditor,
} from './tableCoordinateHeaderMetrics';

export interface TableCoordinateHeaderEventEditor extends TableCoordinateHeaderEditor {
  on?: (eventName: 'transaction', handler: (payload: unknown) => void) => void;
  off?: (eventName: 'transaction', handler: (payload: unknown) => void) => void;
}

export interface UseTableCoordinateHeaderControllerOptions {
  visible: Ref<boolean>;
  tableInfo: Ref<unknown>;
  editor: Ref<TableCoordinateHeaderEventEditor | null | undefined>;
  getCellRect: (editor: TableCoordinateHeaderEditor, cellDocPos: number) => RectMetrics | null;
  debug?: (message: string, payload?: unknown) => void;
}

interface TransactionLike {
  getMeta: (key: unknown) => unknown;
  docChanged?: boolean;
  selectionSet?: boolean;
}

const EMPTY_TABLE_RECT: RectMetrics = { left: 0, top: 0, width: 0, height: 0 };
const EMPTY_POINT: PointMetrics = { left: 0, top: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

function readTablePos(tableInfo: unknown): number | null {
  if (!isRecord(tableInfo)) return null;
  const pos = tableInfo.pos;
  return typeof pos === 'number' && Number.isFinite(pos) ? pos : null;
}

function readTransaction(payload: unknown): TransactionLike | null {
  if (!isRecord(payload)) return null;
  const transaction = payload.transaction;
  if (!isRecord(transaction)) return null;
  const getMeta = transaction.getMeta;
  if (typeof getMeta !== 'function') return null;

  return {
    getMeta: (key: unknown) => getMeta.call(transaction, key),
    docChanged: transaction.docChanged === true,
    selectionSet: transaction.selectionSet === true,
  };
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(performance.now()), 16);
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(id);
    return;
  }
  window.clearTimeout(id);
}

/**
 * 表格坐标轴控制器。
 *
 * 中文说明：
 * - 只管理坐标轴测量状态与 DOM/PM 监听生命周期；
 * - 不渲染 UI，不直接依赖 Pinia；
 * - 使用 sessionId 隔离旧 rAF / MutationObserver 回调，避免虚拟化 hydrate/dehydrate 期间旧回调污染新表格。
 */
export function useTableCoordinateHeaderController(
  options: UseTableCoordinateHeaderControllerOptions
) {
  const columnWidths = ref<number[]>([]);
  const rowHeights = ref<number[]>([]);
  const tableRect = ref<RectMetrics>({ ...EMPTY_TABLE_RECT });
  const scrollLeft = ref(0);
  const scrollTop = ref(0);
  const containerRect = ref<PointMetrics>({ ...EMPTY_POINT });
  const tableScrollContainerRect = ref<PointMetrics>({ ...EMPTY_POINT });
  const editorShellScrollbarHeight = ref(0);
  const editorShellBottomInViewport = ref(0);
  const tableVisibleWidth = ref(0);
  const tableTopInContainer = ref(0);
  const tableScrollContainer = shallowRef<HTMLElement | null>(null);

  const currentSessionId = ref(0);
  const tableElement = computed(() => {
    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    return editor && tablePos !== null ? getTableDomElement(editor, tablePos) : null;
  });

  let pageScrollContainer: PageScrollContainer | null = null;
  let subscribedEditor: TableCoordinateHeaderEventEditor | null = null;
  let domObserver: MutationObserver | null = null;
  let rafId: number | null = null;
  let measureRequested = false;
  let lastRequestSource = 'init';
  let lastTableRect: RectMetrics | null = null;

  const dlog = (message: string, payload?: unknown): void => {
    options.debug?.(message, payload);
  };

  const cancelPendingFrame = (): void => {
    if (rafId === null) return;
    cancelFrame(rafId);
    rafId = null;
  };

  const measureTablePosition = (): void => {
    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    if (!editor || tablePos === null) return;

    const tableDom = getTableDomElement(editor, tablePos);
    if (!tableDom) {
      console.warn('[TableCoordinateHeaders] Table DOM node not found at position:', tablePos);
      return;
    }

    const metrics = measureTablePositionMetrics({
      tableDom,
      pageScrollContainer,
      tableScrollContainer: tableScrollContainer.value,
      previousRect: lastTableRect,
    });

    containerRect.value = metrics.containerRect;
    tableTopInContainer.value = metrics.tableTopInContainer;
    editorShellScrollbarHeight.value = metrics.editorShellScrollbarHeight;
    editorShellBottomInViewport.value = metrics.editorShellBottomInViewport;
    if (metrics.tableVisibleWidth !== null) {
      tableVisibleWidth.value = metrics.tableVisibleWidth;
    }
    if (metrics.tableScrollContainerRect) {
      tableScrollContainerRect.value = metrics.tableScrollContainerRect;
    }

    dlog('measureTablePosition', {
      rect: metrics.tableRect,
      containerRect: containerRect.value,
      delta: metrics.delta,
      tableVisibleWidth: tableVisibleWidth.value,
    });

    tableRect.value = metrics.tableRect;
    lastTableRect = metrics.tableRect;
  };

  const measureColumnWidths = (forceDomMeasurement = false): void => {
    const startedAt = performance.now?.() ?? Date.now();
    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    if (!editor || tablePos === null) return;

    const widths = measureTableColumnWidths({
      editor,
      tablePos,
      getCellRect: options.getCellRect,
      forceDomMeasurement,
      debug: dlog,
    });
    if (!widths) return;

    columnWidths.value = widths;
    const endedAt = performance.now?.() ?? Date.now();
    dlog('measureColumnWidths complete', {
      count: widths.length,
      durationMs: +(endedAt - startedAt).toFixed(2),
    });
  };

  const measureRowHeights = (): void => {
    const startedAt = performance.now?.() ?? Date.now();
    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    if (!editor || tablePos === null) return;

    const heights = measureTableRowHeights({
      editor,
      tablePos,
      getCellRect: options.getCellRect,
      debug: dlog,
    });
    if (!heights) return;

    rowHeights.value = heights;
    const endedAt = performance.now?.() ?? Date.now();
    dlog('measureRowHeights complete', {
      count: heights.length,
      durationMs: +(endedAt - startedAt).toFixed(2),
    });
  };

  const performMeasurement = (): void => {
    const startedAt = performance.now?.() ?? Date.now();
    dlog('performMeasurement start', { source: lastRequestSource });
    measureTablePosition();
    measureColumnWidths();
    measureRowHeights();
    measureRequested = false;
    const endedAt = performance.now?.() ?? Date.now();
    dlog('performMeasurement end', { durationMs: +(endedAt - startedAt).toFixed(2) });
  };

  const requestMeasurement = (source = 'unknown', sessionId: number | null = null): void => {
    dlog('requestMeasurement called', {
      source,
      sessionId,
      currentSessionId: currentSessionId.value,
      measureRequested,
      rafActive: rafId !== null,
    });

    if (sessionId !== null && sessionId !== currentSessionId.value) {
      dlog('requestMeasurement ignored: session mismatch', {
        requestSession: sessionId,
        currentSession: currentSessionId.value,
      });
      return;
    }

    lastRequestSource = source;
    if (measureRequested) return;
    measureRequested = true;

    rafId = requestFrame(() => {
      if (sessionId !== null && sessionId !== currentSessionId.value) {
        dlog('requestAnimationFrame cancelled: session changed', {
          requestSession: sessionId,
          currentSession: currentSessionId.value,
        });
        rafId = null;
        measureRequested = false;
        return;
      }

      dlog('requestAnimationFrame firing', { source: lastRequestSource, sessionId: currentSessionId.value });
      performMeasurement();
      rafId = null;
    });
  };

  const updateScrollPosition = (): void => {
    if (tableScrollContainer.value) {
      const prev = scrollLeft.value;
      scrollLeft.value = tableScrollContainer.value.scrollLeft;
      if (prev !== scrollLeft.value) {
        dlog('updateScrollPosition (horizontal)', { prev, new: scrollLeft.value });
      }
    }

    if (pageScrollContainer) {
      const prev = scrollTop.value;
      scrollTop.value = !isHTMLElement(pageScrollContainer)
        ? (window.pageYOffset || document.documentElement.scrollTop)
        : pageScrollContainer.scrollTop;
      if (prev !== scrollTop.value) {
        dlog('updateScrollPosition (vertical)', { scrollTop: scrollTop.value });
      }

      if (isHTMLElement(pageScrollContainer)) {
        const pageRect = pageScrollContainer.getBoundingClientRect();
        containerRect.value = { left: pageRect.left, top: pageRect.top };
      }
    }
  };

  const handleScroll = (): void => {
    dlog('handleScroll event');
    cancelPendingFrame();

    rafId = requestFrame(() => {
      dlog('handleScroll rAF firing');
      updateScrollPosition();
      measureTablePosition();
      rafId = null;
    });
  };

  const handleResize = (): void => {
    dlog('window resize');
    requestMeasurement('window-resize');
  };

  const findPageScrollContainer = (): PageScrollContainer | null => {
    return findEditorPageScrollContainer(options.editor.value);
  };

  const findTableScrollContainer = (): HTMLElement | null => {
    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    return editor && tablePos !== null ? findTableHorizontalScrollContainer(editor, tablePos, dlog) : null;
  };

  const cleanupDomObserver = (): void => {
    if (!domObserver) return;
    dlog('cleanupDomObserver');
    domObserver.disconnect();
    domObserver = null;
  };

  const setupDomObserver = (): void => {
    cleanupDomObserver();
    if (typeof MutationObserver === 'undefined') return;

    const editor = options.editor.value;
    const tablePos = readTablePos(options.tableInfo.value);
    if (!editor || tablePos === null) return;

    const tableDom = getTableDomElement(editor, tablePos);
    if (!tableDom) return;

    const observerSessionId = currentSessionId.value;
    dlog('setupDomObserver: starting', { sessionId: observerSessionId });

    domObserver = new MutationObserver(() => {
      if (observerSessionId !== currentSessionId.value) {
        dlog('DOM Mutation ignored: session mismatch', {
          observerSessionId,
          currentSessionId: currentSessionId.value,
        });
        return;
      }

      dlog('DOM Mutation observed, immediate measurement.');
      cancelPendingFrame();

      rafId = requestFrame(() => {
        if (observerSessionId !== currentSessionId.value) {
          dlog('DOM Mutation rAF cancelled: session changed');
          rafId = null;
          return;
        }

        dlog('DOM Mutation rAF firing - immediate update');
        measureColumnWidths(true);
        rafId = null;
      });
    });

    domObserver.observe(tableDom, {
      attributes: true,
      attributeFilter: ['style'],
      subtree: true,
    });
  };

  const cleanupListeners = (): void => {
    if (pageScrollContainer) {
      pageScrollContainer.removeEventListener('scroll', handleScroll);
      pageScrollContainer = null;
    }

    if (tableScrollContainer.value) {
      tableScrollContainer.value.removeEventListener('scroll', handleScroll);
      tableScrollContainer.value = null;
    }

    window.removeEventListener('resize', handleResize);

    if (subscribedEditor?.off) {
      subscribedEditor.off('transaction', handleTransaction);
      subscribedEditor = null;
    }

    cancelPendingFrame();
    measureRequested = false;
  };

  const setupListeners = (): void => {
    cleanupListeners();

    pageScrollContainer = findPageScrollContainer();
    tableScrollContainer.value = findTableScrollContainer();

    dlog('setupListeners', {
      hasPageScrollContainer: !!pageScrollContainer,
      hasTableScrollContainer: !!tableScrollContainer.value,
    });

    if (pageScrollContainer) {
      pageScrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    }

    if (tableScrollContainer.value) {
      tableScrollContainer.value.addEventListener('scroll', handleScroll, { passive: true });
    }

    window.addEventListener('resize', handleResize);

    const editor = options.editor.value;
    if (editor?.on) {
      editor.on('transaction', handleTransaction);
      subscribedEditor = editor;
    }
  };

  const refreshTableDomBindings = (): void => {
    if (tableScrollContainer.value) {
      tableScrollContainer.value.removeEventListener('scroll', handleScroll);
      tableScrollContainer.value = null;
    }

    tableScrollContainer.value = findTableScrollContainer();
    if (tableScrollContainer.value) {
      tableScrollContainer.value.addEventListener('scroll', handleScroll, { passive: true });
    }

    setupDomObserver();
  };

  function handleTransaction(payload: unknown): void {
    const transaction = readTransaction(payload);
    if (!transaction) return;

    const isColumnResized = transaction.getMeta('columnResized');
    const isRenderVirtualizationChanged = hasRenderVirtualizationTransactionMeta(transaction);
    dlog('handleTransaction', {
      isColumnResized,
      isRenderVirtualizationChanged,
      docChanged: transaction.docChanged,
      selectionSet: transaction.selectionSet,
    });

    if (isRenderVirtualizationChanged) {
      refreshTableDomBindings();
      requestMeasurement('render-virtualization');
      return;
    }

    if (transaction.docChanged || isColumnResized) {
      requestMeasurement('transaction');
    } else if (transaction.selectionSet) {
      handleScroll();
    }
  }

  const resetMeasurementState = (): void => {
    columnWidths.value = [];
    rowHeights.value = [];
    tableRect.value = { ...EMPTY_TABLE_RECT };
    tableScrollContainerRect.value = { ...EMPTY_POINT };
    tableVisibleWidth.value = 0;
    tableTopInContainer.value = 0;
    lastTableRect = null;
  };

  const restartSession = (source: string, clearState: boolean): void => {
    currentSessionId.value += 1;
    dlog('Session restarted', { source, sessionId: currentSessionId.value });

    cleanupListeners();
    cleanupDomObserver();
    if (clearState) {
      resetMeasurementState();
    }

    if (!options.visible.value) return;
    setupListeners();
    setupDomObserver();
    requestMeasurement(source, currentSessionId.value);
  };

  watch(
    () => options.visible.value,
    (visible) => {
      dlog('watch visible', { visible });
      if (visible) {
        restartSession('visible-watch', false);
        return;
      }
      restartSession('hidden-watch', true);
    },
    { immediate: true }
  );

  watch(
    [() => options.tableInfo.value, () => options.editor.value],
    () => {
      dlog('watch table context changed');
      if (!options.visible.value) return;
      restartSession('table-context-watch', false);
    },
    { deep: true }
  );

  onUnmounted(() => {
    dlog('onUnmounted');
    currentSessionId.value += 1;
    cleanupListeners();
    cleanupDomObserver();
  });

  return {
    columnWidths,
    rowHeights,
    tableRect,
    scrollLeft,
    scrollTop,
    containerRect,
    tableScrollContainerRect,
    editorShellScrollbarHeight,
    editorShellBottomInViewport,
    tableVisibleWidth,
    tableTopInContainer,
    tableScrollContainer,
    tableElement,
    measureTablePosition,
    requestMeasurement,
  };
}
