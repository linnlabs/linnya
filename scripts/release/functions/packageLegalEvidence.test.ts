import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectPackageLegalEvidence,
  readManifestLicenseDeclaration,
} from './packageLegalEvidence';

function createPackage(input: {
  readonly license?: unknown;
  readonly licenses?: unknown;
  readonly name: string;
  readonly repository?: string;
  readonly rootDir: string;
  readonly version: string;
}): string {
  const installedRoot = path.join(input.rootDir, 'node_modules', input.name);
  fs.mkdirSync(installedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installedRoot, 'package.json'),
    JSON.stringify({
      name: input.name,
      version: input.version,
      ...(input.license === undefined ? {} : { license: input.license }),
      ...(input.licenses === undefined ? {} : { licenses: input.licenses }),
      ...(input.repository ? { repository: input.repository } : {}),
    })
  );
  return installedRoot;
}

describe('package legal evidence', () => {
  it('用 integrity、源文件 hash 和行范围复核 registry tarball 内的许可证片段', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-reviewed-legal-'));
    try {
      const installedRoot = createPackage({
        rootDir,
        name: 'conflicting-package',
        version: '1.0.0',
        license: 'ISC',
        repository: 'https://github.com/example/conflicting-package',
      });
      const sourceDocument = 'Introduction\n# License\nMIT license text\nFooter\n';
      fs.writeFileSync(path.join(installedRoot, 'README.md'), sourceDocument);
      const evidencePath = 'evidence/conflicting-package-license.txt';
      fs.mkdirSync(path.join(rootDir, 'evidence'));
      fs.writeFileSync(path.join(rootDir, evidencePath), '# License\nMIT license text\n');
      const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

      const result = collectPackageLegalEvidence({
        rootDir,
        references: [
          {
            packageName: 'conflicting-package',
            version: '1.0.0',
            installedRoot,
            integrity: 'sha512-reviewed',
          },
        ],
        requireIntegrity: true,
        licenseSelections: [
          {
            packageName: 'conflicting-package',
            version: '1.0.0',
            declaredExpression: 'ISC',
            selectedExpression: 'MIT',
            reason: 'registry tarball README 提供了完整 MIT 正文',
          },
        ],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceRootDir: rootDir,
        reviewedEvidenceFiles: [
          {
            appliesTo: ['conflicting-package@1.0.0'],
            contentSha256: digest('# License\nMIT license text\n'),
            evidencePath,
            kind: 'license',
            reason: '精确 tarball README 片段',
            selectedLicense: 'MIT',
            source: {
              kind: 'installed-package-file-excerpt',
              packageName: 'conflicting-package',
              version: '1.0.0',
              integrity: 'sha512-reviewed',
              packagePath: 'README.md',
              documentSha256: digest(sourceDocument),
              startLine: 2,
              endLine: 3,
            },
          },
        ],
      });

      expect(result.problems).toEqual([]);
      expect(result.packages[0]).toMatchObject({
        declaredLicense: 'ISC',
        selectedLicense: 'MIT',
        licenseConclusionReason: 'registry tarball README 提供了完整 MIT 正文',
        evidence: 'files',
        evidenceFiles: [
          expect.objectContaining({
            origin: 'reviewed-upstream',
            relativePath: evidencePath,
          }),
        ],
      });
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('读取旧式 npm licenses[]，规范化来源并收集随包文本', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-package-legal-'));
    try {
      const installedRoot = createPackage({
        rootDir,
        name: 'legacy-package',
        version: '1.0.0',
        licenses: [{ type: 'MIT', url: 'https://opensource.org/license/mit' }],
        repository: 'github:example/legacy-package',
      });
      fs.writeFileSync(path.join(installedRoot, 'LICENSE'), 'MIT license text\n');
      const result = collectPackageLegalEvidence({
        rootDir,
        references: [
          {
            packageName: 'legacy-package',
            version: '1.0.0',
            installedRoot,
            integrity: 'sha512-legacy',
          },
        ],
        requireIntegrity: true,
        licenseSelections: [],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([]);
      expect(result.packages).toEqual([
        expect.objectContaining({
          name: 'legacy-package',
          declaredLicense: 'MIT',
          selectedLicense: 'MIT',
          declarationSource: 'manifest-legacy-license',
          source: 'https://github.com/example/legacy-package',
          evidence: 'files',
        }),
      ]);
      expect(result.documents).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(rootDir);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('拒绝没有精确版本结论的模糊 BSD 标识', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-package-bsd-'));
    try {
      const installedRoot = createPackage({
        rootDir,
        name: 'ambiguous-bsd',
        version: '1.0.0',
        license: 'BSD',
        repository: 'https://github.com/example/ambiguous-bsd',
      });
      const result = collectPackageLegalEvidence({
        rootDir,
        references: [
          {
            packageName: 'ambiguous-bsd',
            version: '1.0.0',
            installedRoot,
            integrity: 'sha512-bsd',
          },
        ],
        requireIntegrity: true,
        licenseSelections: [],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([
        {
          packageIdentity: 'ambiguous-bsd@1.0.0',
          message: '许可证 BSD 缺少精确版本选择',
        },
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('优先采用现代 license 字段，不被同包过时声明或另一输入图的精确策略降级', () => {
    expect(
      readManifestLicenseDeclaration({
        license: 'BSD-3-Clause',
        licenses: [{ type: 'BSD' }],
      })
    ).toEqual({ expression: 'BSD-3-Clause', source: 'manifest-license' });

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-package-modern-license-'));
    try {
      const installedRoot = createPackage({
        rootDir,
        name: 'modern-package',
        version: '1.0.0',
        license: 'BSD-3-Clause',
        licenses: [{ type: 'BSD' }],
        repository: 'https://github.com/example/modern-package',
      });
      const result = collectPackageLegalEvidence({
        rootDir,
        references: [
          {
            packageName: 'modern-package',
            version: '1.0.0',
            installedRoot,
            integrity: 'sha512-modern',
          },
        ],
        requireIntegrity: true,
        licenseSelections: [
          {
            packageName: 'modern-package',
            version: '1.0.0',
            declaredExpression: 'BSD',
            selectedExpression: 'BSD-3-Clause',
          },
        ],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([]);
      expect(result.packages[0]).toMatchObject({
        declaredLicense: 'BSD-3-Clause',
        selectedLicense: 'BSD-3-Clause',
      });
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
