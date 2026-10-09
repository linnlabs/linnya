import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunIdSchema } from '@linnlabs/linnkit/contracts';
import { graph } from '@linnlabs/linnkit/runtime-kernel';
import { resetAgentRuntimeSingletonsForTest } from 'src/electron-main/services/agentRuntimeSingletons';
import { WorkspaceService } from 'src/electron-main/services/workspace/workspace';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from '../../../plugin-registry/pluginRuntimeState';
import {
  createDurableFlowHarness,
  installRecoveryModelFixture,
} from '../__test-helpers__/createDurableFlowHarness';
import {
  installResearchCarrierFixture,
  ResearchCarrierFixtureTool,
  researchCarrierRequest,
  researchCarrierDraftTurns,
  researchCarrierFollowingTurns,
  RESEARCH_CARRIER_CONVERSATION as conversationId,
  RESEARCH_CARRIER_TOOL,
  type CarrierBoundary,
} from '../__test-helpers__/researchCarrierFixture';
import {
  readSubrunTrace,
  readTail,
} from '../../persistence/event-store/ui-projection/sqliteUiMessagesReader';
import type { ConversationRealtimeEvent } from '../flow.schemas';
import { ReadFileTool } from 'src/tools/workspace/read_file/ReadFileTool';
import type { ToolContext } from 'src/tools/types';

let directory: string;
const closers: Array<() => void> = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'linnya-research-carrier-'));
  setPluginRuntimeStateForTests({
    installedPluginIds: ['platform'],
    enabledPluginIds: ['platform'],
  });
  installRecoveryModelFixture();
});
afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
  for (const close of closers.splice(0).reverse()) close();
  resetAgentRuntimeSingletonsForTest();
  clearPluginRuntimeStateForTests();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
async function open(turns: Parameters<typeof createDurableFlowHarness>[1]) {
  const fixture = await createDurableFlowHarness(join(directory, 'workspace.sqlite'), turns);
  closers.push(fixture.close);
  return fixture;
}
type Fixture = Awaited<ReturnType<typeof open>>;
async function close(fixture: Fixture) {
  await new Promise(resolve => setTimeout(resolve, 0));
  fixture.close();
  closers.pop();
  resetAgentRuntimeSingletonsForTest();
}
async function paused(fixture: Fixture) {
  const root = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
  if (!root || root.status !== 'paused' || !root.pause?.settled || !root.execution_id)
    throw new Error(`Expected settled pause: ${JSON.stringify(root)}`);
  return { ...root, pause: root.pause, execution_id: root.execution_id };
}
async function continueRoot(fixture: Fixture) {
  const root = await paused(fixture);
  await fixture.flow.continueRun(
    root.run_id,
    {
      conversation_id: conversationId,
      expected_execution_id: root.execution_id,
      expected_updated_at: root.pause.updated_at,
    },
    () => {}
  );
  return root;
}
async function project(fixture: Fixture) {
  const projectId = new WorkspaceService(fixture.db).createProject('Synthetic research');
  await fixture.eventStore.ensureConversation(conversationId, [], projectId, 'agent');
  return projectId;
}
async function facts(fixture: Fixture) {
  return (await fixture.eventStore.readEvents(conversationId, { limit: 1000 })).events;
}
async function parentCall(fixture: Fixture) {
  const decision = (await facts(fixture)).find(
    event => event.type === 'tool_call_decision' && event.tool_name === RESEARCH_CARRIER_TOOL
  );
  if (!decision || decision.type !== 'tool_call_decision')
    throw new Error('Missing parent decision');
  return decision;
}
async function assertCompleteTree(fixture: Fixture, parentRunId: string) {
  const children = (
    await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(parentRunId) })
  ).runs;
  expect(children).toHaveLength(4);
  expect(children.every(child => child.status === 'completed')).toBe(true);
  const events = await facts(fixture);
  const outputs = events.filter(
    event => event.type === 'tool_output' && event.tool_name === RESEARCH_CARRIER_TOOL
  );
  expect(outputs).toHaveLength(1);
  expect(
    events.filter(
      event => event.type === 'tool_call_decision' && event.tool_name === RESEARCH_CARRIER_TOOL
    )
  ).toHaveLength(1);
  expect(
    events.filter(
      event => event.type === 'tool_output' && event.tool_call_id === 'carrier-draft-write'
    )
  ).toHaveLength(1);
  expect(
    events.find(
      event => event.type === 'tool_output' && event.tool_call_id === 'carrier-draft-write'
    )
  ).toMatchObject({ status: 'success' });
  const window = readTail(fixture.db, conversationId, 100);
  if (window.status !== 'ready') throw new Error('Missing reload projection');
  expect(window.messages.filter(message => message.message_type === 'tool_calls')).toHaveLength(1);
  expect(window.messages.find(message => message.message_type === 'tool_calls')).toMatchObject({
    payload: { status: 'success' },
  });
  const decision = await parentCall(fixture);
  for (const slot of ['draft', 'argument_review', 'source_review', 'final']) {
    const trace = readSubrunTrace(
      fixture.db,
      conversationId,
      decision.tool_call_id,
      `${decision.tool_call_id}_${slot}`
    );
    if (trace.status !== 'ready') throw new Error('Missing child trace projection');
    expect(trace.events.filter(event => event.kind === 'final_answer')).toHaveLength(1);
  }
  expect(
    fixture.db.prepare("SELECT id FROM workspace_nodes WHERE name = 'synthetic-note.md'").all()
  ).toHaveLength(1);
  expect((await fixture.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
  fixture.ai.assertAllTurnsConsumed();
}

async function crashAt(boundary: CarrierBoundary, projectId: string) {
  return new Promise<{ signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--pool=threads',
        '--maxWorkers=1',
        'src/app-hosts/linnya/adapters/flow/__test-helpers__/researchCarrierCrash.fixture.test.ts',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LINNYA_CARRIER_CRASH_DB: join(directory, 'workspace.sqlite'),
          LINNYA_CARRIER_CRASH_PROJECT: projectId,
          LINNYA_CARRIER_CRASH_BOUNDARY: boundary,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    // 超时发 SIGTERM，不能冒充夹具在指定边界自发 SIGKILL。
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, 20_000);
    child.stdout.on('data', chunk => {
      output = (output + String(chunk)).slice(-20_000);
    });
    child.stderr.on('data', chunk => {
      output = (output + String(chunk)).slice(-20_000);
    });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (_code, signal) => {
      clearTimeout(timeout);
      resolve({ signal, output });
    });
  });
}

