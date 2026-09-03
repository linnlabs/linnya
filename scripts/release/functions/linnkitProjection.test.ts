import { describe, expect, it } from 'vitest';

import {
  calculateLinnkitProjectionSha256,
  createLinnkitSourceProvenance,
  normalizeGitRepositoryIdentity,
  shouldExportLinnkitPath,
} from './linnkitProjection';

describe('Linnkit release projection', () => {
  it('只导出公开 package 边界', () => {
    expect(shouldExportLinnkitPath('src/index.ts')).toBe(true);
    expect(shouldExportLinnkitPath('docs/integration/context-engineering.md')).toBe(true);
    expect(shouldExportLinnkitPath('docs/release/RELEASE.md')).toBe(false);
    expect(shouldExportLinnkitPath('src/runtime-kernel/README.md')).toBe(false);
    expect(shouldExportLinnkitPath('dist/index.js')).toBe(false);
  });

  it('同一内容不受输入顺序影响，文件模式变化会改变 hash', () => {
    const source = [
      { path: 'b.ts', mode: '100644' as const, content: Buffer.from('b') },
      { path: 'a.ts', mode: '100644' as const, content: Buffer.from('a') },
    ];
    const expected = calculateLinnkitProjectionSha256(source);
    expect(calculateLinnkitProjectionSha256([...source].reverse())).toBe(expected);
    expect(
      calculateLinnkitProjectionSha256([
        source[0],
        { ...source[1], mode: '100755' as const },
      ])
    ).not.toBe(expected);
  });

  it('记录规范化 source repository、完整 commit、版本与投影 hash', () => {
    const entries = [{ path: 'index.ts', mode: '100644' as const, content: Buffer.from('x') }];
    expect(normalizeGitRepositoryIdentity('git@github.com:linnlabs/linnya.git')).toBe(
      'linnlabs/linnya'
    );
    expect(
      createLinnkitSourceProvenance({
        sourceRepository: 'https://github.com/linnlabs/linnya.git',
        sourceCommit: 'a'.repeat(40),
        packageName: '@linnlabs/linnkit',
        packageVersion: '0.31.0',
        entries,
      })
    ).toEqual({
      schemaVersion: 1,
      sourceRepository: 'linnlabs/linnya',
      sourceCommit: 'a'.repeat(40),
      packageName: '@linnlabs/linnkit',
      packageVersion: '0.31.0',
      projectedFileCount: 1,
      projectionSha256: calculateLinnkitProjectionSha256(entries),
    });
  });
});
