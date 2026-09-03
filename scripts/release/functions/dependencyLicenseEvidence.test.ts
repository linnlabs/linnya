import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';
import { validateDependencyLicenseEvidence } from './dependencyLicenseEvidence';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture(): {
  readonly rootDir: string;
  readonly installedRoot: string;
  readonly evidence: readonly DependencyLicenseEvidence[];
  readonly report: unknown;
  readonly lockfile: string;
} {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-license-evidence-'));
  temporaryDirectories.push(rootDir);
  const installedRoot = path.join(rootDir, 'node_modules', 'dependency');
  fs.mkdirSync(installedRoot, { recursive: true });
  fs.writeFileSync(path.join(installedRoot, 'LICENSE'), 'license text');
  const evidence = [
    {
      packageName: 'dependency',
      versions: ['1.0.0'],
      disposition: 'resolved',
      license: 'MIT',
      source: 'https://example.test/dependency',
      integrity: 'sha512-integrity',
      licenseFile: {
        relativePath: 'LICENSE',
        sha256: '086ef1421303f033b3b925a9c783576ff65dc9d44a1aeadbd5fac5e61953ca26',
      },
    },
    {
      packageName: 'owned-runtime',
      versions: [null],
      disposition: 'public-blocker',
      license: null,
      source: 'packages/owned-runtime',
    },
  ] as const satisfies readonly DependencyLicenseEvidence[];
  return {
    rootDir,
    installedRoot,
    evidence,
    report: {
      Unknown: [
        { name: 'dependency', versions: ['1.0.0'], paths: [installedRoot] },
        { name: 'owned-runtime', versions: [null], paths: [installedRoot] },
      ],
    },
    lockfile: 'packages:\n  dependency@1.0.0:\n    resolution: {integrity: sha512-integrity}\n',
  };
}

describe('dependency license evidence', () => {
  it('准备期只允许精确登记的已解除项和公开阻断项', () => {
    const fixture = createFixture();
    const result = validateDependencyLicenseEvidence({ ...fixture, publicCandidate: false });

    expect(result.problems).toEqual([]);
    expect(result.resolvedUnknowns).toEqual(['dependency']);
    expect(result.publicBlockers).toEqual(['owned-runtime']);
  });

  it('公开候选拒绝仍未取得许可证的自有运行时', () => {
    const fixture = createFixture();
    const result = validateDependencyLicenseEvidence({ ...fixture, publicCandidate: true });

    expect(result.problems).toContainEqual({
      packageName: 'owned-runtime',
      message: '公开候选不允许保留许可证阻断项。',
    });
  });

  it('拒绝新增 Unknown 和版本漂移', () => {
    const fixture = createFixture();
    const result = validateDependencyLicenseEvidence({
      ...fixture,
      report: {
        Unknown: [
          { name: 'dependency', versions: ['2.0.0'], paths: [fixture.installedRoot] },
          { name: 'owned-runtime', versions: [null], paths: [fixture.installedRoot] },
          { name: 'new-unknown', versions: ['1.0.0'], paths: [fixture.installedRoot] },
        ],
      },
      publicCandidate: false,
    });

    expect(result.problems).toEqual(
      expect.arrayContaining([
        {
          packageName: 'dependency',
          message: 'Unknown license 版本与已核权 evidence 不一致。',
        },
        { packageName: 'new-unknown', message: '出现未登记的 Unknown license。' },
      ])
    );
  });

  it('拒绝许可证文件 hash 漂移', () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.installedRoot, 'LICENSE'), 'changed');
    const result = validateDependencyLicenseEvidence({ ...fixture, publicCandidate: false });

    expect(result.problems).toContainEqual({
      packageName: 'dependency',
      message: '随包许可证文件缺失、越界或 hash 与 evidence 不一致。',
    });
  });

  it('拒绝锁文件 integrity 漂移', () => {
    const fixture = createFixture();
    const result = validateDependencyLicenseEvidence({
      ...fixture,
      lockfile: 'packages:\n  dependency@1.0.0:\n    resolution: {integrity: sha512-changed}\n',
      publicCandidate: false,
    });

    expect(result.problems).toContainEqual({
      packageName: 'dependency',
      message: '锁文件 integrity 与已核权 evidence 不一致。',
    });
  });
});
