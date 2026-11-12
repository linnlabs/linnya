import { isRecord } from '@linnya/foundation';
import {
  LOCAL_CI_RUNNER_OS,
  UnsupportedWorkflowExpression,
  type LocalCiPlan,
  type LocalCiSkippedJob,
  type LocalCiStep,
  type WorkflowConditionContext,
} from '../definitions/localCiPlan';
import { evaluateWorkflowCondition, substituteWorkflowExpressions } from './evaluateWorkflowCondition';

export interface ParsedWorkflow {
  /** 工作流文件名，如 ci.yml。 */
  readonly file: string;
  readonly document: unknown;
}

export interface LocalCiPlanFilter {
  readonly workflows?: readonly string[];
  readonly jobs?: readonly string[];
}

type MatrixEntry = Readonly<Record<string, string | number | boolean>>;
type RunnerKind = 'macos' | 'linux' | 'windows' | 'unknown';

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readEnv(value: unknown): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, raw] of Object.entries(readRecord(value))) {
    if (raw !== null && raw !== undefined) env[key] = String(raw);
  }
  return env;
}

function classifyRunner(label: string): RunnerKind {
  if (/macos/iu.test(label)) return 'macos';
  if (/ubuntu|linux/iu.test(label)) return 'linux';
  if (/windows/iu.test(label)) return 'windows';
  return 'unknown';
}

/** 只展开普通数组矩阵；include/exclude 本地未支持时整项跳过并说明。 */
function expandMatrix(strategy: unknown): readonly MatrixEntry[] | string {
  const matrix = readRecord(readRecord(strategy).matrix);
  if ('include' in matrix || 'exclude' in matrix) return '矩阵含 include/exclude，本地尚未支持';
  let entries: MatrixEntry[] = [{}];
  for (const [key, values] of Object.entries(matrix)) {
    if (!Array.isArray(values)) return `矩阵 ${key} 不是数组`;
    entries = entries.flatMap(entry =>
      values.map(value => ({ ...entry, [key]: typeof value === 'object' ? JSON.stringify(value) : value }))
    );
  }
  return entries;
}

