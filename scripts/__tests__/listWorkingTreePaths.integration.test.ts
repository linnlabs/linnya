import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it('大仓库的 Git 文件清单超过 1 MiB 时仍包含新增文件并排除已删除文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'working-tree-paths-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: '', encoding: 'utf8' }).trim();
    // 用真实 index 产生大清单；不必在磁盘上创建数千个文件。
    const paths = Array.from({ length: 6000 }, (_, i) => `deleted/${i}-${'x'.repeat(185)}.ts`);
    execFileSync('git', ['update-index', '--index-info'], {
      cwd: root, input: paths.map(path => `100644 ${blob}\t${path}\n`).join(''),
    });
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/kept.ts'), 'export {};\n'); git('add', 'src/kept.ts');
    writeFileSync(join(root, 'src/new.ts'), 'export {};\n');
    const moduleUrl = pathToFileURL(resolve('scripts/source-analysis/listWorkingTreePaths.ts')).href;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { listWorkingTreePaths } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(listWorkingTreePaths()));`,
    ], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(output)).toEqual(['src/kept.ts', 'src/new.ts']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
