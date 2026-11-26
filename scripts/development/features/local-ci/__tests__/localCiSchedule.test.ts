import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { LOCAL_CI_STEP_SCHEDULE } from '../definitions/localCiSchedule';
import {
  buildLocalCiLanes,
  coversEveryShard,
  localCiStepFingerprint,
  mergedVitestCommand,
  readVitestShard,
} from '../functions/buildLocalCiLanes';
import { buildLocalCiPlan, isLocalCiWorkflow, type ParsedWorkflow } from '../functions/buildLocalCiPlan';
import { pickLocalCiStarts, resolveLocalCiParallelism, type LocalCiSchedulingUnit } from '../functions/pickLocalCiStarts';

describe('测试分片合并', () => {
  it('去掉分片参数并换成本地 worker 数', () => {
    expect(mergedVitestCommand('pnpm exec vitest run --maxWorkers=2 --shard=1/3', 12)).toBe('pnpm exec vitest run --maxWorkers=12');
    expect(mergedVitestCommand('pnpm exec vitest run --shard=2/3 src', 6)).toBe('pnpm exec vitest run --maxWorkers=6 src');
    expect(readVitestShard('pnpm exec vitest run --maxWorkers=2 --shard=3/3')).toEqual({ index: 3, total: 3, base: 'pnpm exec vitest run' });
    expect(readVitestShard('pnpm exec vitest run src')).toBeNull();
    expect(readVitestShard('echo a\npnpm exec vitest run --shard=1/2')).toBeNull();
  });

  it('只有正好覆盖 1..N 每一片才算完整', () => {
    expect(coversEveryShard([2, 3, 1], 3)).toBe(true);
    expect(coversEveryShard([1, 2], 3)).toBe(false);
    expect(coversEveryShard([1, 1, 3], 3)).toBe(false);
    expect(coversEveryShard([1, 2, 3, 4], 3)).toBe(false);
  });

  const sample = (shards: string, buildCommand = 'pnpm run build') =>
    YAML.parse(`
name: Sample
jobs:
  shards:
    name: Tests (\${{ matrix.shard }}/3)
    strategy:
      matrix:
        shard: ${shards}
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: ${buildCommand}
      - name: Test
        run: pnpm exec vitest run --maxWorkers=2 --shard=\${{ matrix.shard }}/3
`);
  const schedule = { 'sample.yml': { shards: { Install: 'build', Build: 'build', Test: 'test' } } } as const;

  it('矩阵组合除分片外完全一致时合并为一条执行线，相同步骤只执行一次', () => {
    const plan = buildLocalCiPlan([{ file: 'sample.yml', document: sample('[1, 2, 3]') }]);
    const lanes = buildLocalCiLanes(plan, { testWorkers: 8, schedule });
    expect(lanes).toHaveLength(1);
    const units = lanes[0]!.units;
    const test = units[units.length - 1]!;
    expect(test.command).toBe('pnpm exec vitest run --maxWorkers=8');
    expect(test.shardMerge).toMatchObject({ shards: [1, 2, 3], total: 3, testWorkers: 8 });
    expect(test.shardMerge!.originalCommands).toEqual([1, 2, 3].map(shard => `pnpm exec vitest run --maxWorkers=2 --shard=${shard}/3`));
    // 每个单元都带着三个分片的计划步骤，回执里每个分片的每一步都有结果。
    expect(lanes[0]!.units.every(unit => unit.steps.length === 3)).toBe(true);
    expect(lanes[0]!.units.flatMap(unit => unit.steps).sort((a, b) => a - b)).toEqual(plan.steps.map((_, index) => index));
    expect(test.kind).toBe('test');
  });

  it('缺分片或其他步骤不同就不合并，各分片照常独立执行', () => {
    const missing = buildLocalCiPlan([{ file: 'sample.yml', document: sample('[1, 2]') }]);
    const missingLanes = buildLocalCiLanes(missing, { testWorkers: 8, schedule });
    expect(missingLanes).toHaveLength(2);
    expect(missingLanes.flatMap(lane => lane.units).some(unit => unit.shardMerge)).toBe(false);

    const differing = buildLocalCiPlan([{ file: 'sample.yml', document: sample('[1, 2, 3]', 'pnpm run build -- --target=${{ matrix.shard }}') }]);
    expect(buildLocalCiLanes(differing, { testWorkers: 8, schedule })).toHaveLength(3);
  });
});

