import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import {
  LOCAL_CI_RUNNER_OS,
  UnsupportedWorkflowExpression,
  type LocalCiLane,
  type LocalCiPlan,
  type LocalCiStep,
  type LocalCiUnit,
  type StepOutcome,
} from '../definitions/localCiPlan';
import type { LocalCiSchedule, LocalCiStepKind } from '../definitions/localCiSchedule';
import { buildLocalCiLanes, isHeavyUnit, localCiStepFingerprint } from '../functions/buildLocalCiLanes';
import { evaluateWorkflowCondition } from '../functions/evaluateWorkflowCondition';
import { pickLocalCiStarts } from '../functions/pickLocalCiStarts';

export interface LocalCiStepResult {
  readonly key: string;
  readonly jobLabel: string;
  readonly name: string;
  readonly outcome: StepOutcome;
  readonly durationMs: number;
  readonly kind: LocalCiStepKind;
  /** 距本次运行开始的毫秒数；只有真正执行的步骤有值。 */
  readonly startedAtMs?: number;
  /** 结果来自另一个步骤的执行（相同步骤去重、或被合并进同一次测试运行）。 */
  readonly reusedFrom?: string;
  /** 属于哪次合并测试运行（值为该运行主步骤的 key）。 */
  readonly mergedRun?: string;
  readonly note?: string;
  readonly log?: string;
}

/** 合并测试分片的回执：证明一次运行覆盖了哪些分片、原命令是什么、实际执行了什么。 */
export interface LocalCiMergedTestRun {
  readonly key: string;
  readonly steps: readonly string[];
  readonly shards: readonly number[];
  readonly total: number;
  readonly originalCommands: readonly string[];
  readonly command: string;
  readonly testWorkers: number;
  readonly outcome: StepOutcome;
  readonly durationMs: number;
  readonly log?: string;
  /** vitest 汇总行，例如 "2313 passed (2313)"。 */
  readonly testFiles?: string;
  readonly tests?: string;
}

export interface LocalCiRunOutcome {
  /** 按计划顺序。 */
  readonly results: readonly LocalCiStepResult[];
  readonly mergedTestRuns: readonly LocalCiMergedTestRun[];
}

export interface LocalCiStartEvent {
  readonly label: string;
  readonly step: LocalCiStep;
  readonly unit: LocalCiUnit;
  readonly elapsedMs: number;
}

