import { readdirSync, readFileSync, mkdirSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  LOCAL_CI_DEFAULT_CONCURRENCY,
  LOCAL_CI_STEP_KIND_REASON,
  LOCAL_CI_TEST_WORKER_HEADROOM,
} from '../definitions/localCiSchedule';
import { buildLocalCiLanes } from '../functions/buildLocalCiLanes';
import { buildLocalCiPlan, type ParsedWorkflow } from '../functions/buildLocalCiPlan';
import { resolveLocalCiParallelism, type LocalCiParallelism } from '../functions/pickLocalCiStarts';
import { prepareLocalCiCheckout, pruneOrphanedLocalCiCheckouts } from '../orchestration/prepareLocalCiCheckout';
import { pruneLocalCiRuns } from '../orchestration/pruneLocalCiRuns';
import { LOCAL_CI_KEEP_RUNS, LOCAL_CI_RECEIPT_KEEP_DAYS } from '../definitions/localCiRetention';
import {
  collectLocalCiEvidence,
  readLogTail,
  runLocalCiPlan,
  writeLocalCiSummary,
  type LocalCiRunOutcome,
} from '../orchestration/runLocalCiPlan';

const USAGE = `用法：pnpm run ci:local [选项]

按 .github/workflows 在本机 macOS 上跑 CI 步骤；失败不停，最后汇总。
  --list                只列出计划与调度类别，不执行
  --workflow <文件>     只跑这个工作流（可重复，如 ci.yml 或 ci）
  --job <任务 id>       只跑这个任务（可重复，如 architecture）
  --working-copy        把 Git 可见的未提交改动带入临时检出，用于开发期快速检查
  --in-place            直接在当前目录跑（含未提交改动，但会受本地残留影响）
  --keep                保留临时干净检出，便于排查
  --concurrency <n>     同时运行的步骤上限（默认 ${LOCAL_CI_DEFAULT_CONCURRENCY}；1 为逐步执行）
                        环境变量 LINNYA_CI_LOCAL_CONCURRENCY
  --test-workers <n>    合并后测试运行的 vitest worker 数（默认 核数-${LOCAL_CI_TEST_WORKER_HEADROOM}，至少 2）
                        环境变量 LINNYA_CI_LOCAL_TEST_WORKERS
  --help                显示本说明`;

interface Options {
  readonly list: boolean;
  readonly inPlace: boolean;
  readonly workingCopy?: boolean;
  readonly keep: boolean;
  readonly workflows: string[];
  readonly jobs: string[];
  readonly concurrency?: string;
  readonly testWorkers?: string;
}

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = { list: false, inPlace: false, keep: false, workflows: [], jobs: [] };
  const mutable = options as { -readonly [K in keyof Options]: Options[K] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return null;
    else if (arg === '--list') mutable.list = true;
    else if (arg === '--working-copy') mutable.workingCopy = true;
    else if (arg === '--in-place') mutable.inPlace = true;
    else if (arg === '--keep') mutable.keep = true;
    else if ((arg === '--concurrency' || arg === '--test-workers') && argv[index + 1]) {
      mutable[arg === '--concurrency' ? 'concurrency' : 'testWorkers'] = argv[index + 1]!;
      index += 1;
    } else if ((arg === '--workflow' || arg === '--job') && argv[index + 1]) {
      (arg === '--workflow' ? options.workflows : options.jobs).push(argv[index + 1]!);
      index += 1;
    } else throw new Error(`无法识别的参数：${arg}\n\n${USAGE}`);
  }
  if (options.workingCopy && options.inPlace) throw new Error('--working-copy 与 --in-place 不能同时使用');
  return options;
}

function readWorkflows(root: string): ParsedWorkflow[] {
  const directory = path.join(root, '.github/workflows');
  return readdirSync(directory)
    .filter(file => /\.ya?ml$/u.test(file))
    .sort()
    .map(file => ({ file, document: YAML.parse(readFileSync(path.join(directory, file), 'utf8')) }));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-').slice(0, 19);
}

function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function printPlan(plan: ReturnType<typeof buildLocalCiPlan>, parallelism: LocalCiParallelism): void {
  console.log(`并行上限 ${parallelism.concurrency}，合并测试 worker ${parallelism.testWorkers}`);
  for (const lane of buildLocalCiLanes(plan, parallelism)) {
    console.log(`\n${lane.label}`);
    for (const unit of lane.units) {
      const step = plan.steps[unit.steps[0]!]!;
      const tag = step.localSkip
        ? `跳过（${step.localSkip}）`
        : `${unit.kind}${unit.declared ? '' : '（未声明）'}${step.condition ? `，条件 ${step.condition}` : ''}`;
      console.log(`  - ${step.name}  ${tag}`);
      if (unit.shardMerge) {
        console.log(`      合并 ${unit.shardMerge.shards.map(shard => `${shard}/${unit.shardMerge!.total}`).join('、')}：${unit.command}`);
      }
    }
  }
  for (const job of plan.skippedJobs) console.log(`\n跳过任务 ${job.workflow}/${job.job}：${job.reason}`);
}

