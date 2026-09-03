import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ArtifactBundleComponentMap } from '../definitions/artifactBundleComponentMap';
import type { ArtifactPackageMap } from '../definitions/artifactPackageMap';
import { createArtifactPackageLegalEvidence } from './artifactPackageLegalEvidence';

function writePackage(input: {
  readonly license?: string;
  readonly licenses?: readonly Readonly<{ type: string }>[];
  readonly location: string;
  readonly name: string;
  readonly rootDir: string;
  readonly version: string;
}): void {
  const installedRoot = path.join(input.rootDir, input.location);
  fs.mkdirSync(installedRoot, { recursive: true });
  fs.writeFileSync(
    path.join(installedRoot, 'package.json'),
    JSON.stringify({
      name: input.name,
      version: input.version,
      ...(input.license ? { license: input.license } : {}),
      ...(input.licenses ? { licenses: input.licenses } : {}),
      repository: `https://github.com/example/${input.name}`,
    })
  );
  if (input.name !== '@app/schemas') {
    fs.writeFileSync(path.join(installedRoot, 'LICENSE'), `${input.name} license text\n`);
  }
}

function createPackageMap(): ArtifactPackageMap {
  return {
    schemaVersion: 1,
    kind: 'linnya-desktop-artifact-package-map',
    identity: { name: 'linnya', version: '1.0.0', platform: 'darwin', architecture: 'arm64' },
    source: { revision: 'abc123', dirty: false },
    environment: {
      platform: 'darwin',
      architecture: 'arm64',
      nodeVersion: '22.22.0',
      productionPackageLockSha256: 'b'.repeat(64),
    },
    contentBomSha256: 'a'.repeat(64),
    contentTreeSha256: 'c'.repeat(64),
    productionPackageLockSha256: 'b'.repeat(64),
    summary: {
      packageComponentCount: 3,
      packageLocationCount: 3,
      asarPackageEntryCount: 12,
      unpackedPackageEntryCount: 0,
    },
    components: [
      {
        id: 'workspace:@app/schemas@1.0.0',
        installKind: 'workspace',
        name: '@app/schemas',
        version: '1.0.0',
        integrities: [],
        resolved: [],
        lockLocations: ['node_modules/@app/schemas'],
        locations: [],
      },
      {
        id: 'registry:duck@0.1.12',
        installKind: 'registry',
        name: 'duck',
        version: '0.1.12',
        artifactDeclaredLicense: 'BSD',
        integrities: ['sha512-duck'],
        resolved: ['https://registry.npmjs.org/duck/-/duck-0.1.12.tgz'],
        lockLocations: ['node_modules/duck'],
        locations: [],
      },
      {
        id: 'registry:legacy-package@1.0.0',
        installKind: 'registry',
        name: 'legacy-package',
        version: '1.0.0',
        integrities: ['sha512-legacy'],
        resolved: ['https://registry.npmjs.org/legacy-package/-/legacy-package-1.0.0.tgz'],
        lockLocations: ['node_modules/legacy-package'],
        locations: [],
      },
    ],
    limitations: [
      { code: 'compiled-bundle-inputs-not-attributed', entryCount: 2, pathSamples: ['bundle.js'] },
      {
        code: 'non-npm-runtime-components-not-attributed',
        entryCount: 3,
        pathSamples: ['Electron'],
      },
      { code: 'license-evidence-not-attached', entryCount: 3, pathSamples: [] },
    ],
  };
}

function createBundleComponentMap(packageMap: ArtifactPackageMap): ArtifactBundleComponentMap {
  return {
    schemaVersion: 1,
    kind: 'linnya-desktop-artifact-bundle-component-map',
    identity: packageMap.identity,
    source: packageMap.source,
    environment: packageMap.environment,
    contentBomSha256: packageMap.contentBomSha256,
    contentTreeSha256: packageMap.contentTreeSha256,
    bundleTraceSetSha256: 'e'.repeat(64),
    occurrences: [],
    components: [{
      id: 'zod@3.25.76',
      name: 'zod',
      version: '3.25.76',
      buildTargets: ['desktop/main'],
    }],
    limitations: [{
      code: 'bundle-package-legal-evidence-not-attached',
      entryCount: 1,
      pathSamples: [],
    }],
    summary: {
      artifactOccurrenceCount: 0,
      buildTargetCount: 1,
      intermediateOutputCount: 0,
      npmPackageComponentCount: 1,
      traceOutputCount: 1,
    },
  };
}