function matrixLabel(matrix: MatrixEntry): string {
  const parts = Object.entries(matrix).map(([key, value]) => `${key}=${value}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function contextFor(matrix: MatrixEntry): WorkflowConditionContext {
  return { runnerOs: LOCAL_CI_RUNNER_OS, matrix, stepOutcomes: {}, jobFailed: false };
}

function matchesFilter(filter: readonly string[] | undefined, ...candidates: readonly string[]): boolean {
  if (!filter?.length) return true;
  const normalize = (value: string) => value.replace(/\.ya?ml$/u, '').toLowerCase();
  return filter.some(wanted => candidates.some(candidate => normalize(candidate) === normalize(wanted)));
}

function planStep(input: {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly index: number;
  readonly workflow: ParsedWorkflow;
  readonly jobId: string;
  readonly jobLabel: string;
  readonly matrix: MatrixEntry;
  readonly inheritedEnv: Readonly<Record<string, string>>;
  readonly defaults: { readonly shell?: string; readonly workingDirectory?: string };
}): LocalCiStep {
  const { raw, workflow, jobId, jobLabel, matrix } = input;
  const uses = readString(raw.uses);
  const run = readString(raw.run);
  const base = {
    key: `${workflow.file}/${jobId}${matrixLabel(matrix)}/${input.index + 1}`,
    workflow: workflow.file,
    job: jobId,
    jobLabel,
    name: readString(raw.name) ?? (uses ? uses.split('@')[0]! : run?.split('\n')[0] ?? `step ${input.index + 1}`),
    stepId: readString(raw.id),
    condition: raw.if === undefined ? undefined : String(raw.if),
    matrix,
    env: {},
  };
  if (uses) {
    const isUpload = /^actions\/upload-artifact@/u.test(uses);
    const paths = readString(readRecord(raw.with).path)
      ?.split('\n')
      .map(line => line.trim())
      .filter(Boolean);
    return {
      ...base,
      localSkip: isUpload ? '上传证据（失败时从干净检出复制到日志目录）' : `外部 action ${uses.split('@')[0]}，本地由开发环境提供`,
      evidencePaths: isUpload ? paths : undefined,
    };
  }
  if (!run) return { ...base, localSkip: '没有 run 命令' };
  const context = contextFor(matrix);
  try {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...input.inheritedEnv, ...readEnv(raw.env) })) {
      env[key] = substituteWorkflowExpressions(value, context);
    }
    return {
      ...base,
      command: substituteWorkflowExpressions(run, context),
      env,
      shell: readString(raw.shell) ?? input.defaults.shell,
      workingDirectory: readString(raw['working-directory']) ?? input.defaults.workingDirectory,
    };
  } catch (error) {
    if (error instanceof UnsupportedWorkflowExpression) return { ...base, localSkip: `本地无法判断：${error.message}` };
    throw error;
  }
}

/** 任务名常带矩阵表达式（如 Source build (${{ matrix.os }})）；能替换就替换，否则附上矩阵值。 */
function readJobName(job: Readonly<Record<string, unknown>>, jobId: string, matrix: MatrixEntry): string {
  const name = readString(job.name);
  if (!name) return `${jobId}${matrixLabel(matrix)}`;
  try {
    const resolved = substituteWorkflowExpressions(name, contextFor(matrix));
    return resolved === name ? `${name}${matrixLabel(matrix)}` : resolved;
  } catch (error) {
    if (!(error instanceof UnsupportedWorkflowExpression)) throw error;
    return `${name}${matrixLabel(matrix)}`;
  }
}

function readDefaults(...sources: readonly unknown[]) {
  let shell: string | undefined;
  let workingDirectory: string | undefined;
  for (const source of sources) {
    const run = readRecord(readRecord(source).run);
    shell = readString(run.shell) ?? shell;
    workingDirectory = readString(run['working-directory']) ?? workingDirectory;
  }
  return { shell, workingDirectory };
}

/**
 * 从工作流生成 macOS 本地计划：矩阵里有 macOS 时只取 macOS 组合；固定 Linux 的任务按可移植任务在 macOS 执行；
 * 只在 Windows 上跑的任务跳过。步骤条件留到运行时按真实结果求值。
 */
export function buildLocalCiPlan(workflows: readonly ParsedWorkflow[], filter: LocalCiPlanFilter = {}): LocalCiPlan {
  const steps: LocalCiStep[] = [];
  const skippedJobs: LocalCiSkippedJob[] = [];
  for (const workflow of workflows) {
    const document = readRecord(workflow.document);
    const workflowName = readString(document.name) ?? workflow.file;
    if (!matchesFilter(filter.workflows, workflow.file, workflowName)) continue;
    for (const [jobId, rawJob] of Object.entries(readRecord(document.jobs))) {
      if (!matchesFilter(filter.jobs, jobId)) continue;
      const job = readRecord(rawJob);
      const skip = (reason: string) => skippedJobs.push({ workflow: workflow.file, job: jobId, reason });
      const expanded = expandMatrix(job.strategy);
      if (typeof expanded === 'string') {
        skip(expanded);
        continue;
      }
      const runsOn = Array.isArray(job['runs-on']) ? job['runs-on'].join(',') : String(job['runs-on'] ?? '');
      let combos: { readonly matrix: MatrixEntry; readonly runner: RunnerKind }[];
      try {
        combos = expanded.map(matrix => ({ matrix, runner: classifyRunner(substituteWorkflowExpressions(runsOn, contextFor(matrix))) }));
      } catch (error) {
        if (!(error instanceof UnsupportedWorkflowExpression)) throw error;
        skip(`runs-on 本地无法判断：${error.message}`);
        continue;
      }
      const macCombos = combos.filter(combo => combo.runner === 'macos');
      const selected = macCombos.length ? macCombos : combos.filter(combo => combo.runner === 'linux');
      if (!selected.length) {
        skip(`只在 ${runsOn} 上运行，本地 macOS 不执行`);
        continue;
      }
      const portable = !macCombos.length;
      for (const combo of combos) {
        if (!selected.includes(combo)) skip(`${matrixLabel(combo.matrix).trim()} 不在 macOS 上运行，只能由 GitHub 验证`);
      }
      const defaults = readDefaults(document.defaults, job.defaults);
      const inheritedEnv = { ...readEnv(document.env), ...readEnv(job.env) };
      for (const { matrix } of selected) {
        const jobLabel = `${workflowName} / ${readJobName(job, jobId, matrix)}${portable ? '（原 Linux 任务，在 macOS 上执行）' : ''}`;
        if (job.if !== undefined) {
          try {
            if (!evaluateWorkflowCondition(String(job.if), contextFor(matrix))) {
              skip(`任务条件不成立：${String(job.if)}`);
              continue;
            }
          } catch (error) {
            if (!(error instanceof UnsupportedWorkflowExpression)) throw error;
            skip(`任务条件本地无法判断：${error.message}`);
            continue;
          }
        }
        const rawSteps = Array.isArray(job.steps) ? job.steps : [];
        rawSteps.forEach((raw, index) => {
          steps.push(planStep({ raw: readRecord(raw), index, workflow, jobId, jobLabel, matrix, inheritedEnv, defaults }));
        });
      }
    }
  }
  return { steps, skippedJobs };
}
