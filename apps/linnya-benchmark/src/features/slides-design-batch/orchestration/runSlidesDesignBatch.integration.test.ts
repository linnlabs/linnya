import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BenchmarkRunFacts, RunBenchmarkCaseRequest } from '../../../definitions/benchmarkRun';
import type { SlidesDesignBatchCliPort, SlidesDesignBatchState } from '../definitions/slidesDesignBatch';

const runBenchmarkCase = vi.hoisted(() => vi.fn());
vi.mock('../../../orchestration/runBenchmarkCase', () => ({ runBenchmarkCase }));

const { runSlidesDesignBatch } = await import('./runSlidesDesignBatch');

function facts(request: RunBenchmarkCaseRequest): BenchmarkRunFacts {
  return {
    schemaVersion: 1,
    benchmark: { id: request.benchmark.definition.id, revision: 1, name: 'n', tags: [], artifactExpectation: '' },
    configuration: {
      projectId: request.projectId,
      agentId: request.benchmark.definition.agentId,
      reasoningEffort: 'high',
      timeoutMs: request.benchmark.definition.timeoutMs,
      inputs: {},
    },
    startedAt: 0,
    finishedAt: 10,
    durationMs: 10,
    outcome: 'completed',
    receipt: {
      conversation_id: `conversation-${request.projectId}`,
      user_message_id: 'message',
      turn_id: 'turn',
      run_id: `run-${request.projectId}`,
      execution_id: 'execution',
      agent_id: 'slides_agent',
      accepted_at: 0,
    },
    statusFrames: [],
    interactionResponses: [],
    audit: { status: 'not_requested' },
    errors: [],
  };
}

function cli(): SlidesDesignBatchCliPort & { readonly created: string[] } {
  const created: string[] = [];
  const unused = () => Promise.reject(new Error('runBenchmarkCase is mocked'));
  return {
    created,
    async createProject(name) {
      created.push(name);
      return { projectId: `project-${created.length}` };
    },
    send: unused,
    watchStatus: unused,
    approve: unused,
    stop: unused,
    result: unused,
    messages: unused,
    audit: unused,
  };
}

