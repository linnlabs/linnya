import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { LocalCiPlan, LocalCiStep } from '../definitions/localCiPlan';
import { runLocalCiPlan, signalGroup } from '../orchestration/runLocalCiPlan';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function step(name: string, extra: Partial<LocalCiStep>): LocalCiStep {
  return { key: `wf/job/${name}`, workflow: 'wf.yml', job: 'job', jobLabel: 'WF / job', name, matrix: {}, env: {}, ...extra };
}

it('失败后继续执行，相同步骤复用结果，条件按真实结果求值', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'local-ci-test-'));
  directories.push(root);
  const plan: LocalCiPlan = {
    skippedJobs: [],
    steps: [
      step('install', { stepId: 'dependencies', command: 'echo installed >> steps.txt' }),
      step('broken', { command: 'echo before; false; echo never' }),
      step('after failure', { command: 'echo "$GREETING $RUNNER_OS" >> steps.txt', env: { GREETING: 'hello' } }),
      step('install again', { command: 'echo installed >> steps.txt' }),
      step('only on linux', { condition: "runner.os == 'Linux'", command: 'echo linux >> steps.txt' }),
      step('needs install', { condition: "steps.dependencies.outcome == 'success' && failure()", command: 'echo guarded >> steps.txt' }),
      step('external', { localSkip: '外部 action' }),
    ],
  };
  const { results } = await runLocalCiPlan(plan, {
    root,
    logDirectory: path.join(root, 'logs'),
    signal: new AbortController().signal,
    concurrency: 1,
    testWorkers: 2,
    onStart: () => {},
    onStep: () => {},
  });

  expect(results.map(result => [result.name, result.outcome])).toEqual([
    ['install', 'success'],
    ['broken', 'failure'],
    ['after failure', 'success'],
    ['install again', 'success'],
    ['only on linux', 'skipped'],
    ['needs install', 'success'],
    ['external', 'skipped'],
  ]);
  expect(results[3]?.note).toContain('复用结果');
  expect(results[3]?.reusedFrom).toBe('wf/job/install');
  expect(readFileSync(path.join(root, 'steps.txt'), 'utf8')).toBe('installed\nhello macOS\nguarded\n');
  // 日志首行回显命令；之后是输出：bash -e 在 false 处停下，不会执行后面的 echo。
  const brokenOutput = readFileSync(results[1]!.log!, 'utf8').split('\n').slice(1).join('\n');
  expect(brokenOutput).toContain('before');
  expect(brokenOutput).not.toContain('never');
  expect(brokenOutput).toContain('[exit 1]');
});

function scratch(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'local-ci-test-'));
  directories.push(root);
  return root;
}

function options(root: string, extra: Partial<Parameters<typeof runLocalCiPlan>[1]> = {}): Parameters<typeof runLocalCiPlan>[1] {
  return {
    root,
    logDirectory: path.join(root, 'logs'),
    signal: new AbortController().signal,
    concurrency: 4,
    testWorkers: 3,
    onStart: () => {},
    onStep: () => {},
    killGraceMs: 500,
    ...extra,
  };
}

it('同一轮调度里两个任务同时就绪，只启动一次业务测试，两个任务都收到失败', async () => {
  const root = scratch();
  const steps = ['packages', 'regression'].map(job => step('cases', {
    key: `${job}/cases`, job, jobLabel: job, command: 'echo ran >> runs.txt; exit 1',
  }));
  const schedule = { 'wf.yml': { packages: { cases: 'test' }, regression: { cases: 'test' } } } as const;
  const { results } = await runLocalCiPlan({ steps, skippedJobs: [] }, options(root, { schedule }));
  expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe('ran\n');
  expect(results.map(result => result.outcome)).toEqual(['failure', 'failure']);
  expect(results[1]?.reusedFrom).toBe(results[0]?.key);
});

/** 每个步骤在开始和结束时各写一行，事后按顺序检查哪些步骤重叠过。 */
function traced(name: string, seconds: number): string {
  return `echo "start ${name}" >> trace.txt; sleep ${seconds}; echo "end ${name}" >> trace.txt`;
}

function overlaps(trace: string): Set<string> {
  const active = new Set<string>();
  const pairs = new Set<string>();
  for (const line of trace.trim().split('\n')) {
    const [event, name] = line.split(' ') as [string, string];
    if (event === 'start') {
      for (const other of active) pairs.add([other, name].sort().join('+'));
      active.add(name);
    } else active.delete(name);
  }
  return pairs;
}

