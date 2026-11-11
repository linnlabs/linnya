import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

test('真实 Git 盘点保留范围、Vue 原行号与解析缺口，且不修改工作区', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-quality-audit-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', [...args], { cwd: root, encoding: 'utf8' });
  const write = (file: string, content: string): void => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  try {
    git(['init', '--quiet']);
    git([
      '-c',
      'user.name=Audit',
      '-c',
      'user.email=audit@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '--quiet',
      '-m',
      'audit fixture',
    ]);
    write('.gitignore', 'ignored/\n');
    write('src/entry.ts', 'export function read(value: number) { return value + 1; }\n');
    write('src/example.test.ts', 'export const fixture = 1;\n');
    write('src/model.d.ts', 'export declare const model: string;\n');
    write('packages/plugins/canvas/src/model.ts', 'export const model = 1;\n');
    write('packages/plugins/mindmap/src/model.ts', 'export const retired = 1;\n');
    write('ignored/output.ts', 'export const generated = 1;\n');
    write(
      'apps/renderer/store/view.vue',
      [
        '<template><p>function fake() {}</p></template>',
        '<script lang="ts">',
        'export function read(value: number) { return value + 1; }',
        '</script>',
        '<script setup lang="ts">',
        'const update = async () => { await Promise.resolve(); };',
        '</script>',
      ].join('\n')
    );
    write('apps/renderer/Empty.vue', '');
    // 同时覆盖 tracked / untracked，Git index 的选择不应改变源码覆盖范围。
    git(['add', 'src/entry.ts']);
    const before = git(['status', '--porcelain=v1', '--untracked-files=all']);
    const indexBefore = fs.readFileSync(path.join(root, '.git/index'));
    const output = execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
        fileURLToPath(new URL('./auditRepository.ts', import.meta.url)),
      ],
      { cwd: root, encoding: 'utf8' }
    );
    const report: unknown = JSON.parse(output);
    expect(report).toMatchObject({
      scope: {
        counts: {
          production: { files: 4 },
          test: { files: 1 },
          declaration: { files: 1 },
        },
        excluded: ['packages/plugins/mindmap/src/model.ts'],
      },
      functions: [
        { file: 'apps/renderer/store/view.vue', name: 'read', line: 3 },
        { file: 'apps/renderer/store/view.vue', name: 'update', line: 6, async: true },
        { file: 'src/entry.ts', name: 'read', line: 1 },
      ],
      signals: [{ file: 'apps/renderer/store/view.vue', line: 6, rule: 'async-in-store' }],
      parseErrors: [expect.stringContaining('apps/renderer/Empty.vue')],
    });
    expect(git(['status', '--porcelain=v1', '--untracked-files=all'])).toBe(before);
    expect(fs.readFileSync(path.join(root, '.git/index'))).toEqual(indexBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
