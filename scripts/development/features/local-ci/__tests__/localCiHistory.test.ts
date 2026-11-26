import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LOCAL_CI_HISTORY_FILE } from '../definitions/localCiHistory';
import { buildLocalCiHistoryEntry, summarizeLocalCiLoad } from '../functions/buildLocalCiHistoryEntry';
import { pruneLocalCiRuns } from '../orchestration/pruneLocalCiRuns';
import { appendLocalCiHistory, type LocalCiStepResult } from '../orchestration/runLocalCiPlan';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const failedTests: LocalCiStepResult = {
  key: 'ci.yml/test-shards (shard=1)/7', jobLabel: 'Public Required / Public tests (1/3) 等 3 个分片', name: 'Run tests', outcome: 'failure',
  durationMs: 120_000, kind: 'test',
  failureDigest: {
    kind: 'test', networkFailure: false, failedTestCount: 1, failedTests: [], failedTestFiles: ['a.test.ts'], tail: [],
    isolatedRerun: { files: ['a.test.ts'], command: 'vitest run --maxWorkers=1 a.test.ts', outcome: 'success', durationMs: 4000, log: '/x' },
  },
};

it('历史行只记趋势要用的事实：失败步骤带类别、网络原因与隔离重跑结果，复用结果的失败只算一次', () => {
  // 入口传进来的是完整的步骤结果，历史行只取其中几项。
  const results: LocalCiStepResult[] = [
    failedTests,
    { ...failedTests, key: 'ci.yml/test-shards (shard=2)/7', reusedFrom: failedTests.key, failureDigest: undefined },
    { key: 'ci.yml/architecture/3', jobLabel: 'Public Required / Architecture', name: 'Audit', outcome: 'failure', durationMs: 30_000, kind: 'static',
      failureDigest: { kind: 'static', networkFailure: true, failedTestCount: 0, failedTests: [], failedTestFiles: [], tail: [] } },
    { key: 'ci.yml/architecture/1', jobLabel: 'Public Required / Architecture', name: 'Lint', outcome: 'success', durationMs: 9_000, kind: 'static' },
  ];
  const entry = buildLocalCiHistoryEntry({
    run: '2026-11-27T01-00-00', startedAt: '2026-11-27T01:00:00.000Z', finishedAt: '2026-11-27T01:07:00.000Z',
    commit: 'abc', tree: 'def', clean: true, fullScope: true, fullRun: true, passed: false, interrupted: false, durationMs: 420_000,
    load: summarizeLocalCiLoad(14, [6.2, 11.4, 8.9]),
    results,
  });

  expect(entry).toEqual({
    v: 1, run: '2026-11-27T01-00-00', startedAt: '2026-11-27T01:00:00.000Z', finishedAt: '2026-11-27T01:07:00.000Z',
    commit: 'abc', tree: 'def', clean: true, fullScope: true, fullRun: true, passed: false, interrupted: false, durationMs: 420_000,
    load: { cores: 14, samples: 3, mean: 8.83, max: 11.4 },
    failedSteps: [
      { step: 'Public Required / Public tests (1/3) 等 3 个分片 › Run tests', kind: 'test', networkFailure: false, isolatedRerun: 'success' },
      { step: 'Public Required / Architecture › Audit', kind: 'static', networkFailure: true },
    ],
  });
});

it('历史文件逐轮追加，运行目录按保留规则清理后历史仍在', () => {
  const repository = mkdtempSync(path.join(os.tmpdir(), 'local-ci-history-'));
  directories.push(repository);
  const ciDirectory = path.join(repository, '_dev_data/ci-local');
  // 超过保留数量的旧运行目录：清理时会删掉多出来的，但不会碰历史文件。
  for (let index = 0; index < 23; index += 1) {
    const run = path.join(ciDirectory, `2026-11-${String(index + 1).padStart(2, '0')}T01-00-00`);
    mkdirSync(run, { recursive: true });
    writeFileSync(path.join(run, 'summary.json'), JSON.stringify({ tree: `t${index}`, clean: true, fullRun: true, passed: false }));
  }
  const entry = (run: string) => buildLocalCiHistoryEntry({
    run, startedAt: '2026-11-27T01:00:00.000Z', finishedAt: '2026-11-27T01:07:00.000Z', commit: 'c', tree: 't', clean: true,
    fullScope: true, fullRun: true, passed: true, interrupted: false, durationMs: 1, load: summarizeLocalCiLoad(14, []), results: [],
  });
  appendLocalCiHistory(ciDirectory, entry('2026-11-26T01-00-00'));
  appendLocalCiHistory(ciDirectory, entry('2026-11-27T01-00-00'));
  // 临时目录不是 Git 仓库，受保护代码直接给空表。
  const removed = pruneLocalCiRuns(repository, { currentTree: 'none', protectedTrees: [], now: Date.parse('2026-12-31T00:00:00Z') });
  expect(removed).toHaveLength(3);

  const lines = readFileSync(path.join(ciDirectory, LOCAL_CI_HISTORY_FILE), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  expect(lines.map(line => line.run)).toEqual(['2026-11-26T01-00-00', '2026-11-27T01-00-00']);
});
