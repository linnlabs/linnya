import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { selectPluginCiScope } from '../functions/selectPluginCiScope';

it('按真实 Git 差异和 pnpm 反向依赖选择插件、共享合同与跨包移动', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'plugin-ci-scope-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  const write = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  const scope = () => selectPluginCiScope(root, 'main');
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write('pnpm-workspace.yaml', "packages: ['packages/*', 'packages/plugins/*']\n");
    write('package.json', '{"name":"host","private":true}');
    write('packages/schemas/package.json', '{"name":"@app/schemas","version":"1.0.0"}');
    for (const plugin of ['slides', 'canvas', 'knowledge', 'decision']) {
      write(`packages/plugins/${plugin}/package.json`, JSON.stringify({
        name: `@plugin/${plugin}`, version: '1.0.0', dependencies: { '@app/schemas': 'workspace:*' },
      }));
      write(`packages/plugins/${plugin}/src/source.ts`, 'original');
    }
    write('packages/schemas/shared.ts', 'shared');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('switch', '-qc', 'work');
    // 基线前进后仍按共同祖先比较；文件名里的空白和换行都保留。
    git('switch', '-q', 'main');
    write('host.ts', 'advanced');
    git('add', '.');
    git('commit', '-qm', 'main advanced');
    git('switch', '-q', 'work');
    for (const plugin of ['canvas', 'decision', 'knowledge']) {
      const file = `packages/plugins/${plugin}/src/source.ts`;
      write(file, 'changed');
      const jobs = plugin === 'canvas' ? ['public', 'owner', 'canvas-regression'] : ['public', 'owner'];
      expect(scope()).toMatchObject({ scope: plugin, jobs });
      git('restore', file);
    }
    const slide = 'packages/plugins/slides/resources/new skill\nfile.md';
    write(slide, 'skill');
    expect(scope()).toMatchObject({ scope: 'slides', jobs: ['public', 'owner'], files: [slide], affectedPackages: ['@plugin/slides'] });
    git('add', '.');
    expect(scope().scope).toBe('slides');
    git('commit', '-qm', 'slides only');
    expect(scope().scope).toBe('slides');
    write('packages/plugins/decision/src/source.ts', 'changed');
    expect(scope().scope).toBe('full');
    git('restore', 'packages/plugins/decision/src/source.ts');
    git('mv', 'packages/schemas/shared.ts', 'packages/plugins/slides/src/moved.ts');
    expect(scope()).toMatchObject({ scope: 'full', jobs: ['public', 'platform', 'canvas-regression'], affectedPackages: [
      '@app/schemas', '@plugin/canvas', '@plugin/decision', '@plugin/knowledge', '@plugin/slides',
    ] });
    git('commit', '-qm', 'move');
    write('packages/plugins/knowledge/package.json', '{"name":"@plugin/knowledge","dependencies":{"@plugin/slides":"workspace:*"}}');
    git('add', '.');
    git('commit', '-qm', 'cross-plugin consumer');
    write(slide, 'updated');
    expect(selectPluginCiScope(root, 'HEAD')).toMatchObject({ scope: 'full', affectedPackages: ['@plugin/knowledge', '@plugin/slides'] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