function undeclaredSteps(plan: ReturnType<typeof buildLocalCiPlan>, parallelism: LocalCiParallelism): string[] {
  return buildLocalCiLanes(plan, parallelism)
    .flatMap(lane => lane.units)
    .filter(unit => !unit.declared && !plan.steps[unit.steps[0]!]!.localSkip)
    .map(unit => {
      const step = plan.steps[unit.steps[0]!]!;
      return `${step.workflow}/${step.job} › ${step.name}`;
    });
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(USAGE);
    return 0;
  }
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const plan = buildLocalCiPlan(readWorkflows(repositoryRoot), { workflows: options.workflows, jobs: options.jobs });
  const parallelism = resolveLocalCiParallelism({
    cores: os.availableParallelism(),
    headroom: LOCAL_CI_TEST_WORKER_HEADROOM,
    defaultConcurrency: LOCAL_CI_DEFAULT_CONCURRENCY,
    concurrency: options.concurrency ?? process.env.LINNYA_CI_LOCAL_CONCURRENCY,
    testWorkers: options.testWorkers ?? process.env.LINNYA_CI_LOCAL_TEST_WORKERS,
  });
  if (options.list) {
    printPlan(plan, parallelism);
    return 0;
  }
  if (!plan.steps.some(step => !step.localSkip)) {
    console.log('没有可执行的步骤，检查 --workflow / --job。');
    return 1;
  }

  const pruned = pruneOrphanedLocalCiCheckouts(repositoryRoot);
  if (pruned.length) console.log(`已回收 ${pruned.length} 份被强制结束的运行留下的检出`);
  const checkout = prepareLocalCiCheckout(repositoryRoot, { inPlace: options.inPlace, keep: options.keep, workingCopy: options.workingCopy });
  const fullScope = !options.workingCopy && options.workflows.length === 0 && options.jobs.length === 0;
  const logDirectory = path.join(repositoryRoot, '_dev_data/ci-local', timestamp());
  mkdirSync(logDirectory, { recursive: true });
  // 本次目录已建好，算在最近 N 个之内；清理失败只提示，不影响这次运行。
  try {
    const removed = pruneLocalCiRuns(repositoryRoot, { currentTree: checkout.tree });
    if (removed.length) {
      console.log(`已清理 ${removed.length} 份旧的本地 CI 结果（保留最近 ${LOCAL_CI_KEEP_RUNS} 份、${LOCAL_CI_RECEIPT_KEEP_DAYS} 天内通过的完整回执，以及各 worktree 当前 HEAD 的最新回执）`);
    }
  } catch (error) {
    console.log(`清理旧的本地 CI 结果失败（已忽略）：${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`本地 CI：提交 ${checkout.commit.slice(0, 9)}，${options.inPlace ? '当前目录' : `${checkout.clean ? '干净检出' : '含工作副本改动的临时检出'} ${checkout.root}`}`);
  if (checkout.clean && checkout.uncommitted.length) {
    console.log(`注意：有 ${checkout.uncommitted.length} 个未提交改动，干净检出不包含它们（CI 也只看提交）；要带上请先提交或用 --in-place。`);
  }
  console.log(`并行上限 ${parallelism.concurrency}，合并测试 worker ${parallelism.testWorkers}（--concurrency / --test-workers 可调）`);
  const undeclared = undeclaredSteps(plan, parallelism);
  if (undeclared.length) {
    console.log(`以下步骤没有声明调度类别，按${LOCAL_CI_STEP_KIND_REASON.loadSensitive}（请补到 definitions/localCiSchedule.ts）：`);
    for (const item of undeclared) console.log(`  - ${item}`);
  }
  console.log(`日志：${logDirectory}\n`);

  const controller = new AbortController();
  const interrupt = () => {
    console.log('\n收到中断，停止当前步骤并清理…');
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('SIGHUP', interrupt);
  const started = Date.now();
  let outcome: LocalCiRunOutcome = { results: [], mergedTestRuns: [] };
  // 调度本身出错时没有完整结果，不能写出“通过”的回执。
  let completed = false;
  try {
    outcome = await runLocalCiPlan(plan, {
      root: checkout.root,
      logDirectory,
      // 只跨干净检出保留锁定的下载包，每轮仍在自己的 extraResources 解包并验收。
      env: {
        LINNYA_RUNTIME_ARCHIVE_CACHE_DIR: path.join(repositoryRoot, '_dev_data', 'ci-local', 'runtime-archives'),
        // 两个任务共用这次临时检出。定向、工作副本和原地运行仍各自从头打包。
        LINNYA_CI_ARTIFACT_CHECKOUT: checkout.clean && fullScope ? realpathSync(checkout.root) : '',
      },
      signal: controller.signal,
      concurrency: parallelism.concurrency,
      testWorkers: parallelism.testWorkers,
      onStart: event => console.log(`… [${formatClock(event.elapsedMs)}] ${event.label} › ${event.step.name}  (${event.unit.kind})`),
      onStep: (result, step) => {
        if (result.outcome === 'skipped') return;
        const mark = result.outcome === 'success' ? '✓' : '✗';
        const note = result.note ? `（${result.note}）` : '';
        const clock = formatClock(Date.now() - started);
        console.log(`${mark} [${clock}] ${step.jobLabel} › ${step.name}  ${formatDuration(result.durationMs)}${note}`);
        if (result.outcome === 'failure' && result.log && !result.reusedFrom) {
          console.log(readLogTail(result.log, 25).replace(/^/gmu, '    '));
          console.log(`    完整日志：${result.log}`);
        }
      },
    });
    completed = true;
  } finally {
    const { results, mergedTestRuns } = outcome;
    const evidence = !options.inPlace ? collectLocalCiEvidence(plan, results, checkout.root, logDirectory) : [];
    // 复用别的步骤结果（去重、合并分片）的失败只算一次：算在真正执行的那一步上。
    const failures = results.filter(result => result.outcome === 'failure' && !result.reusedFrom);
    const summaryFile = writeLocalCiSummary(logDirectory, {
      commit: checkout.commit,
      tree: checkout.tree,
      clean: checkout.clean,
      // 只有不加 --workflow / --job、计划里每一步都有结果的干净检出才代表“全部 CI 在这份代码上通过”。
      // 测试分片只在覆盖 1..N 每一片时才合并，覆盖记录见 mergedTestRuns。
      fullRun: fullScope && results.length === plan.steps.length,
      passed: completed && failures.length === 0 && !controller.signal.aborted,
      durationMs: Date.now() - started,
      interrupted: controller.signal.aborted,
      schedule: { cores: os.availableParallelism(), ...parallelism },
      results,
      mergedTestRuns,
      skippedJobs: plan.skippedJobs,
      evidence,
    });
    if (!options.inPlace && !options.keep) checkout.remove();
    else if (!options.inPlace) console.log(`\n已保留临时检出：${checkout.root}（用完请 git worktree remove --force 回收）`);

    const passed = results.filter(result => result.outcome === 'success').length;
    const skipped = results.filter(result => result.outcome === 'skipped');
    console.log(`\n用时 ${formatDuration(Date.now() - started)}：通过 ${passed}，失败 ${failures.length}，跳过 ${skipped.length}`);
    for (const failure of failures) console.log(`  ✗ ${failure.jobLabel} › ${failure.name}\n    ${failure.log}`);
    for (const run of mergedTestRuns) {
      const totals = [run.testFiles && `Test Files ${run.testFiles}`, run.tests && `Tests ${run.tests}`].filter(Boolean).join('；');
      console.log(`测试分片 ${run.shards.map(shard => `${shard}/${run.total}`).join('、')} 合并为一次运行（${formatDuration(run.durationMs)}）${totals ? `：${totals}` : ''}`);
    }
    const notLocal = [...new Set(skipped.filter(result => result.note?.startsWith('本地无法判断')).map(result => `${result.jobLabel} › ${result.name}`))];
    if (notLocal.length) console.log(`本地无法判断、未执行：\n${notLocal.map(item => `  - ${item}`).join('\n')}`);
    if (plan.skippedJobs.length) {
      console.log(`只能由 GitHub 验证：\n${plan.skippedJobs.map(job => `  - ${job.workflow}/${job.job}：${job.reason}`).join('\n')}`);
    }
    if (evidence.length) console.log(`失败证据已复制到：${path.join(logDirectory, 'evidence')}`);
    console.log(`汇总：${summaryFile}`);
    process.exitCode = completed && !failures.length && !controller.signal.aborted ? 0 : 1;
  }
  return process.exitCode ?? 0;
}

main().then(
  code => {
    process.exitCode = code;
  },
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
);
