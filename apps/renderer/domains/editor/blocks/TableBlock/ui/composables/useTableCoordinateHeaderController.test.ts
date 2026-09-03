// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { TableMap } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, shallowRef, type App, type Ref, type ShallowRef } from 'vue';
import {
  useTableCoordinateHeaderController,
  type TableCoordinateHeaderEventEditor,
} from './useTableCoordinateHeaderController';
import type { RectMetrics } from './tableCoordinateHeaderMetrics';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'table',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    table: {
      group: 'block',
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: 'tableCell+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'tableCellContentBlock',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
    tableCellContentBlock: {
      content: 'text*',
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
  },
});

interface TestEditor extends TableCoordinateHeaderEventEditor {
  transactionListeners: Set<(payload: unknown) => void>;
  emitTransaction: (payload: unknown) => void;
}

interface TestContext {
  editor: TestEditor;
  tableNode: ProseMirrorNode;
  tablePos: number;
  tableDom: HTMLElement;
  contentDom: HTMLElement;
  editorShell: HTMLElement;
  replaceTableDom: (params: { tableRect: RectMetrics; contentRect: RectMetrics; contentWidth: number }) => {
    tableDom: HTMLElement;
    contentDom: HTMLElement;
  };
}

type ControllerApi = ReturnType<typeof useTableCoordinateHeaderController>;

function createCell(text: string): ProseMirrorNode {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null },
    schema.nodes.tableCellContentBlock.create(null, schema.text(text))
  );
}

function createDomRect(rect: RectMetrics): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function createEditorContext(): TestContext {
  const tableRows = [
    schema.nodes.tableRow.create(null, [createCell('a1'), createCell('b1')]),
    schema.nodes.tableRow.create(null, [createCell('a2'), createCell('b2')]),
  ];
  const table = schema.nodes.table.create(null, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);
  const state = EditorState.create({ schema, doc });

  let tablePos: number | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table' || tablePos !== null) return true;
    tablePos = pos;
    return false;
  });

  if (tablePos === null) {
    throw new Error('测试文档缺少 table');
  }

  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode) {
    throw new Error('测试文档缺少 table node');
  }

  const editorShell = document.createElement('div');
  editorShell.className = 'editor-shell';
  const editorDom = document.createElement('div');
  const rootBlock = document.createElement('div');
  rootBlock.className = 'root-block';
  const contentDom = document.createElement('div');
  contentDom.className = 'content';
  const tableDom = document.createElement('table');
  let currentTableDom = tableDom;

  tableDom.getBoundingClientRect = () =>
    createDomRect({ left: 30, top: 80, width: 300, height: 90 });
  editorShell.getBoundingClientRect = () =>
    createDomRect({ left: 10, top: 20, width: 800, height: 600 });
  contentDom.getBoundingClientRect = () =>
    createDomRect({ left: 25, top: 70, width: 320, height: 120 });
  Object.defineProperty(editorShell, 'offsetHeight', { value: 620 });
  Object.defineProperty(editorShell, 'clientHeight', { value: 600 });
  Object.defineProperty(contentDom, 'clientWidth', { value: 320 });

  contentDom.appendChild(tableDom);
  rootBlock.appendChild(contentDom);
  editorDom.appendChild(rootBlock);
  editorShell.appendChild(editorDom);
  document.body.appendChild(editorShell);

  const transactionListeners = new Set<(payload: unknown) => void>();
  const editor: TestEditor = {
    transactionListeners,
    view: {
      state,
      dom: editorDom,
      nodeDOM: (pos: number) => (pos === tablePos ? currentTableDom : null),
    },
    on: (_eventName, handler) => {
      transactionListeners.add(handler);
    },
    off: (_eventName, handler) => {
      transactionListeners.delete(handler);
    },
    emitTransaction: (payload) => {
      transactionListeners.forEach((listener) => listener(payload));
    },
  };

  const replaceTableDom = (params: {
    tableRect: RectMetrics;
    contentRect: RectMetrics;
    contentWidth: number;
  }) => {
    const nextRootBlock = document.createElement('div');
    nextRootBlock.className = 'root-block';
    const nextContentDom = document.createElement('div');
    nextContentDom.className = 'content';
    const nextTableDom = document.createElement('table');

    nextTableDom.getBoundingClientRect = () => createDomRect(params.tableRect);
    nextContentDom.getBoundingClientRect = () => createDomRect(params.contentRect);
    Object.defineProperty(nextContentDom, 'clientWidth', { value: params.contentWidth });

    nextContentDom.appendChild(nextTableDom);
    nextRootBlock.appendChild(nextContentDom);
    rootBlock.replaceWith(nextRootBlock);
    currentTableDom = nextTableDom;

    return {
      tableDom: nextTableDom,
      contentDom: nextContentDom,
    };
  };

  return { editor, tableNode, tablePos, tableDom, contentDom, editorShell, replaceTableDom };
}

function createCellRectReader(context: TestContext) {
  const map = TableMap.get(context.tableNode);
  const rects = new Map<number, RectMetrics>();
  rects.set(context.tablePos + 1 + map.positionAt(0, 0, context.tableNode), {
    left: 0,
    top: 0,
    width: 100,
    height: 30,
  });
  rects.set(context.tablePos + 1 + map.positionAt(0, 1, context.tableNode), {
    left: 100,
    top: 0,
    width: 140,
    height: 30,
  });
  rects.set(context.tablePos + 1 + map.positionAt(1, 0, context.tableNode), {
    left: 0,
    top: 30,
    width: 100,
    height: 42,
  });
  rects.set(context.tablePos + 1 + map.positionAt(1, 1, context.tableNode), {
    left: 100,
    top: 30,
    width: 140,
    height: 42,
  });

  return (_editor: TableCoordinateHeaderEventEditor, cellDocPos: number): RectMetrics | null => {
    return rects.get(cellDocPos) ?? null;
  };
}

