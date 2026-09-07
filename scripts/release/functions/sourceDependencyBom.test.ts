import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { DependencyLicenseEvidence } from '../definitions/dependencyLicenseEvidence';
import { createSourceDependencyBom } from './sourceDependencyBom';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function createInstalledPackage(input: {
  readonly license: string;
  readonly licenseText?: string;
  readonly name: string;
  readonly rootDir: string;
  readonly source: string;
  readonly version: string;
}): string {
  const encodedName = input.name.replaceAll('/', '+').replaceAll('@', '');
  const installedRoot = path.join(
    input.rootDir,
    'node_modules',
    '.pnpm',
    `${encodedName}@${input.version}`,
    'node_modules',
    ...input.name.split('/')
  );
  fs.mkdirSync(installedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installedRoot, 'package.json'),
    JSON.stringify({
      name: input.name,
      version: input.version,
      license: input.license,
      repository: { url: input.source },
    }),
    'utf8'
  );
  if (input.licenseText) {
    fs.writeFileSync(path.join(installedRoot, 'LICENSE'), input.licenseText, 'utf8');
  }
  return installedRoot;
}

describe('source dependency BOM', () => {
  it('生成不含本机路径的确定性 package inventory，并保留随包许可证文本', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-source-bom-'));
    try {
      const alphaRoot = createInstalledPackage({
        rootDir,
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        source: 'git+https://github.com/example/alpha.git',
        licenseText: 'Alpha MIT license\n',
      });
      const betaLicense = 'Beta resolved license\n';
      const betaRoot = createInstalledPackage({
        rootDir,
        name: 'beta',
        version: '2.0.0',
        license: 'Unknown',
        source: 'https://github.com/example/beta',
        licenseText: betaLicense,
      });
      const gammaRoot = createInstalledPackage({
        rootDir,
        name: 'gamma',
        version: '3.0.0',
        license: '(MIT OR GPL-3.0-only)',
        source: 'https://github.com/example/gamma',
      });
      const unknownLicenseEvidence: readonly DependencyLicenseEvidence[] = [
        {
          packageName: 'beta',
          versions: ['2.0.0'],
          disposition: 'resolved',
          license: 'MIT',
          source: 'https://github.com/example/beta',
          integrity: 'sha512-beta',
          licenseFile: { relativePath: 'LICENSE', sha256: sha256(betaLicense) },
        },
      ];
      const result = createSourceDependencyBom({
        rootDir,
        projectManifest: { name: 'linnya', version: '1.0.0' },
        lockfile: `packages:
  alpha@1.0.0:
    resolution: {integrity: sha512-alpha}
  beta@2.0.0:
    resolution: {integrity: sha512-beta}
  gamma@3.0.0:
    resolution: {integrity: sha512-gamma}
`,
        licenseReport: {
          MIT: [{ name: 'alpha', versions: ['1.0.0'], paths: [alphaRoot] }],
          Unknown: [{ name: 'beta', versions: ['2.0.0'], paths: [betaRoot] }],
          '(MIT OR GPL-3.0-only)': [{ name: 'gamma', versions: ['3.0.0'], paths: [gammaRoot] }],
        },
        platform: 'darwin',
        architecture: 'arm64',
        licenseSelections: [
          {
            packageName: 'gamma',
            version: '3.0.0',
            declaredExpression: '(MIT OR GPL-3.0-only)',
            selectedExpression: 'MIT',
          },
        ],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        supplementalNotices: [
          {
            id: 'catalog-data',
            title: 'Catalog data',
            source: 'https://example.com/catalog',
            licenseExpression: 'MIT',
            content: 'Catalog MIT license',
          },
        ],
        unknownLicenseEvidence,
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([]);
      expect(result.bom).toMatchObject({
        packageCount: 3,
        manifestOnlyPackageCount: 1,
        platform: 'darwin',
        architecture: 'arm64',
      });
      expect(result.bom?.packages.find(item => item.name === 'gamma')).toMatchObject({
        selectedLicense: 'MIT',
        evidence: 'manifest-only',
      });
      expect(result.notice).toContain('Alpha MIT license');
      expect(result.notice).toContain('Catalog MIT license');
      expect(result.bom?.supplementalNotices).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(rootDir);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('拒绝未解除的 Unknown 与没有精确版本选择的复合许可证', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-source-bom-invalid-'));
    try {
      const unknownRoot = createInstalledPackage({
        rootDir,
        name: 'unknown-package',
        version: '1.0.0',
        license: 'Unknown',
        source: 'https://github.com/example/unknown-package',
      });
      const compoundRoot = createInstalledPackage({
        rootDir,
        name: 'compound-package',
        version: '1.0.0',
        license: '(MIT OR GPL-3.0-only)',
        source: 'https://github.com/example/compound-package',
      });
      const result = createSourceDependencyBom({
        rootDir,
        projectManifest: { name: 'linnya', version: '1.0.0' },
        lockfile: `packages:
  unknown-package@1.0.0:
    resolution: {integrity: sha512-unknown}
  compound-package@1.0.0:
    resolution: {integrity: sha512-compound}
`,
        licenseReport: {
          Unknown: [{ name: 'unknown-package', versions: ['1.0.0'], paths: [unknownRoot] }],
          '(MIT OR GPL-3.0-only)': [
            { name: 'compound-package', versions: ['1.0.0'], paths: [compoundRoot] },
          ],
        },
        platform: 'darwin',
        architecture: 'arm64',
        licenseSelections: [],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        supplementalNotices: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([
        {
          packageIdentity: 'compound-package@1.0.0',
          message: '许可证 (MIT OR GPL-3.0-only) 缺少精确版本选择',
        },
        {
          packageIdentity: 'unknown-package@1.0.0',
          message: '存在未解除的 Unknown license',
        },
      ]);
      expect(result.bom).toBeUndefined();
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('把 importer 中的 URL tarball 映射为 package identity 并校验 integrity', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-source-bom-url-'));
    try {
      const xlsxRoot = createInstalledPackage({
        rootDir,
        name: 'xlsx',
        version: '0.20.3',
        license: 'Apache-2.0',
        source: 'https://sheetjs.com',
        licenseText: 'SheetJS Apache license\n',
      });
      const tarballUrl = 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz';
      const result = createSourceDependencyBom({
        rootDir,
        projectManifest: { name: 'linnya', version: '1.0.0' },
        lockfile: `importers:
  .:
    dependencies:
      xlsx:
        specifier: ${tarballUrl}
        version: ${tarballUrl}

packages:
  xlsx@${tarballUrl}:
    resolution:
      integrity: sha512-xlsx
      tarball: ${tarballUrl}
    version: 0.20.3
`,
        licenseReport: {
          'Apache-2.0': [{ name: 'xlsx', versions: ['0.20.3'], paths: [xlsxRoot] }],
        },
        platform: 'darwin',
        architecture: 'arm64',
        licenseSelections: [],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        supplementalNotices: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([]);
      expect(result.bom?.packages).toMatchObject([
        {
          name: 'xlsx',
          version: '0.20.3',
          integrity: 'sha512-xlsx',
        },
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