describe('runSlidesDesignBatch', () => {
  let directory: string;
  let manifestFile: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'slides-design-batch-'));
    manifestFile = path.join(directory, 'manifest.json');
    await writeFile(
      manifestFile,
      JSON.stringify({
        schema_version: 1,
        name: 'batch one',
        model: 'model-1',
        concurrency: 2,
        briefs: [
          { key: 'bronze', prompt: '青铜器', runs: 2 },
          { key: 'photo', prompt: '光合作用', runs: 1 },
        ],
      }),
    );
    runBenchmarkCase.mockReset();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('runs every brief in a fresh project and records facts for each run', async () => {
    let active = 0;
    let peak = 0;
    // 运行停在这里直到第二个也开始，峰值不受机器快慢影响；若实现只能串行，2 秒后放行，峰值为 1，断言照样失败。
    let releaseConcurrentPair = () => {};
    const concurrentPair = new Promise<void>(resolve => {
      releaseConcurrentPair = resolve;
    });
    runBenchmarkCase.mockImplementation(async (request: RunBenchmarkCaseRequest) => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 2) releaseConcurrentPair();
      await Promise.race([concurrentPair, new Promise(resolve => setTimeout(resolve, 2_000))]);
      active -= 1;
      return facts(request);
    });
    const port = cli();
    const output = path.join(directory, 'out');

    const state = await runSlidesDesignBatch({ manifestFile, output, cli: port });

    expect(port.created).toHaveLength(3);
    expect(peak).toBe(2);
    expect(state.runs.map(run => [run.runKey, run.status, run.outcome])).toEqual([
      ['bronze-1', 'finished', 'completed'],
      ['bronze-2', 'finished', 'completed'],
      ['photo-1', 'finished', 'completed'],
    ]);
    const first = runBenchmarkCase.mock.calls[0]![0] as RunBenchmarkCaseRequest;
    expect(first.modelId).toBe('model-1');
    expect(first.benchmark.prompt).toBe('青铜器');
    expect(first.benchmark.definition.interaction).toEqual({ awaitingUser: 'approve', maxResponses: 4 });
    const saved = JSON.parse(await readFile(path.join(output, 'batch.json'), 'utf8')) as SlidesDesignBatchState;
    expect(saved.runs.every(run => run.factsFile && run.conversationId)).toBe(true);
    await expect(readFile(path.join(output, 'runs', 'photo-1.facts.json'), 'utf8')).resolves.toContain('"completed"');
  });

  it('resumes without resending runs that were in flight', async () => {
    const output = path.join(directory, 'out');
    runBenchmarkCase.mockImplementation(async (request: RunBenchmarkCaseRequest) => facts(request));
    await runSlidesDesignBatch({ manifestFile, output, cli: cli() });
    const saved = JSON.parse(await readFile(path.join(output, 'batch.json'), 'utf8')) as SlidesDesignBatchState;
    await writeFile(
      path.join(output, 'batch.json'),
      JSON.stringify({
        ...saved,
        runs: saved.runs.map((run, index) =>
          index === 0 ? { ...run, status: 'running', outcome: undefined } : index === 1 ? { runKey: run.runKey, briefKey: run.briefKey, index: run.index, status: 'pending' } : run,
        ),
      }),
    );
    runBenchmarkCase.mockClear();
    const port = cli();

    const state = await runSlidesDesignBatch({ manifestFile, output, cli: port });

    expect(state.runs.map(run => run.status)).toEqual(['interrupted', 'finished', 'finished']);
    expect(runBenchmarkCase).toHaveBeenCalledTimes(1);
    expect(port.created).toEqual(['batch one bronze-2']);
  });

  it('records the conversation identity as soon as the message is accepted', async () => {
    const output = path.join(directory, 'out');
    const seen: (string | undefined)[] = [];
    runBenchmarkCase.mockImplementation(async (request: RunBenchmarkCaseRequest, options: { cli: SlidesDesignBatchCliPort }) => {
      const receipt = facts(request).receipt!;
      await options.cli.send({ message: 'm', projectId: request.projectId, agentId: 'slides_agent', reasoningEffort: 'high' });
      const saved = JSON.parse(await readFile(path.join(output, 'batch.json'), 'utf8')) as SlidesDesignBatchState;
      seen.push(saved.runs.find(run => run.projectId === request.projectId)?.conversationId);
      expect(receipt.conversation_id).toBe(`conversation-${request.projectId}`);
      return facts(request);
    });
    const port = cli();
    const accepting: SlidesDesignBatchCliPort = {
      ...port,
      async send(request) {
        return { ...facts({ projectId: request.projectId, benchmark: { definition: { id: 'x', agentId: 'slides_agent', timeoutMs: 1 } } } as RunBenchmarkCaseRequest).receipt! };
      },
    };

    await runSlidesDesignBatch({ manifestFile, output, cli: accepting });

    expect([...seen].sort()).toEqual(['conversation-project-1', 'conversation-project-2', 'conversation-project-3']);
  });

  it('keeps going when one run fails before the conversation starts', async () => {
    runBenchmarkCase.mockImplementation(async (request: RunBenchmarkCaseRequest) => facts(request));
    const port = cli();
    let calls = 0;
    const failing: SlidesDesignBatchCliPort = {
      ...port,
      async createProject(name) {
        calls += 1;
        if (calls === 1) throw new Error('project service unavailable');
        return port.createProject(name);
      },
    };

    const state = await runSlidesDesignBatch({ manifestFile, output: path.join(directory, 'out'), cli: failing });

    expect(state.runs.filter(run => run.outcome === 'runner_failed')).toHaveLength(1);
    expect(state.runs.filter(run => run.outcome === 'completed')).toHaveLength(2);
  });
});
