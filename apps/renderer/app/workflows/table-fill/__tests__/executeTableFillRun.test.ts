import { Schema } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import type { SSESubRunTraceEvent, SSEToolOutputEvent } from '@linnlabs/linnkit/contracts';
import { PromptKeys, type SubrunBatchResultItem } from '@app/schemas';
import type { TableCellWriteEditor } from '@/domains/editor/blocks/TableBlock/ai/tableCellWriter.js';
import type { TableFillWriteCommand } from '@/domains/editor/features/table-fill-write';
import { buildTableFillBatchPlan } from '../functions/buildTableFillBatchPlan';
import { executeTableFillRun } from '../orchestration/executeTableFillRun';
import { createConversationUserInputAdmission } from '@/domains/conversation/features/user-input-admission';
import type {
  ExecuteTableFillRunDependencies,
  TableFillWorkflowInput,
} from '../definitions/tableFillWorkflow';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

const schema = new Schema({
  nodes: {
    doc: { content: 'text*' },
    text: {},
  },
});

function createEditor(): TableCellWriteEditor {
  let state = EditorState.create({ schema });
  return {
    get state() {
      return state;
    },
    view: {
      editable: true,
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    },
  };
}

function createInput(): TableFillWorkflowInput {
  return {
    prompt: '补全信息',
    editor: createEditor(),
    table: { initialPos: 10, rootBlockId: 'table-root' },
    outputRect: { top: 0, bottom: 2, left: 1, right: 2 },
    activeInputRefs: [],
  };
}

function createCommittedUserInput() {
  return {
    type: 'user_input_committed' as const,
    id: 'message-1',
    timestamp: 1,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    operation: 'append' as const,
    content: '补全信息',
    raw_content: '补全信息',
  };
}

function createWriteTrace(
  subrunId: string,
  content: string,
  mode: 'replace' | 'append',
  metadata?: SSESubRunTraceEvent['metadata']
): SSESubRunTraceEvent {
  return {
    type: 'subrun_trace',
    id: `trace-${subrunId}-${content}`,
    timestamp: 1,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    parent_tool_call_id: ToolCallIdSchema.parse('batch-call'),
    subrun_id: subrunId,
    source_event_id: `source-${subrunId}-${content}`,
    kind: 'tool_output',
    tool_name: 'write_to_table',
    tool_call_id: ToolCallIdSchema.parse(`write-${subrunId}`),
    status: 'success',
    ...(metadata ? { metadata } : {}),
    output: {
      data: {
        action: 'write_to_table',
        content,
        mode,
        timestamp: 1,
      },
      observation: '表格内容已写入。',
    },
  };
}

function createBatchOutput(results: readonly SubrunBatchResultItem[]): SSEToolOutputEvent {
  const succeeded = results.filter(item => item.status === 'completed').length;
  const failed = results.filter(item => item.status === 'failed').length;
  const cancelled = results.filter(item => item.status === 'cancelled').length;
  const status =
    succeeded === results.length
      ? 'completed'
      : cancelled === results.length
        ? 'cancelled'
        : succeeded === 0 && failed > 0
          ? 'failed'
          : 'partial';
  return {
    type: 'tool_output',
    id: 'batch-output',
    timestamp: 2,
    conversation_id: 'conversation-1',
    turn_id: 'turn-1',
    tool_name: 'subrun_batch',
    tool_call_id: ToolCallIdSchema.parse('batch-call'),
    status: 'success',
    observation: 'batch done',
    data: {
      status,
      total: results.length,
      succeeded,
      failed,
      cancelled,
      subrun_ids: results.map(item => item.subrun_id),
      results: [...results],
    },
  };
}

interface WorkflowHarness {
  dependencies: ExecuteTableFillRunDependencies;
  writes: TableFillWriteCommand[];
  lifecycle: string[];
  settled: Array<{
    completedSuccessfully: boolean;
    errorMessage: string | null;
  }>;
  readController(): AbortController | null;
}

