import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_CI_RUNNER_OS,
  UnsupportedWorkflowExpression,
  type LocalCiPlan,
  type LocalCiStep,
  type StepOutcome,
} from '../definitions/localCiPlan';
import { evaluateWorkflowCondition } from '../functions/evaluateWorkflowCondition';

export interface LocalCiStepResult {
  readonly key: string;
  readonly jobLabel: string;
  readonly name: string;
  readonly outcome: StepOutcome;
  readonly durationMs: number;
  readonly note?: string;
  readonly log?: string;
}

interface RunOptions {
  readonly root: string;
  readonly logDirectory: string;
  readonly onStep: (result: LocalCiStepResult, step: LocalCiStep) => void;
  readonly onStart: (step: LocalCiStep) => void;
  readonly signal: AbortSignal;
}

function shellCommand(shell: string | undefined, command: string): readonly [string, readonly string[]] | null {
  // 与 GitHub macOS runner 的默认 bash 一致：-e 遇错即停，pipefail 让管道里的失败生效。
  if (!shell || shell === 'bash') return ['bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', command]];
  if (shell === 'sh') return ['sh', ['-e', '-c', command]];
  return null;
}

function slug(text: string): string {
  return text.replace(/[^\w一-鿿-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 60) || 'step';
}

function runCommand(step: LocalCiStep, root: string, logFile: string, runnerTemp: string, signal: AbortSignal): Promise<boolean> {
  const invocation = shellCommand(step.shell, step.command!);
  if (!invocation) return Promise.resolve(false);
  const log = createWriteStream(logFile);
  log.write(`$ ${step.command}\n\n`);
  return new Promise(resolve => {
    const child = spawn(invocation[0], invocation[1], {
      cwd: step.workingDirectory ? path.join(root, step.workingDirectory) : root,
      env: {
        ...process.env,
        CI: 'true',
        RUNNER_OS: LOCAL_CI_RUNNER_OS,
        RUNNER_TEMP: runnerTemp,
        GITHUB_WORKSPACE: root,
        GITHUB_OUTPUT: path.join(runnerTemp, 'github-output'),
        GITHUB_ENV: path.join(runnerTemp, 'github-env'),
        GITHUB_STEP_SUMMARY: path.join(runnerTemp, 'github-step-summary'),
        ...step.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const abort = () => {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    };
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('close', code => {
      signal.removeEventListener('abort', abort);
      log.end(`\n[exit ${code}]\n`, () => resolve(code === 0));
    });
  });
}

/** 同一命令、环境和目录只执行一次（例如每个任务开头都装依赖），后面的复用结果。 */
function fingerprint(step: LocalCiStep): string {
  return JSON.stringify([step.command, step.env, step.workingDirectory ?? '', step.shell ?? '']);
}

export async function runLocalCiPlan(plan: LocalCiPlan, options: RunOptions): Promise<readonly LocalCiStepResult[]> {
  const results: LocalCiStepResult[] = [];
  const runnerTemp = path.join(options.logDirectory, 'runner-temp');
  mkdirSync(runnerTemp, { recursive: true });
  const finished = new Map<string, { readonly ok: boolean; readonly key: string }>();
  const jobOutcomes = new Map<string, { stepOutcomes: Record<string, StepOutcome>; failed: boolean }>();

  for (const [index, step] of plan.steps.entries()) {
    if (options.signal.aborted) break;
    const job = jobOutcomes.get(step.jobLabel) ?? { stepOutcomes: {}, failed: false };
    jobOutcomes.set(step.jobLabel, job);
    const record = (outcome: StepOutcome, durationMs: number, extra: { note?: string; log?: string } = {}) => {
      const result: LocalCiStepResult = { key: step.key, jobLabel: step.jobLabel, name: step.name, outcome, durationMs, ...extra };
      if (step.stepId) job.stepOutcomes[step.stepId] = outcome;
      if (outcome === 'failure') job.failed = true;
      results.push(result);
      options.onStep(result, step);
    };

    if (step.localSkip) {
      record('skipped', 0, { note: step.localSkip });
      continue;
    }
    if (step.condition !== undefined) {
      try {
        const context = { runnerOs: LOCAL_CI_RUNNER_OS, matrix: step.matrix, stepOutcomes: job.stepOutcomes, jobFailed: job.failed };
        if (!evaluateWorkflowCondition(step.condition, context)) {
          record('skipped', 0, { note: `条件不成立：${step.condition}` });
          continue;
        }
      } catch (error) {
        if (!(error instanceof UnsupportedWorkflowExpression)) throw error;
        record('skipped', 0, { note: `本地无法判断：${error.message}` });
        continue;
      }
    }
    // 不带条件的步骤在 CI 里默认 success()：前面失败就跳过，后面的问题被遮住。本地继续执行，一次看全。
    const previous = finished.get(fingerprint(step));
    if (previous) {
      record(previous.ok ? 'success' : 'failure', 0, { note: `与 ${previous.key} 相同，复用结果` });
      continue;
    }
    if (!shellCommand(step.shell, step.command!)) {
      record('skipped', 0, { note: `本地不支持 shell: ${step.shell}` });
      continue;
    }
    options.onStart(step);
    const logFile = path.join(options.logDirectory, `${String(index + 1).padStart(3, '0')}-${slug(step.job)}-${slug(step.name)}.log`);
    const started = Date.now();
    const ok = await runCommand(step, options.root, logFile, runnerTemp, options.signal);
    finished.set(fingerprint(step), { ok, key: step.key });
    record(ok ? 'success' : 'failure', Date.now() - started, { log: logFile });
  }
  return results;
}

/** 有失败的任务按 upload-artifact 声明把证据从检出复制到日志目录，检出删掉后仍可查看。 */
export function collectLocalCiEvidence(plan: LocalCiPlan, results: readonly LocalCiStepResult[], root: string, logDirectory: string): readonly string[] {
  const failedJobs = new Set(results.filter(result => result.outcome === 'failure').map(result => result.jobLabel));
  const copied: string[] = [];
  for (const step of plan.steps) {
    if (!failedJobs.has(step.jobLabel) || !step.evidencePaths) continue;
    for (const evidence of step.evidencePaths) {
      if (evidence.startsWith('!') || /[*?]/u.test(evidence)) continue;
      const source = path.join(root, evidence);
      if (!existsSync(source)) continue;
      const target = path.join(logDirectory, 'evidence', evidence);
      cpSync(source, target, { recursive: true });
      copied.push(target);
    }
  }
  return copied;
}

export function readLogTail(file: string, lines: number): string {
  return readFileSync(file, 'utf8').split('\n').slice(-lines).join('\n');
}

export function writeLocalCiSummary(logDirectory: string, summary: unknown): string {
  const file = path.join(logDirectory, 'summary.json');
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  return file;
}
