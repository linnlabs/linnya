import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { buildLocalCiPlan } from '../functions/buildLocalCiPlan';
import { evaluateWorkflowCondition, substituteWorkflowExpressions } from '../functions/evaluateWorkflowCondition';
import { UnsupportedWorkflowExpression, type WorkflowConditionContext } from '../definitions/localCiPlan';

const context: WorkflowConditionContext = {
  runnerOs: 'macOS',
  matrix: { os: 'macos-latest', shard: 2 },
  stepOutcomes: { dependencies: 'success', 'linux-display': 'skipped' },
  jobFailed: false,
};

describe('evaluateWorkflowCondition', () => {
  it('按 macOS runner 判断仓库里实际用到的条件', () => {
    expect(evaluateWorkflowCondition("runner.os == 'Linux'", context)).toBe(false);
    expect(evaluateWorkflowCondition("runner.os != 'Linux'", context)).toBe(true);
    expect(evaluateWorkflowCondition("runner.os == 'macos'", context)).toBe(true);
    expect(
      evaluateWorkflowCondition("${{ !cancelled() && runner.os != 'Linux' && steps.dependencies.outcome == 'success' }}", context)
    ).toBe(true);
    expect(
      evaluateWorkflowCondition("${{ !cancelled() && steps.dependencies.outcome == 'success' && steps.linux-display.outcome == 'success' }}", context)
    ).toBe(false);
    expect(evaluateWorkflowCondition('always()', { ...context, jobFailed: true })).toBe(true);
    expect(evaluateWorkflowCondition('success()', { ...context, jobFailed: true })).toBe(false);
    expect(evaluateWorkflowCondition("(matrix.shard == 1) || matrix.os == 'macos-latest'", context)).toBe(true);
  });

  it('本地拿不到的值明确报告，不猜', () => {
    expect(() => evaluateWorkflowCondition("github.event_name == 'push'", context)).toThrow(UnsupportedWorkflowExpression);
    expect(() => substituteWorkflowExpressions('${{ needs.test-shards.result }}', context)).toThrow(UnsupportedWorkflowExpression);
    expect(() => evaluateWorkflowCondition("contains(runner.os, 'mac')", context)).toThrow(UnsupportedWorkflowExpression);
  });

  it('替换命令里的矩阵值', () => {
    expect(substituteWorkflowExpressions('vitest --shard=${{ matrix.shard }}/3', context)).toBe('vitest --shard=2/3');
  });
});

const workflow = YAML.parse(`
name: Sample
env:
  SHARED: one
jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Gate
        run: pnpm run guard
  matrix-job:
    name: Build (\${{ matrix.os }})
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-24.04, macos-latest, windows-2022]
    steps:
      - name: Linux only
        if: runner.os == 'Linux'
        run: echo linux
      - name: Shard
        env:
          TARGET: \${{ matrix.os }}
        run: echo \${{ matrix.os }}
      - uses: actions/upload-artifact@v4
        with:
          path: |
            _dev_data/probe
            _dev_data/other
  windows-only:
    runs-on: windows-2022
    steps:
      - run: echo win
  aggregate:
    needs: [gates]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Require
        env:
          RESULT: \${{ needs.gates.result }}
        run: test "$RESULT" = success
`);

describe('buildLocalCiPlan', () => {
  const plan = buildLocalCiPlan([{ file: 'sample.yml', document: workflow }]);

  it('矩阵只取 macOS 组合，其余组合列为只能由 GitHub 验证', () => {
    const matrixSteps = plan.steps.filter(step => step.job === 'matrix-job');
    expect(new Set(matrixSteps.map(step => step.jobLabel))).toEqual(new Set(['Sample / Build (macos-latest)']));
    expect(matrixSteps.find(step => step.name === 'Shard')).toMatchObject({ command: 'echo macos-latest', env: { SHARED: 'one', TARGET: 'macos-latest' } });
    expect(matrixSteps.find(step => step.name === 'Linux only')?.condition).toBe("runner.os == 'Linux'");
    expect(plan.skippedJobs.filter(job => job.job === 'matrix-job').map(job => job.reason)).toEqual([
      '(os=ubuntu-24.04) 不在 macOS 上运行，只能由 GitHub 验证',
      '(os=windows-2022) 不在 macOS 上运行，只能由 GitHub 验证',
    ]);
  });

  it('固定 Linux 的任务按可移植任务执行，只在 Windows 的任务跳过', () => {
    expect(plan.steps.find(step => step.name === 'Gate')?.jobLabel).toContain('原 Linux 任务');
    expect(plan.skippedJobs.find(job => job.job === 'windows-only')?.reason).toContain('windows-2022');
  });

  it('外部 action 只报告；上传步骤带出证据路径；依赖其他任务结果的步骤标为本地无法判断', () => {
    expect(plan.steps.find(step => step.name === 'actions/checkout')?.localSkip).toContain('外部 action');
    expect(plan.steps.find(step => step.name === 'actions/upload-artifact')?.evidencePaths).toEqual(['_dev_data/probe', '_dev_data/other']);
    expect(plan.steps.find(step => step.name === 'Require')?.localSkip).toContain('本地无法判断');
  });

  it('按工作流和任务筛选', () => {
    const filtered = buildLocalCiPlan([{ file: 'sample.yml', document: workflow }], { workflows: ['sample'], jobs: ['gates'] });
    expect(new Set(filtered.steps.map(step => step.job))).toEqual(new Set(['gates']));
    expect(buildLocalCiPlan([{ file: 'sample.yml', document: workflow }], { workflows: ['other.yml'] }).steps).toEqual([]);
  });
});