function createHarness(
  invoke: ExecuteTableFillRunDependencies['invokeAssistant'],
  enqueueWrite?: (command: TableFillWriteCommand) => Promise<void>
): WorkflowHarness {
  const writes: TableFillWriteCommand[] = [];
  const lifecycle: string[] = [];
  const settled: WorkflowHarness['settled'] = [];
  let controller: AbortController | null = null;

  return {
    writes,
    lifecycle,
    settled,
    readController: () => controller,
    dependencies: {
      executionState: {
        begin(nextController) {
          controller = nextController;
          lifecycle.push('execution:begin');
        },
        settle(params) {
          settled.push({
            completedSuccessfully: params.completedSuccessfully,
            errorMessage: params.errorMessage,
          });
          lifecycle.push('execution:settle');
        },
      },
      readActiveConversationId: () => 'conversation-1',
      ensureHistoryTail: async () => {
        lifecycle.push('history:tail');
      },
      prepareRunCommand: async () => ({
        ok: true,
        run: {
          conversationId: 'conversation-1',
          runId: 'run-1',
          messageId: 'message-1',
          projectId: 'project-1',
          projectMetadata: { id: 'project-1' },
          wasNewConversation: false,
        },
      }),
      createUserInputAdmission: ({ run }) =>
        createConversationUserInputAdmission({
          expectation: {
            conversationId: run.conversationId,
            messageId: run.messageId,
            operation: 'append',
          },
          commitUserInput: event => ({
            id: event.id,
            role: 'user',
            type: 'user_input',
            content: event.content,
            timestamp: event.timestamp,
          }),
        }),
      buildRowPlans: () => ({
        table: { initialPos: 10, rootBlockId: 'table-root' },
        rows: [
          { rowIndex: 0, colIndex: 1, prompt: 'row 1', rowContext: { source: 'A' } },
          { rowIndex: 1, colIndex: 1, prompt: 'row 2', rowContext: { source: 'B' } },
        ],
      }),
      buildBatchPlan: rows =>
        buildTableFillBatchPlan(rows, {
          createUnitId: row => `unit-${row.rowIndex}`,
          createSubrunId: row => `subrun-${row.rowIndex}`,
          describeRow: row => `第 ${row.rowIndex + 1} 行`,
        }),
      createSessionId: () => 'session-1',
      writeSessions: {
        beginSession() {
          lifecycle.push('session:begin');
        },
      },
      writePort: {
        async enqueueWrite(command) {
          writes.push(command);
          await enqueueWrite?.(command);
        },
        async flush() {
          lifecycle.push('session:flush');
        },
        async cancelSession() {
          lifecycle.push('session:cancel');
        },
        async endSession() {
          lifecycle.push('session:end');
        },
      },
      requestSave: async () => {
        lifecycle.push('workspace:save');
      },
      invokeAssistant: invoke,
      resolveProcessingFailureMessage: () => '处理失败',
    },
  };
}

function completedResult(unitId: string, subrunId: string): SubrunBatchResultItem {
  return {
    unit_id: unitId,
    subrun_id: subrunId,
    description: unitId,
    status: 'completed',
    final_answer: `${unitId} done`,
  };
}

