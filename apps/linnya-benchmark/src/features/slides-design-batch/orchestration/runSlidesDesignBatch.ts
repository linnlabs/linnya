import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkCaseDefinition, ResolvedBenchmarkCase } from '../../../definitions/benchmarkCase';
import { runBenchmarkCase } from '../../../orchestration/runBenchmarkCase';
import {
  SlidesDesignBatchManifestSchema,
  type SlidesDesignBatchCliPort,
  type SlidesDesignBatchManifest,
  type SlidesDesignBatchRunState,
  type SlidesDesignBatchState,
} from '../definitions/slidesDesignBatch';

export interface RunSlidesDesignBatchRequest {
  readonly manifestFile: string;
  readonly output: string;
  readonly cli: SlidesDesignBatchCliPort;
  readonly onProgress?: (run: SlidesDesignBatchRunState) => void;
}

const STATE_FILE = 'batch.json';

function briefCase(manifest: SlidesDesignBatchManifest, brief: SlidesDesignBatchManifest['briefs'][number]): ResolvedBenchmarkCase {
  const definition: BenchmarkCaseDefinition = {
    id: `slides_design_batch.${brief.key}`,
    revision: 1,
    name: `${manifest.name} · ${brief.key}`,
    description: 'Slides 设计基准的一份简报。',
    tags: ['slides', 'design-benchmark'],
    agentId: manifest.agent,
    reasoningEffort: manifest.reasoning,
    timeoutMs: manifest.timeout_minutes * 60 * 1000,
    promptTemplate: brief.prompt,
    inputs: [],
    interaction: { awaitingUser: 'approve', maxResponses: manifest.max_approvals },
    artifactExpectation: '一份完成的 Slides 文稿。',
    humanReview: [],
  };
  return { definition, prompt: brief.prompt, inputs: {} };
}

function initialState(manifest: SlidesDesignBatchManifest, manifestFile: string): SlidesDesignBatchState {
  return {
    schema_version: 1,
    name: manifest.name,
    manifestFile,
    agent: manifest.agent,
    ...(manifest.model ? { model: manifest.model } : {}),
    reasoning: manifest.reasoning,
    runs: manifest.briefs.flatMap(brief =>
      Array.from({ length: brief.runs }, (_, offset) => ({
        runKey: `${brief.key}-${offset + 1}`,
        briefKey: brief.key,
        index: offset + 1,
        status: 'pending' as const,
      })),
    ),
  };
}

/** 续跑：保留已完成与已发出的试跑；中断时仍在跑的标为 interrupted，不重发。 */
function resumeState(previous: SlidesDesignBatchState, fresh: SlidesDesignBatchState): SlidesDesignBatchState {
  const keys = (state: SlidesDesignBatchState) => state.runs.map(run => run.runKey).join(',');
  if (keys(previous) !== keys(fresh)) {
    throw new Error('Existing batch.json does not match the manifest runs; use a new --output directory');
  }
  return {
    ...previous,
    runs: previous.runs.map(run => (run.status === 'running' ? { ...run, status: 'interrupted' as const } : run)),
  };
}

async function readState(file: string): Promise<SlidesDesignBatchState | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as SlidesDesignBatchState;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function runSlidesDesignBatch(request: RunSlidesDesignBatchRequest): Promise<SlidesDesignBatchState> {
  const manifestFile = path.resolve(request.manifestFile);
  const manifest = SlidesDesignBatchManifestSchema.parse(JSON.parse(await readFile(manifestFile, 'utf8')));
  const output = path.resolve(request.output);
  await mkdir(path.join(output, 'runs'), { recursive: true });
  const stateFile = path.join(output, STATE_FILE);
  const fresh = initialState(manifest, manifestFile);
  const previous = await readState(stateFile);
  let state = previous ? resumeState(previous, fresh) : fresh;

  // 并发试跑共用一份状态；每次更新后整体落盘，runner 中途退出也能续跑。
  let writing = Promise.resolve();
  const update = (runKey: string, patch: Partial<SlidesDesignBatchRunState>) => {
    state = { ...state, runs: state.runs.map(run => (run.runKey === runKey ? { ...run, ...patch } : run)) };
    const snapshot = JSON.stringify(state, null, 2);
    writing = writing.then(async () => {
      await writeFile(`${stateFile}.tmp`, snapshot);
      await rename(`${stateFile}.tmp`, stateFile);
    });
    const run = state.runs.find(candidate => candidate.runKey === runKey);
    if (run) request.onProgress?.(run);
    return writing;
  };
  await update(state.runs[0]!.runKey, {});

  const queue = state.runs.filter(run => run.status === 'pending').map(run => run.runKey);
  const briefs = new Map(manifest.briefs.map(brief => [brief.key, brief]));

  async function execute(runKey: string): Promise<void> {
    const run = state.runs.find(candidate => candidate.runKey === runKey)!;
    const brief = briefs.get(run.briefKey)!;
    try {
      const projectId = run.projectId ?? (await request.cli.createProject(`${manifest.name} ${runKey}`)).projectId;
      await update(runKey, { projectId, status: 'running' });
      // 发出即记下会话身份；runner 中途退出时，interrupted 的试跑仍能按身份核对。
      const cli: SlidesDesignBatchCliPort = {
        ...request.cli,
        send: async sendRequest => {
          const receipt = await request.cli.send(sendRequest);
          await update(runKey, { conversationId: receipt.conversation_id, runId: receipt.run_id });
          return receipt;
        },
      };
      const facts = await runBenchmarkCase(
        { benchmark: briefCase(manifest, brief), projectId, modelId: manifest.model, reasoningEffort: manifest.reasoning },
        { cli },
      );
      const factsFile = path.join('runs', `${runKey}.facts.json`);
      await writeFile(path.join(output, factsFile), `${JSON.stringify(facts, null, 2)}\n`);
      await update(runKey, {
        status: 'finished',
        outcome: facts.outcome,
        durationMs: facts.durationMs,
        factsFile,
        ...(facts.receipt ? { conversationId: facts.receipt.conversation_id, runId: facts.receipt.run_id } : {}),
        ...(facts.errors.length > 0 ? { error: facts.errors.map(error => `${error.stage}: ${error.message}`).join('; ') } : {}),
      });
    } catch (error: unknown) {
      await update(runKey, {
        status: 'finished',
        outcome: 'runner_failed',
        error: error instanceof Error ? error.message : 'Unknown batch runner error',
      });
    }
  }

  const workers = Array.from({ length: Math.min(manifest.concurrency, queue.length) }, async () => {
    for (let runKey = queue.shift(); runKey; runKey = queue.shift()) {
      await execute(runKey);
    }
  });
  await Promise.all(workers);
  await writing;
  return state;
}
