import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { clearPluginRuntimeStateForTests, setPluginRuntimeStateForTests } from '../../../plugin-registry/pluginRuntimeState';
import { createDurableFlowHarness, installRecoveryModelFixture } from '../__test-helpers__/createDurableFlowHarness';
import { EditFileTool } from 'src/tools/workspace/edit_file/EditFileTool';
import { readTail } from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { SqliteExecutionCommit } from '../../persistence/execution-commit';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-cancel-settlement-'));
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

describe('cancel through real Graph, SQLite, durable tool projection and Host completion', () => {
  it('原 run 暂停后继续并取消，累计预算与最后提交的 checkpoint 相同，不再叠加暂停前预算', async () => {
    const entered = barrier();
    const tool = new EditFileTool();
    vi.spyOn(tool, 'run').mockImplementation(async (_args, context) => {
      const signal = context.abortSignal;
      if (!signal) throw new Error('Expected abort signal');
      entered.release();
      return new Promise((_resolve, reject) => signal.addEventListener('abort',
        () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    });
    fixture = await createDurableFlowHarness(join(directory, 'resumed-cancel.sqlite'), [
      { throwAfterEvents: new Error('Network interruption') },
      { toolCalls: [{ id: 'resumed-edit', name: 'edit_file', argumentsJson: JSON.stringify({
        locator: 'workspace:/fixture.md', old_string: 'before', new_string: 'after',
      }) }] },
    ], [tool]);
    const conversationId = 'resumed-cancel';
    await fixture.flow.next({ conversation_id: conversationId,
      new_events: [{ type: 'user_input', content: 'Edit', source: 'user', timestamp: 1 }],
      options: { promptKey: 'default', model_id: 'scripted-test-model' },
    }, () => {});
    const paused = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!paused?.pause?.settled || !paused.execution_id) throw new Error('Expected durable pause');
    const runId = RunIdSchema.parse(paused.run_id);
    const originalBudget = (await fixture.runtime.supervisor.peek(runId))?.iterationsUsed;
    expect(originalBudget).toBeGreaterThan(0);
    const continuing = fixture.flow.continueRun(paused.run_id, {
      conversation_id: conversationId, expected_execution_id: paused.execution_id,
      expected_updated_at: paused.pause.updated_at,
    }, () => {});
    const outcome = Promise.allSettled([continuing]);
    await entered.promise;
    const durableBudget = (await fixture.checkpointer.load(paused.run_id))?.local?.executorLocal?.stepCount;
    expect(durableBudget).toBeGreaterThan(originalBudget ?? 0);
    await expect(fixture.flow.cancelRun(paused.run_id, conversationId, 'Budget exhausted'))
      .resolves.toMatchObject({ terminal_status: 'cancelled' });
    expect((await outcome)[0].status).toBe('fulfilled');
    expect((await fixture.runtime.supervisor.peek(runId))?.iterationsUsed).toBe(durableBudget);
    const metrics = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events
      .filter(event => event.type === 'run_execution_metrics');
    expect(metrics[metrics.length - 1]?.metadata).toMatchObject({ run_iterations_used: durableBudget });
    expect(metrics[metrics.length - 1]?.metadata).not.toHaveProperty('execution_steps_used');
    expect(await fixture.checkpointer.load(paused.run_id)).toBeNull();
  });

  it('取消与工具成功边界排队竞争时，不丢成功结果也不执行下一个调用', async () => {
    const enteredCommit = barrier();
    const releaseCommit = barrier();
    const originalFactory = SqliteExecutionCommit.prototype.forExecution;
    vi.spyOn(SqliteExecutionCommit.prototype, 'forExecution').mockImplementation(function (this: SqliteExecutionCommit, runId, executionId) {
      const writer = originalFactory.call(this, runId, executionId);
      return async input => {
        if (input.checkpoint.executionStatus === 'ready' && input.events.some(
          row => row.event.type === 'tool_output' && row.event.tool_call_id === 'race-active',
        )) {
          enteredCommit.release();
          await releaseCommit.promise;
        }
        return writer(input);
      };
    });
    const tool = new EditFileTool();
    const execute = vi.spyOn(tool, 'run').mockResolvedValue(JSON.stringify({ observation: 'Committed', data: {} }));
    fixture = await createDurableFlowHarness(join(directory, 'race.sqlite'), [{
      toolCalls: ['race-active', 'race-pending'].map(id => ({ id, name: 'edit_file', argumentsJson: JSON.stringify({
        locator: 'workspace:/fixture.md', old_string: 'before', new_string: 'after',
      }) })),
    }], [tool]);
    const conversationId = 'cancel-commit-race';
    const executing = fixture.flow.next({ conversation_id: conversationId,
      new_events: [{ type: 'user_input', content: 'Edit', source: 'user', timestamp: 1 }],
      options: { promptKey: 'default', model_id: 'scripted-test-model' },
    }, () => {});
    const executionOutcome = Promise.allSettled([executing]);
    await enteredCommit.promise;
    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!active) throw new Error('Expected active run');
    const cancelled = fixture.flow.cancelRun(active.run_id, conversationId, 'commit race');
    // 观察正式 RunRegistry 的取消事实，随后释放已经排队的 ready checkpoint。
    await vi.waitFor(async () => {
      expect((await fixture?.runtime.supervisor.findByConversation(conversationId))?.find(run => run.runId === active.run_id)?.status).toBe('cancelled');
    });
    releaseCommit.release();
    await expect(cancelled).resolves.toMatchObject({ terminal_status: 'cancelled' });
    expect((await executionOutcome)[0].status).toBe('fulfilled');
    expect(execute).toHaveBeenCalledOnce();
    const outputs = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events
      .filter(event => event.type === 'tool_output');
    expect(outputs.map(event => [event.tool_call_id, event.status]))
      .toEqual([['race-active', 'success'], ['race-pending', 'error']]);
  });

  it.each(['aborted', 'committed'] as const)(
    '等待在途 edit_file 收尾并配对全部工具，实际编辑结果=%s', async outcome => {
      const entered = barrier();
      const abortSeen = barrier();
      const finishTool = barrier();
      const tool = new EditFileTool();
      // 只控制文档 I/O 的完成点；Agent、ToolNode、事实写入和 UI reader 全走正式链路。
      const execute = vi.spyOn(tool, 'run').mockImplementation(async (_args, context) => {
        const signal = context.abortSignal;
        if (!signal) throw new Error('Expected execution abort signal');
        signal.addEventListener('abort', abortSeen.release, { once: true });
        entered.release();
        await abortSeen.promise;
        await finishTool.promise;
        if (outcome === 'aborted') throw new DOMException('Edit cancelled', 'AbortError');
        return JSON.stringify({ observation: 'Edit committed before cancellation', data: { committed: true } });
      });
      fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), [{
        toolCalls: ['edit-active', 'edit-pending'].map(id => ({
          id, name: 'edit_file', argumentsJson: JSON.stringify({
            locator: 'workspace:/fixture.md', old_string: 'before', new_string: 'after',
          }),
        })),
      }], [tool]);
      const conversationId = 'cancel-edit-conversation';
      const executing = fixture.flow.next({
        conversation_id: conversationId,
        new_events: [{ type: 'user_input', content: 'Edit the document', source: 'user', timestamp: 1 }],
        options: { promptKey: 'default', model_id: 'scripted-test-model' },
      }, () => {});
      const executionOutcome = Promise.allSettled([executing]);
      await entered.promise;
      const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
      if (!active) throw new Error('Expected active root run');
      let settled = false;
      const cancelling = fixture.flow.cancelRun(active.run_id, conversationId, 'test cancellation')
        .then(result => { settled = true; return result; });
      await abortSeen.promise;
      expect(settled).toBe(false);
      finishTool.release();
      await expect(cancelling).resolves.toMatchObject({ terminal_status: 'cancelled' });
      expect((await executionOutcome)[0].status).toBe('fulfilled');
      expect(execute).toHaveBeenCalledOnce();

      const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
      const outputs = events.filter(event => event.type === 'tool_output');
      expect(outputs.filter(event => event.tool_call_id === 'edit-active')).toHaveLength(1);
      expect(outputs.filter(event => event.tool_call_id === 'edit-pending')).toHaveLength(1);
      expect(outputs.find(event => event.tool_call_id === 'edit-active')?.status)
        .toBe(outcome === 'committed' ? 'success' : 'error');
      expect(outputs.find(event => event.tool_call_id === 'edit-pending')?.status).toBe('error');

      const window = readTail(fixture.db, conversationId, 100);
      if (window.status !== 'ready') throw new Error('Expected durable UI window');
      const cards = window.messages.filter(message => message.message_type === 'tool_calls');
      expect(cards).toHaveLength(2);
      expect(cards.every(card => card.payload.status !== 'loading')).toBe(true);
      await expect(fixture.flow.cancelRun(active.run_id, conversationId, 'retry'))
        .resolves.toMatchObject({ outcome: 'already_terminal', terminal_status: 'cancelled' });
    },
  );
});
