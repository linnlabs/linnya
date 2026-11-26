import type { LocalCiLane, LocalCiPlan, LocalCiShardMerge, LocalCiStep, LocalCiUnit } from '../definitions/localCiPlan';
import {
  LOCAL_CI_STEP_SCHEDULE,
  LOCAL_CI_UNDECLARED_STEP_KIND,
  type LocalCiSchedule,
  type LocalCiStepKind,
} from '../definitions/localCiSchedule';


/** 同一命令、环境、目录和 shell 只执行一次（例如每个任务开头都装依赖），后面的复用结果。 */
export function localCiStepFingerprint(step: LocalCiStep, command = step.command): string {
  return JSON.stringify([command, step.env, step.workingDirectory ?? '', step.shell ?? '']);
}

export function classifyLocalCiStep(
  step: LocalCiStep,
  schedule: LocalCiSchedule = LOCAL_CI_STEP_SCHEDULE
): { readonly kind: LocalCiStepKind; readonly declared: boolean } {
  const kind = schedule[step.workflow]?.[step.job]?.[step.name];
  return kind ? { kind, declared: true } : { kind: LOCAL_CI_UNDECLARED_STEP_KIND, declared: false };
}

const SHARD_FLAG = /\s--shard[= ](\d+)\/(\d+)(?=\s|$)/u;
const MAX_WORKERS_FLAG = /\s--maxWorkers[= ]\S+(?=\s|$)/u;

/** 读取 vitest 分片参数；不是单行 `vitest run ... --shard=K/N` 命令时返回 null。 */
export function readVitestShard(command: string): { readonly index: number; readonly total: number; readonly base: string } | null {
  if (command.includes('\n') || !/\bvitest\s+run\b/u.test(command)) return null;
  const match = SHARD_FLAG.exec(command);
  if (!match) return null;
  const base = command.replace(SHARD_FLAG, '').replace(MAX_WORKERS_FLAG, '');
  return { index: Number(match[1]), total: Number(match[2]), base };
}

/** 去掉分片参数、换成本地 worker 数：所有分片的并集就是不带 --shard 的同一条命令。 */
export function mergedVitestCommand(command: string, testWorkers: number): string {
  const base = command.replace(SHARD_FLAG, '').replace(MAX_WORKERS_FLAG, '');
  return base.replace(/\bvitest\s+run\b/u, match => `${match} --maxWorkers=${testWorkers}`);
}

/**
 * 合并测试失败后的隔离重跑命令：同一条 vitest 命令只跑失败的文件，worker 数为 1，文件逐个串行执行。
 * vitest 把位置参数当作文件路径过滤条件；路径来自它自己的失败报告，相对同一个根目录。
 */
