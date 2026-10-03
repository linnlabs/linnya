import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import { BaseTool } from 'src/tools/types';

class ReadFixture extends BaseTool {
  readonly name = 'read_file';
  readonly description = 'Read a deterministic fixture';
  readonly parameters = { type: 'object' as const, properties: {}, required: [] };
  async run(): Promise<string> {
    return 'Persisted source text';
  }
}

let directory: string;
let fixture: Awaited<ReturnType<typeof createDurableFlowHarness>> | undefined;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-terminal-release-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
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

describe('durable manual tool terminal resource release', () => {
  it.each([true, false])('连续终态释放执行器及断点、保留事实（手动工具=%s）', async manualTool => {
    fixture = await createDurableFlowHarness(
      join(directory, 'workspace.sqlite'),
      manualTool ? [] : Array.from({ length: 3 }, () => ({ contentChunks: ['Completed answer'] })),
      [new ReadFixture()]
    );
    // Graph 的公开释放入口同时拥有进程内 local 与持久 checkpoint；不能只删 SQLite。
    const release = vi.spyOn(fixture.engine, 'clearCheckpoint');
    const conversationId = 'manual-tools-with-history';
    for (let index = 0; index < 3; index += 1) {
      await fixture.flow.next(
        {
          conversation_id: conversationId,
          new_events: [
            {
              type: 'user_input',
              source: 'user',
              timestamp: Date.now(),
              content: `Read ${index}`,
            },
          ],
          options: {
            promptKey: 'default',
            model_id: 'scripted-test-model',
            host_tool_call: manualTool
              ? {
                  tool_name: 'read_file',
                  args: {},
                  completion_mode: 'yield_after_batch',
                }
              : undefined,
          },
        },
        () => {}
      );
      const runs = await fixture.runtime.supervisor.findByConversation(conversationId);
      expect(runs).toHaveLength(index + 1);
      expect(release).toHaveBeenCalledTimes(index + 1);
      for (const run of runs) {
        expect(run.status).toBe('completed');
        expect(release).toHaveBeenCalledWith(run.runId);
        expect(await fixture.checkpointer.load(run.runId)).toBeNull();
        expect(await fixture.runtime.runDescriptors?.exists(run.runId)).toBe(false);
      }
    }
    expect(fixture.ai.getConsumedTurnCount()).toBe(manualTool ? 0 : 3);
    const events = (await fixture.eventStore.readEvents(conversationId, { limit: 100 })).events;
    expect(events.filter(event => event.type === 'tool_output')).toHaveLength(manualTool ? 3 : 0);
    expect(events.filter(event => event.type === 'final_answer')).toHaveLength(manualTool ? 0 : 3);
    expect(events.filter(event => event.type === 'user_input')).toHaveLength(3);
  });
});
