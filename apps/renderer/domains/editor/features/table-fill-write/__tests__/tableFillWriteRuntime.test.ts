// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { findTableIdentityByRootBlockId } from '../../../blocks/TableBlock/position/tableIdentity';
import type { TableCellWriteOperationResult } from '../../../blocks/TableBlock/ai/tableCellWriteOperation';
import type { TableCellWriteEditor } from '../../../blocks/TableBlock/ai/tableCellWriter.js';
import { createTableFillWriteRuntime } from '../orchestration/createTableFillWriteRuntime';
import { buildTableFillRowPlans } from '../functions/buildTableFillRowPlans';

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

function createCell(text: string): ProseMirrorNode {
  return schema.nodes.tableCell.create(
    null,
    schema.nodes.tableCellContentBlock.create(null, text ? schema.text(text) : null),
  );
}

function createTableRootBlock(id: string, rows: readonly (readonly string[])[]): ProseMirrorNode {
  return schema.nodes.rootBlock.create(
    { id },
    schema.nodes.table.create(
      null,
      rows.map((row) => schema.nodes.tableRow.create(null, row.map(createCell))),
    ),
  );
}

function createEditorFixture() {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      createTableRootBlock('target-table', [
        ['row 1 source', ''],
        ['row 2 source', ''],
      ]),
    ]),
  });
  const dispatch = vi.fn((transaction: Transaction) => {
    state = state.apply(transaction);
  });

  return {
    editor: {
      get state() {
        return state;
      },
      view: { editable: true, dispatch },
    },
    dispatch,
  };
}

function requireTableIdentity(editor: TableCellWriteEditor, rootBlockId: string) {
  const table = findTableIdentityByRootBlockId(editor.state.doc, rootBlockId);
  if (!table) throw new Error(`测试文档缺少表格: ${rootBlockId}`);
  return table;
}