describe('artifact package legal evidence', () => {
  it('只为真实第三方 package 生成 NOTICE，并单列 first-party 许可证状态', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-artifact-legal-'));
    try {
      writePackage({
        rootDir,
        location: 'node_modules/@app/schemas',
        name: '@app/schemas',
        version: '1.0.0',
      });
      writePackage({
        rootDir,
        location: 'node_modules/duck',
        name: 'duck',
        version: '0.1.12',
        license: 'BSD',
      });
      writePackage({
        rootDir,
        location: 'node_modules/legacy-package',
        name: 'legacy-package',
        version: '1.0.0',
        licenses: [{ type: 'MIT' }],
      });

      const packageMap = createPackageMap();
      const result = createArtifactPackageLegalEvidence({
        bundleComponentMap: createBundleComponentMap(packageMap),
        bundleComponentMapSha256: 'e'.repeat(64),
        packageMap,
        packageMapSha256: 'd'.repeat(64),
        productionInstallRoot: rootDir,
        firstPartyWorkspacePackageNames: ['@app/schemas'],
        licenseSelections: [
          {
            packageName: 'duck',
            version: '0.1.12',
            declaredExpression: 'BSD',
            selectedExpression: 'BSD-2-Clause',
          },
        ],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([]);
      expect(result.evidence?.summary).toEqual({
        artifactPackageComponentCount: 3,
        bundlePackageComponentCount: 1,
        firstPartyPackageCount: 1,
        thirdPartyPackageCount: 2,
        manifestOnlyThirdPartyPackageCount: 0,
        licenseDocumentCount: 2,
      });
      expect(result.evidence?.firstPartyComponents).toEqual([
        expect.objectContaining({
          componentId: 'workspace:@app/schemas@1.0.0',
          licenseState: 'project-license-pending',
        }),
      ]);
      expect(result.evidence?.thirdPartyComponents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            componentId: 'registry:duck@0.1.12',
            selectedLicense: 'BSD-2-Clause',
          }),
          expect.objectContaining({
            componentId: 'registry:legacy-package@1.0.0',
            declarationSource: 'manifest-legacy-license',
          }),
        ])
      );
      expect(result.notice).not.toContain('@app/schemas');
      expect(result.notice).not.toContain(rootDir);
      expect(result.evidence?.limitations.map(item => item.code)).not.toContain(
        'license-evidence-not-attached'
      );
      expect(result.evidence?.limitations.map(item => item.code)).toContain(
        'bundle-package-legal-evidence-not-attached'
      );
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('拒绝未登记的 workspace package owner', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linnya-artifact-owner-'));
    try {
      writePackage({
        rootDir,
        location: 'node_modules/@app/schemas',
        name: '@app/schemas',
        version: '1.0.0',
      });
      const packageMap = createPackageMap();
      const result = createArtifactPackageLegalEvidence({
        bundleComponentMap: createBundleComponentMap(packageMap),
        bundleComponentMapSha256: 'e'.repeat(64),
        packageMap: { ...packageMap, components: [packageMap.components[0]] },
        packageMapSha256: 'd'.repeat(64),
        productionInstallRoot: rootDir,
        firstPartyWorkspacePackageNames: [],
        licenseSelections: [],
        sourceOverrides: [],
        supplementalEvidenceFiles: [],
        unknownLicenseEvidence: [],
        reviewedEvidenceFiles: [],
        reviewedEvidenceRootDir: rootDir,
      });

      expect(result.problems).toEqual([
        {
          packageIdentity: '@app/schemas@1.0.0',
          message: '出现未登记的 first-party workspace package',
        },
      ]);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
