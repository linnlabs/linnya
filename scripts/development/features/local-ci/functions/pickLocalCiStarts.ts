import type { LocalCiStepKind } from '../definitions/localCiSchedule';

export interface LocalCiSchedulingUnit {
  readonly kind: LocalCiStepKind;
  /** 合并后的测试运行：不与其他测试重叠。 */
  readonly heavy: boolean;
}

export interface LocalCiSchedulingState {
  /** 各执行线下一个待执行单元，按执行线顺序；返回值是这里的下标。 */
  readonly ready: readonly LocalCiSchedulingUnit[];
  readonly running: readonly LocalCiSchedulingUnit[];
  /** 同时运行的单元上限。 */
  readonly concurrency: number;
}

/**
 * 决定现在启动哪些就绪单元（返回 ready 下标，按启动顺序）。规则按优先级：
 *
 * 1. 负载敏感步骤运行时什么都不启动；它只在没有任何步骤运行、也没有其他步骤可启动时才开始，所以排在最后。
 * 2. 构建一次一个，且只在没有测试运行时开始；有构建在等或在跑时不启动新测试，让产物先就位。
 * 3. 测试在构建全部让路后并行；合并后的测试运行（heavy）只在没有其他测试时开始，它在等时也不再插入别的测试。
 * 4. 只读源码的 static 步骤随时可以填空位（负载敏感步骤运行时除外）。
 *
 * 纯函数：相同输入得到相同选择，调度顺序可以复现。
 */
export function pickLocalCiStarts(state: LocalCiSchedulingState): number[] {
  const active = [...state.running];
  const picks: number[] = [];
  const has = (predicate: (unit: LocalCiSchedulingUnit) => boolean) => active.some(predicate);
  if (has(unit => unit.kind === 'loadSensitive')) return picks;
  const hasCapacity = () => active.length < state.concurrency;
  const start = (index: number) => {
    picks.push(index);
    active.push(state.ready[index]!);
  };

  const firstBuild = state.ready.findIndex(unit => unit.kind === 'build');
  if (firstBuild >= 0 && hasCapacity() && !has(unit => unit.kind === 'build' || unit.kind === 'test')) start(firstBuild);

  if (firstBuild < 0 && !has(unit => unit.kind === 'build')) {
    const heavy = state.ready.findIndex(unit => unit.kind === 'test' && unit.heavy);
    if (heavy >= 0) {
      if (hasCapacity() && !has(unit => unit.kind === 'test')) start(heavy);
    } else if (!has(unit => unit.kind === 'test' && unit.heavy)) {
      state.ready.forEach((unit, index) => {
        if (unit.kind === 'test' && hasCapacity()) start(index);
      });
    }
  }

  state.ready.forEach((unit, index) => {
    if (unit.kind === 'static' && hasCapacity()) start(index);
  });

  if (active.length === 0) {
    const loadSensitive = state.ready.findIndex(unit => unit.kind === 'loadSensitive');
    if (loadSensitive >= 0) start(loadSensitive);
  }
  return picks;
}

export interface LocalCiParallelism {
  readonly testWorkers: number;
  readonly concurrency: number;
}

function readPositiveInteger(value: string | number | undefined, label: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} 必须是正整数：${value}`);
  return parsed;
}

/**
 * 合并测试的 worker 数默认取「核数 - headroom」（至少 2），给并行的源码检查和系统留出余量；并行上限默认固定值。
 * 命令行参数优先于环境变量。
 */
export function resolveLocalCiParallelism(input: {
  readonly cores: number;
  readonly headroom: number;
  readonly defaultConcurrency: number;
  readonly testWorkers?: string | number;
  readonly concurrency?: string | number;
}): LocalCiParallelism {
  return {
    testWorkers: readPositiveInteger(input.testWorkers, '测试 worker 数') ?? Math.max(2, input.cores - input.headroom),
    concurrency: readPositiveInteger(input.concurrency, '并行上限') ?? input.defaultConcurrency,
  };
}