function mountControllerHost(params: {
  visible: Ref<boolean>;
  tableInfo: Ref<{ pos: number } | null>;
  editor: ShallowRef<TestEditor | null>;
  getCellRect: (editor: TableCoordinateHeaderEventEditor, cellDocPos: number) => RectMetrics | null;
  onApi: (api: ControllerApi) => void;
}): App {
  const Host = defineComponent({
    setup() {
      params.onApi(useTableCoordinateHeaderController({
        visible: params.visible,
        tableInfo: params.tableInfo,
        editor: params.editor,
        getCellRect: params.getCellRect,
      }));
      return () => h('div');
    },
  });

  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(Host);
  app.mount(container);
  return app;
}

async function waitFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

function createRenderVirtualizationTransactionPayload(): unknown {
  return {
    transaction: {
      getMeta(key: unknown): unknown {
        return key === 'renderVirtualization' ? { hydrate: ['root-table'] } : undefined;
      },
      docChanged: false,
      selectionSet: false,
    },
  };
}

describe('useTableCoordinateHeaderController', () => {
  const mountedApps: App[] = [];

  afterEach(() => {
    mountedApps.forEach((app) => app.unmount());
    mountedApps.length = 0;
    document.body.innerHTML = '';
  });

  it('measures table headers and updates horizontal scroll through the bound table scroller', async () => {
    const context = createEditorContext();
    const visible = ref(true);
    const tableInfo = ref<{ pos: number } | null>({ pos: context.tablePos });
    const editor = shallowRef<TestEditor | null>(context.editor);
    const apiHolder: { api: ControllerApi | null } = { api: null };

    mountedApps.push(mountControllerHost({
      visible,
      tableInfo,
      editor,
      getCellRect: createCellRectReader(context),
      onApi: (nextApi) => {
        apiHolder.api = nextApi;
      },
    }));

    await waitFrame();

    const api = apiHolder.api;
    if (!api) {
      throw new Error('controller api not mounted');
    }

    expect(api.tableScrollContainer.value).toBe(context.contentDom);
    expect(api.columnWidths.value).toEqual([100, 140]);
    expect(api.rowHeights.value).toEqual([30, 42]);
    expect(api.tableRect.value).toEqual({ left: 30, top: 80, width: 300, height: 90 });

    context.contentDom.scrollLeft = 37;
    context.contentDom.dispatchEvent(new Event('scroll'));
    await waitFrame();

    expect(api.scrollLeft.value).toBe(37);
  });

  it('keeps transaction listener registration idempotent across context changes and cleanup', async () => {
    const context = createEditorContext();
    const visible = ref(true);
    const tableInfo = ref<{ pos: number } | null>({ pos: context.tablePos });
    const editor = shallowRef<TestEditor | null>(context.editor);

    mountedApps.push(mountControllerHost({
      visible,
      tableInfo,
      editor,
      getCellRect: createCellRectReader(context),
      onApi: () => {},
    }));

    await waitFrame();
    expect(context.editor.transactionListeners.size).toBe(1);

    tableInfo.value = { pos: context.tablePos };
    await nextTick();
    expect(context.editor.transactionListeners.size).toBe(1);

    visible.value = false;
    await nextTick();
    expect(context.editor.transactionListeners.size).toBe(0);
  });

  it('rebinds the table scroll container after a render-virtualization transaction replaces DOM', async () => {
    const context = createEditorContext();
    const visible = ref(true);
    const tableInfo = ref<{ pos: number } | null>({ pos: context.tablePos });
    const editor = shallowRef<TestEditor | null>(context.editor);
    const apiHolder: { api: ControllerApi | null } = { api: null };

    mountedApps.push(mountControllerHost({
      visible,
      tableInfo,
      editor,
      getCellRect: createCellRectReader(context),
      onApi: (nextApi) => {
        apiHolder.api = nextApi;
      },
    }));

    await waitFrame();

    const api = apiHolder.api;
    if (!api) {
      throw new Error('controller api not mounted');
    }

    expect(api.tableScrollContainer.value).toBe(context.contentDom);

    const replacement = context.replaceTableDom({
      tableRect: { left: 60, top: 120, width: 420, height: 110 },
      contentRect: { left: 55, top: 110, width: 460, height: 150 },
      contentWidth: 460,
    });

    context.editor.emitTransaction(createRenderVirtualizationTransactionPayload());
    await waitFrame();

    expect(api.tableScrollContainer.value).toBe(replacement.contentDom);
    expect(api.tableRect.value).toEqual({ left: 60, top: 120, width: 420, height: 110 });
    expect(api.tableVisibleWidth.value).toBe(460);

    context.contentDom.scrollLeft = 15;
    context.contentDom.dispatchEvent(new Event('scroll'));
    await waitFrame();
    expect(api.scrollLeft.value).toBe(0);

    replacement.contentDom.scrollLeft = 88;
    replacement.contentDom.dispatchEvent(new Event('scroll'));
    await waitFrame();
    expect(api.scrollLeft.value).toBe(88);
  });
});
