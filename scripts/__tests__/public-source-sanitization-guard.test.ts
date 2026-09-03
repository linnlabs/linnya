import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  analyzePublicTextForSourceSanitization,
  runPublicSourceSanitizationGuard,
} from '../guards/public-source-sanitization-guard';

function createPrivateUserSegment(): string {
  return ['local', 'developer'].join('-');
}

describe('public source sanitization guard', () => {
  it('拒绝 macOS、Linux 与 Windows 用户目录', () => {
    const user = createPrivateUserSegment();
    const macPath = ['/Users', user, 'code/project'].join('/');
    const linuxPath = ['/home', user, 'code/project'].join('/');
    const windowsPath = ['C:', 'Users', user, 'code', 'project'].join('\\');
    const content = [macPath, `file://${linuxPath}`, windowsPath].join('\n');

    expect(analyzePublicTextForSourceSanitization('fixture.txt', content)).toEqual([
      { file: 'fixture.txt', line: 1, reason: 'user-home-path' },
      { file: 'fixture.txt', line: 2, reason: 'user-home-path' },
      { file: 'fixture.txt', line: 3, reason: 'user-home-path' },
    ]);
  });

  it('拒绝机器卷、macOS 用户临时目录并保留精确行号', () => {
    const volume = ['team', 'disk'].join('-');
    const machineVolumePath = ['/Volumes', volume, 'project'].join('/');
    const userTemporaryPath = ['/private/var', 'folders', 'aa', 'cache'].join('/');
    const content = ['header', machineVolumePath, userTemporaryPath].join('\n');

    expect(analyzePublicTextForSourceSanitization('fixture.md', content)).toEqual([
      { file: 'fixture.md', line: 2, reason: 'machine-volume-path' },
      { file: 'fixture.md', line: 3, reason: 'macos-user-temporary-path' },
    ]);
  });

  it('允许公开占位符、动态变量、系统路径与仓库内模块路径', () => {
    const content = [
      '/Users/name/project',
      '/home/example/project',
      'C:/Users/${sshUser}/AppData/Local/Temp',
      '/Users/<用户名>/Documents/Linnya',
      '/usr/bin/codesign',
      '/System/Library/Fonts',
      '@/domains/workspace/ui/home/ProjectKbSettingsPanel.vue',
    ].join('\n');

    expect(analyzePublicTextForSourceSanitization('fixture.ts', content)).toEqual([]);
  });

  it('拒绝盘符根下的开发 checkout 与已退役产品身份', () => {
    const checkoutPath = ['D:', 'code', 'private-project'].join('/');
    const checkoutFileUrl = `file:///${['E:', 'workspaces', 'private-project'].join('/')}`;
    const retiredProductName = ['Ting', 'Talk'].join('');
    const content = [
      checkoutPath,
      checkoutFileUrl,
      `legacy=${retiredProductName}_official_version`,
    ].join('\n');

    expect(analyzePublicTextForSourceSanitization('fixture.ts', content)).toEqual([
      { file: 'fixture.ts', line: 1, reason: 'windows-development-root-path' },
      { file: 'fixture.ts', line: 2, reason: 'windows-development-root-path' },
      { file: 'fixture.ts', line: 3, reason: 'retired-product-name' },
    ]);
  });

  it('扫描 Git 候选文件并排除已忽略的本地文件', () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'linnya-public-path-guard-'));
    const user = createPrivateUserSegment();
    const privatePath = ['/Users', user, 'code/project'].join('/');

    try {
      execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot });
      writeFileSync(path.join(repositoryRoot, '.gitignore'), 'ignored.txt\n');
      writeFileSync(path.join(repositoryRoot, 'ignored.txt'), privatePath);
      writeFileSync(path.join(repositoryRoot, 'candidate.md'), `safe\n${privatePath}\n`);

      expect(runPublicSourceSanitizationGuard(repositoryRoot)).toEqual([
        { file: 'candidate.md', line: 2, reason: 'user-home-path' },
      ]);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });
});