/**
 * 进程是否仍在运行。刚被杀、尚未被回收的僵尸对 kill(pid, 0) 仍返回成功，
 * 但它已经退出了，所以按 ps 的状态把僵尸（stat 以 Z 开头）算作已退出。
 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    return stat !== '' && !stat.startsWith('Z');
  } catch {
    return false;
  }
}

it('源码检查与构建并行，构建之间、构建与测试之间不重叠，负载敏感步骤单独执行', async () => {
  const root = scratch();
  const lane = (job: string, steps: readonly [string, string][]) =>
    steps.map(([name, command], index) => ({
      key: `wf.yml/${job}/${index + 1}`,
      workflow: 'wf.yml',
      job,
      jobLabel: `WF / ${job}`,
      name,
      matrix: {},
      env: {},
      command,
    }));
  const plan: LocalCiPlan = {
    skippedJobs: [],
    steps: [
      ...lane('gates', [['lint', traced('lint', 0.6)]]),
      ...lane('app', [['build-a', traced('build-a', 0.3)], ['test-a', traced('test-a', 0.3)], ['probe', traced('probe', 0.2)]]),
      ...lane('other', [['build-b', traced('build-b', 0.3)], ['test-b', traced('test-b', 0.3)]]),
    ],
  };
  const schedule = {
    'wf.yml': {
      gates: { lint: 'static' },
      app: { 'build-a': 'build', 'test-a': 'test', probe: 'loadSensitive' },
      other: { 'build-b': 'build', 'test-b': 'test' },
    },
  } as const;
  const { results } = await runLocalCiPlan(plan, options(root, { schedule }));

  expect(results.map(result => [result.name, result.outcome, result.kind])).toEqual([
    ['lint', 'success', 'static'],
    ['build-a', 'success', 'build'],
    ['test-a', 'success', 'test'],
    ['probe', 'success', 'loadSensitive'],
    ['build-b', 'success', 'build'],
    ['test-b', 'success', 'test'],
  ]);
  const pairs = overlaps(readFileSync(path.join(root, 'trace.txt'), 'utf8'));
  expect(pairs.has('build-a+lint')).toBe(true);
  expect(pairs.has('test-a+test-b')).toBe(true);
  for (const forbidden of ['build-a+build-b', 'build-a+test-b', 'build-b+test-a']) expect(pairs.has(forbidden)).toBe(false);
  expect([...pairs].filter(pair => pair.includes('probe'))).toEqual([]);
  expect(readFileSync(path.join(root, 'trace.txt'), 'utf8').trim().split('\n').slice(-2)).toEqual(['start probe', 'end probe']);
});

it('测试分片合并为一次运行：只执行一次，每个分片都有指向合并运行的结果；失败只算一次', async () => {
  const root = scratch();
  const plan: LocalCiPlan = {
    skippedJobs: [],
    steps: [1, 2, 3].flatMap(shard => [
      { key: `wf.yml/shards (shard=${shard})/1`, workflow: 'wf.yml', job: 'shards', jobLabel: `WF / shards (${shard}/3)`, name: 'build', matrix: { shard }, env: {}, command: 'echo build >> runs.txt' },
      {
        key: `wf.yml/shards (shard=${shard})/2`,
        workflow: 'wf.yml',
        job: 'shards',
        jobLabel: `WF / shards (${shard}/3)`,
        name: 'test',
        matrix: { shard },
        env: {},
        command: `echo vitest run --maxWorkers=2 --shard=${shard}/3 >> runs.txt; echo " Test Files  9 passed (9)"; false`,
      },
    ]),
  };
  const schedule = { 'wf.yml': { shards: { build: 'build', test: 'test' } } } as const;
  const { results, mergedTestRuns } = await runLocalCiPlan(plan, options(root, { schedule }));

  expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe('build\nvitest run --maxWorkers=3\n');
  expect(results).toHaveLength(6);
  const tests = results.filter(result => result.name === 'test');
  expect(tests.map(result => result.outcome)).toEqual(['failure', 'failure', 'failure']);
  expect(tests.map(result => result.mergedRun)).toEqual(Array(3).fill('wf.yml/shards (shard=1)/2'));
  expect(tests.filter(result => !result.reusedFrom)).toHaveLength(1);
  expect(mergedTestRuns).toEqual([
    expect.objectContaining({
      key: 'wf.yml/shards (shard=1)/2',
      shards: [1, 2, 3],
      total: 3,
      testWorkers: 3,
      outcome: 'failure',
      testFiles: '9 passed (9)',
      steps: [1, 2, 3].map(shard => `wf.yml/shards (shard=${shard})/2`),
    }),
  ]);
});

/**
 * 模拟 vitest：worker 数大于 1（并发）时报告一个超时失败；只用 1 个 worker 单独跑时，
 * FLAKY=1 表示通过（负载下的偶发），否则照样失败（确定性失败）。
 */
const FAKE_VITEST = `#!/usr/bin/env bash
echo "$*" >> runs.txt
if [[ " $* " == *" --maxWorkers=1 "* && "$FLAKY" == 1 ]]; then echo " Test Files  1 passed (1)"; exit 0; fi
cat <<'OUT'
stderr | sub/other.test.ts > 打印日志
Error: 测试自己打印的错误日志，不是失败
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sub/supervisor.test.ts > 进程监管 > 负载下按时就绪
Error: Test timed out in 5000ms.
 ❯ sub/supervisor.test.ts:12:3

⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 9 passed (10)
OUT
exit 1
`;

