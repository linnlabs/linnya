import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildLocalCiPlan, type ParsedWorkflow } from '../functions/buildLocalCiPlan';
import { prepareLocalCiCheckout } from '../orchestration/prepareLocalCiCheckout';
import {
  collectLocalCiEvidence,
  readLogTail,
  runLocalCiPlan,
  writeLocalCiSummary,
  type LocalCiStepResult,
} from '../orchestration/runLocalCiPlan';

const USAGE = `用法：pnpm run ci:local [选项]

按 .github/workflows 在本机 macOS 上跑 CI 步骤；失败不停，最后汇总。
  --list              只列出计划，不执行
  --workflow <文件>   只跑这个工作流（可重复，如 ci.yml 或 ci）
  --job <任务 id>     只跑这个任务（可重复，如 architecture）
  --in-place          直接在当前目录跑（含未提交改动，但会受本地残留影响）
  --keep              保留临时干净检出，便于排查
  --help              显示本说明`;

interface Options {
  readonly list: boolean;
  readonly inPlace: boolean;
  readonly keep: boolean;
  readonly workflows: string[];
  readonly jobs: string[];
}

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = { list: false, inPlace: false, keep: false, workflows: [], jobs: [] };
  const mutable = options as { -readonly [K in keyof Options]: Options[K] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return null;
    else if (arg === '--list') mutable.list = true;
    else if (arg === '--in-place') mutable.inPlace = true;
    else if (arg === '--keep') mutable.keep = true;
    else if ((arg === '--workflow' || arg === '--job') && argv[index + 1]) {
      (arg === '--workflow' ? options.workflows : options.jobs).push(argv[index + 1]!);
      index += 1;
    } else throw new Error(`无法识别的参数：${arg}\n\n${USAGE}`);
  }
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

function printPlan(plan: ReturnType<typeof buildLocalCiPlan>): void {
  let lastJob = '';
  for (const step of plan.steps) {
    if (step.jobLabel !== lastJob) {
      console.log(`\n${step.jobLabel}`);
      lastJob = step.jobLabel;
    }
    const tag = step.localSkip ? `跳过（${step.localSkip}）` : step.condition ? `条件 ${step.condition}` : '执行';
    console.log(`  - ${step.name}  ${tag}`);
  }
  for (const job of plan.skippedJobs) console.log(`\n跳过任务 ${job.workflow}/${job.job}：${job.reason}`);
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(USAGE);
    return 0;
  }
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const plan = buildLocalCiPlan(readWorkflows(repositoryRoot), { workflows: options.workflows, jobs: options.jobs });
  if (options.list) {
    printPlan(plan);
    return 0;
  }
  if (!plan.steps.some(step => !step.localSkip)) {
    console.log('没有可执行的步骤，检查 --workflow / --job。');
    return 1;
  }

  const checkout = prepareLocalCiCheckout(repositoryRoot, { inPlace: options.inPlace });
  const logDirectory = path.join(repositoryRoot, '_dev_data/ci-local', timestamp());
  mkdirSync(logDirectory, { recursive: true });
  console.log(`本地 CI：提交 ${checkout.commit.slice(0, 9)}，${checkout.clean ? `干净检出 ${checkout.root}` : '当前目录'}`);
  if (checkout.clean && checkout.uncommitted.length) {
    console.log(`注意：有 ${checkout.uncommitted.length} 个未提交改动，干净检出不包含它们（CI 也只看提交）；要带上请先提交或用 --in-place。`);
  }
  console.log(`日志：${logDirectory}\n`);

  const controller = new AbortController();
  const interrupt = () => {
    console.log('\n收到中断，停止当前步骤并清理…');
    controller.abort();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const started = Date.now();
  let results: readonly LocalCiStepResult[] = [];
  try {
    results = await runLocalCiPlan(plan, {
      root: checkout.root,
      logDirectory,
      signal: controller.signal,
      onStart: step => process.stdout.write(`… ${step.jobLabel} › ${step.name}\n`),
      onStep: (result, step) => {
        if (result.outcome === 'skipped') return;
        const mark = result.outcome === 'success' ? '✓' : '✗';
        const note = result.note ? `（${result.note}）` : '';
        console.log(`${mark} ${step.jobLabel} › ${step.name}  ${formatDuration(result.durationMs)}${note}`);
        if (result.outcome === 'failure' && result.log) {
          console.log(readLogTail(result.log, 25).replace(/^/gmu, '    '));
          console.log(`    完整日志：${result.log}`);
        }
      },
    });
  } finally {
    const evidence = checkout.clean ? collectLocalCiEvidence(plan, results, checkout.root, logDirectory) : [];
    const failures = results.filter(result => result.outcome === 'failure' && !result.note);
    const summaryFile = writeLocalCiSummary(logDirectory, {
      commit: checkout.commit,
      clean: checkout.clean,
      durationMs: Date.now() - started,
      interrupted: controller.signal.aborted,
      results,
      skippedJobs: plan.skippedJobs,
      evidence,
    });
    if (checkout.clean && !options.keep) checkout.remove();
    else if (checkout.clean) console.log(`\n已保留干净检出：${checkout.root}（用完请 git worktree remove --force 回收）`);

    const passed = results.filter(result => result.outcome === 'success').length;
    const skipped = results.filter(result => result.outcome === 'skipped');
    console.log(`\n用时 ${formatDuration(Date.now() - started)}：通过 ${passed}，失败 ${failures.length}，跳过 ${skipped.length}`);
    for (const failure of failures) console.log(`  ✗ ${failure.jobLabel} › ${failure.name}\n    ${failure.log}`);
    const notLocal = [...new Set(skipped.filter(result => result.note?.startsWith('本地无法判断')).map(result => `${result.jobLabel} › ${result.name}`))];
    if (notLocal.length) console.log(`本地无法判断、未执行：\n${notLocal.map(item => `  - ${item}`).join('\n')}`);
    if (plan.skippedJobs.length) {
      console.log(`只能由 GitHub 验证：\n${plan.skippedJobs.map(job => `  - ${job.workflow}/${job.job}：${job.reason}`).join('\n')}`);
    }
    if (evidence.length) console.log(`失败证据已复制到：${path.join(logDirectory, 'evidence')}`);
    console.log(`汇总：${summaryFile}`);
    process.exitCode = failures.length || controller.signal.aborted ? 1 : 0;
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
