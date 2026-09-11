import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import {
  setPluginRuntimeStateForTests,
  clearPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import { WriteFileTool } from 'src/tools/workspace/write_file/WriteFileTool';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';

const conversationId = 'durable-conversation';
let directory: string;
const closeFixtures: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-process-crash-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closeFixtures.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function open(
  turns: Parameters<typeof createDurableFlowHarness>[1],
  tools: Parameters<typeof createDurableFlowHarness>[2] = []
) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns, tools);
  closeFixtures.push(fixture.close);
  return fixture;
}
async function paused(fixture: Awaited<ReturnType<typeof open>>) {
  const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!active || active.status !== 'paused' || !active.pause?.settled || !active.execution_id) {
    throw new Error('Expected original settled pause after process crash');
  }
  return { ...active, pause: active.pause, execution_id: active.execution_id };
}
describe('real process crash recovery with Audit off', () => {
  it('SIGKILL 后启动重建原运行，受管写入不重复且无需用户消息', async () => {
    const initial = await open([]);
    const projectId = new WorkspaceService(initial.db).createProject('Recovery');
    await initial.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
    initial.close();
    closeFixtures.pop();
    resetAgentRuntimeSingletonsForTest();
    const processResult = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      output: string;
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          '--pool=threads',
          '--maxWorkers=1',
          'src/app-hosts/linnya/adapters/flow/__test-helpers__/durableProcessCrash.fixture.test.ts',
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            LINNYA_TEST_CRASH_DB: join(directory, 'workspace.sqlite'),
            LINNYA_TEST_CRASH_PROJECT: projectId,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let output = '';
      const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
      child.stdout.on('data', chunk => {
        output = (output + String(chunk)).slice(-12_000);
      });
      child.stderr.on('data', chunk => {
        output = (output + String(chunk)).slice(-12_000);
      });
      child.once('error', error => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, output });
      });
    });
    expect(processResult.signal, processResult.output).toBe('SIGKILL');
    const resumed = await open(
      [{ contentChunks: ['Recovered original run'] }],
      [new WriteFileTool()]
    );
    const root = await paused(resumed);
    expect(resumed.ai.getConsumedTurnCount()).toBe(0);
    expect(
      resumed.runtime.toolResults?.read(root.run_id, 'killed-write', 'write_file')?.result
    ).toContain('killed.md');
    await resumed.flow.continueRun(
      root.run_id,
      {
        conversation_id: conversationId,
        expected_execution_id: root.execution_id,
        expected_updated_at: root.pause.updated_at,
      },
      () => {}
    );
    expect(resumed.getToolExecutions()).toHaveLength(0);
    expect(
      resumed.db.prepare("SELECT id FROM workspace_nodes WHERE name = 'killed.md'").all()
    ).toHaveLength(1);
    expect(
      (await resumed.eventStore.readEvents(conversationId, { limit: 100 })).events.filter(
        e => e.type === 'user_input'
      )
    ).toHaveLength(1);
    expect(await resumed.flow.getActiveForegroundRun(conversationId)).toMatchObject({ run: null });
  }, 30_000);
});