describe('Host research carrier through SQLite and published Linnkit', () => {
  it('未声明恢复 owner 的父工具保持受阻，不因含有 child 就推断可重入', async () => {
    class UnknownOwnerCarrier extends ResearchCarrierFixtureTool {
      override readonly name = 'unknown_owner_carrier';
    }
    const first = await open(researchCarrierDraftTurns);
    const projectId = await project(first);
    const tool = new UnknownOwnerCarrier(async () => {
      throw new graph.RunRecoveryBlockedError('Interrupted before next admission');
    });
    installResearchCarrierFixture(tool);
    const request = researchCarrierRequest(projectId);
    await first.flow.next(
      {
        ...request,
        options: {
          ...request.options,
          host_tool_call: {
            tool_name: tool.name,
            args: {},
            completion_mode: 'yield_after_batch',
          },
        },
      },
      () => {}
    );
    const original = await paused(first);
    await close(first);
    const resumed = await open([]);
    const unowned = new UnknownOwnerCarrier();
    installResearchCarrierFixture(unowned);
    await continueRoot(resumed);
    expect((await paused(resumed)).pause.reason).toBe('tool_reconciliation_required');
    expect(unowned.invocations).toBe(0);
    expect(
      (await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(original.run_id) }))
        .runs
    ).toHaveLength(1);
    resumed.ai.assertAllTurnsConsumed();
  });

  it('一个父 receipt 覆盖顺序和不同职责并行阶段，完成前保持 loading', async () => {
    const fixture = await open([
      ...researchCarrierDraftTurns,
      ...['argument-read', 'source-read'].map(id => ({
        toolCalls: [
          {
            id,
            name: 'read_file',
            argumentsJson: JSON.stringify({ locator: 'workspace:/synthetic-note.md' }),
          },
        ],
      })),
      ...researchCarrierFollowingTurns,
    ]);
    const projectId = await project(fixture);
    const live: ConversationRealtimeEvent[] = [];
    let releaseReaders!: () => void;
    const bothReading = new Promise<void>(resolve => {
      releaseReaders = resolve;
    });
    const readerRuns = new Set<string>();
    class ConcurrentArtifactRead extends ReadFileTool {
      override async run(args: Record<string, unknown>, context: ToolContext): Promise<string> {
        if (!context.runId) throw new Error('Missing reviewer run identity');
        readerRuns.add(context.runId);
        if (readerRuns.size === 2) releaseReaders();
        await bothReading;
        const result = await super.run(args, context);
        expect(result).toContain('12 units');
        return result;
      }
    }
    const tool = new ResearchCarrierFixtureTool(async (boundary, context) => {
      if (!context.runId || !context.parentToolCallId) throw new Error('Missing root identity');
      expect(
        fixture.runtime.toolResults?.read(
          context.runId,
          context.parentToolCallId,
          RESEARCH_CARRIER_TOOL
        )
      ).toBeUndefined();
      expect((await fixture.flow.getActiveForegroundRun(conversationId)).run?.status).toBe(
        'running'
      );
      const window = readTail(fixture.db, conversationId, 100);
      if (window.status !== 'ready') throw new Error('Missing live parent projection');
      expect(window.messages.find(message => message.message_type === 'tool_calls')).toMatchObject({
        payload: { status: 'loading' },
      });
      const children = (await fixture.runtime.supervisor.list({ parentRunId: context.runId })).runs;
      expect(children).toHaveLength(
        boundary === 'draft_completed' ? 1 : boundary === 'reviews_completed' ? 3 : 4
      );
      for (const child of children) {
        const descriptor = await fixture.runtime.runDescriptors?.load(child.runId);
        expect(descriptor?.request.maxSteps).toBe(800);
        expect(descriptor?.child?.parentToolCallId).toBe(context.parentToolCallId);
      }
    });
    installResearchCarrierFixture(tool, [new ConcurrentArtifactRead()]);
    await fixture.flow.next(researchCarrierRequest(projectId), event => live.push(event));
    const decision = await parentCall(fixture);
    await assertCompleteTree(fixture, decision.run_id);
    expect(tool.invocations).toBe(1);
    expect(readerRuns.size).toBe(2);
    expect(
      new Set(
        fixture.ai.getCalls().map(call =>
          call.messages
            .filter(message => message.role === 'system')
            .map(message => message.content)
            .join('\n')
        )
      ).size
    ).toBeGreaterThanOrEqual(3);
    expect(live.some(event => event.type === 'subrun_trace')).toBe(true);
  });

  it.each(['draft_completed', 'before_parent_return'] as const)(
    'SIGKILL at %s preserves identities and never reruns completed children',
    async boundary => {
      const initial = await open([]);
      const projectId = await project(initial);
      await close(initial);
      const crashed = await crashAt(boundary, projectId);
      expect(crashed.signal, crashed.output).toBe('SIGKILL');
      const resumed = await open(
        boundary === 'draft_completed' ? researchCarrierFollowingTurns : []
      );
      const root = await paused(resumed);
      const originalChildren = (
        await resumed.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
      ).runs;
      expect(originalChildren).toHaveLength(boundary === 'draft_completed' ? 1 : 4);
      expect(originalChildren.every(child => child.status === 'completed')).toBe(true);
      const beforeEvents = await facts(resumed);
      const originalChildFacts = beforeEvents.filter(event =>
        originalChildren.some(child => child.runId === event.run_id)
      );
      const tool = new ResearchCarrierFixtureTool();
      installResearchCarrierFixture(tool);
      await continueRoot(resumed);
      await assertCompleteTree(resumed, root.run_id);
      expect(tool.invocations).toBe(1);
      expect(
        (await facts(resumed)).filter(event =>
          originalChildren.some(child => child.runId === event.run_id)
        )
      ).toEqual(originalChildFacts);
      expect(resumed.ai.getConsumedTurnCount()).toBe(boundary === 'draft_completed' ? 3 : 0);
    },
    30_000
  );

  it('父结果已返回但 terminal 未提交时恢复完整 receipt，不再进入工具或 child', async () => {
    const first = await open([...researchCarrierDraftTurns, ...researchCarrierFollowingTurns]);
    const projectId = await project(first);
    installResearchCarrierFixture(new ResearchCarrierFixtureTool());
    first.db.exec(`CREATE TRIGGER reject_carrier_terminal BEFORE INSERT ON events
      WHEN NEW.type = 'tool_output' AND NEW.run_id IN (SELECT id FROM runs WHERE parent_run_id IS NULL)
      BEGIN SELECT RAISE(ABORT, 'carrier terminal unavailable'); END;`);
    await expect(first.flow.next(researchCarrierRequest(projectId), () => {})).rejects.toThrow(
      'carrier terminal unavailable'
    );
    const root = await paused(first);
    const decision = await parentCall(first);
    const receipt = first.runtime.toolResults?.read(
      root.run_id,
      decision.tool_call_id,
      RESEARCH_CARRIER_TOOL
    );
    expect(receipt?.result).toContain('All fixed stages completed');
    first.db.exec('DROP TRIGGER reject_carrier_terminal');
    await close(first);
    const resumed = await open([]);
    const tool = new ResearchCarrierFixtureTool();
    installResearchCarrierFixture(tool);
    await continueRoot(resumed);
    await assertCompleteTree(resumed, root.run_id);
    expect(tool.invocations).toBe(0);
  });

  it('一个并行 review 中断保留同伴结果，恢复只继续原中断者并执行后继', async () => {
    const first = await open([
      ...researchCarrierDraftTurns,
      { throwAfterEvents: new Error('Synthetic review transport interruption') },
      { contentChunks: ['The independent companion review completed.'] },
    ]);
    const projectId = await project(first);
    installResearchCarrierFixture(new ResearchCarrierFixtureTool());
    await first.flow.next(researchCarrierRequest(projectId), () => {});
    const root = await paused(first);
    const children = (
      await first.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(root.run_id) })
    ).runs;
    expect(children).toHaveLength(3);
    expect(children.filter(child => child.status === 'paused')).toHaveLength(1);
    expect(children.filter(child => child.status === 'completed')).toHaveLength(2);
    const completedIds = children
      .filter(child => child.status === 'completed')
      .map(child => child.runId);
    const originalFacts = (await facts(first)).filter(event => completedIds.includes(event.run_id));
    await close(first);
    const resumed = await open([
      { contentChunks: ['The interrupted review now completed.'] },
      { contentChunks: ['The original chain finished after both reviews.'] },
    ]);
    installResearchCarrierFixture(new ResearchCarrierFixtureTool());
    await continueRoot(resumed);
    await assertCompleteTree(resumed, root.run_id);
    expect((await facts(resumed)).filter(event => completedIds.includes(event.run_id))).toEqual(
      originalFacts
    );
  });

  it('cancel 在已完成文稿后阻止所有后继阶段，重载保留范围', async () => {
    const fixture = await open(researchCarrierDraftTurns);
    const projectId = await project(fixture);
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    installResearchCarrierFixture(
      new ResearchCarrierFixtureTool(async (point, context) => {
        if (point !== 'draft_completed') return;
        const signal = context.abortSignal;
        if (!signal) throw new Error('Missing parent abort signal');
        entered();
        await new Promise<void>(resolve =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
      })
    );
    const running = fixture.flow.next(researchCarrierRequest(projectId), () => {});
    await started;
    const active = (await fixture.flow.getActiveForegroundRun(conversationId)).run;
    if (!active) throw new Error('Missing running parent');
    await fixture.flow.cancelRun(active.run_id, conversationId, 'fixture user cancellation');
    await running;
    expect(
      (await fixture.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(active.run_id) }))
        .runs
    ).toHaveLength(1);
    expect((await fixture.runtime.supervisor.peek(RunIdSchema.parse(active.run_id)))?.status).toBe(
      'cancelled'
    );
    fixture.ai.assertAllTurnsConsumed();
    await close(fixture);
    const reloaded = await open([]);
    expect(
      (await reloaded.runtime.supervisor.list({ parentRunId: RunIdSchema.parse(active.run_id) }))
        .runs
    ).toHaveLength(1);
    expect((await reloaded.flow.getActiveForegroundRun(conversationId)).run).toBeNull();
    expect(readTail(reloaded.db, conversationId, 100).status).toBe('ready');
    reloaded.ai.assertAllTurnsConsumed();
  });
});