function readTableRows(editor: TableCellWriteEditor, rootBlockId: string): string[][] {
  const table = requireTableIdentity(editor, rootBlockId).node;
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

function beginTwoRowSession(params: {
  runtime: ReturnType<typeof createTableFillWriteRuntime>;
  editor: TableCellWriteEditor;
  signal?: AbortSignal;
}): void {
  const table = requireTableIdentity(params.editor, 'target-table');
  params.runtime.sessions.beginSession({
    sessionId: 'session-1',
    editor: params.editor,
    table: { initialPos: table.pos, rootBlockId: 'target-table' },
    units: [
      { unitId: 'row-1', rowIndex: 0, colIndex: 1, rowContext: { name: 'Alice' } },
      { unitId: 'row-2', rowIndex: 1, colIndex: 1 },
    ],
    signal: params.signal,
  });
}

describe('TableFillWriteRuntime', () => {
  it('按稳定表身份一次性构造全部行 prompt 与写入目标', () => {
    const fixture = createEditorFixture();
    const table = requireTableIdentity(fixture.editor, 'target-table');
    fixture.editor.view.dispatch(
      fixture.editor.state.tr.insert(0, createTableRootBlock('inserted-before', [['before']])),
    );

    const plan = buildTableFillRowPlans({
      editor: fixture.editor,
      table: { initialPos: table.pos, rootBlockId: 'target-table' },
      outputRect: { top: 0, bottom: 2, left: 1, right: 2 },
      activeInputRefs: [
        { refKey: 'source', label: 'source', rect: { top: 0, bottom: 2, left: 0, right: 1 } },
      ],
      promptTemplate: '处理 {{source}}',
    });

    expect(plan.table.initialPos).toBeGreaterThan(table.pos);
    expect(plan.rows).toEqual([
      {
        rowIndex: 0,
        colIndex: 1,
        prompt: '处理 "row 1 source"',
        rowContext: { source: 'row 1 source' },
      },
      {
        rowIndex: 1,
        colIndex: 1,
        prompt: '处理 "row 2 source"',
        rowContext: { source: 'row 2 source' },
      },
    ]);
  });

  it('并发入队时严格 FIFO，并保持占位符与首次 replace、后续 append 语义', async () => {
    const fixture = createEditorFixture();
    const runtime = createTableFillWriteRuntime();
    beginTwoRowSession({ runtime, editor: fixture.editor });

    await Promise.all([
      runtime.port.enqueueWrite({
        sessionId: 'session-1',
        unitId: 'row-1',
        content: 'Hello {{name}}',
        mode: 'replace',
      }),
      runtime.port.enqueueWrite({
        sessionId: 'session-1',
        unitId: 'row-1',
        content: '!',
        mode: 'replace',
      }),
      runtime.port.enqueueWrite({
        sessionId: 'session-1',
        unitId: 'row-2',
        content: 'Second',
        mode: 'replace',
      }),
    ]);
    await runtime.port.flush('session-1');

    expect(readTableRows(fixture.editor, 'target-table')).toEqual([
      ['row 1 source', 'Hello Alice!'],
      ['row 2 source', 'Second'],
    ]);
    expect(fixture.dispatch).toHaveBeenCalledTimes(3);
    await runtime.port.endSession('session-1');
  });

  it('每次写入都按 rootBlockId 从最新文档重定位表格', async () => {
    const fixture = createEditorFixture();
    const runtime = createTableFillWriteRuntime();
    beginTwoRowSession({ runtime, editor: fixture.editor });

    fixture.editor.view.dispatch(
      fixture.editor.state.tr.insert(0, createTableRootBlock('inserted-before', [['before']])),
    );
    await runtime.port.enqueueWrite({
      sessionId: 'session-1',
      unitId: 'row-1',
      content: 'relocated',
      mode: 'replace',
    });

    expect(readTableRows(fixture.editor, 'inserted-before')).toEqual([['before']]);
    expect(readTableRows(fixture.editor, 'target-table')[0]).toEqual(['row 1 source', 'relocated']);
    await runtime.port.endSession('session-1');
  });

  it('单项写入失败不会毒死队列，后续 unit 仍可完成', async () => {
    const fixture = createEditorFixture();
    const runtime = createTableFillWriteRuntime();
    const table = requireTableIdentity(fixture.editor, 'target-table');
    runtime.sessions.beginSession({
      sessionId: 'session-1',
      editor: fixture.editor,
      table: { initialPos: table.pos, rootBlockId: 'target-table' },
      units: [
        { unitId: 'invalid-row', rowIndex: 99, colIndex: 1 },
        { unitId: 'row-2', rowIndex: 1, colIndex: 1 },
      ],
    });

    const results = await Promise.allSettled([
      runtime.port.enqueueWrite({
        sessionId: 'session-1',
        unitId: 'invalid-row',
        content: 'invalid',
        mode: 'replace',
      }),
      runtime.port.enqueueWrite({
        sessionId: 'session-1',
        unitId: 'row-2',
        content: 'still written',
        mode: 'replace',
      }),
    ]);

    expect(results[0]).toMatchObject({ status: 'rejected' });
    expect(results[1]).toEqual({ status: 'fulfilled', value: undefined });
    expect(readTableRows(fixture.editor, 'target-table')[1]).toEqual(['row 2 source', 'still written']);
    await runtime.port.endSession('session-1');
  });

  it('取消保留在途写入，并拒绝排队中与后续写入', async () => {
    const fixture = createEditorFixture();
    let releaseFirstWrite: (() => void) | undefined;
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const writtenRows: number[] = [];
    const runtime = createTableFillWriteRuntime({
      async writeTarget(params): Promise<TableCellWriteOperationResult> {
        writtenRows.push(params.rowIndex);
        if (params.rowIndex === 0) {
          markFirstWriteStarted?.();
          await firstWriteGate;
        }
        return { ok: true };
      },
    });
    const abortController = new AbortController();
    beginTwoRowSession({ runtime, editor: fixture.editor, signal: abortController.signal });

    const firstWrite = runtime.port.enqueueWrite({
      sessionId: 'session-1',
      unitId: 'row-1',
      content: 'first',
      mode: 'replace',
    });
    await firstWriteStarted;
    const queuedWrite = runtime.port.enqueueWrite({
      sessionId: 'session-1',
      unitId: 'row-2',
      content: 'queued',
      mode: 'replace',
    });

    abortController.abort();
    releaseFirstWrite?.();
    await firstWrite;
    await expect(queuedWrite).rejects.toMatchObject({ name: 'AbortError' });
    await runtime.port.flush('session-1');
    await expect(runtime.port.enqueueWrite({
      sessionId: 'session-1',
      unitId: 'row-2',
      content: 'late',
      mode: 'replace',
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(writtenRows).toEqual([0]);
    await runtime.port.endSession('session-1');
  });

  it('session 启动时拒绝重复 unit 身份', () => {
    const fixture = createEditorFixture();
    const runtime = createTableFillWriteRuntime();
    const table = requireTableIdentity(fixture.editor, 'target-table');

    expect(() => runtime.sessions.beginSession({
      sessionId: 'session-1',
      editor: fixture.editor,
      table: { initialPos: table.pos, rootBlockId: 'target-table' },
      units: [
        { unitId: 'same-row', rowIndex: 0, colIndex: 1 },
        { unitId: 'same-row', rowIndex: 1, colIndex: 1 },
      ],
    })).toThrow('duplicate unitId');
  });
});