export function isolatedVitestCommand(mergedCommand: string, files: readonly string[]): string {
  const base = mergedCommand.replace(MAX_WORKERS_FLAG, '');
  const quoted = files.map(file => `'${file.replaceAll("'", `'\\''`)}'`).join(' ');
  return `${base.replace(/\bvitest\s+run\b/u, match => `${match} --maxWorkers=1`)} ${quoted}`;
}

/** 分片集合必须正好是 1..total，各出现一次；缺一片或多一片都不合并。 */
export function coversEveryShard(shards: readonly number[], total: number): boolean {
  if (!Number.isInteger(total) || total < 1 || shards.length !== total) return false;
  const sorted = [...shards].sort((left, right) => left - right);
  return sorted.every((shard, index) => shard === index + 1);
}

function laneKey(step: LocalCiStep): string {
  return step.jobLabel;
}

function sameStepShape(left: LocalCiStep, right: LocalCiStep): boolean {
  return left.name === right.name && left.condition === right.condition && left.stepId === right.stepId && left.localSkip === right.localSkip;
}

interface RawLane {
  readonly label: string;
  readonly workflow: string;
  readonly job: string;
  readonly steps: readonly number[];
}

interface LaneOptions {
  readonly testWorkers: number;
  readonly schedule?: LocalCiSchedule;
}

function unitFor(plan: LocalCiPlan, options: LaneOptions, steps: readonly number[], extra: Partial<LocalCiUnit> = {}): LocalCiUnit {
  return { steps, ...classifyLocalCiStep(plan.steps[steps[0]!]!, options.schedule), ...extra };
}

/**
 * 同一任务的矩阵组合除测试分片参数外完全一致时，合并成一条执行线：相同步骤只执行一次，
 * 分片步骤合并为一次覆盖全部分片的 vitest 运行。任何其他差异都不合并，各组合照常独立执行。
 */
function mergeShardLanes(plan: LocalCiPlan, lanes: readonly RawLane[], options: LaneOptions): LocalCiLane | null {
  const { testWorkers } = options;
  if (lanes.length < 2) return null;
  const length = lanes[0]!.steps.length;
  if (lanes.some(lane => lane.steps.length !== length)) return null;
  const units: LocalCiUnit[] = [];
  let merged = false;
  for (let position = 0; position < length; position += 1) {
    const indices = lanes.map(lane => lane.steps[position]!);
    const steps = indices.map(index => plan.steps[index]!);
    const first = steps[0]!;
    if (!steps.every(step => sameStepShape(step, first))) return null;
    if (first.localSkip || steps.every(step => localCiStepFingerprint(step) === localCiStepFingerprint(first))) {
      units.push(unitFor(plan, options, indices));
      continue;
    }
    const shards = steps.map(step => (step.command ? readVitestShard(step.command) : null));
    if (shards.some(shard => shard === null)) return null;
    const total = shards[0]!.total;
    const sameRun = steps.every(
      (step, index) =>
        shards[index]!.total === total &&
        shards[index]!.base === shards[0]!.base &&
        localCiStepFingerprint(step, '') === localCiStepFingerprint(first, '')
    );
    const shardIndices = shards.map(shard => shard!.index);
    if (!sameRun || !coversEveryShard(shardIndices, total)) return null;
    const order = indices.map((index, at) => ({ index, shard: shardIndices[at]! })).sort((left, right) => left.shard - right.shard);
    const shardMerge: LocalCiShardMerge = {
      shards: order.map(item => item.shard),
      total,
      originalCommands: order.map(item => plan.steps[item.index]!.command!),
      testWorkers,
    };
    units.push(unitFor(plan, options, order.map(item => item.index), { command: mergedVitestCommand(first.command!, testWorkers), shardMerge }));
    merged = true;
  }
  if (!merged) return null;
  const label = `${plan.steps[lanes[0]!.steps[0]!]!.jobLabel} 等 ${lanes.length} 个分片（合并执行）`;
  return { label, units };
}

/**
 * 计划 → 执行线：每个任务（矩阵组合）一条，步骤保持工作流里的顺序；能合并的测试分片合并为一条。
 * 返回顺序与计划里任务首次出现的顺序一致，保证调度和输出可复现。
 */
export function buildLocalCiLanes(plan: LocalCiPlan, options: LaneOptions): readonly LocalCiLane[] {
  const raw = new Map<string, { label: string; workflow: string; job: string; steps: number[] }>();
  plan.steps.forEach((step, index) => {
    const key = laneKey(step);
    const lane = raw.get(key) ?? { label: step.jobLabel, workflow: step.workflow, job: step.job, steps: [] };
    lane.steps.push(index);
    raw.set(key, lane);
  });
  const byJob = new Map<string, RawLane[]>();
  for (const lane of raw.values()) {
    const key = `${lane.workflow}/${lane.job}`;
    byJob.set(key, [...(byJob.get(key) ?? []), lane]);
  }
  const lanes: LocalCiLane[] = [];
  const emitted = new Set<string>();
  for (const lane of raw.values()) {
    const jobKey = `${lane.workflow}/${lane.job}`;
    if (emitted.has(jobKey)) continue;
    const siblings = byJob.get(jobKey)!;
    const merged = mergeShardLanes(plan, siblings, options);
    if (merged) {
      emitted.add(jobKey);
      lanes.push(merged);
      continue;
    }
    lanes.push({ label: lane.label, units: lane.steps.map(index => unitFor(plan, options, [index])) });
  }
  return lanes;
}

/** 合并后的测试运行占满测试资源：不与其他测试重叠。 */
export function isHeavyUnit(unit: LocalCiUnit): boolean {
  return unit.shardMerge !== undefined;
}