it.each([
  { flaky: '1', rerunOutcome: 'success' },
  { flaky: '0', rerunOutcome: 'failure' },
])('合并测试失败后单独串行重跑失败文件（FLAKY=$flaky）：重跑结果记进摘要，本轮仍判失败', async ({ flaky, rerunOutcome }) => {
  const root = scratch();
  writeFileSync(path.join(root, 'fake-vitest.sh'), FAKE_VITEST);
  const plan: LocalCiPlan = {
    skippedJobs: [],
    steps: [1, 2].map(shard => ({
      key: `wf.yml/shards (shard=${shard})/1`,
      workflow: 'wf.yml',
      job: 'shards',
      jobLabel: `WF / shards (${shard}/2)`,
      name: 'test',
      matrix: { shard },
      env: { FLAKY: flaky },
      command: `bash fake-vitest.sh vitest run --maxWorkers=2 --shard=${shard}/2`,
    })),
  };
  const reruns: string[] = [];
  const { results } = await runLocalCiPlan(
    plan,
    options(root, { schedule: { 'wf.yml': { shards: { test: 'test' } } }, onIsolatedRerun: (_, rerun) => reruns.push(rerun.outcome) })
  );

  expect(readFileSync(path.join(root, 'runs.txt'), 'utf8')).toBe(
    "vitest run --maxWorkers=3\nvitest run --maxWorkers=1 sub/supervisor.test.ts\n"
  );
  expect(results.map(result => result.outcome)).toEqual(['failure', 'failure']);
  const digest = results[0]!.failureDigest!;
  expect(digest.failedTests.map(failure => [failure.file, failure.test, failure.message[0]])).toEqual([
    ['sub/supervisor.test.ts', '进程监管 > 负载下按时就绪', 'Error: Test timed out in 5000ms.'],
  ]);
  expect(digest.isolatedRerun).toEqual(
    expect.objectContaining({ files: ['sub/supervisor.test.ts'], command: "bash fake-vitest.sh vitest run --maxWorkers=1 'sub/supervisor.test.ts'", outcome: rerunOutcome })
  );
  expect(existsSync(digest.isolatedRerun!.log)).toBe(true);
  expect(reruns).toEqual([rerunOutcome]);
  // 摘要只挂在真正执行的那一步上；被合并的分片指向它。
  expect(results[1]!.failureDigest).toBeUndefined();
  expect(results[1]!.reusedFrom).toBe(results[0]!.key);
});

it('命令退出后回收组里残留的后台进程；中断时停掉正在运行的步骤', async () => {
  const root = scratch();
  const leftover = {
    key: 'wf.yml/job/1', workflow: 'wf.yml', job: 'job', jobLabel: 'WF / job', name: 'leftover', matrix: {}, env: {},
    command: 'sleep 30 > /dev/null 2>&1 & echo $! > leftover.pid',
  };
  await runLocalCiPlan({ skippedJobs: [], steps: [leftover] }, options(root));
  const leftoverPid = Number(readFileSync(path.join(root, 'leftover.pid'), 'utf8'));
  await expect.poll(() => isAlive(leftoverPid), { timeout: 3000 }).toBe(false);

  const controller = new AbortController();
  const long = { ...leftover, name: 'long', command: 'sleep 30 & echo $! > long.pid; wait' };
  const started = Date.now();
  const run = runLocalCiPlan({ skippedJobs: [], steps: [long] }, options(root, { signal: controller.signal }));
  await expect.poll(() => existsSync(path.join(root, 'long.pid')), { timeout: 3000 }).toBe(true);
  controller.abort();
  const { results } = await run;
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(results.map(result => result.outcome)).toEqual(['failure']);
  const longPid = Number(readFileSync(path.join(root, 'long.pid'), 'utf8'));
  // 回收由内核与 launchd 异步完成，和前半段一样轮询，避免在慢机器上撞到退出的瞬间。
  await expect.poll(() => isAlive(longPid), { timeout: 3000 }).toBe(false);
});

it('进程组里没有活着的成员时（ESRCH，或 macOS 的僵尸进程 EPERM）忽略，其他错误照常抛出', () => {
  const failing = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };
  expect(() => signalGroup(4242, 'SIGTERM', failing('ESRCH') as typeof process.kill)).not.toThrow();
  expect(() => signalGroup(4242, 'SIGTERM', failing('EPERM') as typeof process.kill)).not.toThrow();
  expect(() => signalGroup(4242, 'SIGTERM', failing('EINVAL') as typeof process.kill)).toThrow('EINVAL');
  const sent: [number, NodeJS.Signals | number | undefined][] = [];
  signalGroup(4242, 'SIGKILL', ((pid: number, signal?: NodeJS.Signals | number) => {
    sent.push([pid, signal]);
    return true;
  }) as typeof process.kill);
  expect(sent).toEqual([[-4242, 'SIGKILL']]);
});