describe('仓库工作流的调度声明', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const directory = path.join(root, '.github/workflows');
  const workflows: ParsedWorkflow[] = readdirSync(directory)
    .filter(file => /\.ya?ml$/u.test(file))
    .map(file => ({ file, document: YAML.parse(readFileSync(path.join(directory, file), 'utf8')) }));
  const allRunSteps = workflows.filter(isLocalCiWorkflow).flatMap(workflow =>
    Object.entries((workflow.document as { jobs: Record<string, { steps?: { name?: string; run?: string }[] }> }).jobs).flatMap(([job, body]) =>
      (body.steps ?? []).filter(step => step.run !== undefined).map(step => ({ workflow: workflow.file, job, name: step.name ?? '' }))
    )
  );

  it('每个 run 步骤都有声明，声明里也没有已经不存在的步骤', () => {
    const undeclared = allRunSteps.filter(step => !LOCAL_CI_STEP_SCHEDULE[step.workflow]?.[step.job]?.[step.name]);
    expect(undeclared).toEqual([]);
    const existing = new Set(allRunSteps.map(step => `${step.workflow}/${step.job}/${step.name}`));
    const stale = Object.entries(LOCAL_CI_STEP_SCHEDULE).flatMap(([workflow, jobs]) =>
      Object.entries(jobs).flatMap(([job, steps]) => Object.keys(steps).map(name => `${workflow}/${job}/${name}`))
    );
    expect(stale.filter(key => !existing.has(key))).toEqual([]);
  });

  it('全量直接执行架构、包、分片、平台和 Canvas，跳过 PR 路由', () => {
    const jobs = new Set(buildLocalCiPlan(workflows).steps.filter(step => step.command).map(step => step.job));
    expect([...jobs].sort()).toEqual(['architecture', 'deterministic', 'packages', 'source-build', 'test-shards']);
  });

  it('公共架构任务覆盖插件 PR 委托给它的源码 lint 和边界门禁', () => {
    const { steps } = buildLocalCiPlan(workflows, { jobs: ['architecture'] });
    const commands = steps.flatMap(step => step.command?.split('\n') ?? []);
    expect(commands).toEqual(expect.arrayContaining(['pnpm run lint:code', 'pnpm run guard:plugin-boundaries']));
  });

  it('公共包和 Canvas 单独运行时各带业务测试，合跑时命令、目录和环境允许复用', () => {
    const fingerprints = ['packages', 'deterministic'].map(job => {
      const { steps } = buildLocalCiPlan(workflows, { jobs: [job] });
      const cases = steps.filter(step => step.command === 'pnpm --filter @plugin/canvas test' && !step.localSkip);
      expect(cases).toHaveLength(1);
      return localCiStepFingerprint(cases[0]!);
    });
    expect(fingerprints[0]).toBe(fingerprints[1]);
  });

  it('公共测试的全部分片合并为一次运行，覆盖每个分片', () => {
    const plan = buildLocalCiPlan(workflows);
    const merged = buildLocalCiLanes(plan, { testWorkers: 12 })
      .flatMap(lane => lane.units)
      .filter(unit => unit.shardMerge);
    expect(merged).toHaveLength(1);
    const [unit] = merged;
    expect(coversEveryShard(unit!.shardMerge!.shards, unit!.shardMerge!.total)).toBe(true);
    const shardSteps = plan.steps.filter(step => step.job === 'test-shards' && step.command?.includes('--shard='));
    expect(unit!.steps.map(index => plan.steps[index]!.key).sort()).toEqual(shardSteps.map(step => step.key).sort());
    expect(unit!.command).not.toContain('--shard');
  });
});

describe('pickLocalCiStarts', () => {
  const unit = (kind: LocalCiSchedulingUnit['kind'], heavy = false): LocalCiSchedulingUnit => ({ kind, heavy });

  it('构建一次一个，源码检查填空位，构建在等或在跑时不启动测试', () => {
    expect(pickLocalCiStarts({ ready: [unit('static'), unit('build'), unit('build'), unit('test'), unit('static')], running: [], concurrency: 4 })).toEqual([1, 0, 4]);
    expect(pickLocalCiStarts({ ready: [unit('test'), unit('static')], running: [unit('build')], concurrency: 4 })).toEqual([1]);
    // 有测试在跑时构建等待，也不再插入新测试，让构建尽快开始。
    expect(pickLocalCiStarts({ ready: [unit('build'), unit('test')], running: [unit('test')], concurrency: 4 })).toEqual([]);
  });

  it('测试在构建让路后并行；合并测试运行不与其他测试重叠', () => {
    expect(pickLocalCiStarts({ ready: [unit('test'), unit('test'), unit('static')], running: [], concurrency: 4 })).toEqual([0, 1, 2]);
    expect(pickLocalCiStarts({ ready: [unit('test'), unit('test', true)], running: [], concurrency: 4 })).toEqual([1]);
    expect(pickLocalCiStarts({ ready: [unit('test', true), unit('static')], running: [unit('test')], concurrency: 4 })).toEqual([1]);
    expect(pickLocalCiStarts({ ready: [unit('test'), unit('static')], running: [unit('test', true)], concurrency: 4 })).toEqual([1]);
  });

  it('负载敏感步骤只在完全空闲且没有其他可启动步骤时单独执行', () => {
    expect(pickLocalCiStarts({ ready: [unit('loadSensitive'), unit('static')], running: [], concurrency: 4 })).toEqual([1]);
    expect(pickLocalCiStarts({ ready: [unit('loadSensitive')], running: [unit('static')], concurrency: 4 })).toEqual([]);
    expect(pickLocalCiStarts({ ready: [unit('loadSensitive'), unit('loadSensitive')], running: [], concurrency: 4 })).toEqual([0]);
    expect(pickLocalCiStarts({ ready: [unit('static'), unit('build')], running: [unit('loadSensitive')], concurrency: 4 })).toEqual([]);
  });

  it('遵守并行上限；上限为 1 时逐步执行', () => {
    expect(pickLocalCiStarts({ ready: [unit('static'), unit('static'), unit('static')], running: [unit('build')], concurrency: 3 })).toEqual([0, 1]);
    expect(pickLocalCiStarts({ ready: [unit('build'), unit('static')], running: [], concurrency: 1 })).toEqual([0]);
  });
});

describe('resolveLocalCiParallelism', () => {
  const base = { headroom: 6, defaultConcurrency: 4 };
  it('worker 数默认按核数留出余量，至少 2；参数可覆盖', () => {
    expect(resolveLocalCiParallelism({ ...base, cores: 18 })).toEqual({ testWorkers: 12, concurrency: 4 });
    expect(resolveLocalCiParallelism({ ...base, cores: 4 })).toEqual({ testWorkers: 2, concurrency: 4 });
    expect(resolveLocalCiParallelism({ ...base, cores: 18, testWorkers: '8', concurrency: 1 })).toEqual({ testWorkers: 8, concurrency: 1 });
    expect(() => resolveLocalCiParallelism({ ...base, cores: 18, concurrency: '0' })).toThrow('正整数');
  });
});
