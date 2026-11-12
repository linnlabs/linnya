import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { LocalCiPlan, LocalCiStep } from '../definitions/localCiPlan';
import { runLocalCiPlan } from '../orchestration/runLocalCiPlan';

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
  const results = await runLocalCiPlan(plan, {
    root,
    logDirectory: path.join(root, 'logs'),
    signal: new AbortController().signal,
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
  expect(readFileSync(path.join(root, 'steps.txt'), 'utf8')).toBe('installed\nhello macOS\nguarded\n');
  // 日志首行回显命令；之后是输出：bash -e 在 false 处停下，不会执行后面的 echo。
  const brokenOutput = readFileSync(results[1]!.log!, 'utf8').split('\n').slice(1).join('\n');
  expect(brokenOutput).toContain('before');
  expect(brokenOutput).not.toContain('never');
  expect(brokenOutput).toContain('[exit 1]');
});
