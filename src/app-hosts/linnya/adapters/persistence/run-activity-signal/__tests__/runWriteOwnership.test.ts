import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

/**
 * 侧栏运行状态靠 runs 写入后的失效信号刷新，没有定时轮询兜底。新的 runs 写入 SQL 若不发信号，
 * 侧栏会停在旧状态，所以写入点固定在下列文件，且每个文件都要调用 notifyRunActivityChanged。
 */
const RUN_WRITERS = [
  'src/app-hosts/linnya/adapters/persistence/event-store/history-mutation/functions/sqliteHistoryMutation.ts',
  'src/app-hosts/linnya/adapters/persistence/event-store/sqlite.implementation.ts',
  'src/app-hosts/linnya/adapters/persistence/run-registry/sqlite-run-registry.store.ts',
];

const SCAN_ROOTS = ['src', 'apps', 'packages'];
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', '__tests__', '__test-helpers__']);
const RUNS_WRITE = /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+runs\b/i;
const repositoryRoot = path.resolve(__dirname, '../../../../../../..');

function collectSourceFiles(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) collectSourceFiles(path.join(directory, entry.name), files);
    } else if (/\.(ts|mts|js|mjs)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
}

function readCode(file: string): string {
  // 去掉注释，避免“UPDATE runs 后提交”之类的说明被当成写入。
  return fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

it('runs 表只在发出运行状态信号的文件里写入', () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectSourceFiles(path.join(repositoryRoot, root), files);
  const writers = files
    .filter(file => RUNS_WRITE.test(readCode(file)))
    .map(file => path.relative(repositoryRoot, file).split(path.sep).join('/'))
    .sort();
  expect(writers).toEqual(RUN_WRITERS);
  for (const writer of RUN_WRITERS) {
    expect(readCode(path.join(repositoryRoot, writer)), writer).toContain('notifyRunActivityChanged(');
  }
});