describe('executeTableFillRun', () => {
  it('一次 forced batch 支持同 unit 多次 FIFO 写入，并允许其他 child 业务失败', async () => {
    const invoke = vi.fn<ExecuteTableFillRunDependencies['invokeAssistant']>(
      async (params, callbacks) => {
        expect(params.options?.messageId).toBe('message-1');
        expect(params.options?.promptKey).toBe(PromptKeys.SYSTEM_BATCH_SUMMARIZER);
        expect(params.options?.hostToolCall).toMatchObject({
          tool_name: 'subrun_batch',
          args: { worker_prompt_key: 'table_ai_fill' },
        });
        await callbacks.onUserInputCommitted?.(createCommittedUserInput());
        await callbacks.onSubRunTrace?.(
          createWriteTrace('subrun-0', 'first', 'replace', { unit_id: 'unit-1' })
        );
        await callbacks.onSubRunTrace?.(createWriteTrace('subrun-0', 'second', 'append'));
        await callbacks.onToolOutput?.(
          createBatchOutput([
            completedResult('unit-0', 'subrun-0'),
            {
              unit_id: 'unit-1',
              subrun_id: 'subrun-1',
              description: 'unit-1',
              status: 'failed',
              final_answer: '',
              error: 'child failed',
            },
          ])
        );
        await callbacks.onTransportEnd?.({
          type: 'transport_end',
          id: 'stream-end',
          timestamp: 3,
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          execution_id: 'execution-1',
          reason: 'complete',
        });
      }
    );
    const harness = createHarness(invoke);

    await executeTableFillRun(createInput(), harness.dependencies);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(harness.writes.map(write => [write.unitId, write.content, write.mode])).toEqual([
      ['unit-0', 'first', 'replace'],
      ['unit-0', 'second', 'append'],
    ]);
    expect(harness.settled).toEqual([{ completedSuccessfully: true, errorMessage: null }]);
    expect(harness.lifecycle).toEqual([
      'execution:begin',
      'history:tail',
      'workspace:save',
      'session:begin',
      'session:flush',
      'session:end',
      'execution:settle',
    ]);
  });

  it('transport 正常结束但缺少 durable ack 时拒绝把任务结算为成功', async () => {
    const invoke: ExecuteTableFillRunDependencies['invokeAssistant'] = async () => undefined;
    const harness = createHarness(invoke);

    await expect(executeTableFillRun(createInput(), harness.dependencies)).rejects.toThrow(
      'Table fill completed without a durable user input commit'
    );
    expect(harness.settled).toEqual([{ completedSuccessfully: false, errorMessage: '处理失败' }]);
  });

  it('本地写入失败时停止父 run，并在失败收口后释放 session', async () => {
    let reachedParentOutput = false;
    const invoke: ExecuteTableFillRunDependencies['invokeAssistant'] = async (
      _params,
      callbacks
    ) => {
      await callbacks.onSubRunTrace?.(createWriteTrace('subrun-0', 'cannot write', 'replace'));
      reachedParentOutput = true;
    };
    const harness = createHarness(invoke, async () => {
      throw new Error('ProseMirror dispatch failed');
    });

    await expect(executeTableFillRun(createInput(), harness.dependencies)).rejects.toThrow(
      'ProseMirror dispatch failed'
    );

    expect(reachedParentOutput).toBe(false);
    expect(harness.lifecycle.slice(-3)).toEqual([
      'session:flush',
      'session:end',
      'execution:settle',
    ]);
    expect(harness.settled).toEqual([{ completedSuccessfully: false, errorMessage: '处理失败' }]);
  });

  it('父结果把没有写入 trace 的 unit 标成 completed 时拒绝继续', async () => {
    const invoke: ExecuteTableFillRunDependencies['invokeAssistant'] = async (
      _params,
      callbacks
    ) => {
      await callbacks.onSubRunTrace?.(createWriteTrace('subrun-0', 'written', 'replace'));
      await callbacks.onToolOutput?.(
        createBatchOutput([
          completedResult('unit-0', 'subrun-0'),
          completedResult('unit-1', 'subrun-1'),
        ])
      );
    };
    const harness = createHarness(invoke);

    await expect(executeTableFillRun(createInput(), harness.dependencies)).rejects.toThrow(
      'completed unit did not write to table: unit-1'
    );
    expect(harness.settled).toEqual([{ completedSuccessfully: false, errorMessage: '处理失败' }]);
  });

  it('用户取消后保留已完成写入并释放 session，不显示错误状态', async () => {
    let harness: WorkflowHarness;
    const invoke: ExecuteTableFillRunDependencies['invokeAssistant'] = async (
      _params,
      callbacks
    ) => {
      await callbacks.onSubRunTrace?.(createWriteTrace('subrun-0', 'written', 'replace'));
      harness.readController()?.abort();
      await callbacks.onError?.(new DOMException('Aborted', 'AbortError'));
    };
    harness = createHarness(invoke);

    await expect(executeTableFillRun(createInput(), harness.dependencies)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(harness.writes.map(write => write.unitId)).toEqual(['unit-0']);
    expect(harness.lifecycle.slice(-3)).toEqual([
      'session:cancel',
      'session:end',
      'execution:settle',
    ]);
    expect(harness.settled).toEqual([{ completedSuccessfully: false, errorMessage: null }]);
  });
});