interface RunOptions {
  readonly root: string;
  readonly logDirectory: string;
  readonly concurrency: number;
  readonly testWorkers: number;
  readonly onStep: (result: LocalCiStepResult, step: LocalCiStep) => void;
  readonly onStart: (event: LocalCiStartEvent) => void;
  readonly signal: AbortSignal;
  /** 中断时先 SIGTERM，超过这段时间仍未退出的进程组改用 SIGKILL。 */
  readonly killGraceMs?: number;
  /** 调度表；默认是仓库声明（definitions/localCiSchedule.ts）。 */
  readonly schedule?: LocalCiSchedule;
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

/** 向整个进程组发信号；组里已经没有进程时忽略。 */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

interface CommandInput {
  readonly step: LocalCiStep;
  readonly command: string;
  readonly root: string;
  readonly logFile: string;
  readonly runnerTemp: string;
  readonly signal: AbortSignal;
  readonly killGraceMs: number;
}

/**
 * 每个步骤在自己的进程组里运行（detached）。命令本身退出后立刻回收组里残留的子进程（例如没关掉的 Electron），
 * 和 GitHub 任务结束时清理孤儿进程一致；中断时整组 SIGTERM，宽限期后 SIGKILL。
 */
function runCommand(input: CommandInput): Promise<boolean> {
  const invocation = shellCommand(input.step.shell, input.command)!;
  mkdirSync(input.runnerTemp, { recursive: true });
  const log = createWriteStream(input.logFile);
  log.write(`$ ${input.command}\n\n`);
  return new Promise(resolve => {
    const child = spawn(invocation[0], invocation[1], {
      cwd: input.step.workingDirectory ? path.join(input.root, input.step.workingDirectory) : input.root,
      env: {
        ...process.env,
        CI: 'true',
        RUNNER_OS: LOCAL_CI_RUNNER_OS,
        RUNNER_TEMP: input.runnerTemp,
        GITHUB_WORKSPACE: input.root,
        GITHUB_OUTPUT: path.join(input.runnerTemp, 'github-output'),
        GITHUB_ENV: path.join(input.runnerTemp, 'github-env'),
        GITHUB_STEP_SUMMARY: path.join(input.runnerTemp, 'github-step-summary'),
        ...input.step.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    const pid = child.pid;
    let escalation: NodeJS.Timeout | undefined;
    const abort = () => {
      if (!pid) return;
      signalGroup(pid, 'SIGTERM');
      escalation = setTimeout(() => signalGroup(pid, 'SIGKILL'), input.killGraceMs);
      escalation.unref();
    };
    if (input.signal.aborted) abort();
    else input.signal.addEventListener('abort', abort, { once: true });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    let leftover: NodeJS.Timeout | undefined;
    child.on('exit', () => {
      // 命令已退出，组里残留的子进程可能还占着输出管道，不回收的话 close 永远等不到。
      if (!pid) return;
      signalGroup(pid, 'SIGTERM');
      leftover = setTimeout(() => signalGroup(pid, 'SIGKILL'), input.killGraceMs);
      leftover.unref();
    });
    child.on('error', error => log.write(`\n[spawn error] ${error.message}\n`));
    child.on('close', code => {
      input.signal.removeEventListener('abort', abort);
      clearTimeout(escalation);
      clearTimeout(leftover);
      log.end(`\n[exit ${code}]\n`, () => resolve(code === 0));
    });
  });
}

const ANSI = /\u001b\[[0-9;]*m/gu;

function readVitestTotals(logFile: string): { testFiles?: string; tests?: string } {
  if (!existsSync(logFile)) return {};
  const text = readFileSync(logFile, 'utf8').replace(ANSI, '');
  const testFiles = /^\s*Test Files\s+(.+)$/mu.exec(text)?.[1]?.trim();
  const tests = /^\s*Tests\s+(.+)$/mu.exec(text)?.[1]?.trim();
  return { ...(testFiles ? { testFiles } : {}), ...(tests ? { tests } : {}) };
}

interface LaneState {
  readonly lane: LocalCiLane;
  readonly runnerTemp: string;
  position: number;
  readonly stepOutcomes: Record<string, StepOutcome>;
  failed: boolean;
}

interface Running {
  readonly lane: LaneState;
  readonly unit: LocalCiUnit;
  readonly fingerprint: string;
  readonly promise: Promise<void>;
}

/**
 * 按执行线并行运行计划：每条线内保持工作流顺序，线之间按 pickLocalCiStarts 的规则调度。
 * 失败不停；相同步骤（含正在执行的）只执行一次，后到的等它结束后复用结果。
 */
export async function runLocalCiPlan(plan: LocalCiPlan, options: RunOptions): Promise<LocalCiRunOutcome> {
  const lanes = buildLocalCiLanes(plan, { testWorkers: options.testWorkers, schedule: options.schedule });
  const started = Date.now();
  const killGraceMs = options.killGraceMs ?? 10_000;
  const results: (LocalCiStepResult | undefined)[] = new Array(plan.steps.length);
  const mergedTestRuns: LocalCiMergedTestRun[] = [];
  const finished = new Map<string, { readonly ok: boolean; readonly key: string }>();
  const running = new Map<string, Running>();
  const states: LaneState[] = lanes.map((lane, index) => ({
    lane,
    runnerTemp: path.join(options.logDirectory, 'runner-temp', `${String(index + 1).padStart(2, '0')}-${slug(lane.label)}`),
    position: 0,
    stepOutcomes: {},
    failed: false,
  }));

  const record = (
    state: LaneState,
    unit: LocalCiUnit,
    outcome: StepOutcome,
    durationMs: number,
    extra: { note?: string; log?: string; startedAtMs?: number; reusedFrom?: string } = {}
  ) => {
    const primary = plan.steps[unit.steps[0]!]!;
    if (primary.stepId) state.stepOutcomes[primary.stepId] = outcome;
    if (outcome === 'failure') state.failed = true;
    const mergedRun = unit.shardMerge ? primary.key : undefined;
    unit.steps.forEach((index, at) => {
      const step = plan.steps[index]!;
      const base = { key: step.key, jobLabel: step.jobLabel, name: step.name, outcome, kind: unit.kind, ...(mergedRun ? { mergedRun } : {}) };
      let result: LocalCiStepResult;
      if (at === 0) result = { ...base, durationMs, ...extra };
      else if (outcome === 'skipped') result = { ...base, durationMs: 0, note: step.localSkip ?? extra.note };
      else if (unit.shardMerge) {
        result = { ...base, durationMs: 0, reusedFrom: primary.key, note: `分片 ${unit.shardMerge.shards[at]}/${unit.shardMerge.total} 已包含在 ${primary.key} 的合并运行中`, log: extra.log };
      } else result = { ...base, durationMs: 0, reusedFrom: extra.reusedFrom ?? primary.key, note: `与 ${extra.reusedFrom ?? primary.key} 相同，复用结果` };
      results[index] = result;
      options.onStep(result, step);
    });
  };

  /** 不需要执行的单元（跳过、条件不成立、复用已完成结果）当场记下；返回 true 表示这条线停在一个需要执行或等待的单元上。 */
  const settle = (state: LaneState): void => {
    while (state.position < state.lane.units.length) {
      const unit = state.lane.units[state.position]!;
      const step = plan.steps[unit.steps[0]!]!;
      if (step.localSkip) {
        record(state, unit, 'skipped', 0, { note: step.localSkip });
        state.position += 1;
        continue;
      }
      if (step.condition !== undefined) {
        let note: string | undefined;
        try {
          const context = { runnerOs: LOCAL_CI_RUNNER_OS, matrix: step.matrix, stepOutcomes: state.stepOutcomes, jobFailed: state.failed };
          if (!evaluateWorkflowCondition(step.condition, context)) note = `条件不成立：${step.condition}`;
        } catch (error) {
          if (!(error instanceof UnsupportedWorkflowExpression)) throw error;
          note = `本地无法判断：${error.message}`;
        }
        if (note) {
          record(state, unit, 'skipped', 0, { note });
          state.position += 1;
          continue;
        }
      }
      // 不带条件的步骤在 CI 里默认 success()：前面失败就跳过，后面的问题被遮住。本地继续执行，一次看全。
      const command = unit.command ?? step.command!;
      if (!shellCommand(step.shell, command)) {
        record(state, unit, 'skipped', 0, { note: `本地不支持 shell: ${step.shell}` });
        state.position += 1;
        continue;
      }
      const previous = finished.get(localCiStepFingerprint(step, command));
      if (previous) {
        record(state, unit, previous.ok ? 'success' : 'failure', 0, { note: `与 ${previous.key} 相同，复用结果`, reusedFrom: previous.key });
        state.position += 1;
        continue;
      }
      return;
    }
  };

  const launch = (state: LaneState): void => {
    const unit = state.lane.units[state.position]!;
    const index = unit.steps[0]!;
    const step = plan.steps[index]!;
    const command = unit.command ?? step.command!;
    const fingerprint = localCiStepFingerprint(step, command);
    const label = unit.shardMerge ? state.lane.label : step.jobLabel;
    const startedAtMs = Date.now() - started;
    options.onStart({ label, step, unit, elapsedMs: startedAtMs });
    const suffix = unit.shardMerge ? '-merged-shards' : '';
    const logFile = path.join(options.logDirectory, `${String(index + 1).padStart(3, '0')}-${slug(step.job)}-${slug(step.name)}${suffix}.log`);
    const promise = runCommand({ step, command, root: options.root, logFile, runnerTemp: state.runnerTemp, signal: options.signal, killGraceMs }).then(ok => {
      const durationMs = Date.now() - started - startedAtMs;
      running.delete(fingerprint);
      finished.set(fingerprint, { ok, key: step.key });
      const outcome: StepOutcome = ok ? 'success' : 'failure';
      const note = unit.shardMerge
        ? `${unit.shardMerge.total} 个分片合并为一次运行（--maxWorkers=${unit.shardMerge.testWorkers}）`
        : undefined;
      record(state, unit, outcome, durationMs, { log: logFile, startedAtMs, ...(note ? { note } : {}) });
      if (unit.shardMerge) {
        mergedTestRuns.push({
          key: step.key,
          steps: unit.steps.map(member => plan.steps[member]!.key),
          shards: unit.shardMerge.shards,
          total: unit.shardMerge.total,
          originalCommands: unit.shardMerge.originalCommands,
          command,
          testWorkers: unit.shardMerge.testWorkers,
          outcome,
          durationMs,
          log: logFile,
          ...readVitestTotals(logFile),
        });
      }
      state.position += 1;
    });
    running.set(fingerprint, { lane: state, unit, fingerprint, promise });
  };

  while (!options.signal.aborted) {
    states.forEach(settle);
    const waiting = states.filter(state => state.position < state.lane.units.length);
    const ready = waiting.filter(state => {
      const unit = state.lane.units[state.position]!;
      const step = plan.steps[unit.steps[0]!]!;
      // 同一命令正在别的线上执行：等它结束后复用。
      return !running.has(localCiStepFingerprint(step, unit.command ?? step.command!)) && ![...running.values()].some(item => item.lane === state);
    });
    const picks = pickLocalCiStarts({
      ready: ready.map(state => {
        const unit = state.lane.units[state.position]!;
        return { kind: unit.kind, heavy: isHeavyUnit(unit) };
      }),
      running: [...running.values()].map(item => ({ kind: item.unit.kind, heavy: isHeavyUnit(item.unit) })),
      concurrency: options.concurrency,
    });
    for (const pick of picks) launch(ready[pick]!);
    if (running.size === 0) {
      if (waiting.length) throw new Error(`本地 CI 调度停滞：${waiting.map(state => state.lane.label).join('、')}`);
      break;
    }
    await Promise.race([...running.values()].map(item => item.promise));
  }
  // 中断后等所有子进程组退出（SIGTERM → 宽限期 → SIGKILL），不留孤儿进程。
  await Promise.all([...running.values()].map(item => item.promise));
  return { results: results.filter((result): result is LocalCiStepResult => result !== undefined), mergedTestRuns };
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
