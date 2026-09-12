import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { ConversationControlRunStatusSnapshotSchema } from '@app/schemas';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { ProcessTool } from 'src/tools/commands/process/ProcessTool';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { projectRunStatus } from '../../../application/conversation-control/functions/projectRunStatus';
import { SQLiteRunRegistryStore } from '../../persistence/run-registry';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-protocol-fuse-'));
  setPluginRuntimeStateForTests({ installedPluginIds: ['platform'], enabledPluginIds: ['platform'] });
  installRecoveryModelFixture();
});
afterEach(() => {
  fixture?.close();
  fixture = undefined;
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('protocol fuse through real Flow, Graph, SQLite and CLI status projection', () => {
  it('持久化全部拒绝结果及安全暂停原因；显式继续消费原错误历史且不重跑工具', async () => {
    const callIds = Array.from({ length: 4 }, (_, index) => `process-invalid-${index + 1}`);
    fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [
      ...callIds.map(id => ({ toolCalls: [{
        id,
        name: 'process',
        argumentsJson: JSON.stringify({
          process_handle: 'command_process_123e4567-e89b-42d3-a456-426614174000',
          action: 'wait',
        }),
      }] })),
      {
        contentChunks: ['The protocol failures are preserved; no command was executed.'],
        assertCall(call) {
          expect(call.messages.filter(message => message.role === 'tool')
            .map(message => message.tool_call_id)).toEqual(callIds);
        },
      },
    ], [new ProcessTool()]);
    const conversationId = 'protocol-fuse-conversation';
    await fixture.flow.next({
      conversation_id: conversationId,
      new_events: [{ type: 'user_input', content: 'Inspect the command', source: 'user', timestamp: 1 }],
      options: { promptKey: 'default', model_id: 'scripted-test-model' },
    }, () => {});

    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    expect(active).toMatchObject({ status: 'paused', pause: { settled: true, reason: 'tool.protocol_fuse' } });
    if (!active?.execution_id || !active.pause) throw new Error('Expected a settled execution pause');
    // 从 SQLite owner 重新读取，不用内存 handle 或实时工具卡证明持久状态。
    const registry = new SQLiteRunRegistryStore(fixture.db);
    const record = await registry.load(RunIdSchema.parse(active.run_id));
    if (!record) throw new Error('Expected durable run record');
    expect(record).toMatchObject({ status: 'paused', pauseReason: 'tool.protocol_fuse' });
    const cliStatus = ConversationControlRunStatusSnapshotSchema.parse(projectRunStatus(record, undefined, false));
    expect(cliStatus.pause).toEqual({ settled: true, reason: record.pauseReason });
    expect(cliStatus.error).toBeUndefined();
    expect(fixture.ai.getCalls()).toHaveLength(4);
    expect(fixture.getToolExecutions()).toEqual([]);

    const before = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    const outputs = before.filter(event => event.type === 'tool_output');
    expect(outputs.map(event => [event.tool_call_id, event.status]))
      .toEqual(callIds.map(id => [id, 'error']));
    expect(new Set(outputs.map(event => event.id)).size).toBe(callIds.length);
    const window = readTail(fixture.db, conversationId, 100);
    if (window.status !== 'ready') throw new Error('Expected durable UI window');
    const cards = window.messages.filter(message => message.message_type === 'tool_calls');
    expect(cards).toHaveLength(4);
    expect(cards.every(card => card.payload.status === 'error')).toBe(true);

    const checkpoint = await fixture.checkpointer.load(active.run_id);
    expect(checkpoint).toMatchObject({ nodeId: 'llm', executionStatus: 'ready', local: { pendingToolCalls: [] } });
    expect(checkpoint?.local?.executingToolCallId).toBeUndefined();
    await fixture.flow.continueRun(active.run_id, {
      conversation_id: conversationId,
      expected_execution_id: active.execution_id,
      expected_updated_at: active.pause.updated_at,
    }, () => {});
    const completed = await registry.load(RunIdSchema.parse(active.run_id));
    expect(completed?.status).toBe('completed');
    expect(completed?.metadata?.executionId).not.toBe(active.execution_id);
    expect(fixture.ai.getCalls()).toHaveLength(5);
    fixture.ai.assertAllTurnsConsumed();
    expect(fixture.getToolExecutions()).toEqual([]);
    const after = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(after.filter(event => event.type === 'tool_output').map(event => event.id))
      .toEqual(outputs.map(event => event.id));
    expect(after.filter(event => event.type === 'user_input')).toHaveLength(1);
  });
});
