import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalCiRunRecord } from '../definitions/localCiRetention';
import { selectLocalCiRunsToPrune } from '../functions/selectLocalCiRunsToPrune';
import { localCiProtectedTrees, parseLocalCiRunTime, pruneLocalCiRuns } from '../orchestration/pruneLocalCiRuns';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** 距 NOW 若干天前的运行目录名，与 ci:local 写目录名的格式一致。 */
function runName(daysAgo: number, extraSeconds = 0): string {
  return new Date(NOW - daysAgo * DAY + extraSeconds * 1000).toISOString().replace(/[:.]/gu, '-').slice(0, 19);
}

type Receipt = { tree?: string; clean?: boolean; fullRun?: boolean; passed?: boolean };
const full = (tree: string): Receipt => ({ tree, clean: true, fullRun: true, passed: true });

function record(name: string, receipt: Receipt | null): LocalCiRunRecord {
  return { name, startedAtMs: parseLocalCiRunTime(name), receipt };
}

const policy = { keepNewest: 3, protectedTrees: ['head'], now: NOW, receiptKeepDays: 7 };

describe('保留规则', () => {
  it('超出最近 N 个的旧运行被删除，最近 N 个不论结果都保留', () => {
    const runs = [0, 1, 2, 3, 4, 5].map(index => record(runName(30 + index), index === 0 ? { tree: 'x', passed: false } : null));
    const doomed = selectLocalCiRunsToPrune(runs, policy);
    // 名字越大越新：30 天前（index 0）最新，35 天前最旧。
    expect(doomed).toEqual([runName(33), runName(34), runName(35)]);
  });

  it('当前 HEAD 代码最新的一份通过回执，即使很旧也保留；更旧的同代码回执可以删', () => {
    const runs = [
      record(runName(0), null),
      record(runName(1), null),
      record(runName(2), null),
      record(runName(40), full('head')),
      record(runName(41), full('head')),
      record(runName(42), full('other')),
    ];
    expect(selectLocalCiRunsToPrune(runs, policy)).toEqual([runName(41), runName(42)]);
  });

  it('代码相同但更新的运行失败了，仍保留更早那份通过的回执', () => {
    const runs = [
      record(runName(0), null),
      record(runName(1), null),
      record(runName(2), null),
      record(runName(30), { tree: 'head', clean: true, fullRun: true, passed: false }),
      record(runName(31), full('head')),
    ];
    expect(selectLocalCiRunsToPrune(runs, policy)).toEqual([runName(30)]);
  });

  it('7 天内通过的完整回执都保留，不论代码是否还是 HEAD；不合格的回执不受保护', () => {
    const runs = [
      record(runName(0), null),
      record(runName(0.5), null),
      record(runName(1), null),
      record(runName(2), full('older-main')),
      record(runName(3), { tree: 'a', clean: true, fullRun: true, passed: false }),
      record(runName(4), { tree: 'b', clean: false, fullRun: true, passed: true }),
      record(runName(5), { tree: 'c', clean: true, fullRun: false, passed: true }),
      record(runName(6.9), full('week-old')),
      record(runName(7.1), full('too-old')),
      record(runName(8), null),
    ];
    expect(selectLocalCiRunsToPrune(runs, policy)).toEqual([runName(3), runName(4), runName(5), runName(7.1), runName(8)]);
  });

  it('多个受保护 tree（其他 worktree 的 HEAD）各保留自己最新的一份', () => {
    const runs = [
      record(runName(0), null),
      record(runName(1), null),
      record(runName(2), null),
      record(runName(20), full('main-tip')),
      record(runName(21), full('branch-tip')),
      record(runName(22), full('branch-tip')),
      record(runName(23), full('nobody')),
    ];
    expect(selectLocalCiRunsToPrune(runs, { ...policy, protectedTrees: ['main-tip', 'branch-tip'] })).toEqual([
      runName(22),
      runName(23),
    ]);
  });

  it('回执读不出的运行（强杀、损坏）只靠最近 N 个保留', () => {
    const runs = [0, 1, 2, 3].map(index => record(runName(20 + index), null));
    expect(selectLocalCiRunsToPrune(runs, policy)).toEqual([runName(23)]);
  });

  it('运行数不超过上限时什么都不删', () => {
    expect(selectLocalCiRunsToPrune([record(runName(50), null)], policy)).toEqual([]);
    expect(selectLocalCiRunsToPrune([], policy)).toEqual([]);
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function temp(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeRun(runsDirectory: string, name: string, receipt: Receipt | null | 'broken'): void {
  const directory = path.join(runsDirectory, name);
  mkdirSync(path.join(directory, 'evidence'), { recursive: true });
  writeFileSync(path.join(directory, '001-step.log'), 'log');
  if (receipt === 'broken') writeFileSync(path.join(directory, 'summary.json'), '{not json');
  else if (receipt) writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ commit: 'c', ...receipt }));
}

describe('清理运行目录', () => {
  it('按规则删除整个运行目录，保留受保护的回执与不是运行结果的条目', () => {
    const runsDirectory = temp('local-ci-runs-');
    const kept = [runName(0), runName(1), runName(2), runName(30), runName(3)];
    writeRun(runsDirectory, runName(0), null);
    writeRun(runsDirectory, runName(1), full('x'));
    writeRun(runsDirectory, runName(2), { tree: 'x', passed: false });
    writeRun(runsDirectory, runName(3), full('recent'));
    writeRun(runsDirectory, runName(30), full('head'));
    writeRun(runsDirectory, runName(31), full('head'));
    writeRun(runsDirectory, runName(32), 'broken');
    writeRun(runsDirectory, runName(33), null);
    mkdirSync(path.join(runsDirectory, 'notes'));
    writeFileSync(path.join(runsDirectory, 'README.txt'), 'not a run');

    const removed = pruneLocalCiRuns(temp('repo-unused-'), {
      runsDirectory, currentTree: 'head', protectedTrees: ['head'], now: NOW, keepNewest: 3,
    });
    expect(removed.sort()).toEqual([runName(31), runName(32), runName(33)].sort());
    expect(readdirSync(runsDirectory).sort()).toEqual([...kept, 'notes', 'README.txt'].sort());
    expect(existsSync(path.join(runsDirectory, runName(31)))).toBe(false);
    expect(existsSync(path.join(runsDirectory, runName(30), 'summary.json'))).toBe(true);
  });

  it('默认保留最近 20 个运行目录', () => {
    const runsDirectory = temp('local-ci-runs-');
    for (let index = 0; index < 24; index += 1) writeRun(runsDirectory, runName(40, index), null);
    const removed = pruneLocalCiRuns(temp('repo-unused-'), { runsDirectory, currentTree: 'head', protectedTrees: [], now: NOW });
    expect(removed).toHaveLength(4);
    expect(readdirSync(runsDirectory)).toHaveLength(20);
    // 删的是最旧的 4 个。
    expect(readdirSync(runsDirectory).sort()[0]).toBe(runName(40, 4));
  });

  it('没有运行目录时什么也不做', () => {
    expect(pruneLocalCiRuns(temp('repo-unused-'), { runsDirectory: path.join(temp('empty-'), 'missing'), currentTree: 'head' })).toEqual([]);
  });

  it('受保护的 tree 包含本次运行和仓库所有 worktree 的 HEAD', () => {
    const repository = temp('local-ci-trees-');
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
    git(repository, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(repository, 'a.txt'), '1\n');
    git(repository, 'add', 'a.txt');
    git(repository, 'commit', '-qm', 'one');
    const mainTree = git(repository, 'rev-parse', 'HEAD^{tree}');
    const branchRoot = path.join(temp('local-ci-branch-'), 'wt');
    git(repository, 'worktree', 'add', '-q', '-b', 'feature', branchRoot);
    writeFileSync(path.join(branchRoot, 'b.txt'), '2\n');
    git(branchRoot, 'add', 'b.txt');
    git(branchRoot, 'commit', '-qm', 'two');
    const featureTree = git(branchRoot, 'rev-parse', 'HEAD^{tree}');
    expect(featureTree).not.toBe(mainTree);

    expect(localCiProtectedTrees(repository, 'current-tree').sort()).toEqual([featureTree, mainTree, 'current-tree'].sort());
    expect(localCiProtectedTrees(path.join(repository, 'not-a-repo'), 'only-current')).toEqual(['only-current']);
  });
});
